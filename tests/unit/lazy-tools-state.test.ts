import { describe, expect, it } from "vitest";
import { restoreLazyToolNames } from "../../server/agent/lazy-tools-state.js";

describe("lazy tool restoration", () => {
	it("ordinary conversation history does not activate default SDK tools", () => {
		expect([
			...restoreLazyToolNames([
				{ role: "user", content: "hello" },
				{ role: "assistant", content: [] },
			]),
		]).toEqual([]);
	});
	it("restores used tools and successful load receipts, excluding core and rejected names", () => {
		const messages = [
			{
				role: "toolResult",
				toolName: "load_tools",
				details: { loaded: ["api_test_execute", { name: "compat_tool" }], rejected: [{ name: "blocked" }] },
			},
			{ role: "toolResult", toolName: "load_tools", isError: true, details: { loaded: [{ name: "failed" }] } },
			{ role: "toolResult", toolName: "mcp_browser_snapshot", isError: true },
			{ role: "toolResult", toolName: "read" },
			{ role: "user", toolName: "untrusted" },
			null,
		];
		expect([...restoreLazyToolNames(messages)]).toEqual(["api_test_execute", "compat_tool", "mcp_browser_snapshot"]);
	});
});
