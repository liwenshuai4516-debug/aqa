import { describe, expect, it } from "vitest";
import type { UiMessage } from "../../server/protocol.js";
import { presentChatMessages } from "../../web/src/chat-presentation.js";

const user: UiMessage = { id: "u", role: "user", content: [{ type: "text", text: "time?" }] };
const process: UiMessage = {
	id: "a1",
	role: "assistant",
	stopReason: "toolUse",
	durationMs: 9005,
	content: [
		{ type: "thinking", thinking: "private process" },
		{ type: "text", text: "checking" },
		{ type: "toolCall", id: "call", name: "bash" },
	],
};
const tool: UiMessage = { id: "t", role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "16:54" }] };
const final: UiMessage = {
	id: "a2",
	role: "assistant",
	stopReason: "stop",
	durationMs: 5388,
	content: [
		{ type: "thinking", thinking: "final reasoning" },
		{ type: "text", text: "It is 16:54" },
	],
};
const history = [user, process, tool, final];

describe("chat presentation", () => {
	it("keeps live process then shows only final answer and actual summed model timing", () => {
		expect(presentChatMessages(history, true)).toEqual(history);
		const result = presentChatMessages(history, false);
		expect(result.map((m) => m.id)).toEqual(["u", "a2"]);
		expect(result.at(-1)?.content).toEqual([{ type: "text", text: "It is 16:54" }]);
		expect(result.at(-1)?.durationMs).toBe(14393);
		// The projection never changes evidence used by trace/search/export.
		expect(history[1]).toBe(process);
		expect(history[3].content).toHaveLength(2);
	});
	it("does not invent missing historical timing", () => {
		expect(
			presentChatMessages([user, { ...process, durationMs: undefined }, tool, final], false).at(-1)?.durationMs,
		).toBeUndefined();
	});
	it.each(["error", "aborted", "toolUse"])("preserves unfinished/failed %s runs", (stopReason) => {
		const failed = [user, process, tool, { ...final, stopReason }];
		expect(presentChatMessages(failed, false)).toEqual(failed);
	});
	it("hides failed intermediate tools once the model supplies a final answer", () => {
		const failed = [user, process, { ...tool, isError: true }, final];
		expect(presentChatMessages(failed, true)).toEqual(failed);
		expect(presentChatMessages(failed, false).map((m) => m.id)).toEqual(["u", "a2"]);
		expect(failed[2].isError).toBe(true);
	});
	it("hides recovered model errors without losing the final outcome", () => {
		const recovered = [user, { ...process, stopReason: "error", errorMessage: "retryable failure" }, tool, final];
		expect(presentChatMessages(recovered, false).map((m) => m.id)).toEqual(["u", "a2"]);
	});
	it("keeps a skill invocation as a short user command after completion", () => {
		const skill = {
			...user,
			content: [
				{
					type: "text",
					text: '<skill name="ui-test" location="/test/SKILL.md">\nInternal skill instructions\n</skill>\n\nTest the login page',
				},
			],
		};
		const source = [skill, process, tool, final];
		expect(presentChatMessages(source, true)).toEqual(source);
		const completed = presentChatMessages(source, false);
		expect(completed[0].content).toEqual([{ type: "text", text: "/skill:ui-test Test the login page" }]);
		expect(completed.map((m) => m.id)).toEqual(["u", "a2"]);
	});
	it("isolates turns and preserves custom messages and the live next turn", () => {
		const custom: UiMessage = { id: "card", role: "assistant", customType: "notice", content: [] };
		const nextUser = { ...user, id: "u2" };
		const nextProcess = { ...process, id: "a3" };
		const result = presentChatMessages([...history, custom, nextUser, nextProcess], true);
		expect(result.map((m) => m.id)).toEqual(["u", "a2", "card", "u2", "a3"]);
	});
	it("preserves a tool-only run with no result rather than making it disappear", () => {
		expect(presentChatMessages([user, process, tool], false)).toEqual([user, process, tool]);
	});
});
