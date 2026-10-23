import { afterEach, describe, expect, it, vi } from "vitest";
import { engineFixture, evaluator, passFinding } from "../fixtures/agent-evaluation/engine.mjs";
import { EvaluationEngine } from "../../plugins/agent-evaluation/evaluate.mjs";
import { recordsOf } from "../../plugins/agent-evaluation/collect.mjs";
const cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup.splice(0).reverse()) fn();
});
const setup = (options: any) => {
	const f = engineFixture(options);
	cleanup.push(f.cleanup);
	return f;
};
describe("EC03 snapshot-only scoring jobs", () => {
	it("freezes inputs, persists version/configuration and re-evaluates without recollecting or executing", async () => {
		const evaluate = vi.fn((_contract, view) => {
			expect(Object.isFrozen(view.evidence[0].value)).toBe(true);
			expect(Object.keys(view).sort()).toEqual(["attempts", "conflicting", "evidence", "snapshot"]);
			return [passFinding(view, "goal")];
		});
		const f = setup({ rules: [evaluator("Custom", evaluate)], conditions: [{ id: "goal", ruleRef: "Custom@1" }] });
		const first = await f.engine.evaluate(f.context, f.args);
		expect(first.data).toMatchObject({
			state: "completed",
			summary: { goal: "achieved", deliveryVerdict: "pass" },
			configuration: { profileId: "fixture" },
		});
		expect(first.data.findings[0].nature).toBe("verified");
		expect((await f.engine.evaluate(f.context, f.args)).id).toBe(first.id);
		expect(evaluate).toHaveBeenCalledTimes(1);
		const again = await f.engine.evaluate(f.context, { ...f.args, requestId: "rescore" });
		expect(again.id).not.toBe(first.id);
		expect(again.data.snapshotRef).toEqual(first.data.snapshotRef);
		expect(recordsOf(f.store, f.context, "attempts")).toHaveLength(1);
		expect(evaluate).toHaveBeenCalledTimes(2);
	});
	it("isolates a throwing rule and keeps independent findings and a completed report", async () => {
		const f = setup({
			rules: [
				evaluator("Broken", () => {
					throw new Error("private exception text");
				}),
				evaluator("Healthy", (_c, view) => [passFinding(view, "goal")]),
			],
			conditions: [{ id: "goal", ruleRef: "Healthy" }],
		});
		const report = await f.engine.evaluate(f.context, f.args);
		expect(report.data.state).toBe("completed");
		expect(report.data.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ ruleId: "Broken", verdict: "inconclusive", error: "EVALUATOR_ERROR" }),
				expect.objectContaining({ conditionId: "goal", verdict: "pass" }),
			]),
		);
		expect(report.data.summary).toMatchObject({ goal: "achieved", deliveryVerdict: "inconclusive" });
		expect(JSON.stringify(report)).not.toContain("private exception text");
	});
	it("times out asynchronous work without accepting its eventual result", async () => {
		let resolve: any;
		const f = setup({
			rules: [
				evaluator(
					"Slow",
					() =>
						new Promise((r) => {
							resolve = r;
						}),
					{ timeoutMs: 5 },
				),
			],
		});
		const report = await f.engine.evaluate(f.context, f.args);
		expect(report.data.findings[0].error).toBe("RULE_TIMEOUT");
		resolve([]);
		await new Promise((r) => setTimeout(r, 10));
		expect(recordsOf(f.store, f.context, "evaluations")).toHaveLength(1);
	});
	it("cancels a running generation and rejects late completion; stop prevents new jobs", async () => {
		let resolve: any;
		const f = setup({
			rules: [
				evaluator(
					"Slow",
					() =>
						new Promise((r) => {
							resolve = r;
						}),
				),
			],
		});
		const job = f.engine.start(f.context, f.args);
		await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
		f.engine.cancel(f.context, job.jobId);
		const report = await job.done;
		expect(report.data).toMatchObject({
			state: "cancelled",
			job: { generation: 2, cancellationRequestedAt: expect.any(String), cancellationConfirmedAt: expect.any(String) },
		});
		resolve([]);
		await new Promise((r) => setTimeout(r, 10));
		expect(recordsOf(f.store, f.context, "evaluations")).toHaveLength(1);
		f.engine.close();
		expect(() => f.engine.start(f.context, { ...f.args, requestId: "new" })).toThrow(/stopped/);
	});
	it("cancels queued work without calling an evaluator", async () => {
		const evaluate = vi.fn(() => []),
			f = setup({ rules: [evaluator("Never", evaluate)] });
		const job = f.engine.start(f.context, f.args);
		f.engine.cancel(f.context, job.jobId);
		expect((await job.done).data.state).toBe("cancelled");
		expect(evaluate).not.toHaveBeenCalled();
	});
	it("rejects fabricated evidence, wrong condition binding and malformed output without making the Agent fail", async () => {
		const f = setup({
			rules: [
				evaluator("Invalid", () => [
					{
						...passFinding(
							{ evidence: [{ ref: { kind: "evidence", id: "00000000-0000-4000-8000-000000000000", revision: 1 } }] },
							"goal",
						),
					},
				]),
			],
			conditions: [{ id: "goal", ruleRef: "Invalid" }],
		});
		const report = await f.engine.evaluate(f.context, f.args);
		expect(report.data.findings[0]).toMatchObject({ error: "INVALID_RULE_OUTPUT", verdict: "inconclusive" });
		expect(report.data.summary.deliveryVerdict).toBe("inconclusive");
	});
	it("does not promote target self-reports to verified required success", async () => {
		const f = setup({
			rules: [evaluator("Read", (_c, view) => [passFinding(view, "goal")])],
			conditions: [{ id: "goal", ruleRef: "Read" }],
			evidence: [{ kind: "claim", origin: "target-reported", value: { pass: true } }],
		});
		const report = await f.engine.evaluate(f.context, f.args);
		expect(report.data.findings[0]).toMatchObject({ verdict: "inconclusive", nature: "unconfirmed" });
	});
	it("does not replay an interrupted durable job on another engine instance", async () => {
		let resolve: any;
		const f = setup({
			rules: [
				evaluator(
					"Slow",
					() =>
						new Promise((r) => {
							resolve = r;
						}),
				),
			],
		});
		const job = f.engine.start(f.context, f.args);
		await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
		const replacement = new EvaluationEngine(f.store, f.registry);
		expect(() => replacement.start(f.context, f.args)).toThrow(/interrupted/);
		expect(replacement.status(f.context, job.jobId).state).toBe("unknown");
		f.engine.cancel(f.context, job.jobId);
		await job.done;
		replacement.close();
	});
	it("refuses an unauthorized caller before idempotency/status/cancellation access", async () => {
		const f = setup({ rules: [evaluator("Read", (_c, view) => [passFinding(view)])] });
		const job = f.engine.start(f.context, f.args);
		await job.done;
		expect(() => f.engine.start({}, f.args)).toThrow();
		expect(() => f.engine.status({}, job.jobId)).toThrow();
		expect(() => f.engine.cancel({}, job.jobId)).toThrow();
	});
	it("reports save failure without pretending an empty successful report and recovers a lost durable receipt", async () => {
		const calls = vi.fn((_c: any, view: any) => [passFinding(view)]);
		const f = setup({ rules: [evaluator("Read", calls)] });
		let publications = 0;
		f.store.fault = (stage: string) => {
			if (stage === "afterPublish" && ++publications === 3) throw new Error("lost acknowledgement");
		};
		await expect(f.engine.evaluate(f.context, f.args)).rejects.toThrow(/durable/);
		f.store.fault = () => {};
		const recovered = await f.engine.evaluate(f.context, f.args);
		expect(recovered.data.state).toBe("completed");
		expect(calls).toHaveBeenCalledTimes(1);
		expect(recordsOf(f.store, f.context, "evaluations")).toHaveLength(1);
	});
	it("rejects a synchronous late result and isolates it from the next rule", async () => {
		const f = setup({
			rules: [
				evaluator(
					"Slow",
					(_c: any, view: any) => {
						const until = performance.now() + 15;
						while (performance.now() < until) {
							/* controlled synchronous timeout fixture */
						}
						return [passFinding(view)];
					},
					{ timeoutMs: 1 },
				),
				evaluator("Next", (_c: any, view: any) => [passFinding(view)]),
			],
		});
		const report = await f.engine.evaluate(f.context, f.args);
		expect(report.data.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ ruleId: "Slow", error: "RULE_TIMEOUT" }),
				expect.objectContaining({ ruleId: "Next", verdict: "pass" }),
			]),
		);
	});
	it("does not invoke a rule whose declared required evidence is absent", async () => {
		const calls = vi.fn(() => []);
		const f = setup({ rules: [evaluator("NeedsNative", calls, { requiredEvidence: ["native-test-run"] })] });
		const report = await f.engine.evaluate(f.context, f.args);
		expect(calls).not.toHaveBeenCalled();
		expect(report.data.summary.counts).toMatchObject({ executed: 0, notExecuted: 1, errors: 0 });
		expect(report.data.findings[0]).toMatchObject({ verdict: "inconclusive", error: "EVIDENCE_GAP" });
	});
	it("does not mark a rejected report write as completed", async () => {
		const f = setup({ rules: [evaluator("Read", (_c: any, view: any) => [passFinding(view)])] });
		let writes = 0;
		f.store.fault = (stage: string) => {
			if (stage === "beforeWrite" && ++writes === 3) throw new Error("disk unavailable");
		};
		const job = f.engine.start(f.context, f.args);
		await expect(job.done).rejects.toThrow(/Write failed/);
		f.store.fault = () => {};
		expect(f.engine.status(f.context, job.jobId)).toMatchObject({ state: "failed", error: "IO_ERROR" });
		expect(recordsOf(f.store, f.context, "evaluations")).toHaveLength(0);
	});
});
