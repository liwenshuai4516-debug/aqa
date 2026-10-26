/** U00: existing approved synthetic asset → controlled failure → analysis → failed-only rerun.
 * Revalidates changed native diagnostic rules. Never creates design/result approval or calls a model.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	ArtifactStore,
	DesignReviewService,
	RuntimeAdmissionService,
	UiRunService,
	UiWorkflowService,
	capabilities,
	collectResults,
	recoveryPlan,
	saveAnalysis,
	draftReport,
	checkReport,
	traceEvidence,
	verifyResults,
	sha256,
} from "pi-ui-testing";
import { measureDiscovery } from "./lib/ui-discovery-measure.mjs";

const [directory, option, receiptPath] = process.argv.slice(2);
assert.ok(!option || (option === "--continue-from" && receiptPath), "Use --continue-from <failed receipt>");
const previous = receiptPath ? JSON.parse(await fs.readFile(resolve(receiptPath), "utf8")) : undefined;
if (previous) {
	assert.equal(previous.status, "FAIL");
	assert.ok(previous.parentReport && !previous.rerun, "Continuation only supports a saved parent report before rerun");
	assert.equal(resolve(previous.plan.root), resolve(directory));
}
assert.ok(directory, "Usage: <original approved U05 directory>; no paid calls");
const root = resolve(directory),
	repo = fileURLToPath(new URL("..", import.meta.url));
const id = previous?.plan.id ?? "u00-failed-" + Date.now(),
	output = join(repo, "tests/scratch/ui-failed-baseline", previous ? id + "-continuation-" + Date.now() : id);
await fs.mkdir(output, { recursive: true });
await fs.cp(fileURLToPath(import.meta.url), join(output, "harness.mjs"));
await fs.cp(join(repo, "tests/lib/ui-discovery-measure.mjs"), join(output, "observer.mjs"));
const load = async (name) => JSON.parse(await fs.readFile(join(root, name), "utf8"));
const revision = await load("browser-v4-diagnostics.json"),
	delivered = await load("browser-v4-delivery.json");
const reviewRef = (await load("native-review-10-authorization4.json")).tool.details.artifact_refs[0];
const spec = await load(revision.diagnosticSpecRef.path);
const store = new ArtifactStore(root),
	authority = join(root, "ui-review-authority");
const installed = dirname(fileURLToPath(import.meta.resolve("pi-ui-testing")));
const workflow = new UiWorkflowService(root, authority, {
	tools: ["read", ...capabilities.map((c) => c.tool)],
	skills: await fs.readdir(join(installed, "../skills")),
});
const immutable = [
	revision.assetRef,
	reviewRef,
	delivered.report_ref,
	delivered.review_ref,
	delivered.delivery_ref,
	(await load("browser-v4-formal.json")).execution.run_ref,
];
for (const ref of immutable) assert.equal(sha256(await fs.readFile(join(root, ref.path))), ref.sha256);
const ledgerPath = join(repo, "tests/scratch/ui-optimization-u00/u05-authorized-review-budget.json");
const ledgerHash = sha256(await fs.readFile(ledgerPath));
const plan = {
	id,
	...(receiptPath ? { continuationOf: resolve(receiptPath), measurementInterrupted: true } : {}),
	createdAt: new Date().toISOString(),
	root: directory,
	assetRef: revision.assetRef,
	reviewRef,
	nativeVersion: JSON.parse(await fs.readFile(join(installed, "../package.json"))).version,
	harnessSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
	diagnostic:
		"Reuse independent design approval; if current runtime gate is stale, run unchanged 15-round/90-attempt spec under a new request. Preserve old diagnostic history.",
	failure: {
		mutation: "A-edit-2",
		caseId: "C-edit",
		expectedPassed: 5,
		expectedFailed: 1,
		expectedAssertionsReached: 13,
	},
	recovery: {
		intent: "rerun-failed",
		selected: ["C-edit"],
		excluded: 5,
		expectedPassed: 1,
		expectedAssertionsReached: 2,
	},
	deployment:
		"Controlled synthetic fixture u00-1: A-edit-2 response variant at original target origin, then frozen positive bytes. Environment version is a family label; do not describe the two response variants as identical deployments or a real product fix.",
	measurement:
		"Sequential native service invocation elapsed time and host async FS counts; direct child starts only, including host preflight browsers. Nested runner/worker browser counts, OS cache state and full workflow before/after pairs are unmeasured. Setup-warmed with observer overhead; service invocation count is not Agent orchestration call count.",
	endpoint:
		"Failure report candidate and separate failed-only rerun report candidate; independent result review/delivery are not authorized by existing v4 design-only remainder and remain pending.",
	modelCalls: 0,
	dataSpaceWrites: 0,
	realTargetRequests: 0,
};
await fs.writeFile(join(output, "plan.json"), JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
const result = { ...previous, status: "FAIL", plan, immutable, modelCalls: 0, fullPlanComplete: false };
delete result.error;
const measurement = measureDiscovery();
const invoke = async (name, call) =>
	(await measurement.invoke("native-service", name, async () => ({ status: "completed", value: await call() }))).value;
const { startProbeServers } = await import(
	pathToFileURL(join(root, dirname(revision.assetRef.path), "ui-probe-replay.mjs")).href
);
let running;
try {
	// Calibration is retained separately; it is not included in a service invocation.
	measurement.mark("before-control");
	await fs.readFile(join(output, "plan.json"));
	measurement.mark("after-control");
	await invoke("trusted-design-gate", () =>
		new DesignReviewService(root, authority).gate(revision.assetRef, reviewRef, false),
	);
	const admission = new RuntimeAdmissionService(root, authority);
	result.originalDiagnosticStatus = await invoke("old-diagnostic-status", () =>
		admission.status("u05-native-diagnostic-1"),
	);
	if (!result.originalDiagnosticStatus.runtime_ready) {
		running = await startProbeServers(revision.deployments);
		result.diagnostic = await invoke("current-rules-diagnose", () =>
			admission.diagnose(revision.assetRef, reviewRef, revision.diagnosticSpecRef, id + "-diagnostic"),
		);
		assert.equal(result.diagnostic.runtime_ready, true);
		await running.close();
		running = undefined;
	}
	await invoke("current-runtime-gate", () =>
		new DesignReviewService(root, authority).gate(revision.assetRef, reviewRef),
	);
	const target = revision.deployments.find((d) => d.id === "positive");
	assert.ok(target);
	const runner = new UiRunService(root, authority);
	const request = {
		task_id: id,
		request_id: id,
		asset_ref: revision.assetRef,
		review_ref: reviewRef,
		environment_ref: spec.environment_ref,
		config_ref: spec.config_ref,
		timeout_ms: 120000,
	};
	if (!previous) {
		running = await startProbeServers([{ ...target, id: "A-edit-2" }]);
		const task = await invoke("failure-execute-task", () =>
			workflow.start({ task_id: id, mode: "execute", asset_ref: revision.assetRef }),
		);
		assert.equal(task.task.data.state, "running");
		result.parent = await invoke("controlled-failure-to-run-terminal", () => runner.start(request));
		assert.equal(result.parent.run.data.state, "finished");
		result.parentResults = await invoke("failure-parse", () =>
			collectResults(root, result.parent.run_ref, id + "-results"),
		);
	} else {
		await invoke("verify-existing-parent-results", () => verifyResults(root, result.parentResults.results_ref));
		const savedParent = await store.load(result.parent.run_ref);
		assert.equal(savedParent.data.state, "finished");
	}
	assert.equal(result.parentResults.data.counts.passed, 5);
	assert.equal(result.parentResults.data.counts.failed, 1);
	assert.equal(result.parentResults.details.assertion_reached_attempt_count, 13);
	assert.equal(result.parentResults.details.complete, true);
	const failed = result.parentResults.data.instances.filter((i) => i.status === "failed");
	assert.equal(failed.length, 1);
	const planned = result.parent.run.data.plan.find((p) => p.instance_id === failed[0].instance_id);
	assert.equal(planned.case_id, "C-edit");
	const same = await invoke("same-parent-request-status", () => runner.status(id, id));
	assert.deepEqual(same.run_ref, result.parent.run_ref);
	assert.equal(same.replayed, true);
	await running?.close();
	running = undefined;
	const beforeAnalysis = measurement.stop();
	result.executionMeasurement = beforeAnalysis;
	// Separate observer makes the read-only stage's zero child-start assertion unambiguous.
	const analysisMeasurement = measureDiscovery();
	const analyze = async (name, call) =>
		(
			await analysisMeasurement.invoke("native-service", name, async () => ({
				status: "completed",
				value: await call(),
			}))
		).value;
	try {
		if (!previous) {
			const trace = failed[0].attempts.flatMap((a) => a.evidence_refs).find((r) => r.path.endsWith("/trace.zip"));
			assert.ok(trace, "Failure needs actual native trace");
			result.failureTrace = await analyze("failure-read-trace", () =>
				traceEvidence(root, result.parentResults.results_ref, trace),
			);
			await fs.writeFile(join(output, "failure-trace.json"), JSON.stringify(result.failureTrace, null, 2));
			const analysis = await analyze("failure-save-analysis", () =>
				saveAnalysis(root, {
					schema_version: "1.0",
					kind: "analysis",
					id: id + "-analysis",
					created_at: new Date().toISOString(),
					data: {
						run_ref: result.parent.run_ref,
						results_ref: result.parentResults.results_ref,
						findings: [
							{
								instance_id: failed[0].instance_id,
								classification: "insufficient-evidence",
								certainty: "unknown",
								facts: [
									"C-edit failed at A-edit-2: getByRole(listitem) expected [U05-owned-item], received [], timeout 5000ms after save/reload/search. Five other cases passed; thirteen assertion steps were reached, not all passed.",
									"The native failure trace belongs to this failed instance/attempt. Scope is synthetic client persistence behavior; this is not evidence of an OperationContract defect.",
								],
								hypotheses: [
									"The harness intends a controlled response variant, but runtime response identity is unverified by the supplied native evidence. Persistence loss is a hypothesis; no product/server/database cause is established.",
								],
								alternatives: [
									"Browser behavior alone does not establish an underlying storage or server implementation cause.",
								],
								supporting_refs: [trace, result.parentResults.data.raw_ref],
								next_action:
									"Restore the declared positive fixture and freeze a new failed-only batch from initial state; preserve the parent failure and do not infer full-plan success from the subset.",
							},
						],
					},
				}),
			);
			result.parentReport = await analyze("failure-draft-report", () =>
				draftReport(root, result.parentResults.results_ref, analysis.analysis_ref, id + "-report"),
			);
		}
		result.parentReportCheck = await analyze("failure-report-static-check", () =>
			checkReport(root, result.parentReport.report_ref),
		);
		assert.deepEqual(result.parentReportCheck.check.issues, []);
		const current = await workflow.find(id);
		const handoff =
			current.task.data.stage === "execute"
				? await workflow.checkpoint(current.task_ref, "execute", [result.parent.run_ref])
				: current;
		assert.equal(handoff.task.data.stage, "analyze");
		const reportHandoff = await workflow.checkpoint(handoff.task_ref, "analyze", [result.parentReport.report_ref]);
		result.parentTask = await workflow.block(reportHandoff.task_ref, [
			"U00 controlled-failure report candidate awaits separately authorized independent result review; no report approval or final delivery fabricated.",
		]);
		result.selection = await analyze("plan-failed-only-recovery", () =>
			recoveryPlan(root, result.parent.run_ref, "rerun-failed"),
		);
		assert.deepEqual(result.selection.blockers, []);
		assert.deepEqual(
			result.selection.selected.map((p) => p.case_id),
			["C-edit"],
		);
		assert.equal(result.selection.excluded.length, 5);
	} finally {
		result.analysisMeasurement = analysisMeasurement.stop();
	}
	assert.equal(
		result.analysisMeasurement.directChildren.length,
		0,
		"Parse/trace/analysis/report/selection must not launch a browser or runner",
	);
	const parentHashes = Object.fromEntries(
		await Promise.all(
			[result.parent.run_ref, result.parentResults.results_ref, result.parentReport.report_ref].map(async (r) => [
				r.path,
				sha256(await fs.readFile(join(root, r.path))),
			]),
		),
	);
	const rerunMeasurement = measureDiscovery();
	const rerun = async (name, call) =>
		(await rerunMeasurement.invoke("native-service", name, async () => ({ status: "completed", value: await call() })))
			.value;
	try {
		running = await startProbeServers([target]);
		const rerunId = id + "-rerun";
		const rerunTask = await rerun("failed-only-workflow-start", () =>
			workflow.start({ task_id: rerunId, mode: "rerun-failed", run_ref: result.parent.run_ref }),
		);
		assert.equal(rerunTask.task.data.state, "running");
		result.rerun = await rerun("failed-only-to-run-terminal", () =>
			runner.start({ ...request, task_id: rerunId, request_id: rerunId, parent_run_ref: result.parent.run_ref }),
		);
		result.rerunResults = await rerun("failed-only-parse", () =>
			collectResults(root, result.rerun.run_ref, rerunId + "-results"),
		);
		assert.equal(result.rerunResults.data.planned_count, 1);
		assert.equal(result.rerunResults.data.counts.passed, 1);
		assert.equal(result.rerunResults.details.complete, true);
		assert.equal(result.rerunResults.details.assertion_reached_attempt_count, 2);
		const rerunAnalysis = await rerun("failed-only-save-analysis", () =>
			saveAnalysis(root, {
				schema_version: "1.0",
				kind: "analysis",
				id: rerunId + "-analysis",
				created_at: new Date().toISOString(),
				data: { run_ref: result.rerun.run_ref, results_ref: result.rerunResults.results_ref, findings: [] },
			}),
		);
		result.rerunReport = await rerun("failed-only-draft-report", () =>
			draftReport(root, result.rerunResults.results_ref, rerunAnalysis.analysis_ref, rerunId + "-report"),
		);
		result.rerunReportCheck = await rerun("failed-only-report-static-check", () =>
			checkReport(root, result.rerunReport.report_ref),
		);
		assert.deepEqual(result.rerunReportCheck.check.issues, []);
		const rerunCurrent = await workflow.find(rerunId);
		const rerunHandoff = await workflow.checkpoint(rerunCurrent.task_ref, "execute", [result.rerun.run_ref]);
		const rerunReportHandoff = await workflow.checkpoint(rerunHandoff.task_ref, "analyze", [
			result.rerunReport.report_ref,
		]);
		result.rerunTask = await workflow.block(rerunReportHandoff.task_ref, [
			"U00 failed-only rerun report candidate awaits separately authorized independent review; passing one case does not replace parent five-passed/one-failed coverage.",
		]);
		for (const [path, hash] of Object.entries(parentHashes))
			assert.equal(sha256(await fs.readFile(join(root, path))), hash);
	} finally {
		result.rerunMeasurement = rerunMeasurement.stop();
	}
	for (const ref of immutable) assert.equal(sha256(await fs.readFile(join(root, ref.path))), ref.sha256);
	assert.equal(sha256(await fs.readFile(ledgerPath)), ledgerHash);
	result.status = "PASS_CANDIDATES_REVIEW_PENDING";
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	// stop() restores the same original functions; retain the first segment if failure preceded the boundary.
	if (!result.executionMeasurement) result.executionMeasurement = measurement.stop();
	await running?.close();
	await fs.writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(
		JSON.stringify(
			{
				output,
				status: result.status,
				error: result.error,
				parentCounts: result.parentResults?.data.counts,
				rerunCounts: result.rerunResults?.data.counts,
				selected: result.selection?.selected,
				modelCalls: 0,
			},
			null,
			2,
		),
	);
}
