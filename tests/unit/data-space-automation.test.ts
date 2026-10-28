import { afterEach, describe, expect, it, vi } from "vitest";
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
it("keeps API environment matching exact when a UI page can be nested", async () => {
	const f = fixture();
	await f.a.idle();
	f.native.environment.baseUrl = "http://localhost:9999/api";
	await expect(f.bind()).rejects.toThrow("环境地址与原生资产目标不一致");
	expect(f.store().cases[0].automation).toBeUndefined();
	f.a.dispose();
});
it("registers evidence only through the UI host capability and treats it as a write", async () => {
	const f = fixture();
	await expect(f.a.call(f.cwd, { action: "register-evidence", engine: "api", runRef: "r" })).rejects.toThrow();
	await expect(f.a.call(f.cwd, { action: "register-evidence", engine: "ui", runRef: "r" })).rejects.toThrow();
	const registerEvidence = vi.fn(async () => ({ ok: true, registered: true }));
	Object.assign(f.host.testing, { registerEvidence });
	await f.a.call(f.cwd, { action: "register-evidence", engine: "ui", runRef: "r", authority: "/untrusted" });
	expect(registerEvidence).toHaveBeenCalledWith(f.cwd, "r");
	expect(extensionToolEffect("data_space_automation", { action: "register-evidence" })).toBe("asset-write");
	f.a.dispose();
});
it("queries pending native results without writing, then reconciles concurrent sync receipts", async () => {
	const f = fixture();
	await f.a.idle();
	await f.bind();
	const before = JSON.stringify({ store: f.store(), runs: f.runs() });
	const query = () => f.a.call(f.cwd, { action: "sync-status", engine: "api", runRef: "r" });
	expect(await query()).toMatchObject({
		status: "pending",
		runId: "r",
		runRef: "r",
		counts: { pending: 1, unmatched: 0 },
		complete: false,
	});
	expect(JSON.stringify({ store: f.store(), runs: f.runs() })).toBe(before);
	const [a, b] = await Promise.all([f.a.sync(f.cwd, "api", "r"), f.a.sync(f.cwd, "api", "r")]);
	expect(a.counts).toMatchObject({ new: 1, existing: 0 });
	expect(b.counts).toMatchObject({ new: 0, existing: 1 });
	expect(await query()).toMatchObject({
		status: "synced",
		complete: true,
		counts: { existing: 1, pending: 0 },
		items: [{ caseId: "c", nativeCaseId: "native", envId: "e", projectId: "s", featureId: "f", verdict: "通过" }],
	});
	expect(f.runs().runs).toHaveLength(1);
	f.a.dispose();
});
it("appends an explicit, evidence-backed correction without changing the original result", async () => {
	const f = fixture();
	await f.a.idle();
	f.store().cases[0].type = "UI";
	f.native.engine = "ui";
	f.native.evidence = ["r"];
	f.host.testing.inspect = async () => ({
		engine: "ui",
		workspace: f.cwd,
		assetRef: "asset",
		revision: "version",
		cases: [{ id: "native" }],
		environment: f.native.environment,
	});
	await f.a.call(f.cwd, {
		action: "bind",
		caseId: "c",
		engine: "ui",
		assetRef: "asset",
		nativeCaseId: "native",
		envId: "e",
	});
	f.native.rows[0].evidenceComplete = false;
	await f.a.sync(f.cwd, "ui", "r");
	const original = structuredClone(f.runs().runs[0]);
	expect(original.verdict).toBe("未知");
	f.native.rows[0].evidenceComplete = true;
	const requested = {
		action: "reconcile",
		engine: "ui",
		runRef: "r",
		expectedResults: [{ caseId: "c", resultId: original.id }],
	};
	expect(await f.a.call(f.cwd, { action: "sync-status", engine: "ui", runRef: "r" })).toMatchObject({
		complete: false,
		counts: { stale: 1 },
	});
	await f.a.call(f.cwd, requested);
	expect(f.runs().runs).toHaveLength(2);
	expect(f.runs().runs[0]).toEqual(original);
	expect(f.runs().runs[1]).toMatchObject({ verdict: "通过", automation: { supersedes: original.id } });
	await f.a.call(f.cwd, requested);
	expect(f.runs().runs).toHaveLength(2);
	f.native.rows[0].evidenceComplete = false;
	expect(await f.a.call(f.cwd, { action: "sync-status", engine: "ui", runRef: "r" })).toMatchObject({
		complete: false,
		counts: { stale: 1 },
	});
	await expect(f.a.call(f.cwd, requested)).rejects.toThrow();
	expect(f.runs().runs).toHaveLength(2);
	f.a.dispose();
});
it("rejects correction without matching evidence, exact original IDs and the full association set", async () => {
	const f = fixture();
	await f.a.idle();
	f.store().cases[0].type = "UI";
	f.native.engine = "ui";
	f.native.evidence = ["r"];
	f.host.testing.inspect = async () => ({
		engine: "ui",
		workspace: f.cwd,
		assetRef: "asset",
		revision: "version",
		cases: [{ id: "native" }],
		environment: f.native.environment,
	});
	await f.a.call(f.cwd, {
		action: "bind",
		caseId: "c",
		engine: "ui",
		assetRef: "asset",
		nativeCaseId: "native",
		envId: "e",
	});
	f.store().cases.push({ ...structuredClone(f.store().cases[0]), id: "other" });
	f.native.rows[0].evidenceComplete = false;
	await f.a.sync(f.cwd, "ui", "r");
	const original = structuredClone(f.runs().runs);
	const expectedResults = original.map((r: any) => ({ caseId: r.caseId, resultId: r.id }));
	await expect(f.a.call(f.cwd, { action: "reconcile", engine: "ui", runRef: "r", expectedResults })).rejects.toThrow();
	f.native.rows[0].evidenceComplete = true;
	await expect(
		f.a.call(f.cwd, { action: "reconcile", engine: "ui", runRef: "r", expectedResults: expectedResults.slice(0, 1) }),
	).rejects.toThrow();
	await expect(
		f.a.call(f.cwd, {
			action: "reconcile",
			engine: "ui",
			runRef: "r",
			expectedResults: expectedResults.map((v: any) => ({ ...v, resultId: "wrong" })),
		}),
	).rejects.toThrow();
	f.native.evidence = ["different"];
	await expect(
		f.a.call(f.cwd, { action: "reconcile", engine: "ui", runRef: "different", expectedResults }),
	).rejects.toThrow();
	expect(f.runs().runs).toEqual(original);
	f.a.dispose();
});
it("reports unbound native cases and stale associations without treating zero imports as complete", async () => {
	const f = fixture();
	await f.a.idle();
	expect(await f.a.sync(f.cwd, "api", "r")).toMatchObject({
		imported: 0,
		complete: false,
		counts: { unmatched: 1 },
		runId: "r",
	});
	await f.bind();
	f.store().cases[0].title = "changed";
	expect(await f.a.sync(f.cwd, "api", "r")).toMatchObject({
		complete: false,
		counts: { stale: 1 },
		items: [{ status: "stale" }],
	});
	expect(f.runs().runs).toHaveLength(0);
	f.a.dispose();
});
it("isolates one invalid environment while synchronizing an independent association", async () => {
	const f = fixture();
	await f.a.idle();
	await f.bind();
	f.store().cases.push({
		...f.store().cases[0],
		id: "other",
		automation: { ...f.store().cases[0].automation, envId: "missing" },
	});
	const result = await f.a.sync(f.cwd, "api", "r");
	expect(result).toMatchObject({ ok: false, imported: 1, complete: false, counts: { new: 1, failed: 1 } });
	expect(f.runs().runs).toHaveLength(1);
	const originalId = f.runs().runs[0].id;
	f.store().envs.push({ ...f.store().envs[0], id: "missing" });
	const repaired = await f.a.sync(f.cwd, "api", "r");
	expect(repaired).toMatchObject({ complete: true, runId: "r", counts: { new: 1, existing: 1, failed: 0 } });
	expect(f.runs().runs).toHaveLength(2);
	expect(f.runs().runs[0].id).toBe(originalId);
	f.a.dispose();
});
it("keeps full unmatched counts when native receipt items are truncated", async () => {
	const f = fixture();
	await f.a.idle();
	f.native.rows = Array.from({ length: 105 }, (_, i) => ({
		caseId: `N${i}`,
		status: "skipped",
		evidenceComplete: false,
	}));
	const receipt = await f.a.call(f.cwd, { action: "sync-status", engine: "api", runRef: "r" });
	expect(receipt).toMatchObject({
		complete: false,
		imported: 0,
		total: 105,
		nativeCaseCount: 105,
		counts: { unmatched: 105 },
		itemsTruncated: true,
	});
	expect(receipt.items).toHaveLength(100);
	expect(f.runs().runs).toHaveLength(0);
	f.a.dispose();
});

it("allows sync-status through read-only guards but keeps sync a write", () => {
	expect(extensionToolEffect("data_space_automation", { action: "sync-status" })).toBe("query");
	expect(
		extensionToolDenial(
			"data_space_automation",
			{ action: "sync-status" },
			{ planMode: true, delegateMode: true, goalReview: true, permission: "read-only", uiDisabled: false },
		),
	).toBeUndefined();
	expect(extensionToolEffect("data_space_automation", { action: "sync" })).toBe("asset-write");
});

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
		await defs[1].execute("status", { action: "sync-status" });
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
