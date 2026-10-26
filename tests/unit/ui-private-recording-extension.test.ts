import { afterEach, expect, it, vi } from "vitest";
import { StdioTransport } from "@earendil-works/pi-mcp";
import { resolve } from "node:path";

const probe = vi.hoisted(() => ({ options: undefined as any, prepare: vi.fn() }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
	createMcpExtension: (options: any) => {
		probe.options = options;
		return () => {};
	},
}));
vi.mock("../../.pi/skills/ui-testing-workflow/assets/private-recording-session.mjs", () => ({
	preparePrivateRecordingSession: probe.prepare,
}));
import extension from "../../.pi/skills/ui-testing-workflow/assets/mcp-extension.mjs";

afterEach(() => {
	vi.clearAllMocks();
});
async function fixture() {
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const servers = new Map();
	const register = vi.fn((name, config) => {
		servers.set(name, { name, config });
	});
	const unregister = vi.fn((name) => {
		servers.delete(name);
	});
	const ctx = { cwd: resolve("."), sessionManager: { getSessionDir: () => "/synthetic-session" } };
	await extension({
		on: (name: string, handler: (event: any, ctx: any) => any) => {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerMcpServer: register,
		unregisterMcpServer: unregister,
		getMcpServers: () => [...servers.values()],
	});
	const emit = async (name: string, event: any = {}) => {
		let output;
		for (const handler of handlers.get(name) ?? []) output = (await handler(event, ctx)) ?? output;
		return output;
	};
	await emit("session_start");
	const ref = { path: "qa/ui/recordings/synthetic/session.json", sha256: "a".repeat(64) };
	const start = {
		toolName: "ui_discover_record",
		isError: false,
		input: {
			request: { operation: "start", configuration: { private_recording: {}, backend: "mcp__ui_playwright_test__" } },
		},
		content: [{ type: "text", text: JSON.stringify({ status: "completed", artifact_refs: [ref], errors: [] }) }],
	};
	const finish = { ...start, input: { request: { operation: "finish", session_ref: ref } } };
	const prepared = { snapshot: { revoke: vi.fn(async () => {}) }, receipt: { status: "private-snapshot-prepared" } };
	probe.prepare.mockResolvedValue(prepared);
	return { emit, ref, start, finish, prepared, register, unregister, servers };
}
it("switches the same public registration without exposing private handles, and restores anonymous only after finish", async () => {
	const f = await fixture();
	const output = await f.emit("tool_result", f.start);
	expect(probe.prepare).toHaveBeenCalledWith({
		workspace: resolve("."),
		authority: "/synthetic-session/ui-recording-authority",
		sessionRef: f.ref,
	});
	expect(output.details.output.recording).toBe("blocked-capture-not-connected");
	expect(JSON.stringify(f.register.mock.calls)).not.toContain("/synthetic-session");
	expect(f.servers.get("ui-playwright-test").config.description).toContain(f.ref.sha256);
	expect(await f.emit("tool_call", { toolName: "mcp__other__browser_snapshot" })).toMatchObject({ block: true });
	expect(await f.emit("tool_call", { toolName: "read_mcp_resource" })).toMatchObject({ block: true });
	// Unrelated stdio registrations retain the SDK transport factory even during private binding.
	expect(
		probe.options.createTransport({ name: "other", config: { command: process.execPath } }, resolve(".")),
	).toBeInstanceOf(StdioTransport);
	await f.emit("tool_result", f.finish);
	expect(f.prepared.snapshot.revoke).toHaveBeenCalledTimes(1);
	expect(f.servers.get("ui-playwright-test").config.description).toBeUndefined();
	expect(await f.emit("tool_call", { toolName: "mcp__other__browser_snapshot" })).toBeUndefined();
});
it("retains a failed private preparation as blocked until explicit finish, with no anonymous fallback", async () => {
	const f = await fixture();
	probe.prepare.mockRejectedValue(Error("raw synthetic private path"));
	const output = await f.emit("tool_result", f.start);
	expect(output.details.status).toBe("blocked");
	expect(output.details.artifact_refs).toEqual([f.ref]);
	expect(JSON.stringify(output)).not.toContain("raw synthetic");
	expect(f.unregister).toHaveBeenCalledWith("ui-playwright-test");
	expect(() => probe.options.createTransport({ name: "ui-playwright-test", config: {} })).toThrow("禁止退回匿名");
	expect(await f.emit("tool_call", { toolName: "mcp__ui_playwright_test__browser_snapshot" })).toMatchObject({
		block: true,
	});
	await f.emit("tool_result", f.finish);
	expect(f.register).toHaveBeenCalledTimes(2);
});
it("revokes late preparation after shutdown without reconnecting into the ended session", async () => {
	const f = await fixture();
	let release!: (value: typeof f.prepared) => void;
	probe.prepare.mockReturnValue(
		new Promise((resolve) => {
			release = resolve;
		}),
	);
	const pending = f.emit("tool_result", f.start);
	await f.emit("session_shutdown");
	release(f.prepared);
	const output = await pending;
	expect(output.details.status).toBe("blocked");
	expect(f.prepared.snapshot.revoke).toHaveBeenCalledTimes(1);
	expect(f.register).toHaveBeenCalledTimes(1);
	expect(f.unregister).not.toHaveBeenCalled();
});
it("rejects an unmanaged private backend and preserves binding after an unsuccessful finish", async () => {
	const f = await fixture();
	expect(
		await f.emit("tool_call", {
			...f.start,
			input: { request: { operation: "start", configuration: { private_recording: {}, backend: "mcp__other__" } } },
		}),
	).toMatchObject({ block: true });
	await f.emit("tool_result", f.start);
	await f.emit("tool_result", {
		...f.finish,
		content: [{ type: "text", text: JSON.stringify({ status: "blocked" }) }],
	});
	await f.emit("tool_result", {
		...f.finish,
		input: { request: { operation: "finish", session_ref: { ...f.ref, sha256: "b".repeat(64) } } },
	});
	expect(f.prepared.snapshot.revoke).not.toHaveBeenCalled();
	expect(await f.emit("tool_call", { toolName: "mcp__ui_playwright_test__browser_snapshot" })).toMatchObject({
		block: true,
	});
	await f.emit("session_shutdown");
	expect(f.prepared.snapshot.revoke).toHaveBeenCalledTimes(1);
});
