import { afterEach, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { authState, type UiEnvironment } from "pi-ui-testing";
import { preparePrivateRecordingWorkspace } from "../../.pi/skills/ui-testing-workflow/assets/private-recording-workspace.mjs";
const roots: string[] = [],
	references: string[] = [],
	prepared: Array<{ revoke(): Promise<void> }> = [];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
afterEach(async () => {
	for (const item of prepared.splice(0)) await item.revoke();
	for (const reference of references.splice(0)) delete process.env[reference];
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "recording-workspace-")));
	roots.push(root);
	const workspace = join(root, "public"),
		authority = join(root, "host"),
		parentDirectory = join(root, "parent");
	for (const path of [workspace, authority, parentDirectory, join(workspace, "tests")])
		await mkdir(path, { mode: 0o700 });
	await symlink(await realpath("node_modules"), join(workspace, "node_modules"), "dir");
	const reference = `PI_UI_DATA_SPACE_${randomUUID().replaceAll("-", "").toUpperCase()}`;
	references.push(reference);
	const parentPath = join(parentDirectory, "state.json"),
		base = "http://127.0.0.1:18983/";
	const environment: UiEnvironment = {
		schema_version: "1.0",
		environment_id: "synthetic",
		deployment_version: "fixture-v1",
		base_url: base,
		role: "fixture",
		identity: { selector: "h1", text: "fixture" },
		initial_state: { selector: "h1", text: "fixture" },
		isolation: "context",
		timeout_ms: 1000,
		auth: { kind: "storage-state-env", reference },
	};
	const state = {
		cookies: [],
		origins: [{ origin: new URL(base).origin, localStorage: [{ name: "token", value: "synthetic-" + randomUUID() }] }],
		pi_ui_private: {
			version: 1,
			reference,
			workspace,
			origin: new URL(base).origin,
			baseUrl: base,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		},
	};
	await writeFile(parentPath, JSON.stringify(state), { mode: 0o600 });
	process.env[reference] = parentPath;
	const files = {
		"package.json": '{"type":"module"}',
		"playwright.config.mjs": "export default {testDir:'./tests'};",
		"tests/seed.spec.ts": "export {};",
	};
	const inputRefs = [];
	for (const [path, code] of Object.entries(files)) {
		const bytes = Buffer.from(code);
		await writeFile(join(workspace, path), bytes);
		inputRefs.push({ path, sha256: hash(bytes) });
	}
	const input = { workspace, authority, inputRefs, environment };
	const prepare = async () => {
		const value = await preparePrivateRecordingWorkspace(input);
		prepared.push(value);
		return value;
	};
	return { root, workspace, authority, reference, parentPath, state, input, prepare };
}

