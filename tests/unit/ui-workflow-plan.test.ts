import { describe, expect, it, vi } from "vitest";
import { ClientSession } from "../../server/agent/agent-service.js";
import { PlanManager } from "../../server/plan-manager.js";

function host() {
	const service = Object.create(ClientSession.prototype) as any;
	const conv = {
		id: "ui-conversation",
		cwd: "/isolated",
		session: { sessionId: "ui-session", sessionManager: { appendCustomEntry: vi.fn() } },
		toolStartTimes: new Map(),
		activeToolCalls: new Map(),
		toolPendingArgs: new Map(),
	};
	Object.assign(service, {
		convs: new Map([[conv.id, conv]]),
		activeId: conv.id,
		planManager: new PlanManager(),
		reapplySoftCapIfModelChanged: vi.fn(),
		clearToolWatchdog: vi.fn(),
		emitRun: vi.fn(),
		emit: vi.fn(),
		flushSnapshot: vi.fn(),
	});
	return { service, conv };
}

function output(state = "blocked", completed = ["analyze"], id = "partial-task", mode = "analyze") {
	const value = {
		task_ref: { path: `qa/ui/tasks/${id}/manifest.json`, sha256: "a".repeat(64) },
		task: {
			kind: "task",
			id,
			data: {
				workflow: { mode },
				state,
				stage: "result-review",
				completed_stages: completed,
				blockers: state === "blocked" ? ["trace 缺失，完整性未通过"] : [],
			},
		},
		sequence: ["analyze", "result-review"],
		blockers: [],
	};
	return { content: [{ type: "text", text: JSON.stringify({ output: value }) }] };
}

function finish(h: ReturnType<typeof host>, operation: string, result = output(), isError = false) {
	h.conv.toolPendingArgs.set("call", { request: { operation } });
	h.service.onEvent(h.conv, {
		type: "tool_execution_end",
		toolCallId: "call",
		toolName: "ui_test_workflow",
		result,
		isError,
	});
	return h.service.planManager.getPlan(h.conv.id);
}

describe("Native UI workflow board reconciliation", () => {
	it("partial report keeps delivery pending and exposes the concrete blocker", () => {
		const h = host();
		const plan = finish(h, "start");
		expect(plan?.steps.map((s: any) => s.status)).toEqual(["done", "pending"]);
		expect(plan?.steps[1].description).toContain("trace 缺失");
		expect(plan?.activeStepId).toBeNull();
		expect(h.service.emit).toHaveBeenCalledWith(
			expect.objectContaining({ type: "plan_updated", conversationId: h.conv.id }),
		);
	});
	it("explicit same-task resume and complete failing report update the existing steps", () => {
		const h = host();
		finish(h, "start");
		const resumed = finish(h, "resume-task", output("running"));
		expect(resumed?.steps.map((s: any) => s.status)).toEqual(["done", "in_progress"]);
		expect(resumed?.steps[1].description).not.toContain("trace 缺失");
		const done = finish(h, "checkpoint", output("completed", ["analyze", "result-review"]));
		expect(done?.steps.map((s: any) => s.status)).toEqual(["done", "done"]);
		expect(done?.steps).toHaveLength(2);
		expect(done?.steps[1].description).toContain("不代表用例全部通过");
		expect(h.conv.session.sessionManager.appendCustomEntry).toHaveBeenCalledWith("plan/update", { plan: done });
	});
	it("does not attach status from another task or overwrite unrelated plan steps", () => {
		const h = host();
		h.service.planManager.setPlan(h.conv.id, [{ id: "other", title: "Other work", status: "pending" }]);
		finish(h, "start");
		const before = h.service.planManager.getPlan(h.conv.id);
		expect(before?.steps[0].id).toBe("other");
		expect(finish(h, "status", output("completed", ["analyze", "result-review"], "other-task"))).toEqual(before);
		expect(finish(h, "checkpoint", output("completed"), true)).toEqual(before);
	});
	it("catalog, view and malformed output never create a board", () => {
		const h = host();
		expect(finish(h, "catalog")).toBeNull();
		expect(finish(h, "start", output("running", [], "view-task", "view"))).toBeNull();
		expect(finish(h, "start", { content: [{ type: "text", text: "bad JSON" }] })).toBeNull();
	});
});
