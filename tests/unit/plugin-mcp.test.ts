import { describe, expect, it } from "vitest";
import { callPluginMcp, createPluginInvocation, type PluginToolContext } from "../../server/mcp/plugin-mcp.js";
import { pluginToolToDefinition } from "../../server/agent/agent-formatters.js";
import { ClientSession } from "../../server/agent/agent-service.js";

const identity: PluginToolContext = {
	clientId: "client",
	conversationId: "origin",
	cwd: "/fixture",
	pluginId: "api-testing",
	toolName: "api_test_execute",
};
const request = { serverId: "api-testing", toolName: "runApprovedSuite", runRef: "approved" };
const running = new AbortController().signal;

describe("controlled plugin MCP identity", () => {
	it("rejects forged, cross-plugin and expired invocation identities", async () => {
		const caller = async () => "unexpected";
		await expect(callPluginMcp("api-testing", identity, request, caller, running)).rejects.toThrow("identity");
		const scope = createPluginInvocation(identity, () => {});
		await expect(callPluginMcp("other", scope.context, request, caller, running)).rejects.toThrow("identity");
		scope.dispose();
		await expect(callPluginMcp("api-testing", scope.context, request, caller, running)).rejects.toThrow("expired");
	});
	it("revocation aborts a pending call without waiting for the tool to finish", async () => {
		let allowed = true;
		const scope = createPluginInvocation(identity, () => {
			if (!allowed) throw new Error("revoked");
		});
		const result = callPluginMcp(
			"api-testing",
			scope.context,
			request,
			async (_i, _r, signal) => {
				allowed = false;
				return new Promise((_resolve, reject) =>
					signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
				);
			},
			running,
		);
		await expect(result).rejects.toThrow("revoked");
		scope.dispose();
	});
	it("tool adapter expires identity on completion and does not give model params authority", async () => {
		let captured: PluginToolContext | undefined;
		const def = pluginToolToDefinition(
			{
				name: identity.toolName,
				description: "Run fixture.",
				execute: async (_id, _p, _s, _u, context) => {
					captured = context;
					return callPluginMcp("api-testing", context!, request, async (owner) => owner.conversationId, running);
				},
			},
			(signal) => createPluginInvocation(identity, () => {}, signal),
		);
		const result = await (def.execute as any)("tool", { conversationId: "forged" }, undefined, undefined);
		expect(result.content).toEqual([{ type: "text", text: "origin" }]);
		await expect(callPluginMcp("api-testing", captured!, request, async () => null, running)).rejects.toThrow(
			"expired",
		);
	});
});

function binding() {
	const conversation = {
		id: "origin",
		cwd: "/fixture",
		session: {},
		agentPreset: "standard",
		planMode: false,
		delegateMode: false,
	};
	const current = { disabledPlugins: [] as string[], disabledPluginTools: [] as string[] };
	const tool = {
		name: identity.toolName,
		pluginId: identity.pluginId,
		description: "Run fixture.",
		execute: async (_id: string, _params: unknown, _signal: unknown, _update: unknown, context: PluginToolContext) =>
			callPluginMcp("api-testing", context, request, async (owner) => owner, running),
	};
	const ctx = {
		clientId: "client",
		convs: new Map([["origin", conversation]]),
		settingsSvc: { current },
		pluginToolsProvider: () => [tool],
		goalReviewTurnOf: () => false,
		activeId: "other",
	};
	const definition = (ClientSession.prototype as any).enabledPluginToolDefs.call(ctx, "standard", "origin")[0];
	return { ctx, conversation, current, run: () => definition.execute("tool", {}, undefined, undefined) };
}

describe("ClientSession binds live origin and permission gates", () => {
	it("keeps origin identity when the foreground conversation changes", async () => {
		const { run } = binding();
		const result = await run();
		expect(JSON.parse(result.content[0].text)).toMatchObject({ conversationId: "origin", cwd: "/fixture" });
	});
	for (const mode of ["planMode", "delegateMode"] as const)
		it(`blocks ${mode}`, async () => {
			const state = binding();
			state.conversation[mode] = true;
			await expect(state.run()).rejects.toThrow("mode");
		});
	it("blocks stale tools after disable or unload", async () => {
		const state = binding();
		state.current.disabledPluginTools = [identity.toolName];
		await expect(state.run()).rejects.toThrow("disabled");
		state.current.disabledPluginTools = [];
		state.ctx.pluginToolsProvider = () => [];
		await expect(state.run()).rejects.toThrow("unloaded");
	});
	it("blocks detached conversation sessions and has no unbound fallback", async () => {
		const state = binding();
		state.ctx.convs.clear();
		await expect(state.run()).rejects.toThrow("bound conversation");
	});
});
