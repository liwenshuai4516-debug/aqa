import { afterEach, expect, it, vi } from "vitest";
import {
	accessSync,
	cpSync,
	writeFileSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrivateBrowserStates } from "../../plugins/data-space/private-browser-state.mjs";
import { extensionToolDenial } from "../../server/extension-tool-gate";
import { authState } from "pi-ui-testing";

const dispose: Array<() => void> = [];
afterEach(() => {
	for (const f of dispose.splice(0).reverse()) f();
	vi.useRealTimers();
});
function fixture() {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "data-space-private-unit-")));
	dispose.push(() => rmSync(base, { recursive: true, force: true }));
	const cwd = join(base, "workspace"),
		dataDir = join(base, "data");
	mkdirSync(cwd);
	mkdirSync(dataDir);
	const store: any = {
		revision: 1,
		systems: [{ id: "s" }],
		envs: [
			{
				id: "e",
				systemId: "s",
				baseUrl: "http://127.0.0.1:18990",
				params: [{ key: "token", value: 'synthetic+/private-"token', secret: true }],
			},
		],
	};
	const manager = createPrivateBrowserStates({ dataDir, store: () => store });
	dispose.push(() => manager.dispose());
	const input = {
		engine: "ui",
		mode: "execute",
		systemId: "s",
		envId: "e",
		targetUrl: "http://127.0.0.1:18990/app",
		privateBindings: [{ parameterKey: "token", storageKey: "token" }],
	};
	return {
		base,
		cwd,
		dataDir,
		store,
		manager,
		input,
		prepare: (extra = {}, signal?: AbortSignal) => manager.prepare(cwd, { ...input, ...extra }, signal),
	};
}
it("creates a native consumable private reference without leaking the state or changing the store", async () => {
	const f = fixture(),
		before = JSON.stringify(f.store),
		result = await f.prepare();
	const path = process.env[result.auth.reference]!;
	expect(JSON.stringify(result)).not.toContain(path);
	expect(JSON.stringify(result)).not.toContain(f.store.envs[0].params[0].value);
	expect(JSON.stringify(f.store)).toBe(before);
	expect(result.preparation).toMatchObject({
		authentication: "unknown",
		role: "unknown",
		data: "unknown",
		recording: "unsupported",
	});
	expect(statSync(path).mode & 0o777).toBe(0o600);
	expect(await authState({ auth: result.auth, base_url: f.input.targetUrl } as never, f.cwd)).toBe(path);
	expect(JSON.parse(readFileSync(path, "utf8")).origins[0].localStorage[0].value).toBe(f.store.envs[0].params[0].value);
	f.manager.dispose();
	expect(process.env[result.auth.reference]).toBeUndefined();
	expect(() => accessSync(path)).toThrow();
	await expect(f.prepare()).rejects.toThrow("未就绪");
});
it("reuses fresh dynamic values and caps the private lifetime at the dynamic expiry", async () => {
	const f = fixture(),
		expiresAt = new Date(Date.now() + 20000).toISOString();
	f.store.envs[0].script = { enabled: true, steps: [{ url: "/login", extract: [{ key: "token", secret: true }] }] };
	f.store.envs[0].dynamic = [
		{ key: "token", value: "synthetic-fresh-dynamic", secret: true, at: new Date().toISOString(), expiresAt },
	];
	const r = await f.prepare(),
		path = process.env[r.auth.reference]!;
	expect(r.expiresAt).toBe(expiresAt);
	expect(JSON.parse(readFileSync(path, "utf8")).origins[0].localStorage[0].value).toBe("synthetic-fresh-dynamic");
	f.store.envs[0].dynamic[0].expiresAt = new Date(Date.now() - 1).toISOString();
	f.manager.reconcile();
	expect(process.env[r.auth.reference]).toBeUndefined();
	await expect(f.prepare()).rejects.toThrow("未就绪");
});
it("rejects absent/mismatched environments, recording, bad mappings, stale values and foreign targets", async () => {
	const f = fixture();
	for (const extra of [
		{ systemId: "other" },
		{ envId: "other" },
		{ targetUrl: "http://127.0.0.1:18991/app" },
		{ targetUrl: "http://u:p@127.0.0.1:18990/app" },
		{ mode: "record" },
		{ engine: "api" },
		{ privateBindings: [] },
		{ privateBindings: [{ parameterKey: "missing", storageKey: "token" }] },
		{ privateBindings: [f.input.privateBindings[0], f.input.privateBindings[0]] },
	])
		await expect(f.prepare(extra)).rejects.toThrow("未就绪");
	await expect(f.prepare({}, AbortSignal.abort())).rejects.toThrow();
	f.store.envs[0].script = { enabled: true, steps: [{ url: "/login", extract: [{ key: "token", secret: true }] }] };
	await expect(f.prepare()).rejects.toThrow("未就绪");
});
it("revokes changed environments and disconnects only matching workspace/environment references", async () => {
	const f = fixture(),
		first = await f.prepare();
	f.store.envs[0].params[0].value = "changed-secret";
	f.manager.reconcile();
	expect(process.env[first.auth.reference]).toBeUndefined();
	const second = await f.prepare();
	f.manager.disconnect(f.cwd, "other");
	expect(process.env[second.auth.reference]).toBeDefined();
	f.manager.disconnect(f.cwd, "e");
	expect(process.env[second.auth.reference]).toBeUndefined();
});
it("expires references and private files without waiting for a later tool call", async () => {
	vi.useFakeTimers();
	const f = fixture(),
		r = await f.prepare(),
		path = process.env[r.auth.reference]!;
	vi.advanceTimersByTime(300000);
	expect(process.env[r.auth.reference]).toBeUndefined();
	expect(() => accessSync(path)).toThrow();
});
it("rejects private directories inside a workspace and symlink escapes", async () => {
	const f = fixture();
	const nested = createPrivateBrowserStates({ dataDir: f.cwd, store: () => f.store });
	dispose.push(() => nested.dispose());
	await expect(nested.prepare(f.cwd, f.input)).rejects.toThrow("未就绪");
	mkdirSync(join(f.dataDir, "data-space"));
	symlinkSync(f.cwd, join(f.dataDir, "data-space/private-browser"));
	await expect(f.prepare()).rejects.toThrow("未就绪");
});
it("keeps prepare-private behind existing plan/read-only/delegate guards", () => {
	// Reuse exactly the public effect classification used by actual plugin tool execution.
	for (const options of [
		{ planMode: true },
		{ delegateMode: true },
		{ goalReview: true },
		{ permission: "read-only" },
	]) {
		expect(extensionToolDenial("data_space_automation", { action: "prepare-private" }, options as never)).toBeTruthy();
	}
});

