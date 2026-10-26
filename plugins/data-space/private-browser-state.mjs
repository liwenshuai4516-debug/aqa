/** Execution-only parameter bridge. Owns short-lived private files/references, never browser or network work. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, lstatSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { dynamicFresh, dynamicKeys, scriptReady } from "./env-script.mjs";
import { environmentPreparation } from "./environment-preparation.mjs";
import { environmentUrl } from "./test-channel.mjs";

const inside = (root, path) => {
	const rel = relative(root, path);
	return !isAbsolute(rel) && rel !== ".." && !rel.startsWith("../");
};
const blocked = () =>
	new Error("私密浏览器准备未就绪：核对执行模式、明确环境、参数映射、有效期及兼容原生运行包；未启动浏览器");
export function createPrivateBrowserStates({ dataDir, store, log = () => {} }) {
	const entries = new Map();
	let disposed = false,
		cleanupFailures = 0;
	function revoke(reference) {
		const entry = entries.get(reference);
		if (!entry) return;
		clearTimeout(entry.timer);
		delete process.env[reference];
		entries.delete(reference);
		try {
			rmSync(entry.directory, { recursive: true, force: true });
		} catch {
			cleanupFailures++;
			log("error", "私密引用已撤销，但宿主私有临时文件清理失败");
		}
	}
	function reconcile() {
		for (const [reference, entry] of entries) {
			const env = store().envs.find((e) => e.id === entry.envId);
			if (JSON.stringify(env) !== entry.snapshot || Date.now() >= entry.expires) revoke(reference);
		}
	}
	async function prepare(cwd, input, signal) {
		if (disposed) throw blocked();
		signal?.throwIfAborted();
		// The optional native runtime must enforce this contract, including on direct authState calls.
		let runtime;
		try {
			const require = createRequire(import.meta.url);
			runtime = await import(require.resolve("pi-ui-testing"));
		} catch {
			throw blocked();
		}
		if (runtime.managedAuthStateVersion !== 1 || disposed) throw blocked();
		signal?.throwIfAborted();
		const s = store(),
			env = s.envs.find((e) => e.id === input.envId && e.systemId === input.systemId);
		if (
			input.engine !== "ui" ||
			input.mode !== "execute" ||
			!input.systemId ||
			!input.envId ||
			!env ||
			!s.systems.some((p) => p.id === env.systemId)
		)
			throw blocked();
		let base, target, workspace;
		try {
			base = new URL(environmentUrl(env.baseUrl));
			target = new URL(environmentUrl(input.targetUrl));
			workspace = realpathSync(cwd);
		} catch {
			throw blocked();
		}
		if (!(target.href === base.href || target.href.startsWith(base.href.replace(/\/+$/, "") + "/"))) throw blocked();
		const preparation = environmentPreparation(env, { mode: "execute" });
		if (preparation.parameters.state !== "ready") throw blocked();
		const configured = scriptReady(env.script),
			fresh = configured && dynamicFresh(env);
		const reserved = new Set(
			[...(configured ? dynamicKeys(env.script) : []), ...(env.dynamic ?? []).map((p) => p.key)].map((k) =>
				k.toLowerCase(),
			),
		);
		const values = new Map(
			[...(env.params ?? []).filter((p) => !reserved.has(p.key.toLowerCase())), ...(fresh ? env.dynamic : [])].map(
				(p) => [p.key, p],
			),
		);
		if (!Array.isArray(input.privateBindings) || !input.privateBindings.length || input.privateBindings.length > 30)
			throw blocked();
		let expires = Date.now() + 5 * 60_000;
		const names = new Set(),
			localStorage = [];
		for (const binding of input.privateBindings) {
			const item = values.get(binding?.parameterKey),
				name = binding?.storageKey;
			if (
				typeof name !== "string" ||
				!name ||
				name.length > 100 ||
				names.has(name) ||
				!item ||
				typeof item.value !== "string" ||
				!item.value ||
				item.value === "***"
			)
				throw blocked();
			names.add(name);
			localStorage.push({ name, value: item.value });
			if (item.expiresAt) expires = Math.min(expires, Date.parse(item.expiresAt));
		}
		if (!Number.isFinite(expires) || expires <= Date.now()) throw blocked();
		let directory, reference;
		try {
			const parent = join(realpathSync(dataDir), "data-space", "private-browser");
			if (inside(workspace, parent)) throw blocked();
			mkdirSync(parent, { recursive: true, mode: 0o700 });
			const info = lstatSync(parent);
			if (info.isSymbolicLink() || !info.isDirectory() || info.mode & 0o077 || inside(workspace, realpathSync(parent)))
				throw blocked();
			directory = mkdtempSync(join(parent, "state-"));
			// Logical identity remains stable across explicit refresh/restart; no secret values enter its digest.
			reference =
				"PI_UI_DATA_SPACE_" +
				createHash("sha256")
					.update(
						JSON.stringify([
							workspace,
							env.systemId,
							env.id,
							base.href,
							input.privateBindings
								.map(({ parameterKey, storageKey }) => [parameterKey, storageKey])
								.sort((a, b) => a[1].localeCompare(b[1])),
						]),
					)
					.digest("hex")
					.toUpperCase();
			const path = join(directory, "state.json");
			writeFileSync(
				path,
				JSON.stringify({
					cookies: [],
					origins: [{ origin: base.origin, localStorage }],
					pi_ui_private: {
						version: 1,
						reference,
						workspace,
						origin: base.origin,
						baseUrl: base.href,
						expiresAt: new Date(expires).toISOString(),
					},
				}),
				{ mode: 0o600, flag: "wx" },
			);
			revoke(reference);
			process.env[reference] = path;
			const timer = setTimeout(() => revoke(reference), expires - Date.now());
			timer.unref();
			entries.set(reference, { envId: env.id, snapshot: JSON.stringify(env), directory, expires, timer, workspace });
		} catch {
			if (reference) {
				revoke(reference);
				delete process.env[reference];
			}
			if (directory) {
				try {
					rmSync(directory, { recursive: true, force: true });
				} catch {
					cleanupFailures++;
					log("error", "私密引用准备失败，宿主私有临时文件清理未完成");
				}
			}
			throw blocked();
		}
		return {
			ok: true,
			status: "prepared-private-execution",
			systemId: env.systemId,
			envId: env.id,
			revision: s.revision,
			auth: { kind: "storage-state-env", reference },
			expiresAt: new Date(expires).toISOString(),
			preparation: {
				configuration: "matched",
				privateExecution: "reference-created",
				authentication: "unknown",
				role: "unknown",
				data: "unknown",
				recording: "unsupported",
				cleanupFailures,
			},
		};
	}
	return {
		prepare,
		reconcile,
		disconnect(cwd, envId) {
			const workspace = realpathSync(cwd);
			for (const [reference, entry] of entries)
				if (entry.workspace === workspace && (!envId || entry.envId === envId)) revoke(reference);
		},
		dispose() {
			disposed = true;
			for (const reference of entries.keys()) revoke(reference);
		},
	};
}
