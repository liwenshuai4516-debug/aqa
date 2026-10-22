/** P2-1: real host/MCP/Newman persistence; review is an explicitly marked control stub. */
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	cpSync,
	symlinkSync,
	readFileSync,
	writeFileSync,
	readdirSync,
	rmSync,
	existsSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PluginManager } from "../server/plugins.ts";
import { ClientSession } from "../server/agent/agent-service.ts";
import { ApiTestingRunner } from "../server/api-testing-runner.ts";
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtime = resolve(process.argv[2] ?? "tests/scratch/api-testing-p1-1/runtime");
const output = mkdtempSync(join(tmpdir(), "api-testing-p3-1-")),
	project = join(output, "project"),
	data = join(output, "data"),
	pluginRoot = join(data, "plugins/api-testing");
mkdirSync(project);
cpSync(join(repo, "plugins/api-testing"), pluginRoot, { recursive: true, filter: (p) => !p.includes("node_modules") });
symlinkSync(join(runtime, "node_modules"), join(pluginRoot, "node_modules"), "dir");
cpSync(join(repo, "tests/fixtures/api-testing-workflow/contract.json"), join(project, "source.json"));
const sha = (x) => createHash("sha256").update(x).digest("hex");
let hits = 0,
	calls = 0,
	hold = false;
const server = createServer((_req, res) => {
	hits++;
	if (hold) return;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify({ id: "r-2", status: "active", example: "synthetic" }));
});
let manager = new PluginManager(data, project);
let runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
manager.mcpCaller = (...args) => runner.call(...args);
manager.apiScheduleProvider = runner.attachScheduler;
manager.llmProvider = async (_id, req) => {
	calls++;
	const p = JSON.parse(req.prompt);
	return {
		ok: true,
		model: "explicit-persistence-control-stub",
		text: JSON.stringify({ verdict: "pass", artifactHash: p.artifactHash, findings: [] }),
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
		task: "P3-1",
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
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
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

	await assert.rejects(
		invoke({
			action: "schedule_create",
			assetRef,
			intervalMs: 60000,
			authorizationExpiresAt: new Date(Date.now() + 3600000).toISOString(),
		}),
		/manual execution/,
	);
	check("schedule-requires-same-version-manual-pass");
	const manual = await invoke({ action: "asset_run", assetRef });
	assert.equal(manual.executionVerdict, "passed");
	const scheduled = await invoke({
		action: "schedule_create",
		assetRef,
		intervalMs: 60000,
		authorizationExpiresAt: new Date(Date.now() + 3600000).toISOString(),
	});
	check("fixed-version-environment-expiring-fixture-lease-persisted-before-enable");
	const beforeHits = hits,
		beforeCalls = calls;
	const deadline = Date.now() + 85000;
	let listed;
	while (Date.now() < deadline) {
		await wait(250);
		listed = await invoke({ action: "schedule_list" });
		if (listed.triggers.some((r) => r.status === "completed")) break;
	}
	const completed = listed.triggers.find((r) => r.status === "completed");
	assert(completed, "Actual 60-second host timer must execute through MCP");
	assert.equal(completed.executionVerdict, "passed");
	assert.equal(hits, beforeHits + 1);
	assert.equal(calls, beforeCalls);
	assert.deepEqual(completed.modelCalls, { generation: 0, review: 0, analysis: 0 });
	assert(Date.parse(completed.dueAtUTC) <= Date.parse(completed.firedAt));
	check("actual-host-persistent-timer-real-MCP-Newman-success-zero-model-calls");
	const report = await invoke({ action: "asset_report", runId: completed.runId });
	assert.equal(report.report.priorRunId, manual.runId);
	check("planned-UTC-claim-links-new-run-and-report-with-history");
	const stopEntry = manager.bgTasks().find((r) => r.taskId === "schedule:api-" + scheduled.scheduleId);
	assert(stopEntry);
	manager.stopPluginBgTask(stopEntry.taskId);
	assert.equal(
		(await invoke({ action: "schedule_list" })).schedules.find((r) => r.id === scheduled.scheduleId).state,
		"paused",
	);
	check("background-stop-persists-business-pause");
	const resumable = await invoke({
		action: "schedule_create",
		assetRef,
		intervalMs: 60000,
		authorizationExpiresAt: new Date(Date.now() + 3600000).toISOString(),
	});
	manager.dispose();
	await runner.dispose();
	manager = new PluginManager(data, project);
	runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
	manager.mcpCaller = (...args) => runner.call(...args);
	manager.apiScheduleProvider = runner.attachScheduler;
	await manager.ensureLoaded();
	assert.equal(
		(await invoke({ action: "schedule_list" })).schedules.find((r) => r.id === scheduled.scheduleId).state,
		"paused",
	);
	assert(!manager.bgTasks().some((r) => r.taskId === "schedule:api-" + scheduled.scheduleId));
	assert.equal(hits, beforeHits + 1);
	check("stopped-schedule-does-not-revive-after-new-host-and-runner");
	assert.equal(
		(await invoke({ action: "schedule_list" })).schedules.find((r) => r.id === resumable.id).state,
		"enabled",
	);
	assert(manager.bgTasks().some((r) => r.taskId === "schedule:api-" + resumable.id));
	assert.equal(hits, beforeHits + 1);
	check("enabled-definition-resumes-on-new-host-without-replaying-missed-requests");
	await invoke({ action: "schedule_stop", scheduleId: resumable.id });
	summary.status = "passed";
	summary.hits = hits;
	summary.modelCalls = calls;
	summary.completedTrigger = completed;
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
