/** P1-3: actual plugin/identity/private MCP/Newman; independent model responses explicitly stubbed. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { PluginManager } from "../server/plugins.ts";
import { ClientSession } from "../server/agent/agent-service.ts";
import { ApiTestingRunner } from "../server/api-testing-runner.ts";
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtime = resolve(process.argv[2] ?? "tests/scratch/api-testing-p1-1/runtime");
const output = mkdtempSync(join(tmpdir(), "api-testing-p1-3-")),
	project = join(output, "project"),
	data = join(output, "data"),
	pluginRoot = join(data, "plugins/api-testing");
mkdirSync(project);
cpSync(join(repo, "plugins/api-testing"), pluginRoot, { recursive: true, filter: (p) => !p.includes("node_modules") });
symlinkSync(join(runtime, "node_modules"), join(pluginRoot, "node_modules"), "dir");
const contract = JSON.parse(readFileSync(join(repo, "tests/fixtures/api-testing-workflow/contract.json")));
contract.paths["/records/{id}"].delete = {
	...structuredClone(contract.paths["/records/{id}"].get),
	operationId: "deleteRecord",
};
writeFileSync(join(project, "source.json"), JSON.stringify(contract));
let defect = true,
	networkFailure = false,
	hold = false,
	calls = 0,
	modelMode = "pass",
	hits = [];
const server = createServer((req, res) => {
	hits.push({ method: req.method, path: req.url });
	if (hold) return;
	if (networkFailure) {
		req.socket.destroy();
		return;
	}
	res.setHeader("Content-Type", "application/json");
	res.statusCode = req.method === "DELETE" ? 500 : 200;
	res.end(JSON.stringify({ id: defect ? 42 : "r-2", status: "active", example: "synthetic" }));
});
let port = 19180;
for (; port < 19280; port++) {
	try {
		await new Promise((ok, fail) => {
			server.once("error", fail);
			server.listen(port, "127.0.0.1", () => {
				server.removeListener("error", fail);
				ok();
			});
		});
		break;
	} catch (e) {
		if (e.code !== "EADDRINUSE") throw e;
	}
}
assert(port < 19280);
const origin = `http://127.0.0.1:${port}`;
const runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot),
	manager = new PluginManager(data, project);
manager.mcpCaller = runner.call;
manager.llmProvider = async (_plugin, req) => {
	calls++;
	assert.equal(_plugin, "api-testing");
	assert(!("tools" in req));
	const p = JSON.parse(req.prompt);
	return {
		ok: true,
		model: "explicit-semantic-review-stub",
		usage: { input: 10, output: 5 },
		text: JSON.stringify({
			verdict: modelMode,
			artifactHash: p.artifactHash,
			findings:
				modelMode === "pass"
					? []
					: [{ caseId: p.candidate.id, code: "FIXTURE_DATA", message: "Use isolated fixture ID r-2" }],
		}),
	};
};
const conv = { id: "origin", cwd: project, session: {}, agentPreset: "standard", planMode: false, delegateMode: false };
const ctx = {
	clientId: "client",
	convs: new Map([["origin", conv]]),
	settingsSvc: { current: { disabledPlugins: [], disabledPluginTools: [] } },
	pluginToolsProvider: () => manager.getAgentTools(),
	goalReviewTurnOf: () => false,
};
const invoke = async (params, signal) =>
	JSON.parse(
		(
			await ClientSession.prototype.enabledPluginToolDefs
				.call(ctx, "standard", "origin")[0]
				.execute("test", params, signal, undefined)
		).content[0].text,
	);
let serial = 0;
const candidate = (id = "r-1") => ({
	id: "record-normal",
	operationId: "getRecord",
	request: { path: { id } },
	status: 200,
	checks: [{ kind: "type", pointer: "/id", value: "string" }],
});
const prepare = (more = {}) =>
	invoke({
		action: "prepare",
		sourcePath: "source.json",
		operationIds: ["getRecord"],
		cases: [candidate()],
		baseUrl: origin,
		outputPath: "suite-" + ++serial,
		...more,
	});
const checkList = [],
	runs = [];
const check = (name) => checkList.push({ name, status: "passed" });
const report = {
	schemaVersion: 1,
	task: "P1-3",
	environment: "macOS fixture; real private MCP/Newman, explicit model stub",
	startedAt: new Date().toISOString(),
	output,
	checks: checkList,
	runs,
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
try {
	await manager.ensureLoaded();
	const prepared = await prepare();
	const ref = prepared.workflowRef;
	assert.equal(prepared.phase, "draft");
	assert.equal(hits.length, 0);
	await assert.rejects(() => invoke({ action: "run", runRef: ref }), /not approved/);
	check("one-entry-prepare-freezes-draft-and-unreviewed-cannot-run");
	modelMode = "revise";
	assert.equal((await invoke({ action: "review", runRef: ref })).phase, "revise");
	const revised = await invoke({ action: "revise", runRef: ref, cases: [candidate("r-2")], outputPath: "corrected" });
	assert.equal(revised.phase, "draft");
	modelMode = "pass";
	const approved = await invoke({ action: "review", runRef: ref });
	assert.equal(approved.phase, "approved");
	assert.equal(calls, 2);
	assert.notEqual(approved.suitePath, prepared.suitePath);
	check("semantic-return-correction-approval-only-from-live-independent-call");
	const failed = await invoke({ action: "run", runRef: ref });
	runs.push(failed);
	assert.equal(failed.executionVerdict, "failed");
	let findings = read(failed.findingsPath);
	assert.equal(findings[0].kind, "suspected_api_defect");
	assert.equal(findings[0].status, "open");
	const firstBytes = readFileSync(failed.findingsPath, "utf8");
	check("actual-contract-defect-produces-open-finding-and-report");
	const stillFail = await invoke({ action: "retest", runRef: ref, priorRunId: failed.runId });
	runs.push(stillFail);
	assert.equal(stillFail.executionVerdict, "failed");
	assert.equal(read(stillFail.findingsPath)[0].status, "open");
	assert.equal(read(stillFail.findingsPath)[0].occurrences.length, 2);
	check("unfixed-retest-retains-open-identity-and-new-evidence");
	defect = false;
	const fixed = await invoke({ action: "retest", runRef: ref, priorRunId: stillFail.runId });
	runs.push(fixed);
	assert.equal(fixed.executionVerdict, "passed");
	assert.equal(read(fixed.findingsPath)[0].status, "closed");
	assert.equal(readFileSync(failed.findingsPath, "utf8"), firstBytes);
	assert.equal(calls, 2);
	check("fixture-fix-retest-closes-finding-without-erasing-first-failure-or-model-recalls");
	const before = hits.length;
	const history = await invoke({ action: "report", runRef: ref, runId: failed.runId });
	assert.equal(history.executionVerdict, "failed");
	assert.equal(hits.length, before);
	check("historical-report-never-requests-or-calls-model");
	const other = { ...conv, id: "other", session: {} };
	ctx.convs.set("other", other);
	const tool = ClientSession.prototype.enabledPluginToolDefs.call(ctx, "standard", "other")[0];
	await assert.rejects(
		() => tool.execute("test", { action: "run", runRef: ref }, undefined, undefined),
		/another caller/,
	);
	check("workflow-reference-bound-to-original-conversation");
	const safeBefore = hits.length;
	await assert.rejects(() => prepare({ baseUrl: "http://192.168.90.224:8238" }), /not configured/);
	assert.equal(hits.length, safeBefore);
	check("business-target-still-blocked-despite-user-write-authorization");
	const altered = read(join(approved.suitePath, "manifest.json"));
	altered.state = "draft";
	writeFileSync(join(approved.suitePath, "manifest.json"), JSON.stringify(altered));
	// Even a harmless manifest state change cannot make a new unsigned package execute.
	const casesPath = join(approved.suitePath, "cases.json");
	writeFileSync(casesPath, "[]");
	await assert.rejects(() => invoke({ action: "run", runRef: ref }), /hash|changed/);
	assert.equal(hits.length, safeBefore);
	check("changed-approved-package-cannot-execute");
	const env = await prepare();
	await invoke({ action: "review", runRef: env.workflowRef });
	networkFailure = true;
	const envRun = await invoke({ action: "run", runRef: env.workflowRef });
	networkFailure = false;
	runs.push(envRun);
	assert.equal(envRun.executionVerdict, "error");
	assert(read(envRun.findingsPath).some((f) => f.kind === "environment_fault"));
	check("actual-network-fault-separated-from-contract-defect");
	const clean = await prepare({
		operationIds: ["deleteRecord"],
		cases: [{ ...candidate("r-2"), operationId: "deleteRecord", phase: "cleanup" }],
	});
	await invoke({ action: "review", runRef: clean.workflowRef });
	const cleanRun = await invoke({ action: "run", runRef: clean.workflowRef });
	runs.push(cleanRun);
	assert.equal(cleanRun.cleanup, "failed");
	assert(read(cleanRun.findingsPath).some((f) => f.kind === "cleanup_failure"));
	check("actual-cleanup-response-failure-is-visible");
	const revisedCleanup = await invoke({
		action: "revise",
		runRef: clean.workflowRef,
		cases: [{ ...candidate("r-3"), operationId: "deleteRecord", phase: "cleanup" }],
		outputPath: "cleanup-corrected",
	});
	assert.equal(revisedCleanup.phase, "draft");
	await assert.rejects(() => invoke({ action: "run", runRef: clean.workflowRef }), /not approved/);
	await invoke({ action: "review", runRef: clean.workflowRef });
	const revisedFailure = await invoke({ action: "retest", runRef: clean.workflowRef, priorRunId: cleanRun.runId });
	runs.push(revisedFailure);
	assert.equal(revisedFailure.executionVerdict, "failed");
	assert(read(revisedFailure.findingsPath).filter((f) => f.status === "open").length >= 2);
	assert.equal(read(cleanRun.findingsPath)[0].status, "open");
	check("post-execution-case-revision-requires-new-review-and-retains-prior-version-finding");
	const canceled = await prepare();
	await invoke({ action: "review", runRef: canceled.workflowRef });
	hold = true;
	const controller = new AbortController();
	const beforeHeld = hits.length;
	const active = invoke({ action: "run", runRef: canceled.workflowRef }, controller.signal).then(
		() => null,
		(e) => e,
	);
	const t = Date.now();
	while (hits.length <= beforeHeld) {
		if (Date.now() - t > 10000) throw new Error("runner wait timed out");
		await wait(10);
	}
	const count = hits.length;
	await assert.rejects(() => invoke({ action: "run", runRef: canceled.workflowRef }), /pending/);
	assert.equal(hits.length, count);
	controller.abort();
	assert(await active);
	hold = false;
	const canceledState = read(join(canceled.evidencePath, "workflow.json"));
	const canceledReport = read(join(canceled.evidencePath, canceledState.runIds[0], "report.json"));
	assert.equal(canceledReport.executionVerdict, "unknown");
	check("concurrent-start-blocked-and-cancellation-preserves-unknown-report");
	const neverImproves = await prepare();
	modelMode = "revise";
	const startCalls = calls;
	assert.equal((await invoke({ action: "review", runRef: neverImproves.workflowRef })).phase, "revise");
	assert.equal((await invoke({ action: "review", runRef: neverImproves.workflowRef })).phase, "revise");
	assert.equal(
		(await invoke({ action: "review", runRef: neverImproves.workflowRef })).reason,
		"two-rounds-without-improvement",
	);
	assert.equal(calls - startCalls, 2);
	modelMode = "pass";
	check("public-review-actions-share-no-improvement-and-model-call-budget");
	const canceledWrite = await prepare({
		operationIds: ["deleteRecord"],
		cases: [{ ...candidate("r-2"), operationId: "deleteRecord", phase: "cleanup" }],
	});
	await invoke({ action: "review", runRef: canceledWrite.workflowRef });
	hold = true;
	const writeController = new AbortController();
	const beforeWrite = hits.length;
	const writing = invoke({ action: "run", runRef: canceledWrite.workflowRef }, writeController.signal).then(
		() => null,
		(e) => e,
	);
	const writeWait = Date.now();
	while (hits.length === beforeWrite) {
		if (Date.now() - writeWait > 10000) throw new Error("write wait timed out");
		await wait(10);
	}
	writeController.abort();
	assert(await writing);
	hold = false;
	const writeState = read(join(canceledWrite.evidencePath, "workflow.json"));
	const writeReport = read(join(canceledWrite.evidencePath, writeState.runIds[0], "report.json"));
	assert.equal(writeReport.cleanup, "residuals-unknown");
	const noResend = hits.length;
	await assert.rejects(() => invoke({ action: "run", runRef: canceledWrite.workflowRef }), /unknown writes/);
	assert.equal(hits.length, noResend);
	check("unknown-write-blocks-new-requests-and-preserves-residual-record");
	const restricted = await prepare();
	manager.permGrants.grant("api-testing", "llm", { models: ["fixture/allowed"] });
	const beforeDenied = calls;
	const denied = await invoke({ action: "review", runRef: restricted.workflowRef, model: "fixture/denied" });
	assert.equal(denied.phase, "blocked");
	assert.equal(calls, beforeDenied);
	check("workflow-model-calls-obey-host-model-scope");
	const missing = await prepare();
	manager.llmProvider = undefined;
	const absent = await invoke({ action: "review", runRef: missing.workflowRef });
	assert.equal(absent.phase, "blocked");
	await assert.rejects(() => invoke({ action: "run", runRef: missing.workflowRef }), /not approved/);
	check("missing-real-model-does-not-fake-approval");
	report.status = "passed-fixture-model-stub-only";
	report.modelCalls = calls;
	report.fixtureRequests = hits;
} catch (error) {
	report.status = "failed";
	report.error = String(error.stack);
	process.exitCode = 1;
} finally {
	manager.dispose();
	await runner.dispose();
	server.closeAllConnections();
	server.close();
	await once(server, "close");
	report.finishedAt = new Date().toISOString();
	writeFileSync(join(output, "summary.json"), JSON.stringify(report, null, 2));
	console.log(
		JSON.stringify(
			{ status: report.status, checks: checkList.length, evidence: join(output, "summary.json"), error: report.error },
			null,
			2,
		),
	);
}
