/** One product transport. Source identity comes from onMessage/from or the host-bound tool context. */
import { EvaluationService, requestSchema, toolActions, errorResult } from "./service.mjs";
const bounded = (value) => {
	if (Buffer.byteLength(JSON.stringify(value)) > 48 * 1024) {
		const error = new Error("Response exceeds 48 KiB; use a smaller page or paged export");
		error.code = "LIMIT_EXCEEDED";
		throw error;
	}
	return value;
};
export default {
	activate(host) {
		if (typeof host.onClientDisabled !== "function")
			throw new Error("Agent evaluation requires host.onClientDisabled; upgrade the host");
		const service = new EvaluationService(host);
		const offDisabled = host.onClientDisabled((clientId) => service.stopClient(clientId));
		const off = host.onMessage(async (request, from) => {
			if (!from) return;
			let result;
			try {
				result = { ok: true, result: bounded(await service.dispatch({ channel: "ui", clientId: from }, request)) };
			} catch (error) {
				result = { ok: false, error: errorResult(error, request?.action ?? "request") };
			}
			if (!service.closed) host.sendTo(from, { requestId: request?.requestId, ...result });
		});
		const toolSchema = {
			...requestSchema,
			properties: { ...requestSchema.properties, action: { type: "string", enum: toolActions } },
		};
		const unregister = host.registerAgentTool({
			name: "agent_evaluation",
			label: "Agent 评估中心",
			description:
				"Diagnose a selected Pi task using frozen contracts and read-only evidence. Collect, seal, score or inspect local reports. Does not execute tests, external clients or models. Human reviews are available only in the UI.",
			promptSnippet: "Inspect task evidence or prepare an internal task diagnosis.",
			promptGuidelines: [
				"Describe and select explicit message boundaries before collection. Keep Agent-proposed conditions optional until confirmed in the evaluation UI. Preserve requestId when retrying the same operation. Missing evidence is unknown, never a pass.",
			],
			parameters: toolSchema,
			execute: async (_id, request, signal, _update, context) => {
				try {
					if (!context || context.pluginId !== "agent-evaluation" || context.toolName !== "agent_evaluation")
						throw Object.assign(new Error("A bound evaluation invocation is required"), { code: "PERMISSION_DENIED" });
					const value = bounded(
						await service.dispatch(
							{ channel: "tool", clientId: context.clientId, conversationId: context.conversationId },
							request,
							signal,
						),
					);
					return { content: [{ type: "text", text: JSON.stringify(value) }], details: value };
				} catch (error) {
					const value = errorResult(error, request?.action ?? "request");
					return { isError: true, content: [{ type: "text", text: JSON.stringify(value) }], details: value };
				}
			},
		});
		return () => {
			offDisabled();
			off();
			unregister();
			service.close();
		};
	},
};
