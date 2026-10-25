/** Execute only the selected approved and diagnosed synthetic browser asset; never creates approval. */
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	ArtifactStore,
	UiWorkflowService,
	DesignReviewService,
	RuntimeAdmissionService,
	UiRunService,
	capabilities,
	collectResults,
} from "pi-ui-testing";
const [directory, revisionPath, reviewPath] = process.argv.slice(2);
assert.ok(
	directory && revisionPath && reviewPath,
	"Usage: <prepared directory> <revision JSON> <completed native review JSON>",
);
const root = resolve(directory),
	store = new ArtifactStore(root),
	authority = join(root, "ui-review-authority");
const revision = JSON.parse(await readFile(resolve(revisionPath), "utf8"));
const reviewed = JSON.parse(await readFile(resolve(reviewPath), "utf8"));
assert.equal(revision.status, "PASS");
assert.equal(reviewed.tool.details.status, "completed");
const review = JSON.parse(reviewed.tool.content.find((c) => c.type === "text").text).output;
assert.equal(review.decision, "approved");
await new DesignReviewService(root, authority).gate(revision.assetRef, review.review_ref);
const diagnostic = await new RuntimeAdmissionService(root, authority).status("u05-native-diagnostic-1");
assert.equal(diagnostic.runtime_ready, true, "Native runtime admission must be current");
const spec = JSON.parse(await readFile(join(root, revision.diagnosticSpecRef.path), "utf8"));
const installed = dirname(fileURLToPath(import.meta.resolve("pi-ui-testing")));
const workflow = new UiWorkflowService(root, authority, {
	tools: ["read", ...capabilities.map((c) => c.tool)],
	skills: await readdir(join(installed, "../skills")),
});
const saved = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
const originalTask = (await store.snapshot(saved.taskRef.path)).artifact;
let discovery = await workflow.find(originalTask.id);
if (discovery.task.data.state !== "completed") {
	discovery = await workflow.resumeTask(discovery.task_ref);
	discovery = await workflow.checkpoint(discovery.task_ref, "design-review", [revision.assetRef, review.review_ref]);
}
assert.equal(discovery.task.data.state, "completed");
const taskId = "u05-browser-v4-execute",
	requestId = "u05-browser-v4-formal-1";
const task = await workflow.start({ task_id: taskId, mode: "execute", asset_ref: revision.assetRef });
assert.equal(task.task.data.state, "running");
const { startProbeServers } = await import(
	pathToFileURL(join(root, dirname(revision.assetRef.path), "ui-probe-replay.mjs")).href
);
let running;
const result = {
	status: "FAIL",
	modelCalls: 0,
	discoveryTaskRef: discovery.task_ref,
	executionTaskRef: task.task_ref,
	diagnosticSummaryRef: diagnostic.summary_ref,
	request_id: requestId,
};
try {
	running = await startProbeServers(revision.deployments);
	const service = new UiRunService(root, authority);
	const execution = await service.start({
		task_id: taskId,
		request_id: requestId,
		asset_ref: revision.assetRef,
		review_ref: review.review_ref,
		environment_ref: spec.environment_ref,
		config_ref: spec.config_ref,
		timeout_ms: 120000,
	});
	result.execution = execution;
	const summaryRef = execution.run.data.output_refs.find((ref) => ref.path.endsWith("/execution-summary.json"));
	result.executionSummary = JSON.parse(await readFile(join(root, summaryRef.path), "utf8"));
	result.results = await collectResults(root, execution.run_ref, "u05-browser-v4-results");
	result.status = result.executionSummary.status === "completed" ? "COMPLETED" : "BLOCKED";
	// A product failure is retained as an execution result, not converted into an infrastructure pass.
	if (result.status === "BLOCKED") process.exitCode = 1;
} catch (error) {
	result.error = { message: error.message, artifact_refs: error.artifact_refs ?? [] };
	process.exitCode = 1;
} finally {
	await running?.close();
	await writeFile(join(root, "browser-v4-formal.json"), JSON.stringify(result, null, 2), { flag: "wx" });
	console.log(JSON.stringify(result, null, 2));
}
