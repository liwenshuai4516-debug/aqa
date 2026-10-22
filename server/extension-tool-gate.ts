/** Host tool_call hook: covers SDK extensions, late registration and nested calls.
 * Trusted in-process extension code is not an OS sandbox; direct filesystem/network
 * calls outside the SDK tool pipeline remain outside this gate.
 */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { isConfigurableAgentTool } from "./tool-manager.js";
import { extensionToolEffect } from "./extension-tool-policy.js";
import { planModeDenial } from "./plan-mode.js";
import { delegationDenial } from "./delegate-mode.js";
import { goalReviewDenial } from "./goal-review-gate.js";

export interface ExtensionGateState {
	planMode: boolean;
	delegateMode: boolean;
	goalReview: boolean;
	permission: string;
	uiDisabled: boolean;
}
export function extensionToolDenial(name: string, params: unknown, state: ExtensionGateState): string | undefined {
	// Hard modes always precede permission/approval. Neither full access nor a
	// remembered approval can grant an exception to these conversation modes.
	if (state.planMode) {
		const denied = planModeDenial(name, params);
		if (denied) return denied.reason;
	}
	if (state.delegateMode) {
		const denied = delegationDenial(name, params);
		if (denied) return denied.reason;
	}
	if (state.goalReview) {
		const denied = goalReviewDenial(name, params);
		if (denied) return denied.reason;
	}
	const effect = extensionToolEffect(name, params);
	if (
		effect === undefined &&
		!isConfigurableAgentTool(name) &&
		(state.planMode || state.delegateMode || state.goalReview || state.permission === "read-only")
	)
		return `只读执行守卫：未登记操作分类的扩展工具 ${name} 被拒。`;
	if (state.uiDisabled && (name.startsWith("ui_") || name.startsWith("mcp__ui_playwright_test__")))
		return "UI 测试能力已停用，不能通过嵌套工具调用继续执行。";
	if (state.permission === "read-only" && effect !== undefined && effect !== "query")
		return `只读权限：${name} (${effect}) 被拒；查询可继续，修改或执行须切换权限预设。`;
	return undefined;
}
export function createExtensionToolGate(getState: () => ExtensionGateState): ExtensionFactory {
	return (pi) => {
		pi.on("tool_call", (event) => {
			const reason = extensionToolDenial(event.toolName, event.input, getState());
			if (reason) return { block: true, reason };
		});
	};
}
