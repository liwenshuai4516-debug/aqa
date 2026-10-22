import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutomation } from "../../plugins/data-space/automation.mjs";
import { extensionToolEffect } from "../../server/extension-tool-policy";
import { ClientSession } from "../../server/agent/agent-service";
import { extensionToolDenial } from "../../server/extension-tool-gate";
import { nativeTestCompletion } from "../../server/test-execution-notice";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "ds-auto-")));
	roots.push(cwd);
	let store: any = {
		revision: 1,
		cases: [{ id: "c", code: "C1", featureId: "f", type: "接口", title: "read", updatedAt: "2026-01-01" }],
		features: [{ id: "f", moduleId: "m" }],
		modules: [{ id: "m", systemId: "s" }],
		envs: [{ id: "e", systemId: "s", name: "test", baseUrl: "http://localhost:9999" }],
	};
	let runs: any = { revision: 1, runs: [] },
		listener: any;
	const native: any = {
		engine: "api",
		workspace: cwd,
		runId: "r",
		assetRef: "asset",
		environment: { id: "", baseUrl: "http://localhost:9999" },
		rows: [{ caseId: "native", status: "passed", evidenceComplete: true }],
		evidence: [],
		complete: true,
	};
	const host = {
		testing: {
			inspect: async () => ({
				engine: "api",
				workspace: cwd,
				assetRef: "asset",
				revision: "version",
				cases: [{ id: "native" }],
				environment: native.environment,
			}),
			read: async () => native,
			list: async () => ["r"],
		},
		onToolEvent: (fn: any) => {
			listener = fn;
			return () => {
				listener = null;
			};
		},
		log() {},
		broadcast() {},
	};
	const options = {
		host,
		store: () => store,
		runs: () => runs,
		commitStore: (s: any) => {
			store = s;
		},
		commitRuns: (r: any) => {
			runs = r;
		},
	};
	const a = createAutomation(options);
	const bind = () =>
		a.call(cwd, { action: "bind", caseId: "c", engine: "api", assetRef: "asset", nativeCaseId: "native", envId: "e" });
	return {
		a,
		bind,
		cwd,
		native,
		host,
		options,
		store: () => store,
		runs: () => runs,
		event: () => listener({ phase: "end", cwd, testRun: { engine: "api", reference: "r" } }),
	};
}
describe("native Data Space associations", () => {
	it("deduplicates concurrent manual/event sync and recovers missed notifications after restart", async () => {
		const f = fixture();
		await f.a.idle();
		await f.bind();
		f.event();
		await Promise.all([f.a.sync(f.cwd, "api", "r"), f.a.sync(f.cwd, "api", "r")]);
		await f.a.idle();
		expect(f.runs().runs).toHaveLength(1);
		expect(f.runs().runs[0]).toMatchObject({ verdict: "通过", source: "automation" });
		f.a.dispose();
		f.native.runId = "missed";
		const next = createAutomation(f.options);
		await next.idle();
		expect(f.runs().runs).toHaveLength(2);
		next.dispose();
	});
	it("rejects cross-project environment binding and changed environment on execution routing", async () => {
		const f = fixture();
		await f.a.idle();
		f.store().envs[0].systemId = "other";
		await expect(f.bind()).rejects.toThrow("所属项目");
		f.store().envs[0].systemId = "s";
		await f.bind();
		f.store().envs[0].baseUrl = "http://localhost:9998";
		await expect(f.a.call(f.cwd, { action: "route", caseId: "c" })).rejects.toThrow("环境");
		f.a.dispose();
	});
	it("does not import stale/unselected cases, and preserves cancelled/skipped/unknown evidence", async () => {
		const f = fixture();
		await f.a.idle();
		await f.bind();
		f.store().cases[0].title = "changed";
		expect((await f.a.sync(f.cwd, "api", "r")).errors).toHaveLength(1);
		expect(f.runs().runs).toHaveLength(0);
		await f.bind();
		f.native.rows = [];
		await f.a.sync(f.cwd, "api", "r");
		expect(f.runs().runs).toHaveLength(0);
		for (const [status, expected] of [
			["cancelled", "取消"],
			["skipped", "跳过"],
			["passed", "未知"],
		]) {
			f.native.runId = status;
			f.native.rows = [{ caseId: "native", status, evidenceComplete: status !== "passed" }];
			await f.a.sync(f.cwd, "api", status);
			expect(f.runs().runs.at(-1).verdict).toBe(expected);
		}
		f.a.dispose();
	});
	it("allows only read operations in restricted modes and emits no completion for status queries", () => {
		expect(extensionToolEffect("data_space_cases", {})).toBe("query");
		expect(extensionToolEffect("data_space_automation", { action: "sync" })).toBe("asset-write");
		expect(extensionToolEffect("data_space_record_result", {})).toBe("asset-write");
		const result = { details: { runId: "12345678-1234-1234-1234-123456789abc" } };
		expect(nativeTestCompletion("api_test_execute", { action: "asset_report" }, result, false)).toBeUndefined();
		expect(nativeTestCompletion("api_test_execute", { action: "asset_run" }, result, false)?.engine).toBe("api");
		expect(nativeTestCompletion("api_test_execute", { action: "asset_run" }, result, true)).toBeUndefined();
	});
});

it("host plugin invocation independently enforces plan/delegate/goal and disabled-tool boundaries", async () => {
	let calls = 0;
	const conv: any = {
		id: "c",
		cwd: process.cwd(),
		session: {},
		agentPreset: "standard",
		planMode: true,
		delegateMode: false,
	};
	const tools = [
		{
			pluginId: "data-space",
			name: "data_space_cases",
			description: "Query cases",
			parameters: { type: "object" },
			execute: async () => {
				calls++;
				return "query";
			},
		},
		{
			pluginId: "data-space",
			name: "data_space_automation",
			description: "Associations",
			parameters: { type: "object" },
			execute: async () => {
				calls++;
				return "changed";
			},
		},
	];
	let review = false;
	const context: any = {
		clientId: "isolated",
		convs: new Map([["c", conv]]),
		settingsSvc: { current: { disabledPlugins: [], disabledPluginTools: [] } },
		pluginToolsProvider: () => tools,
		goalReviewTurnOf: () => review,
	};
	const defs = (ClientSession.prototype as any).enabledPluginToolDefs.call(context, "standard", "c");
	for (const mode of ["plan", "delegate", "goal"]) {
		conv.planMode = mode === "plan";
		conv.delegateMode = mode === "delegate";
		review = mode === "goal";
		await defs[0].execute("q", { action: "get" });
		const before = calls;
		await expect(defs[1].execute("w", { action: "sync" })).rejects.toThrow("blocked");
		expect(calls).toBe(before);
	}
	const state = { planMode: false, delegateMode: false, goalReview: false, permission: "read-only", uiDisabled: false };
	expect(extensionToolDenial("data_space_cases", { action: "get" }, state)).toBeUndefined();
	expect(extensionToolDenial("data_space_automation", { action: "sync" }, state)).toBeDefined();
	context.settingsSvc.current.disabledPluginTools = ["data_space_cases"];
	await expect(defs[0].execute("disabled", {})).rejects.toThrow("disabled");
});
