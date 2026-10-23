import { describe, expect, it } from "vitest";
import { F01, F02, F04, F05, F06, F07 } from "../../plugins/agent-evaluation/evaluators/basic.mjs";
import { F08, timingMetrics, costMetrics } from "../../plugins/agent-evaluation/evaluators/metrics.mjs";
import { engineFixture } from "../fixtures/agent-evaluation/engine.mjs";
import { createInternalRegistry } from "../../plugins/agent-evaluation/profiles/internal.mjs";
import { digest } from "../../plugins/agent-evaluation/schema.mjs";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const view = (entries: any[], coverage = "complete") => ({
	snapshot: { coverage, gaps: [] },
	attempts: [],
	conflicting: [],
	evidence: entries.map((entry, i) => ({
		ref: { kind: "evidence", id: id(i + 1), revision: 1 },
		digest: digest(entry),
		data: {
			attemptRef: { kind: "attempts", id: id(999), revision: 1 },
			sourceId: "pi:session",
			sourceEventId: `m${i + 1}`,
			producer: "pi-evidence-v1",
			availability: "available",
			origin: "harness-observed",
			kind: "message",
			observedAt: "2026-10-24T00:00:00Z",
			occurredAt: `2026-10-24T00:00:0${i}Z`,
			truncated: false,
			redaction: [],
			...entry.data,
		},
		value: entry.value,
		text: JSON.stringify(entry.value),
	})),
});
const call = (toolCallId: string, name = "read", args: any = {}) => ({
	value: { message: { role: "assistant", content: [{ type: "toolCall", id: toolCallId, name, arguments: args }] } },
});
const result = (toolCallId: string, isError = false, extras: any = {}) => ({
	value: { message: { role: "toolResult", toolCallId, isError, ...extras } },
});
const run = (rule: any, v: any, config: any = {}) => rule.evaluate({}, v, config, new AbortController().signal);
const artifact = (value: any) => ({
	data: { kind: "artifact-snapshot", producer: "artifact-reader-v1" },
	value: { path: "result.json", exists: true, text: '{"ok":true}', redaction: [], truncated: false, ...value },
});
const native = (overrides: any = {}) => ({
	data: { kind: "native-test-run", producer: "native-reader-v1" },
	value: {
		engine: "api",
		runId: "run1",
		at: "2026-10-24T00:00:00.500Z",
		complete: true,
		rows: [{ caseId: "c1", status: "passed", evidenceComplete: true }],
		...overrides,
	},
});
function nativeView(overrides: any = {}, linked = true) {
	return view([
		call("t1", "api_test_execute", { action: "asset_run" }),
		result("t1", false, linked ? { nativeExecution: { engine: "api", reference: "run1" } } : {}),
		native(overrides),
	]);
}
describe("EC03 F01 artifact checks", () => {
	it.each([
		[
			"presence and JSON schema",
			{},
			{ format: "json", jsonSchema: { type: "object", required: ["ok"], properties: { ok: { const: true } } } },
			"pass",
		],
		["absent artifact", { exists: false }, {}, "fail"],
		["bad JSON", { text: "not-json" }, { format: "json" }, "fail"],
		[
			"schema mismatch",
			{ text: '{"ok":false}' },
			{ jsonSchema: { type: "object", properties: { ok: { const: true } } } },
			"fail",
		],
		["redacted bytes", { redaction: ["credentials-v1"] }, { format: "json" }, "inconclusive"],
		["bounded existence still observable", { truncated: true }, {}, "pass"],
		["unobserved digest", {}, { sha256: "0".repeat(64) }, "inconclusive"],
		["changed digest", { sha256: "1".repeat(64) }, { sha256: "0".repeat(64) }, "fail"],
	])("%s", (_name, value, check, expected) => {
		expect(
			run(F01, view([artifact(value)]), { checks: [{ conditionId: "c", path: "result.json", ...check }] })[0].verdict,
		).toBe(expected);
	});
	it("does not infer absence from missing evidence or promote target-reported bytes", () => {
		expect(run(F01, view([]), { checks: [{ conditionId: "c", path: "result.json" }] })[0].verdict).toBe("inconclusive");
		const v = view([artifact({})]);
		v.evidence[0].data.origin = "target-reported";
		expect(run(F01, v, { checks: [{ conditionId: "c", path: "result.json" }] })[0].verdict).toBe("inconclusive");
	});
});
describe("EC03 F02 current native results", () => {
	it("requires a matching UI manifest digest as well as a current execution reference", () => {
		const path = "qa/ui/runs/run1/manifest.json",
			sha256 = "a".repeat(64);
		const v = view([
			call("t1", "ui_test_run", { request: { operation: "start" } }),
			result("t1", false, { nativeExecution: { engine: "ui", reference: { path, sha256 } } }),
			native({ engine: "ui", evidence: [{ path, sha256 }] }),
		]);
		const config = { checks: [{ conditionId: "c", runId: "run1" }] };
		expect(run(F02, v, config)[0].verdict).toBe("pass");
		v.evidence[2].value.evidence[0].sha256 = "b".repeat(64);
		expect(run(F02, v, config)[0].verdict).toBe("inconclusive");
	});

	it.each([
		["current passed", {}, true, "pass"],
		["old run", { at: "2025-01-01T00:00:00Z" }, true, "inconclusive"],
		["no execution link", {}, false, "inconclusive"],
		["incomplete", { complete: false }, true, "inconclusive"],
		["failed assertion", { rows: [{ caseId: "c1", status: "failed", evidenceComplete: true }] }, true, "fail"],
		[
			"skipped is not passed",
			{ rows: [{ caseId: "c1", status: "skipped", evidenceComplete: true }] },
			true,
			"inconclusive",
		],
	])("%s", (_name, value, linked, expected) => {
		expect(run(F02, nativeView(value, linked), { checks: [{ conditionId: "c", runId: "run1" }] })[0].verdict).toBe(
			expected,
		);
	});
});
describe("EC03 F04 necessary dependencies", () => {
	const config = { checks: [{ conditionId: "c", prerequisiteToolCallId: "before", dependentToolCallId: "after" }] };
	it("accepts stopping after failure and allows independent diagnosis", () => {
		expect(run(F04, view([call("before"), result("before", true), call("diagnosis")]), config)[0].verdict).toBe("pass");
	});
	it("rejects running the necessary dependent step after failed prerequisite", () => {
		expect(run(F04, view([call("before"), result("before", true), call("after")]), config)[0].verdict).toBe("fail");
	});
	it("does not prove stopped behavior from partial coverage or unknown prerequisite", () => {
		expect(run(F04, view([call("before"), result("before", true)], "partial"), config)[0].verdict).toBe("inconclusive");
		expect(run(F04, view([call("before")]), config)[0].verdict).toBe("inconclusive");
	});
});
describe("EC03 F05 structured claims", () => {
	it("checks observed boolean claims against separate artifact facts; free text remains unknown", () => {
		const v = view([
			{ data: { kind: "structured-claim", producer: "fixture-observer" }, value: { completed: true } },
			artifact({ exists: false }),
		]);
		const cfg = {
			checks: [
				{
					conditionId: "c",
					claimEvidenceId: id(1),
					claimPath: "/completed",
					basisEvidenceId: id(2),
					basisPath: "/exists",
					expectedValue: true,
				},
			],
		};
		expect(run(F05, v, cfg)[0].verdict).toBe("fail");
		v.evidence[1].value.exists = true;
		expect(run(F05, v, cfg)[0].verdict).toBe("pass");
		v.evidence[0].value = {
			message: { role: "assistant", content: [{ type: "text", text: "I finished everything" }] },
		};
		expect(run(F05, v, cfg)[0].verdict).toBe("inconclusive");
	});
});
describe("EC03 F06/F07 process diagnostics", () => {
	it("does not report complete zero calls after discarding conflicting or unavailable records", () => {
		const v = view([call("a"), result("a")]);
		v.evidence.forEach((e) => (e.data.truncated = true));
		expect(run(F06, v)[0].verdict).toBe("inconclusive");
		expect(run(F06, v)[0].metrics.ignoredObservations).toBe(2);
	});

	it("deduplicates observations, counts failure/denial/cancel, and does not score these as Agent failures", () => {
		const v = view([
			call("a"),
			result("a", true),
			call("a"),
			result("a", true),
			call("b"),
			result("b", true, { denied: true }),
			call("c"),
			result("c", true, { cancelled: true }),
		]);
		const f = run(F06, v)[0];
		expect(f.verdict).toBe("pass");
		expect(f.metrics.counts).toEqual({ succeeded: 0, failed: 1, denied: 1, cancelled: 1, unknown: 0 });
		expect(f.attributions).toEqual([]);
	});
	it("retains unknown lifecycle counts for missing ends", () => {
		expect(run(F06, view([call("a")]))[0]).toMatchObject({
			verdict: "inconclusive",
			metrics: { counts: { unknown: 1 } },
		});
	});
	it("emits candidates without a hard penalty and excludes configured polling and repair boundaries", () => {
		const v = view([
			call("a", "read", { path: "a" }),
			result("a", true),
			call("b", "read", { path: "a" }),
			result("b", true),
			call("fix", "edit"),
			result("fix"),
			call("c", "read", { path: "a" }),
			result("c"),
			call("p1", "status"),
			result("p1"),
			call("p2", "status"),
			result("p2"),
		]);
		const f = run(F07, v, { pollingToolNames: ["status"], repairToolNames: ["edit"] })[0];
		expect(f.verdict).toBe("pass");
		expect(f.metrics.candidates).toHaveLength(1);
		expect(f.metrics.candidates[0].callIds).toEqual(["a", "b"]);
		expect(f.metrics.excludedPolling).toBe(2);
	});
});
describe("EC03 F08 timing and cost", () => {
	const interval = (id: string, extras: any = {}) => ({
		id,
		attemptId: "a",
		phase: "agent",
		kind: "work",
		clockEpoch: "process-1",
		startMs: 0,
		endMs: 10000,
		...extras,
	});
	it("uses interval unions for two parallel ten-second calls and sums work without parent waits", () => {
		const metrics = timingMetrics([
			interval("a"),
			interval("b"),
			interval("wait", { kind: "wait-child" }),
			interval("a"),
		]);
		expect(metrics).toMatchObject({ wallMs: 10000, cumulativeWorkMs: 20000, waitingChildMs: 10000 });
	});
	it("does not join different monotonic epochs or use negative rollback intervals", () => {
		const metrics = timingMetrics([
			interval("a"),
			interval("b", { clockEpoch: "process-2" }),
			interval("bad", { endMs: -1 }),
		]);
		expect(metrics.wallMs).toBeNull();
		expect(metrics.cumulativeWorkMs).toBe(20000);
		expect(metrics.gaps.length).toBeGreaterThan(0);
	});
	it("separates actual/estimated accounts and deduplicates provider/SDK reports of the same call", () => {
		const actual = { callId: "one", phase: "agent", source: "provider-measured", amount: 0.1, currency: "USD" };
		const metrics = costMetrics([
			actual,
			actual,
			{ ...actual, source: "estimated", amount: 0.2, priceVersion: "p1" },
			{ callId: "two", phase: "verification", source: "estimated", amount: 0.3, currency: "CNY", priceVersion: "p2" },
		]);
		expect(metrics.phases.agent).toMatchObject({
			calls: 1,
			knownActualByCurrency: { USD: 0.1 },
			knownEstimatedByCurrency: {},
		});
		expect(metrics.phases.verification.knownEstimatedByCurrency).toEqual({ CNY: 0.3 });
		expect(metrics.phases.evaluation.observed).toBe(false);
	});
	it("leaves missing usage, unversioned estimates and conflicting phases unknown", () => {
		const metrics = costMetrics([
			{ callId: "one", phase: "agent", source: "estimated", amount: 0.1, currency: "USD" },
			{ callId: "shared", phase: "agent", source: "provider-measured", amount: 0.1, currency: "USD" },
			{ callId: "shared", phase: "verification", source: "provider-measured", amount: 0.1, currency: "USD" },
		]);
		expect(metrics.phases.agent).toMatchObject({
			unknownCalls: 1,
			knownEstimatedByCurrency: {},
			knownActualByCurrency: {},
		});
		expect(metrics.unassigned).toHaveLength(1);
	});
	it("never infers task duration or model thinking from tool time alone", () => {
		const v = view([{ data: { kind: "timing-interval" }, value: interval("a") }]);
		const result = run(F08, v, {
			prices: [],
			childWaitToolNames: [],
			checks: [{ conditionId: "limit", maxAgentWallMs: 20000 }],
		});
		expect(result[0].metrics.modelThinkingMs).toBeNull();
		expect(result[1].verdict).toBe("inconclusive");
		expect(
			run(F08, v, { prices: [], childWaitToolNames: [], checks: [{ conditionId: "limit", maxAgentWallMs: 5000 }] })[1]
				.verdict,
		).toBe("fail");
	});

	it("rejects conflicting live clock observations and preserves monotonic time across a wall-clock jump", () => {
		const live = (type: string, monotonicAt: number, extras: any = {}) => ({
			data: { producer: "pi-live-v1" },
			value: { type, toolCallId: "a", clockEpoch: "p1", monotonicAt, ...extras },
		});
		const v = view([
			call("a"),
			result("a"),
			live("tool_start", 100, { at: 100000 }),
			live("tool_end", 10100, { at: 1 }),
		]);
		const cfg = { prices: [], childWaitToolNames: [], checks: [] };
		expect(run(F08, v, cfg)[0].metrics.timing.wallMs).toBe(10000);
		v.evidence.push(...view([live("tool_start", 500)]).evidence);
		expect(run(F08, v, cfg)[0].metrics.timing.wallMs).toBeNull();
	});
	it("does not select an arbitrary price when model/provider pricing is ambiguous", () => {
		const v = view([
			{
				value: {
					message: {
						role: "assistant",
						model: "m",
						provider: "p",
						usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 },
					},
				},
			},
		]);
		const price = {
			model: "m",
			provider: "p",
			currency: "USD",
			version: "v1",
			inputPerMillion: 1,
			outputPerMillion: 1,
			cacheReadPerMillion: 0,
			cacheWritePerMillion: 0,
		};
		const f = run(F08, v, { prices: [price, { ...price, version: "v2" }], childWaitToolNames: [], checks: [] })[0];
		expect(f.metrics.costs.phases.agent.knownEstimatedByCurrency).toEqual({});
		expect(f.missingEvidence.some((x: string) => x.startsWith("ambiguous-price:"))).toBe(true);
	});
	it("registers all seven versions without inventing goal conditions", () => {
		const registry = createInternalRegistry();
		expect(registry.profile("internal", "1").rules.map((r: any) => r.id)).toEqual([
			"F01",
			"F02",
			"F04",
			"F05",
			"F06",
			"F07",
			"F08",
		]);
	});
});

