/** Regression against the installed distribution; control review and synthetic target only. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { UiWorkflowService, capabilities } from "pi-ui-testing";
import { partialReport, restorePartial } from "./fixtures/data-space/ui-partial-fixture.mjs";

test(
	"U01: partial delivery blocks final completion and preserves same-task recovery",
	{ timeout: 90000 },
	async (t) => {
		const fixture = await partialReport(t);
		const { f, execution, report } = fixture;
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
		const before = f.fixture.state.browserRequests;
		assert.ok(before > 0, "The native browser run must have reached the isolated target");
		const { full, approved } = await restorePartial(fixture);
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
