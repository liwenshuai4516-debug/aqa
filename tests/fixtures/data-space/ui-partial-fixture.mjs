/** Shared real native partial-report fixture; no business or model requests. */
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { collectResults, saveAnalysis, draftReport } from "pi-ui-testing";
import { ready } from "./ui-run-fixture.mjs";
import { artifact } from "./ui-artifacts.mjs";

export async function partialReport(t) {
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
	return { ...d, execution, trace, traceBytes, results, analysis, report };
}
