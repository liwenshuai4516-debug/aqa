/** Real PluginManager wiring and existing ClientSession execution restrictions; no VM/model. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PluginManager, type PluginHost } from "../../server/plugins.js";
import { ClientSession } from "../../server/agent/agent-service.js";
import { AgentService } from "../../server/agent/agent-service-daemon.js";
import { extensionToolEffect } from "../../server/extension-tool-policy.js";
import { verifyPluginInvocation, createPluginInvocation } from "../../server/mcp/plugin-mcp.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	delete (globalThis as any).__offlineHostFixture;
});
async function hostFixture(id = "agent-evaluation", permissions = ["tools", "tools:offline-execution"]) {
	const dir = mkdtempSync(join(tmpdir(), "offline-host-")),
		plugin = join(dir, "plugins", id);
	mkdirSync(plugin, { recursive: true });
	writeFileSync(join(plugin, "manifest.json"), JSON.stringify({ id, name: id, apiVersion: 2, permissions }));
	writeFileSync(
		join(plugin, "index.mjs"),
		"export default { activate(host) { globalThis.__offlineHostFixture = host; } };",
	);
	const manager = new PluginManager(dir, dir);
	cleanups.push(() => {
		manager.dispose();
		rmSync(dir, { recursive: true, force: true });
	});
	await manager.ensureLoaded();
	const host = (globalThis as any).__offlineHostFixture as PluginHost;
	expect(host).toBeTruthy();
	return { dir, manager, host };
}
function guardFixture() {
	const conversation: any = { id: "owned", session: {}, agentPreset: "standard", permissionPreset: "default" };
	const settings: any = { defaultPermissionPreset: "default", disabledPlugins: [], disabledPluginTools: [] };
	const ctx: any = {
		convs: new Map([[conversation.id, conversation]]),
		settingsSvc: { current: settings },
		goalReviewTurnOf: () => false,
	};
	const verify = (id = "owned") => ClientSession.prototype.verifyEvaluationExecutionForPlugins.call(ctx, id);
	return { conversation, settings, ctx, verify };
}
describe("EC06 host enrollment of guarded execution port", () => {
	it.each([
		["agent-evaluation", ["tools"]],
		["agent-evaluation", []],
		["other-plugin", ["tools", "tools:offline-execution"]],
	])("requires the exact reserved declaration: %s %j", async (id, permissions) => {
		const f = await hostFixture(id as string, permissions as string[]);
		expect(() => f.host.createOfflineEvaluationExecution({} as any)).toThrow(/Separate/);
	});
	it("requires the engine guard even with the reserved declaration", async () => {
		const f = await hostFixture();
		const port = f.host.createOfflineEvaluationExecution({} as any);
		await expect(
			port.dispatch(
				{},
				{ clientId: "sender", conversationId: "c", sessionId: "s" },
				{ action: "offlineDescribe", requestId: "read" },
			),
		).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
	});
	it("host-owned disable/unload cleanup is registered even if plugin has no lifecycle handler", async () => {
		const f = await hostFixture();
		const port = f.host.createOfflineEvaluationExecution({} as any);
		const stop = vi.spyOn(port, "stopClient"),
			close = vi.spyOn(port, "close");
		f.manager.emitClientPluginsDisabled("sender", ["agent-evaluation"]);
		expect(stop).toHaveBeenCalledWith("sender");
		f.manager.dispose();
		expect(close).toHaveBeenCalledOnce();
	});
	it("delegates source verification to the selected client and conversation", async () => {
		const f = await hostFixture();
		const binding = { clientId: "sender", conversationId: "selected", sessionId: "s" };
		f.manager.evaluationExecutionGuard = vi.fn(() => {
			throw Object.assign(new Error("disabled"), { code: "PERMISSION_DENIED" });
		});
		const port = f.host.createOfflineEvaluationExecution({} as any);
		await expect(port.dispatch({}, binding, { action: "offlineDescribe", requestId: "read" })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		expect(f.manager.evaluationExecutionGuard).toHaveBeenCalledWith(binding);
	});
});
describe("EC06 human controls keep execution restrictions", () => {
	it("accepts an owned unrestricted source but never substitutes the active conversation", () => {
		const f = guardFixture();
		expect(() => f.verify()).not.toThrow();
		expect(() => f.verify("foreign")).toThrow(/not owned/);
	});
	it.each([
		["planMode", true],
		["delegateMode", true],
		["permissionPreset", "read-only"],
		["agentPreset", "reader"],
		["subagentBarsPluginTools", true],
	])("rejects conversation restriction %s", (key, value) => {
		const f = guardFixture();
		f.conversation[key as string] = value;
		expect(() => f.verify()).toThrow(/disabled/);
	});
	it("rejects goal review, global readonly defaults and disabled plugin/tool; accepts explicit re-enable", () => {
		const f = guardFixture();
		f.ctx.goalReviewTurnOf = () => true;
		expect(() => f.verify()).toThrow();
		f.ctx.goalReviewTurnOf = () => false;
		delete f.conversation.permissionPreset;
		f.settings.defaultPermissionPreset = "read-only";
		expect(() => f.verify()).toThrow();
		f.settings.defaultPermissionPreset = "default";
		f.settings.disabledPlugins = ["agent-evaluation"];
		expect(() => f.verify()).toThrow();
		f.settings.disabledPlugins = [];
		f.settings.disabledPluginTools = ["agent_evaluation"];
		expect(() => f.verify()).toThrow();
		f.settings.disabledPluginTools = [];
		expect(() => f.verify()).not.toThrow();
	});
	it("daemon guard refuses missing clients and forwards the exact owned source", () => {
		const verify = vi.fn(),
			daemon: any = { clients: new Map([["sender", { verifyEvaluationExecutionForPlugins: verify }]]) };
		AgentService.prototype.verifyEvaluationExecutionForPlugins.call(daemon, "sender", "selected");
		expect(verify).toHaveBeenCalledWith("selected");
		expect(() => AgentService.prototype.verifyEvaluationExecutionForPlugins.call(daemon, "other", "selected")).toThrow(
			/unavailable/,
		);
	});
	it("classifies every offline operation as a write, including status that may append revisions", () => {
		for (const action of [
			"offlineDescribe",
			"offlinePrepare",
			"offlineStart",
			"offlineStatus",
			"offlineReconcile",
			"offlineCancel",
			"offlineSeal",
			"offlineCleanup",
		])
			expect(extensionToolEffect("agent_evaluation", { action })).toBe("asset-write");
	});
	it("shares the tool adapter verifier without accepting copied, expired or aborted identities", () => {
		const identity = {
			clientId: "c",
			conversationId: "s",
			cwd: "/work",
			pluginId: "agent-evaluation",
			toolName: "agent_evaluation",
		};
		expect(() => verifyPluginInvocation("agent-evaluation", identity)).toThrow(/identity/);
		const abort = new AbortController(),
			verify = vi.fn(),
			scope = createPluginInvocation(identity, verify, abort.signal);
		expect(verifyPluginInvocation("agent-evaluation", scope.context)).toBe(abort.signal);
		expect(verify).toHaveBeenCalledTimes(2);
		expect(() => verifyPluginInvocation("other", scope.context)).toThrow();
		expect(() => verifyPluginInvocation("agent-evaluation", { ...scope.context })).toThrow();
		abort.abort(new Error("cancelled"));
		expect(() => verifyPluginInvocation("agent-evaluation", scope.context)).toThrow("cancelled");
		scope.dispose();
		expect(() => verifyPluginInvocation("agent-evaluation", scope.context)).toThrow(/expired/);
	});
});
