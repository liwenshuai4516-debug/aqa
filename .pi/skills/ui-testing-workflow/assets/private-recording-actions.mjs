// Trusted SDK lineage only. A non-empty parent id alone never authorizes a browser call.
import { AsyncLocalStorage } from "node:async_hooks";
import { isDeepStrictEqual } from "node:util";
import { recordingTools } from "pi-ui-testing";

const prefix = "mcp__ui_playwright_test__";
const blocked = () => ({
	block: true,
	reason: "私密录制只接受本会话原生动作及固定采集；未授权调用已阻塞，请保留 partial",
});
export function createPrivateRecordingActions() {
	const actions = new Map(),
		permits = new Map(),
		helpers = new Map(),
		context = new AsyncLocalStorage();
	return {
		onCall(event, binding) {
			if (!binding) return;
			const request = event.input?.request;
			if (event.toolName === "ui_discover_record" && request?.operation === "action" && binding.prepared?.capture) {
				if (
					!event.toolCallId ||
					actions.has(event.toolCallId) ||
					!isDeepStrictEqual(request.session_ref, binding.sessionRef) ||
					!recordingTools.includes(request.tool)
				)
					return blocked();
				actions.set(event.toolCallId, {
					binding,
					tool: prefix + request.tool,
					input: structuredClone(request.input),
					used: false,
				});
				return;
			}
			if (
				!event.toolName.startsWith("mcp__") &&
				!["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"].includes(event.toolName)
			)
				return;
			if (!binding.prepared?.capture)
				return { block: true, reason: "私密录制捕获与发布尚未接通，浏览器动作已阻塞；请保存 partial 记录" };
			const grant = helpers.get(event.parentToolCallId) ?? actions.get(event.parentToolCallId);
			if (
				!grant ||
				grant.binding !== binding ||
				grant.used ||
				event.toolName !== grant.tool ||
				!isDeepStrictEqual(event.input, grant.input)
			)
				return blocked();
			grant.used = true;
			permits.set(event.toolCallId, {
				binding,
				tool: event.toolName,
				input: structuredClone(event.input),
				ordinal: grant.ordinal,
			});
			return { privateCall: true };
		},
		onResult(event) {
			actions.delete(event.toolCallId);
			permits.delete(event.toolCallId);
		},
		clear() {
			actions.clear();
			permits.clear();
			helpers.clear();
		},
		current(binding) {
			const call = context.getStore();
			return call?.binding === binding ? call : undefined;
		},
		wrap(definition, getBinding) {
			if (!definition.name.startsWith(prefix)) return definition;
			return {
				...definition,
				execute: async (id, input, signal, update, ctx) => {
					const binding = getBinding();
					if (!binding) return definition.execute(id, input, signal, update, ctx);
					const permit = permits.get(id);
					permits.delete(id);
					if (
						!permit ||
						permit.binding !== binding ||
						permit.tool !== definition.name ||
						!isDeepStrictEqual(input, permit.input)
					)
						throw new Error(blocked().reason);
					const call = {
						...permit,
						id,
						signal,
						dispatched: false,
						capture: async (ordinal) => {
							if (
								permit.ordinal ||
								helpers.has(id) ||
								getBinding() !== binding ||
								!Number.isInteger(ordinal) ||
								ordinal < 1 ||
								ordinal > binding.prepared.capture.maxSteps
							)
								throw new Error(blocked().reason);
							const helper = {
								code: `async (page) => { await page.__pi_private_recording_capture(${ordinal}); }`,
								intent: "Capture owned private evidence before publishing this recording response",
							};
							helpers.set(id, {
								binding,
								tool: prefix + "browser_run_code_unsafe",
								input: helper,
								ordinal,
								used: false,
							});
							try {
								return await ctx.executeTool(prefix + "browser_run_code_unsafe", helper, { signal });
							} finally {
								helpers.delete(id);
							}
						},
					};
					return context.run(call, () => definition.execute(id, input, signal, update, ctx));
				},
			};
		},
	};
}
