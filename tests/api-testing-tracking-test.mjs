/** P2-1: real host/MCP/Newman persistence; review is an explicitly marked control stub. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PluginManager } from "../server/plugins.ts";
import { ClientSession } from "../server/agent/agent-service.ts";
import { ApiTestingRunner } from "../server/api-testing-runner.ts";
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtime = resolve(
	process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "tests/scratch/api-testing-p1-1/runtime",
);
const output = mkdtempSync(join(tmpdir(), "api-testing-p3-2-")),
	project = join(output, "project"),
	data = join(output, "data"),
	pluginRoot = join(data, "plugins/api-testing");
mkdirSync(project);
cpSync(join(repo, "plugins/api-testing"), pluginRoot, { recursive: true, filter: (p) => !p.includes("node_modules") });
symlinkSync(join(runtime, "node_modules"), join(pluginRoot, "node_modules"), "dir");
cpSync(join(repo, "tests/fixtures/api-testing-workflow/contract.json"), join(project, "source.json"));
const sha = (x) => createHash("sha256").update(x).digest("hex");
let defect = true,
	responseStatus = 200,
	analysisMode = "unavailable",
	actualModelCalls = 0;
const tickCallbacks = [],
	notices = [],
	modelEvidence = [];
let hits = 0,
	calls = 0,
	hold = false;
const server = createServer((_req, res) => {
	hits++;
	if (hold) return;
	res.statusCode = responseStatus;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify({ id: defect ? 42 : "r-2", status: "active", example: "synthetic" }));
});
const manager = new PluginManager(data, project);
let runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
manager.mcpCaller = (...args) => runner.call(...args);
manager.apiScheduleProvider = async (host) =>
	runner.attachScheduler({
		...host,
		schedule(spec, fn, opts) {
			tickCallbacks.push(fn);
			return host.schedule(spec, fn, opts);
		},
		notify(event) {
			notices.push(event);
			host.notify?.(event);
		},
	});
manager.llmProvider = async (_id, req) => {
	calls++;
	const p = JSON.parse(req.prompt);
	if (p.artifactHash)
		return {
			ok: true,
			model: "explicit-review-control-stub",
			text: JSON.stringify({ verdict: "pass", artifactHash: p.artifactHash, findings: [] }),
		};
	if (analysisMode === "timeout") return new Promise(() => {});
	if (analysisMode === "unavailable") return { ok: false, error: "explicit-unavailable-control" };
	if (analysisMode === "invalid") return { ok: true, text: JSON.stringify({ rootCause: "proven-without-evidence" }) };
	if (analysisMode === "actual") {
		actualModelCalls++;
		const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
		const { completeWithIsolatedSession } = await import("../server/plugin-llm.ts");
		const result = await completeWithIsolatedSession(
			{ cwd: project, agentDir: getAgentDir() },
			{ ...req, model: "gpt/gpt-6.1-sol" },
		);
		modelEvidence.push(result);
		return result;
	}
	return {
		ok: true,
		model: "explicit-analysis-control-stub",
		text: JSON.stringify({
			hypotheses: [
				{
					findingId: p.findings[0].id,
					summary:
						"The selected contract assertion failed; server behavior needs investigation. Root cause is unconfirmed.",
					evidenceRun: p.runId,
				},
			],
		}),
	};
};

const conv = { id: "origin", cwd: project, session: {}, agentPreset: "standard", planMode: false, delegateMode: false };
const context = {
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
				.call(context, "standard", "origin")[0]
				.execute("test", params, signal, undefined)
		).content[0].text,
	);
const read = (p) => JSON.parse(readFileSync(p));
const checks = [],
	summary = {
		task: "P3-2",
		status: "running",
		scope: "real MCP/Newman, explicit review stub; no business calls",
		checks,
		output,
	};
const save = () => writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
const check = (name) => {
	checks.push({ name, status: "passed" });
	save();
};
try {
	await new Promise((ok, fail) => {
		server.once("error", fail);
		server.listen(0, "127.0.0.1", ok);
	});
	assert(server.address().port >= 8900);
	await manager.ensureLoaded();
	const prepared = await invoke({
		action: "prepare",
		sourcePath: "source.json",
		operationIds: ["getRecord"],
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		outputPath: "draft",
		cases: [
			{
				id: "record",
				operationId: "getRecord",
				request: { path: { id: "r-2" } },
				status: 200,
				checks: [{ kind: "type", pointer: "/id", value: "string" }],
			},
		],
	});
	const approved = await invoke({ action: "review", runRef: prepared.workflowRef });
	assert.equal(approved.phase, "approved");
	assert.match(approved.assetRef, /^[a-f0-9]{64}$/);
	const assetRef = approved.assetRef;
	const assetRoot = join(data, "api-testing/assets"),
		projectRoot = join(assetRoot, sha(await import("node:fs").then((m) => m.realpathSync(project))));
	const stored = join(projectRoot, "suites", assetRef);
	assert(existsSync(join(stored, "asset.json")));
	assert(!stored.startsWith(pluginRoot));
	check("live-approved-P1-package-published-outside-removable-plugin");

	const first = await invoke({ action: "asset_run", assetRef });
	assert.equal(first.executionVerdict, "failed");
	assert.equal(first.modelCalls.analysis, 0);
	const nativeBefore = await invoke({ action: "asset_report", runId: first.runId });
	check("manual-new-failure-has-native-report-and-zero-implicit-model-calls");
	const beforeAnalysisHits = hits;
	const unavailable = await invoke({ action: "asset_analyze", runId: first.runId });
	assert.equal(unavailable.status, "failed");
	assert.equal(hits, beforeAnalysisHits);
	check("model-unavailable-appends-failed-revision-without-rerunning-request");
	analysisMode = "invalid";
	const invalid = await invoke({ action: "asset_analyze", runId: first.runId });
	assert.equal(invalid.status, "failed");
	assert.equal(hits, beforeAnalysisHits);
	check("invalid-output-cannot-confirm-root-cause-or-overwrite-native-verdict");
	analysisMode = process.argv.includes("--use-configured-model") ? "actual" : "valid";
	const analyzed = await invoke({ action: "asset_analyze", runId: first.runId });
	assert.equal(analyzed.status, "completed");
	assert.equal(analyzed.rootCause, "unconfirmed");
	assert.equal(hits, beforeAnalysisHits);
	await assert.rejects(invoke({ action: "asset_analyze", runId: first.runId }), /budget exhausted/);
	check("explicit-reanalysis-appends-validated-hypotheses-and-enforces-three-attempt-budget");
	const afterAnalysis = await invoke({ action: "asset_report", runId: first.runId });
	assert.deepEqual(afterAnalysis.report, nativeBefore.report);
	assert.equal(afterAnalysis.analyses.length, 3);
	check("historical-report-preserves-original-evidence-and-all-analysis-revisions");
	const repeated = await invoke({ action: "asset_run", assetRef });
	const secondReport = await invoke({ action: "asset_report", runId: repeated.runId });
	assert.equal(secondReport.report.findings[0].firstSeen, first.runId);
	assert.equal(secondReport.report.findings[0].status, "open");
	assert(secondReport.report.findings[0].occurrences.includes(repeated.runId));
	assert.equal(repeated.followup.event, "known-open");
	check("same-problem-keeps-new-evidence-open-and-first-failure-with-automatic-history-link");
	analysisMode = "timeout";
	const timeoutHits = hits,
		startedAnalysisAt = Date.now();
	const timedOut = await invoke({ action: "asset_analyze", runId: repeated.runId });
	assert.equal(timedOut.status, "failed");
	assert.equal(timedOut.reason, "analysis-time-budget-exceeded");
	assert.equal(hits, timeoutHits);
	assert(Date.now() - startedAnalysisAt < 25000);
	check("unresponsive-analysis-exits-at-budget-without-rerunning-interface");

	defect = false;
	const manualPass = await invoke({ action: "asset_run", assetRef });
	assert.equal(manualPass.executionVerdict, "passed");
	const scheduled = await invoke({
		action: "schedule_create",
		assetRef,
		intervalMs: 60000,
		authorizationExpiresAt: new Date(Date.now() + 3600000).toISOString(),
	});
	const fire = async () => {
		const at = Date.now();
		await tickCallbacks[0]({ scheduledAt: at, firedAt: at });
	};
	defect = true;
	analysisMode = "unavailable";
	const tickHits = hits,
		tickCalls = calls;
	await fire();
	assert.equal(hits, tickHits + 1);
	assert.equal(calls, tickCalls + 1);
	let listing = await invoke({ action: "schedule_list" });
	assert.equal(listing.triggers.at(-1).executionVerdict, "failed");
	assert.equal(listing.schedules[0].state, "enabled");
	check("new-scheduled-failure-attempts-one-bounded-analysis-and-never-retries-request");
	analysisMode = "valid";
	await fire();
	assert.equal(hits, tickHits + 2);
	assert.equal(calls, tickCalls + 1);
	assert.equal(notices.length, 1);
	check("known-scheduled-failure-retains-evidence-with-zero-analysis-and-no-duplicate-notice");
	responseStatus = 503;
	await fire();
	assert.equal(hits, tickHits + 3);
	assert.equal(calls, tickCalls + 2);
	assert.equal(notices.length, 2);
	check("changed-failure-evidence-gets-one-new-analysis-and-station-notice");
	responseStatus = 200;
	defect = false;
	await fire();
	assert.equal(hits, tickHits + 4);
	assert.equal(calls, tickCalls + 2);
	assert.equal(notices.length, 3);
	assert.equal(notices.at(-1).event, "recovered");
	const recovered = await invoke({ action: "asset_report", runId: notices.at(-1).runId });
	assert(recovered.report.findings.every((f) => f.status === "closed"));
	assert.equal((await invoke({ action: "asset_report", runId: first.runId })).report.executionVerdict, "failed");
	check("fix-retest-closes-linked-findings-notifies-recovery-and-preserves-original-failure");
	await invoke({ action: "schedule_stop", scheduleId: scheduled.id });
	const backup = await invoke({ action: "asset_export", assetRef, outputPath: "backup" });
	const manifest = read(join(backup.backupPath, "backup.json"));
	assert(Object.keys(manifest.files).some((n) => n.endsWith("analysis-3.manifest.json")));
	const runRoot = join(projectRoot, "runs", first.runId);
	rmSync(runRoot, { recursive: true });
	await invoke({ action: "asset_restore", sourcePath: "backup" });
	assert.equal((await invoke({ action: "asset_report", runId: first.runId })).analyses.length, 3);
	check("verified-backup-restores-native-results-and-all-analysis-revisions");
	const analysisFile = join(runRoot, "analysis-3.json"),
		analysisBytes = readFileSync(analysisFile);
	writeFileSync(analysisFile, "{}");
	await assert.rejects(invoke({ action: "asset_report", runId: first.runId }), /Analysis revision changed/);
	writeFileSync(analysisFile, analysisBytes);
	check("tampered-analysis-is-visible-and-cannot-silently-replace-report");
	summary.status = "passed";
	summary.hits = hits;
	summary.modelCalls = calls;
	summary.actualModelCalls = actualModelCalls;
	summary.modelEvidence = modelEvidence;
	summary.notices = notices;
	summary.timerScope =
		"Callbacks explicitly captured from actual host; manually invoked to isolate anomaly branches. Actual wall-clock timer evidence is P3-1.";
	save();
	console.log(JSON.stringify(summary, null, 2));
} catch (e) {
	summary.status = "failed";
	summary.error = e.stack;
	save();
	throw e;
} finally {
	manager.dispose();
	await runner.dispose();
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
}
