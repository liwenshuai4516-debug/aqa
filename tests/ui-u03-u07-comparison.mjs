/** Five alternating deterministic pairs; same native run and pending-review endpoint, no model calls. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import * as current from "pi-ui-testing";
import { ready } from "./fixtures/data-space/ui-run-fixture.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const output = join(repo, "tests/scratch/ui-u03-u07/comparison", String(Date.now()));
await mkdir(output, { recursive: true });
const extracted = await mkdtemp(join(tmpdir(), "ui-u03-baseline-"));
const baselinePackage = join(repo, ".pi/skills/ui-testing-workflow/assets/pi-ui-testing-0.1.18.tgz");
execFileSync("tar", ["-xzf", baselinePackage, "-C", extracted]);
await symlink(join(repo, "node_modules"), join(extracted, "package/node_modules"), "dir");
const baseline = await import(pathToFileURL(join(extracted, "package/dist/index.js")).href);
const cleanup = [];
const d = await ready({ after: (fn) => cleanup.push(fn) });
const { f } = d;
const runtime = {
	tools: ["read", "ui_result_analysis", "ui_result_review"],
	skills: ["ui-result-analysis", "ui-result-review"],
};
const samples = [],
	result = {
		status: "FAIL",
		actualModelCalls: 0,
		pairs: 5,
		baseline_version: "0.1.18",
		current_version: "0.1.20",
		samples,
	};
try {
	const execution = await d.service.start(d.request);
	const runBefore = await readFile(join(f.root, execution.run_ref.path));
	const browsers = f.fixture.state.browserRequests;
	result.run_ref = execution.run_ref;
	result.baseline_package_sha256 = current.sha256(await readFile(baselinePackage));
	result.current_package_sha256 = current.sha256(
		await readFile(join(repo, ".pi/skills/ui-testing-workflow/assets/pi-ui-testing-0.1.20.tgz")),
	);
	// Freeze endpoints before measuring: registered analyze task -> normal report candidate pending independent review.
	for (let pair = 0; pair < 5; pair++) {
		for (const version of pair % 2 ? ["current", "baseline"] : ["baseline", "current"]) {
			const api = version === "current" ? current : baseline;
			const w = new api.UiWorkflowService(f.root, f.authority, runtime);
			const id = `pair-${pair}-${version}`;
			const started = await w.start({ task_id: id, mode: "analyze", run_ref: execution.run_ref });
			const before = performance.now();
			let state, reportRef, calls;
			if (version === "baseline") {
				const parsed = await api.collectResults(f.root, execution.run_ref, id);
				const analysis = await api.saveAnalysis(f.root, {
					schema_version: "1.0",
					kind: "analysis",
					id,
					created_at: execution.run.created_at,
					data: { run_ref: execution.run_ref, results_ref: parsed.results_ref, findings: [] },
				});
				const report = await api.draftReport(f.root, parsed.results_ref, analysis.analysis_ref, id);
				reportRef = report.report_ref;
				state = await w.checkpoint(started.task_ref, "analyze", [reportRef]);
				calls = 4;
			} else {
				const analyzed = await api.analyzeTask(w, id);
				reportRef = analyzed.report_ref;
				// The host projects the returned workflow receipt directly to the existing board.
				state = analyzed.workflow;
				calls = 1;
			}
			const elapsed_ms = performance.now() - before;
			assert.equal(state.task.data.stage, "result-review");
			assert.equal(state.task.data.state, "running");
			const report = await f.store.load(reportRef);
			const verified = await current.verifyResults(f.root, report.data.results_ref);
			assert.equal(verified.data.counts.passed, 1);
			assert.equal(report.data.completeness, "complete");
			assert.equal(f.fixture.state.browserRequests, browsers);
			samples.push({
				pair,
				version,
				elapsed_ms,
				deterministic_tool_calls: calls,
				counts: verified.data.counts,
				report_ref: reportRef,
				task_ref: state.task_ref,
				browser_requests: 0,
				model_calls: 0,
			});
		}
	}
	assert.deepEqual(await readFile(join(f.root, execution.run_ref.path)), runBefore);
	const summary = (values) => {
		const sorted = [...values].sort((a, b) => a - b);
		return { median_ms: sorted[2], max_ms: Math.max(...values) };
	};
	result.summary = Object.fromEntries(
		["baseline", "current"].map((v) => [v, summary(samples.filter((s) => s.version === v).map((s) => s.elapsed_ms))]),
	);
	result.paired_changes = Array.from({ length: 5 }, (_, pair) => {
		const rows = samples.filter((s) => s.pair === pair);
		return (
			rows.find((s) => s.version === "current").elapsed_ms / rows.find((s) => s.version === "baseline").elapsed_ms - 1
		);
	});
	result.limitations = [
		"Warm local mechanical paths only; fixture setup and formal browser run are excluded.",
		"Both versions stop at the same pending independent review; no real-model planning or final delivery was measured.",
		"Task/artifact history grows across pairs; alternating order and all samples retained. No 20% whole-workflow speed claim.",
		"Current host projects the analyze-task receipt directly; no extra status call is needed.",
	];
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	for (const fn of cleanup.reverse()) await fn();
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(
		JSON.stringify({
			status: result.status,
			summary: result.summary,
			paired_changes: result.paired_changes,
			error: result.error,
			output,
		}),
	);
}