it("keeps parent scope intact while a child consumes an exact, equally expiring managed state", async () => {
	const f = await fixture(),
		before = await readFile(f.parentPath),
		value = await f.prepare();
	await expect(authState(f.input.environment, value.workspace)).rejects.toThrow();
	const childPath = value.childEnv[f.reference],
		derived = JSON.parse(await readFile(childPath, "utf8"));
	expect(derived.pi_ui_private.workspace).toBe(value.workspace);
	expect(derived.pi_ui_private.expiresAt).toBe(f.state.pi_ui_private.expiresAt);
	expect(derived.origins).toEqual(f.state.origins);
	const entry = pathToFileURL(createRequire(import.meta.url).resolve("pi-ui-testing")).href;
	const code = `import {authState} from ${JSON.stringify(entry)};const p=await authState(${JSON.stringify(f.input.environment)},${JSON.stringify(value.workspace)});if(!p)throw Error('missing');console.log('scope-valid');`;
	expect(
		execFileSync(process.execPath, ["--input-type=module", "--eval", code], {
			env: { PATH: process.env.PATH, ...value.childEnv },
			encoding: "utf8",
		}).trim(),
	).toBe("scope-valid");
	expect(process.env[f.reference]).toBe(f.parentPath);
	expect(await readFile(f.parentPath)).toEqual(before);
	for (const ref of f.input.inputRefs) expect(hash(await readFile(join(value.workspace, ref.path)))).toBe(ref.sha256);
	expect((await lstat(childPath)).mode & 0o777).toBe(0o600);
	expect((await lstat(value.workspace)).mode & 0o777).toBe(0o700);
	expect(await realpath(join(value.workspace, "node_modules"))).toBe(await realpath(join(f.workspace, "node_modules")));
	const receipt = JSON.stringify(value.receipt);
	expect(receipt).not.toContain(f.state.origins[0].localStorage[0].value);
	expect(receipt).not.toContain(childPath);
	expect(value.receipt.authentication).toBe("unknown");
	await value.assertCurrent();
});
it("rejects source mutations even when both copies are changed to identical bytes", async () => {
	const f = await fixture(),
		value = await f.prepare(),
		childPath = value.childEnv[f.reference];
	for (const root of [f.workspace, value.workspace]) await writeFile(join(root, "tests/seed.spec.ts"), "changed");
	await expect(value.assertCurrent()).rejects.toThrow("阻塞");
	await expect(access(childPath)).rejects.toThrow();
});
it("revokes on parent renewal, missing reference and expiry instead of using copied old authentication", async () => {
	for (const change of ["renewed", "missing", "expired"]) {
		const f = await fixture(),
			value = await f.prepare();
		if (change === "renewed")
			await writeFile(
				f.parentPath,
				JSON.stringify({
					...f.state,
					origins: [{ ...f.state.origins[0], localStorage: [{ name: "token", value: "renewed" }] }],
				}),
			);
		if (change === "missing") delete process.env[f.reference];
		if (change === "expired")
			await writeFile(
				f.parentPath,
				JSON.stringify({ ...f.state, pi_ui_private: { ...f.state.pi_ui_private, expiresAt: "2000-01-01T00:00:00Z" } }),
			);
		await expect(value.assertCurrent()).rejects.toThrow("阻塞");
		await expect(access(value.childEnv[f.reference])).rejects.toThrow();
	}
});
it("preserves raw private evidence when derived authentication is revoked", async () => {
	const f = await fixture(),
		value = await f.prepare(),
		raw = join(value.workspace, "private-capture.txt");
	await writeFile(raw, "private raw capture", { mode: 0o600 });
	await value.revoke();
	await value.revoke();
	expect(await readFile(raw, "utf8")).toBe("private raw capture");
	await expect(access(value.childEnv[f.reference])).rejects.toThrow();
	expect(await authState(f.input.environment, f.workspace)).toBe(f.parentPath);
});
it("rejects escape, symlink, stale digest and incomplete authority permissions before returning a workspace", async () => {
	for (const mode of ["escape", "symlink", "digest", "permissions", "public-authority", "unmanaged"]) {
		const f = await fixture();
		if (mode === "escape") f.input.inputRefs[0].path = "../parent/state.json";
		if (mode === "symlink") {
			await rm(join(f.workspace, "tests/seed.spec.ts"));
			await symlink(f.parentPath, join(f.workspace, "tests/seed.spec.ts"));
		}
		if (mode === "digest") f.input.inputRefs[0].sha256 = "0".repeat(64);
		if (mode === "permissions") await chmod(f.authority, 0o755);
		if (mode === "public-authority") f.input.authority = f.workspace;
		if (mode === "unmanaged") {
			const { pi_ui_private, ...unmanaged } = f.state;
			await writeFile(f.parentPath, JSON.stringify(unmanaged));
		}
		await expect(f.prepare()).rejects.toThrow("阻塞");
	}
});
it("blocks tampered derived state and private directory permissions", async () => {
	for (const mode of ["state", "directory", "authority"]) {
		const f = await fixture(),
			value = await f.prepare();
		if (mode === "state") await writeFile(value.childEnv[f.reference], "{}");
		else await chmod(mode === "authority" ? f.authority : value.workspace, 0o755);
		await expect(value.assertCurrent()).rejects.toThrow("阻塞");
		await expect(access(value.childEnv[f.reference])).rejects.toThrow();
	}
});

it("caps a distant parent deadline without extending authentication or overflowing the revocation timer", async () => {
	const f = await fixture();
	await writeFile(
		f.parentPath,
		JSON.stringify({ ...f.state, pi_ui_private: { ...f.state.pi_ui_private, expiresAt: "2099-01-01T00:00:00Z" } }),
	);
	const started = Date.now(),
		value = await f.prepare();
	const derived = JSON.parse(await readFile(value.childEnv[f.reference], "utf8"));
	expect(Date.parse(derived.pi_ui_private.expiresAt)).toBeGreaterThan(started);
	expect(Date.parse(derived.pi_ui_private.expiresAt)).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
	expect(value.receipt.expiresAt).toBe(derived.pi_ui_private.expiresAt);
	await value.assertCurrent();
});
