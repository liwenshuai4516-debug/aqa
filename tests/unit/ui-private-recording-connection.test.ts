import { afterEach, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonRpcMessage } from "@earendil-works/pi-mcp";
import { PrivateEvidence, type UiEnvironment } from "pi-ui-testing";
import { preparePrivateRecordingWorkspace } from "../../.pi/skills/ui-testing-workflow/assets/private-recording-workspace.mjs";
import { createPrivateRecordingConnection } from "../../.pi/skills/ui-testing-workflow/assets/private-recording-connection.mjs";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(unexpectedRequest = false) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "recording-connection-")));
	cleanup.push(() => rm(root, { recursive: true, force: true }));
	const workspace = join(root, "public"),
		authority = join(root, "authority"),
		parent = join(root, "parent");
	for (const path of [workspace, authority, parent]) await mkdir(path, { mode: 0o700 });
	for (const name of ["@playwright/test", "playwright"]) {
		await mkdir(join(workspace, "node_modules", name), { recursive: true });
		await writeFile(join(workspace, "node_modules", name, "package.json"), JSON.stringify({ name, version: "0.0.0" }));
	}
	const secret = "synthetic-" + randomUUID(),
		reference = "PI_UI_DATA_SPACE_" + randomUUID().replaceAll("-", "").toUpperCase();
	const state = join(parent, "state.json");
	const environment: UiEnvironment = {
		schema_version: "1.0",
		environment_id: "fixture",
		deployment_version: "fixture",
		role: "fixture",
		base_url: "http://127.0.0.1:18983/",
		identity: { selector: "h1", text: "Fixture" },
		initial_state: { selector: "h1", text: "Fixture" },
		isolation: "context",
		timeout_ms: 1000,
		auth: { kind: "storage-state-env", reference },
	};
	await writeFile(
		state,
		JSON.stringify({
			cookies: [],
			origins: [{ origin: "http://127.0.0.1:18983", localStorage: [{ name: "token", value: secret }] }],
			pi_ui_private: {
				version: 1,
				reference,
				workspace,
				origin: "http://127.0.0.1:18983",
				baseUrl: environment.base_url,
				expiresAt: new Date(Date.now() + 60000).toISOString(),
			},
		}),
		{ mode: 0o600 },
	);
	process.env[reference] = state;
	cleanup.push(async () => {
		delete process.env[reference];
	});
	// Controlled stdio server reflects a known synthetic value during handshake, without a browser.
	await writeFile(
		join(workspace, "node_modules/playwright/cli.js"),
		`
const fs = require('node:fs');
const secret = JSON.parse(fs.readFileSync(process.env[${JSON.stringify(reference)}], 'utf8')).origins[0].localStorage[0].value;
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
 const m = JSON.parse(line); if (m.id === undefined) return;
 if (m.method === 'tools/call') fs.writeFileSync('dispatched-browser', 'unexpected');
 const result = m.method === 'initialize' ? {protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'},instructions:secret} : {tools:[{name:'fixture',description:secret,inputSchema:{type:'object'}}]};
 const reply = () => { if (${unexpectedRequest}) process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:'unexpected',method:'unknown/private',params:{value:secret}})+String.fromCharCode(10)); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result,extra:secret})+'\\n'); };
 if (m.params && m.params.delay) setTimeout(reply, 50); else reply();
});
`,
	);
	const config = Buffer.from("export default {};");
	await writeFile(join(workspace, "playwright.config.mjs"), config);
	const privacy = (await PrivateEvidence.create(workspace, authority, environment, "qa/ui/recordings/fixture"))!;
	const snapshot = await preparePrivateRecordingWorkspace({
		workspace,
		authority: privacy.directory,
		environment,
		inputRefs: [{ path: "playwright.config.mjs", sha256: createHash("sha256").update(config).digest("hex") }],
	});
	cleanup.push(() => snapshot.revoke());
	const connection = createPrivateRecordingConnection({
		snapshot,
		privacy,
		...(unexpectedRequest
			? {
					capture: {
						protocol: "chromium-single-page-v1" as const,
						seedRef: { path: "tests/seed.spec.ts", sha256: "0".repeat(64) },
						project: "chromium",
						outputFile: "tests/generated.spec.ts",
						maxSteps: 4,
						maxToolCalls: 9,
						reservedToolCalls: 9,
					},
					captureContext: { workspace, environment, sessionId: "fixture" },
				}
			: {}),
		receipt: { session_ref: { path: "fixture", sha256: "0".repeat(64) }, ...snapshot.receipt },
	});
	cleanup.push(() => connection.close());
	const responses: JsonRpcMessage[] = [];
	connection.onMessage((message) => responses.push(message));
	async function handshake() {
		const done = new Promise<JsonRpcMessage>((resolve) => {
			const off = connection.onMessage((message) => {
				off();
				resolve(message);
			});
		});
		await connection.start();
		await connection.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
		return done;
	}
	return { root, secret, state, reference, snapshot, privacy, connection, responses, handshake };
}
it("filters a real stdio handshake with the native filter and retains its original private response", async () => {
	const f = await fixture();
	const output = await f.handshake();
	expect(JSON.stringify(output)).not.toContain(f.secret);
	expect(JSON.stringify(output)).toContain("[PRIVATE]");
	const capture = join(f.privacy.directory, "handshake-1.json");
	expect(await readFile(capture, "utf8")).toContain(f.secret);
	expect((await lstat(capture)).mode & 0o777).toBe(0o600);
	await f.snapshot.assertCurrent();
	await f.connection.close();
	await expect(access(f.snapshot.childEnv[f.reference])).rejects.toThrow();
	expect(await readFile(f.state, "utf8")).toContain(f.secret);
});
it("preserves JSON-RPC framing when a private storage value equals the protocol version", async () => {
	const f = await fixture();
	f.privacy.observeStorageState({
		cookies: [],
		origins: [{ origin: "http://127.0.0.1:18983", localStorage: [{ name: "version", value: "2.0" }] }],
	});
	const output = await f.handshake();
	expect(output).toMatchObject({ jsonrpc: "2.0", id: 1, result: { instructions: "[PRIVATE]" }, extra: "[PRIVATE]" });
	expect(JSON.stringify(output)).not.toContain(f.secret);
	await f.snapshot.assertCurrent();
});
it("rejects unexpected server requests instead of converting them into notifications", async () => {
	const f = await fixture(true);
	await f.handshake();
	await expect(f.snapshot.assertCurrent()).rejects.toThrow();
	expect(JSON.stringify(f.responses)).not.toContain(f.secret);
	expect(f.responses.some((message) => "method" in message)).toBe(false);
	const raw = await Promise.all(
		(await readdir(f.privacy.directory))
			.filter((name) => /^handshake-\d+\.json$/.test(name))
			.map((name) => readFile(join(f.privacy.directory, name), "utf8")),
	);
	expect(raw.some((text) => text.includes("unknown/private"))).toBe(true);
});
it("rejects browser and resource requests before dispatch and refuses reuse after revocation", async () => {
	for (const method of ["tools/call", "resources/read"]) {
		const f = await fixture();
		await f.handshake();
		await expect(
			f.connection.send({ jsonrpc: "2.0", id: 2, method, params: { name: "browser_snapshot" } }),
		).rejects.toThrow("尚未接通");
		await expect(access(join(f.snapshot.workspace, "dispatched-browser"))).rejects.toThrow();
		await expect(f.snapshot.assertCurrent()).rejects.toThrow();
		await f.connection.close();
		await expect(f.connection.start()).rejects.toThrow("失效");
	}
});
it("fails closed if the original private response cannot be processed", async () => {
	const f = await fixture();
	await mkdir(join(f.privacy.directory, "process.json"));
	const output = await f.handshake();
	expect(output).toMatchObject({ id: 1, error: { code: -32000 } });
	expect(JSON.stringify(output)).not.toContain(f.secret);
	await expect(f.snapshot.assertCurrent()).rejects.toThrow();
	expect(await readFile(join(f.privacy.directory, "handshake-1.json"), "utf8")).toContain(f.secret);
});
it("rejects changed input before spawning the stdio server", async () => {
	const f = await fixture();
	await writeFile(join(f.snapshot.workspace, "playwright.config.mjs"), "changed");
	await expect(f.connection.start()).rejects.toThrow("失效");
	expect((await readdir(f.privacy.directory)).filter((name) => name.startsWith("handshake-"))).toEqual([]);
});
it("revokes a cancelled handshake before its delayed response can be delivered", async () => {
	const f = await fixture(),
		controller = new AbortController();
	await f.handshake();
	const response = new Promise<JsonRpcMessage>((resolve) =>
		f.connection.onMessage((message) => {
			if ("id" in message && message.id === 2) resolve(message);
		}),
	);
	await f.connection.send(
		{ jsonrpc: "2.0", id: 2, method: "ping", params: { delay: true } },
		{ signal: controller.signal },
	);
	controller.abort();
	expect(await response).toMatchObject({ id: 2, error: { code: -32000 } });
	await expect(f.snapshot.assertCurrent()).rejects.toThrow();
	expect(JSON.stringify(f.responses)).not.toContain(f.secret);
});
