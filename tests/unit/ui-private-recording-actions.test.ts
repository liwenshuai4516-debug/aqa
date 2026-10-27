import { expect, it } from "vitest";
import { createPrivateRecordingActions } from "../../.pi/skills/ui-testing-workflow/assets/private-recording-actions.mjs";

const prefix = "mcp__ui_playwright_test__";
function fixture() {
	const bridge = createPrivateRecordingActions();
	const binding = { sessionRef: { path: "session", sha256: "a".repeat(64) }, prepared: { capture: { maxSteps: 4 } } };
	const action = {
		toolName: "ui_discover_record",
		toolCallId: "action",
		input: { request: { operation: "action", session_ref: binding.sessionRef, tool: "browser_snapshot", input: {} } },
	};
	const child = {
		toolName: prefix + "browser_snapshot",
		toolCallId: "action/0",
		parentToolCallId: "action",
		input: {},
	};
	return { bridge, binding, action, child };
}
it("rejects direct calls, forged nested ancestry, other servers, resources and mismatched arguments", () => {
	const f = fixture();
	f.bridge.onCall(f.action, f.binding);
	for (const event of [
		{ ...f.child, parentToolCallId: undefined },
		{ ...f.child, parentToolCallId: "other/parent" },
		{ ...f.child, toolName: "mcp__other__browser_snapshot" },
		{ ...f.child, toolName: "read_mcp_resource" },
		{ ...f.child, input: { secretPath: "unverified" } },
	])
		expect(f.bridge.onCall(event, f.binding)).toMatchObject({ block: true });
	expect(f.bridge.onCall(f.child, f.binding)).toEqual({ privateCall: true });
	expect(f.bridge.onCall({ ...f.child, toolCallId: "replay" }, f.binding)).toMatchObject({ block: true });
});
it("binds the fixed helper to the real parent call and restores async context on return", async () => {
	const f = fixture();
	f.bridge.onCall(f.action, f.binding);
	f.bridge.onCall(f.child, f.binding);
	const nested: string[] = [];
	const ctx = {
		executeTool: async (name: string, input: any) => {
			const event = { toolName: name, toolCallId: "helper", parentToolCallId: f.child.toolCallId, input };
			expect(f.bridge.onCall({ ...event, input: { ...input, code: "arbitrary()" } }, f.binding)).toMatchObject({
				block: true,
			});
			expect(f.bridge.onCall(event, f.binding)).toEqual({ privateCall: true });
			const wrapped = f.bridge.wrap(
				{
					name,
					execute: async () => {
						expect(f.bridge.current(f.binding).ordinal).toBe(1);
						nested.push(input.code);
						return { isError: false };
					},
				},
				() => f.binding,
			);
			return wrapped.execute("helper", input, undefined, undefined, {});
		},
	};
	const wrapped = f.bridge.wrap(
		{
			name: f.child.toolName,
			execute: async () => {
				const call = f.bridge.current(f.binding);
				expect(call.id).toBe(f.child.toolCallId);
				await call.capture(1);
				expect(f.bridge.current(f.binding)).toBe(call);
			},
		},
		() => f.binding,
	);
	await wrapped.execute(f.child.toolCallId, {}, undefined, undefined, ctx);
	expect(nested).toEqual(["async (page) => { await page.__pi_private_recording_capture(1); }"]);
	expect(f.bridge.current(f.binding)).toBeUndefined();
	expect(
		f.bridge.onCall(
			{ toolName: prefix + "browser_run_code_unsafe", parentToolCallId: f.child.toolCallId, input: {} },
			f.binding,
		),
	).toMatchObject({ block: true });
});
it("refuses wrapper bypass, stale sessions and use after action completion", async () => {
	const f = fixture();
	const definition = {
		name: f.child.toolName,
		execute: async () => {
			throw Error("must not dispatch");
		},
	};
	await expect(
		f.bridge.wrap(definition, () => f.binding).execute("ungranted", {}, undefined, undefined, {}),
	).rejects.toThrow("未授权");
	f.bridge.onCall(f.action, f.binding);
	f.bridge.onResult({ toolCallId: f.action.toolCallId });
	expect(f.bridge.onCall(f.child, f.binding)).toMatchObject({ block: true });
	expect(
		f.bridge.onCall(
			{ ...f.action, input: { request: { ...f.action.input.request, session_ref: { path: "old" } } } },
			f.binding,
		),
	).toMatchObject({ block: true });
	f.bridge.onCall(f.action, f.binding);
	f.bridge.onCall(f.child, f.binding);
	const next = { ...f.binding };
	await expect(
		f.bridge.wrap(definition, () => next).execute(f.child.toolCallId, {}, undefined, undefined, {}),
	).rejects.toThrow("未授权");
});
