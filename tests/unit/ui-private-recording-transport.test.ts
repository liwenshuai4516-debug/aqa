import { afterEach, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile, access } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonRpcMessage, McpTransport, McpTransportSendOptions } from "@earendil-works/pi-mcp";
import { preparePrivateRecordingWorkspace } from "../../.pi/skills/ui-testing-workflow/assets/private-recording-workspace.mjs";
import { guardPrivateRecordingTransport } from "../../.pi/skills/ui-testing-workflow/assets/private-recording-transport.mjs";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
class Wire implements McpTransport {
	messages = new Set<(message: JsonRpcMessage) => void>();
	errors = new Set<(error: Error) => void>();
	closes = new Set<() => void>();
	sent: Array<{ message: JsonRpcMessage; options?: McpTransportSendOptions }> = [];
	failSend = false;
	closed = false;
	async start() {}
	async send(message: JsonRpcMessage, options?: McpTransportSendOptions) {
		if (this.failSend) throw Error("raw synthetic secret");
		this.sent.push({ message, options });
	}
	async close() {
		this.closed = true;
		for (const f of this.closes) f();
	}
	onMessage(f: (message: JsonRpcMessage) => void) {
		this.messages.add(f);
		return () => {
			this.messages.delete(f);
		};
	}
	onError(f: (error: Error) => void) {
		this.errors.add(f);
		return () => {
			this.errors.delete(f);
		};
	}
	onClose(f: () => void) {
		this.closes.add(f);
		return () => {
			this.closes.delete(f);
		};
	}
	reply(id: number) {
		for (const f of this.messages) f({ jsonrpc: "2.0", id, result: { content: [] } });
	}
}
const request = (id: number, name = "generator_write_test"): JsonRpcMessage => ({
	jsonrpc: "2.0",
	id,
	method: "tools/call",
	params: { name, arguments: {} },
});
async function fixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "recording-transport-"))),
		workspace = join(root, "work"),
		authority = join(root, "authority"),
		parent = join(root, "parent");
	cleanup.push(async () => {
		await rm(root, { recursive: true, force: true });
	});
	for (const p of [workspace, authority, parent]) await mkdir(p, { mode: 0o700 });
	await symlink(await realpath("node_modules"), join(workspace, "node_modules"), "dir");
	const reference = "PI_UI_DATA_SPACE_" + randomUUID().replaceAll("-", "").toUpperCase(),
		state = join(parent, "state.json"),
		base = "http://127.0.0.1:18983/";
	await writeFile(
		state,
		JSON.stringify({
			cookies: [],
			origins: [{ origin: new URL(base).origin, localStorage: [{ name: "token", value: "synthetic-transport" }] }],
			pi_ui_private: {
				version: 1,
				reference,
				workspace,
				origin: new URL(base).origin,
				baseUrl: base,
				expiresAt: new Date(Date.now() + 60000).toISOString(),
			},
		}),
		{ mode: 0o600 },
	);
	process.env[reference] = state;
	cleanup.push(async () => {
		delete process.env[reference];
	});
	const bytes = Buffer.from("export default {};");
	await writeFile(join(workspace, "fixture.mjs"), bytes);
	const snapshot = await preparePrivateRecordingWorkspace({
		workspace,
		authority,
		inputRefs: [{ path: "fixture.mjs", sha256: createHash("sha256").update(bytes).digest("hex") }],
		environment: {
			schema_version: "1.0",
			environment_id: "synthetic",
			deployment_version: "fixture-v1",
			role: "fixture",
			identity: { selector: "h1", text: "fixture" },
			initial_state: { selector: "h1", text: "fixture" },
			isolation: "context",
			timeout_ms: 1000,
			base_url: base,
			auth: { kind: "storage-state-env", reference },
		},
	});
	cleanup.push(() => snapshot.revoke());
	return { snapshot, wire: new Wire(), target: join(workspace, "draft.ts"), state: snapshot.childEnv[reference] };
}
it("finishes each response before the SDK completion signal aborts and preserves send options", async () => {
	const f = await fixture(),
		controller = new AbortController();
	const guarded = guardPrivateRecordingTransport({
		transport: f.wire,
		snapshot: f.snapshot,
		receive: async (m, publish) => {
			await publish(() => writeFileSync(f.target, "native", { flag: "wx" }));
			return m;
		},
	});
	const done = new Promise<void>((resolve) =>
		guarded.onMessage(() => {
			controller.abort();
			resolve();
		}),
	);
	await guarded.start();
	const options = { signal: controller.signal };
	await guarded.send(request(1), options);
	expect(f.wire.sent[0].options).toBe(options);
	f.wire.reply(1);
	await done;
	await f.snapshot.assertCurrent();
	expect(await readFile(f.target, "utf8")).toBe("native");
	await guarded.close();
});
it("blocks a delayed publication on connection close while retaining private capture", async () => {
	const f = await fixture();
	let release!: () => void, entered!: () => void;
	const gate = new Promise<void>((r) => {
			release = r;
		}),
		received = new Promise<void>((r) => {
			entered = r;
		});
	const capture = join(f.snapshot.workspace, "native.ts");
	await writeFile(capture, "native", { mode: 0o600 });
	const guarded = guardPrivateRecordingTransport({
		transport: f.wire,
		snapshot: f.snapshot,
		receive: async (m, publish) => {
			entered();
			await gate;
			await publish(() => writeFileSync(f.target, "native"));
			return m;
		},
	});
	const done = new Promise<JsonRpcMessage>((r) => guarded.onMessage(r));
	await guarded.start();
	await guarded.send(request(1));
	f.wire.reply(1);
	await received;
	await f.wire.close();
	release();
	expect(await done).toMatchObject({ id: 1, error: { code: -32000 } });
	await expect(access(f.target)).rejects.toThrow();
	expect(await readFile(capture, "utf8")).toBe("native");
	await expect(access(f.state)).rejects.toThrow();
	await expect(guarded.send(request(2))).rejects.toThrow("失效");
	expect(f.wire.sent).toHaveLength(1);
});
it("invalidates uncertain failed sends while permitting owned cleanup", async () => {
	const f = await fixture(),
		controller = new AbortController();
	const guarded = guardPrivateRecordingTransport({ transport: f.wire, snapshot: f.snapshot, receive: async (m) => m });
	await guarded.start();
	f.wire.failSend = true;
	await expect(guarded.send(request(1), { signal: controller.signal })).rejects.toThrow("失效");
	controller.abort();
	await expect(f.snapshot.assertCurrent()).rejects.toThrow();
	f.wire.failSend = false;
	await expect(guarded.send(request(2))).rejects.toThrow();
	await guarded.send(request(3, "browser_close"));
	expect(f.wire.sent).toHaveLength(1);
	await guarded.close();
});
it("permits owned browser cleanup after request cancellation, but rejects more browser work", async () => {
	const f = await fixture(),
		controller = new AbortController();
	const guarded = guardPrivateRecordingTransport({ transport: f.wire, snapshot: f.snapshot, receive: async (m) => m });
	await guarded.start();
	await guarded.send(request(1), { signal: controller.signal });
	controller.abort();
	await expect(guarded.send(request(2, "browser_snapshot"))).rejects.toThrow();
	await guarded.send(request(3, "browser_close"));
	expect(f.wire.sent.map((x) => (x.message as { id: number }).id)).toEqual([1, 3]);
	await guarded.close();
});
it("still closes the transport if derived authentication revocation fails", async () => {
	const f = await fixture(),
		snapshot = {
			...f.snapshot,
			revoke: async () => {
				await f.snapshot.revoke();
				throw Error("raw private failure");
			},
		};
	const guarded = guardPrivateRecordingTransport({ transport: f.wire, snapshot, receive: async (m) => m });
	let errors = 0;
	guarded.onError((e) => {
		errors++;
		expect(e.message).not.toContain("raw private");
	});
	await guarded.start();
	await expect(guarded.close()).rejects.toThrow("失效");
	expect(f.wire.closed).toBe(true);
	expect(errors).toBe(1);
});
it("turns receive errors into fixed protocol failures without exposing raw text or leaving a request active", async () => {
	const f = await fixture(),
		controller = new AbortController();
	const guarded = guardPrivateRecordingTransport({
		transport: f.wire,
		snapshot: f.snapshot,
		receive: async () => {
			throw Error("raw synthetic secret");
		},
	});
	await guarded.start();
	const done = new Promise<JsonRpcMessage>((r) => guarded.onMessage(r));
	await guarded.send(request(1), { signal: controller.signal });
	f.wire.reply(1);
	const response = await done;
	expect(response).toMatchObject({ id: 1, error: { code: -32000 } });
	expect(JSON.stringify(response)).not.toContain("synthetic secret");
	controller.abort();
	await expect(f.snapshot.assertCurrent()).rejects.toThrow();
	await guarded.close();
});
it("keeps out-of-order responses bound to their own request cancellation signals", async () => {
	const f = await fixture(),
		first = new AbortController(),
		second = new AbortController();
	const guarded = guardPrivateRecordingTransport({
		transport: f.wire,
		snapshot: f.snapshot,
		receive: async (m, publish) => {
			await publish(() => writeFileSync(f.target + String("id" in m ? m.id : ""), "native", { flag: "wx" }));
			return m;
		},
	});
	const seen: number[] = [];
	let resolved!: () => void;
	const done = new Promise<void>((r) => {
		resolved = r;
	});
	guarded.onMessage((m) => {
		const id = Number("id" in m ? m.id : 0);
		seen.push(id);
		(id === 1 ? first : second).abort();
		resolved();
	});
	await guarded.start();
	await guarded.send(request(1), { signal: first.signal });
	await guarded.send(request(2), { signal: second.signal });
	f.wire.reply(2);
	await done;
	await f.snapshot.assertCurrent();
	const last = new Promise<void>((r) => {
		resolved = r;
	});
	f.wire.reply(1);
	await last;
	expect(seen).toEqual([2, 1]);
	await f.snapshot.assertCurrent();
	expect(await readFile(f.target + "1", "utf8")).toBe("native");
	expect(await readFile(f.target + "2", "utf8")).toBe("native");
	await guarded.close();
});
it("invalidates a connection on raw transport error without forwarding its private message", async () => {
	const f = await fixture();
	const guarded = guardPrivateRecordingTransport({ transport: f.wire, snapshot: f.snapshot, receive: async (m) => m });
	const seen: Error[] = [];
	guarded.onError((e) => seen.push(e));
	await guarded.start();
	await guarded.send(request(1));
	for (const listener of f.wire.errors) listener(Error("raw synthetic secret"));
	expect(seen).toHaveLength(1);
	expect(seen[0].message).not.toContain("synthetic secret");
	await expect(guarded.send(request(2))).rejects.toThrow("失效");
	await expect(f.snapshot.assertCurrent()).rejects.toThrow();
	await guarded.close();
});
