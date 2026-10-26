// Internal preparation only. No browser, target request, approval or public private-state path.
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { authState } from "pi-ui-testing";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (root, path) => {
	const rel = relative(root, path);
	return !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../");
};
const blocked = () => new Error("私密录制快照已阻塞：核对受管身份、明确输入摘要、私有目录和有效期；停止后续动作");
async function inputFile(root, path) {
	if (
		typeof path !== "string" ||
		!path ||
		isAbsolute(path) ||
		path.includes("\\") ||
		path
			.split("/")
			.some(
				(p) =>
					!p ||
					[".", "..", ".git", ".pi", "node_modules", "auth.json", "models.json"].includes(p) ||
					/^\.env(?:\.|$)/.test(p),
			)
	)
		throw blocked();
	let file = root;
	for (const part of path.split("/")) {
		file = join(file, part);
		if ((await lstat(file)).isSymbolicLink()) throw blocked();
	}
	if (!(await lstat(file)).isFile() || !inside(root, await realpath(file))) throw blocked();
	return file;
}

/** Copy explicit, hash-bound inputs; derive an equally short-lived state for a child process only.
 * Imports/assets must be included explicitly. This does not prove an arbitrary project's input closure.
 * @param {{workspace: string, authority: string, inputRefs: {path: string, sha256: string}[], environment: import("pi-ui-testing").UiEnvironment}} options
 */
export async function preparePrivateRecordingWorkspace({ workspace, authority, inputRefs, environment }) {
	const operations = new Set();
	let directory,
		statePath,
		timer,
		revoked = false;
	const revoke = async () => {
		revoked = true;
		clearTimeout(timer);
		for (const finish of operations) finish();
		if (statePath) {
			try {
				await rm(statePath, { force: true });
			} catch {
				throw new Error("私密录制派生认证撤销失败；保留私有证据并停止后续动作");
			}
		}
		// Raw MCP files may now exist in the private snapshot. They are evidence, not disposable auth.
	};
	try {
		workspace = await realpath(workspace);
		const parentPath = await authState(environment, workspace);
		if (!parentPath) throw blocked();
		const parentBytes = await readFile(parentPath),
			parent = JSON.parse(parentBytes);
		if (!parent.pi_ui_private || parent.pi_ui_private.version !== 1 || parent.pi_ui_private.workspace !== workspace)
			throw blocked();
		const expires = Math.min(Date.parse(parent.pi_ui_private.expiresAt), Date.now() + 5 * 60_000);
		if (!Number.isFinite(expires) || expires <= Date.now()) throw blocked();
		const authorityInfo = await lstat(authority);
		if (!authorityInfo.isDirectory() || authorityInfo.isSymbolicLink() || authorityInfo.mode & 0o077) throw blocked();
		authority = await realpath(authority);
		if (inside(workspace, authority) || inside(authority, workspace)) throw blocked();
		if (!Array.isArray(inputRefs) || !inputRefs.length) throw blocked();
		const refs = [],
			inputs = new Map();
		for (const ref of inputRefs) {
			if (!ref || !/^[a-f0-9]{64}$/.test(ref.sha256) || inputs.has(ref.path)) throw blocked();
			const bytes = await readFile(await inputFile(workspace, ref.path));
			if (digest(bytes) !== ref.sha256) throw blocked();
			inputs.set(ref.path, bytes);
			refs.push({ path: ref.path, sha256: ref.sha256 });
		}
		// Only dependencies are shared. No source directory link can redirect captures into the public project.
		const dependencies = await realpath(join(workspace, "node_modules"));
		if (!(await lstat(dependencies)).isDirectory()) throw blocked();
		directory = join(authority, `recording-${randomUUID()}`);
		await mkdir(directory, { mode: 0o700 });
		const mirror = join(directory, "work");
		await mkdir(mirror, { mode: 0o700 });
		for (const [path, bytes] of inputs) {
			const file = join(mirror, path);
			await mkdir(dirname(file), { recursive: true, mode: 0o700 });
			await writeFile(file, bytes, { mode: 0o600, flag: "wx" });
		}
		await symlink(dependencies, join(mirror, "node_modules"), "dir");
		statePath = join(directory, "state.json");
		const derived = Buffer.from(
			JSON.stringify({
				...parent,
				pi_ui_private: { ...parent.pi_ui_private, workspace: mirror, expiresAt: new Date(expires).toISOString() },
			}),
		);
		await writeFile(statePath, derived, { mode: 0o600, flag: "wx" });
		const assertCurrent = async () => {
			try {
				if (
					revoked ||
					Date.now() >= expires ||
					(await authState(environment, workspace)) !== parentPath ||
					!(await readFile(parentPath)).equals(parentBytes)
				)
					throw blocked();
				for (const path of [authority, directory, mirror]) {
					const info = await lstat(path);
					if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077 || (await realpath(path)) !== path)
						throw blocked();
				}
				const stateInfo = await lstat(statePath);
				if (
					!stateInfo.isFile() ||
					stateInfo.isSymbolicLink() ||
					stateInfo.mode & 0o077 ||
					!(await readFile(statePath)).equals(derived)
				)
					throw blocked();
				for (const ref of refs) {
					for (const root of [workspace, mirror])
						if (digest(await readFile(await inputFile(root, ref.path))) !== ref.sha256) throw blocked();
				}
			} catch {
				await revoke();
				throw blocked();
			}
		};
		timer = setTimeout(
			() => {
				void revoke().catch(() => {});
			},
			Math.max(1, expires - Date.now()),
		);
		timer.unref();
		await assertCurrent();
		/** Bind one MCP request to this snapshot. Finish before delivering its reply to the SDK,
		 * whose send signal also aborts when a request completes normally.
		 * @param {AbortSignal | undefined} signal
		 */
		const beginOperation = async (signal) => {
			let active = true;
			const finish = () => {
				active = false;
				signal?.removeEventListener("abort", onAbort);
				operations.delete(finish);
			};
			const onAbort = () => {
				void revoke().catch(() => {});
			};
			const assertActive = () => {
				if (!active || revoked || signal?.aborted) throw blocked();
			};
			operations.add(finish);
			signal?.addEventListener("abort", onAbort, { once: true });
			try {
				if (signal?.aborted) await revoke();
				assertActive();
				await assertCurrent();
				assertActive();
				return {
					assertActive,
					finish,
					/** The exclusive filesystem publication must be synchronous after the final check.
					 * @param {() => void} write
					 */
					publish: async (write) => {
						try {
							assertActive();
							await assertCurrent();
							assertActive();
							write();
						} finally {
							finish();
						}
					},
				};
			} catch (error) {
				finish();
				throw error;
			}
		};
		return {
			// Internal fields must never be returned as ordinary tool output.
			workspace: mirror,
			childEnv: /** @type {Record<string, string>} */ ({ [environment.auth.reference]: statePath }),
			assertCurrent,
			beginOperation,
			revoke,
			receipt: {
				status: "private-snapshot-prepared",
				inputs: refs,
				expiresAt: new Date(expires).toISOString(),
				authentication: "unknown",
				role: "unknown",
				data: "unknown",
				inputClosure: "explicit-inputs-only",
			},
		};
	} catch {
		await revoke();
		if (directory)
			await rm(directory, { recursive: true, force: true }).catch(() => {
				throw blocked();
			});
		throw blocked();
	}
}