it("renews a stable logical reference without changing frozen asset configuration", async () => {
	const f = fixture(),
		first = await f.prepare(),
		oldPath = process.env[first.auth.reference]!;
	const next = await f.prepare();
	expect(next.auth).toEqual(first.auth);
	expect(process.env[next.auth.reference]).not.toBe(oldPath);
	expect(() => accessSync(oldPath)).toThrow();
	expect(await authState({ auth: next.auth, base_url: f.input.targetUrl } as never, f.cwd)).toBe(
		process.env[next.auth.reference],
	);
});

it("refuses an incompatible native contract without writing private state", async () => {
	const f = fixture(),
		copied = join(f.base, "plugin");
	cpSync(new URL("../../plugins/data-space/", import.meta.url), copied, { recursive: true });
	const stub = join(copied, "node_modules/pi-ui-testing");
	mkdirSync(stub, { recursive: true });
	writeFileSync(
		join(stub, "package.json"),
		JSON.stringify({ name: "pi-ui-testing", type: "module", exports: "./index.mjs" }),
	);
	writeFileSync(join(stub, "index.mjs"), "export const managedAuthStateVersion=0;");
	const { pathToFileURL } = await import("node:url");
	const { createPrivateBrowserStates: create } = await import(
		pathToFileURL(join(copied, "private-browser-state.mjs")).href
	);
	const incompatible = create({ dataDir: f.dataDir, store: () => f.store });
	dispose.push(() => incompatible.dispose());
	await expect(incompatible.prepare(f.cwd, f.input)).rejects.toThrow("未就绪");
	expect(() => accessSync(join(f.dataDir, "data-space/private-browser"))).toThrow();
});
