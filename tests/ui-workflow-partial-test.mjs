/** Regression against the installed distribution; control review and synthetic target only. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UiWorkflowService, capabilities, collectResults, saveAnalysis, draftReport } from "pi-ui-testing";
import { ready } from "./fixtures/data-space/ui-run-fixture.mjs";
import { artifact } from "./fixtures/data-space/ui-artifacts.mjs";

test(
	"U01: partial delivery blocks final completion and preserves same-task recovery",
	{ timeout: 90000 },
	async (t) => {
		const d = await ready(t, { targetFault: true });
		const execution = await d.service.start(d.request);
		assert.equal(execution.run.data.state, "finished");
		const { f } = d;
		const trace = execution.run.data.output_refs.find((r) => r.path.endsWith("trace.zip"));
		const traceBytes = await readFile(join(f.root, trace.path));
		await rm(join(f.root, trace.path));
		const results = await collectResults(f.root, execution.run_ref, "partial-results");
		const analysis = await saveAnalysis(
			f.root,
			artifact(
				"analysis",
				{
					run_ref: execution.run_ref,
					results_ref: results.results_ref,
					findings: [
						{
							instance_id: results.data.instances[0].instance_id,
							classification: "product",
							certainty: "unknown",
							facts: ["Persistence assertion failed after Save and reload."],
							hypotheses: [],
							supporting_refs: [results.data.raw_ref],
							alternatives: ["The UI failure does not establish an internal storage root cause."],
							next_action: "Restore the missing evidence before complete delivery.",
						},
					],
				},
				"partial-analysis",
			),
		);
		const report = await draftReport(f.root, results.results_ref, analysis.analysis_ref, "partial-report");
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
	},
);
