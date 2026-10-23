/** Regression against the installed distribution; control review and synthetic target only. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	UiWorkflowService,
	capabilities,
	collectResults,
	saveAnalysis,
	draftReport,
	ResultReviewService,
} from "pi-ui-testing";
import { partialReport } from "./fixtures/data-space/ui-partial-fixture.mjs";

test(
	"U01: partial delivery blocks final completion and preserves same-task recovery",
	{ timeout: 90000 },
	async (t) => {
		const { f, execution, trace, traceBytes, report } = await partialReport(t);
		const runtime = {
			tools: ["read", ...capabilities.map((c) => c.tool)],
			skills: ["ui-result-analysis", "ui-result-review"],
		};
		const workflow = new UiWorkflowService(f.root, f.authority, runtime);
		let task = await workflow.start({ task_id: "partial-workflow", mode: "analyze", run_ref: execution.run_ref });
		task = await workflow.checkpoint(task.task_ref, "analyze", [report.report_ref]);
		task = await workflow.checkpoint(task.task_ref, "result-review", [report.report_ref]);
		assert.equal(task.task.data.state, "blocked");
		assert.equal(task.next_stage, "result-review");
		assert.equal(task.task.data.completed_stages.includes("result-review"), false);
		assert.ok(task.task.data.blockers.some((reason) => reason.includes("完整")));
		const delivery = task.delivery_ref;
		assert.match(await readFile(join(f.root, delivery.path), "utf8"), /阶段报告；完整性未通过/);
		task = await new UiWorkflowService(f.root, f.authority, runtime).resumeTask(task.task_ref);
		assert.equal(task.task.id, "partial-workflow");
		assert.ok(task.task.data.output_refs.some((ref) => ref.path === delivery.path));
		// A second checkpoint must retain the Markdown delivery without parsing it as JSON.
		task = await workflow.checkpoint(task.task_ref, "result-review", [report.report_ref]);
		assert.equal(task.task.data.state, "blocked");
		assert.equal(task.task.data.output_refs.filter((ref) => ref.path === delivery.path).length, 1);
		await writeFile(join(f.root, trace.path), traceBytes);
		assert.equal((await f.store.load(report.report_ref, false)).data.completeness, "partial");
		const before = f.fixture.state.browserRequests;
		assert.ok(before > 0, "The native browser run must have reached the isolated target");
		const restored = await collectResults(f.root, execution.run_ref, "restored-results");
		const oldAnalysis = await f.store.load((await f.store.load(report.report_ref, false)).data.analysis_ref, false);
		const restoredAnalysis = await saveAnalysis(f.root, {
			...oldAnalysis,
			id: "restored-analysis",
			data: { ...oldAnalysis.data, results_ref: restored.results_ref },
		});
		const full = await draftReport(f.root, restored.results_ref, restoredAnalysis.analysis_ref, "restored-report");
		const approved = await new ResultReviewService(f.root, f.authority).assess(
			full.report_ref,
			"restored-review",
			async (input) => {
				const source = input.evidence.find((e) => e.ref.path.endsWith("/content.md")) ?? input.evidence[0];
				const checks = Array.from({ length: 6 }, (_, i) => ({
					rule: `R${i + 1}`,
					verdict: "pass",
					reason: "Controlled protocol review only; not real model semantic acceptance.",
					evidence: [{ anchor_id: source.anchors[0].anchor_id }],
				}));
				return {
					raw: JSON.stringify({
						decision: "approved",
						checked_rules: checks.map((c) => c.rule),
						checks,
						issues: [],
						improvement: "first",
					}),
					provider: "fixture",
					model: "protocol",
				};
			},
		);
		assert.equal(approved.decision, "approved");
		task = await workflow.resumeTask(task.task_ref);
		task = await workflow.checkpoint(task.task_ref, "result-review", [full.report_ref, approved.review_ref]);
		assert.equal(task.task.id, "partial-workflow");
		assert.equal(task.task.data.state, "completed");
		assert.ok(task.task.data.output_refs.some((ref) => ref.path === delivery.path));
		assert.equal((await f.store.load(report.report_ref, false)).data.completeness, "partial");
		assert.match(await readFile(join(f.root, task.delivery_ref.path), "utf8"), /\| failed \| 1 \|/);
		assert.equal(f.fixture.state.browserRequests, before, "Analysis recovery must not replay the browser");
	},
);