describe("EC03 sealed engine rule integration", () => {
	it.each([
		["valid artifact", { exists: true, text: '{"ok":true}', truncated: false, redaction: [] }, "pass"],
		["missing artifact", { exists: false }, "fail"],
		["invalid JSON", { exists: true, text: "{", truncated: false, redaction: [] }, "fail"],
	])("scores %s and preserves the old report after explicit re-evaluation", async (_label, value, verdict) => {
		const f = engineFixture({
			rules: [F01],
			conditions: [{ id: "file", ruleRef: "F01@1" }],
			configs: { F01: { checks: [{ conditionId: "file", path: "result.json", format: "json" }] } },
			evidence: [{ kind: "artifact-snapshot", value: { path: "result.json", ...value } }],
		});
		try {
			const first = await f.engine.evaluate(f.context, f.args);
			expect(first.data.findings[0].verdict).toBe(verdict);
			expect(first.data.summary.counts.errors).toBe(0);
			expect(first.data.job.clockSource).toBe("process-monotonic");
			expect(first.data.job.elapsedMs).toBeGreaterThanOrEqual(0);
			const next = await f.engine.evaluate(f.context, { ...f.args, requestId: "again" });
			expect(next.id).not.toBe(first.id);
			expect(next.data.findings).toEqual(first.data.findings);
			expect(f.store.get(f.context, { kind: first.kind, id: first.id, revision: first.revision })).toEqual(first);
		} finally {
			f.cleanup();
		}
	});
});
