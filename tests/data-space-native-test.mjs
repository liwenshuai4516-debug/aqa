/** Real Playwright and MCP/Newman, with explicitly controlled review responses. No model or business environment. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { apiTestRuntime } from "./lib/api-test-runtime.mjs";
import { PluginManager } from "../server/plugins.ts";
import { ApiTestingRunner } from "../server/api-testing-runner.ts";
import { ClientSession } from "../server/agent/agent-service.ts";
import { TestAssetReader } from "../server/test-asset-reader.ts";
import { nativeTestCompletion } from "../server/test-execution-notice.ts";
import { createAutomation } from "../plugins/data-space/automation.mjs";
import { ready } from "./fixtures/data-space/ui-run-fixture.mjs";
const repo = fileURLToPath(new URL("../", import.meta.url)),
	out = mkdtempSync(join(tmpdir(), "data-space-native-"));
const data = join(out, "data"),
	project = join(out, "api-project"),
	pluginRoot = join(data, "plugins/api-testing");
mkdirSync(project);
cpSync(join(repo, "plugins/api-testing"), pluginRoot, { recursive: true, filter: (p) => !p.includes("node_modules") });
symlinkSync(join(apiTestRuntime(), "node_modules"), join(pluginRoot, "node_modules"), "dir");
cpSync(join(repo, "tests/fixtures/api-testing-workflow/contract.json"), join(project, "source.json"));
const reader = new TestAssetReader(data),
	checks = [],
	cleanup = [];
const check = (name) => {
	checks.push(name);
	console.log("PASS", name);
};
let store = { revision: 1, envs: [], systems: [], modules: [], features: [], cases: [] },
	runs = { revision: 1, runs: [] },
	listener;
const durable = () => writeFileSync(join(out, "ledger.json"), JSON.stringify({ store, runs }, null, 2));
const options = {
	host: {
		testing: reader,
		onToolEvent: (fn) => {
			listener = fn;
			return () => {
				listener = null;
			};
		},
		log(...args) {
			console.log(...args);
		},
		broadcast() {},
	},
	store: () => store,
	runs: () => runs,
	commitStore: (s) => {
		store = s;
		durable();
	},
	commitRuns: (r) => {
		runs = r;
		durable();
	},
};
let automation = createAutomation(options);
await automation.idle();
async function bind(id, engine, workspace, assetRef, baseUrl, nativeCaseId) {
	store = {
		...store,
		envs: [...store.envs, { id, systemId: id, name: id, baseUrl }],
		modules: [...store.modules, { id, systemId: id }],
		features: [...store.features, { id, moduleId: id }],
		cases: [
			...store.cases,
			{
				id,
				code: id,
				featureId: id,
				type: engine === "ui" ? "UI" : "接口",
				title: id,
				updatedAt: new Date().toISOString(),
			},
		],
	};
	await automation.call(workspace, { action: "bind", caseId: id, engine, assetRef, nativeCaseId, envId: id });
	const route = await automation.call(workspace, { action: "route", caseId: id });
	assert.equal(route.tool, engine === "ui" ? "ui_test_workflow" : "api_test_execute");
}
function notify(name, args, result, cwd) {
	const testRun = nativeTestCompletion(name, args, result, false);
	assert.ok(testRun);
	listener({ phase: "end", cwd, testRun });
}
let bad = false,
	hold = false,
	hits = 0;
const server = createServer((_req, res) => {
	hits++;
	if (hold) return;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify({ id: bad ? 42 : "r-2", status: "active", example: "synthetic" }));
});
const manager = new PluginManager(data, project),
	runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
manager.mcpCaller = (...args) => runner.call(...args);
manager.llmProvider = async (_id, req) => ({
	ok: true,
	model: "explicit-integration-control-stub",
	text: JSON.stringify({ verdict: "pass", artifactHash: JSON.parse(req.prompt).artifactHash, findings: [] }),
});
const conv = { id: "origin", cwd: project, session: {}, agentPreset: "standard", planMode: false, delegateMode: false };
const context = {
	clientId: "isolated",
	convs: new Map([[conv.id, conv]]),
	settingsSvc: { current: { disabledPlugins: [], disabledPluginTools: [] } },
	pluginToolsProvider: () => manager.getAgentTools(),
	goalReviewTurnOf: () => false,
};
const invoke = async (input, signal) =>
	JSON.parse(
		(
			await ClientSession.prototype.enabledPluginToolDefs
				.call(context, "standard", conv.id)
				.find((t) => t.name === "api_test_execute")
				.execute("integration", input, signal)
		).content[0].text,
	);
const result = {
	status: "running",
	scope: "local synthetic targets; controlled review responses, real native runners, no real model assessment",
	output: out,
	checks,
};
try {
	await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
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
	await bind("api", "api", project, approved.assetRef, `http://127.0.0.1:${server.address().port}`, "record");
	const first = await invoke({ action: "asset_run", assetRef: approved.assetRef });
	assert.equal(first.executionVerdict, "passed");
	notify("api_test_execute", { action: "asset_run" }, { details: first }, project);
	await automation.idle();
	assert.equal(runs.runs[0]?.verdict, "通过");
	await automation.sync(project, "api", first.runId);
	assert.equal(runs.runs.length, 1);
	check("API actual Newman execution, original route, native evidence and idempotent sync");
	bad = true;
	const failed = await invoke({ action: "asset_run", assetRef: approved.assetRef });
	assert.equal(failed.executionVerdict, "failed");
	await automation.sync(project, "api", failed.runId);
	assert.equal(runs.runs.at(-1).verdict, "失败");
	bad = false;
	const retest = await invoke({ action: "asset_run", assetRef: approved.assetRef, priorRunId: failed.runId });
	await automation.sync(project, "api", retest.runId);
	assert.equal(runs.runs.at(-1).verdict, "通过");
	assert.equal(runs.runs.at(-1).automation.parentRunId, failed.runId);
	check("API actual failed assertion and successful retest retain parent lineage");
	const beforeIds = await reader.list("api", project);
	hold = true;
	const abort = new AbortController(),
		beforeHits = hits;
	const pending = invoke({ action: "asset_run", assetRef: approved.assetRef }, abort.signal);
	pending.catch(() => {});
	const deadline = Date.now() + 15000;
	while (hits === beforeHits && Date.now() < deadline) await new Promise((ok) => setTimeout(ok, 20));
	assert(hits > beforeHits);
	abort.abort();
	await assert.rejects(pending);
	hold = false;
	const interrupted = (await reader.list("api", project)).find((id) => !beforeIds.includes(id));
	assert.ok(interrupted);
	await automation.sync(project, "api", interrupted);
	assert.equal(runs.runs.at(-1).verdict, "未知");
	assert.equal(runs.runs.at(-1).automation.complete, false);
	check("API cancellation imports incomplete native run as unknown without replay");
	const casesPath = join(
		data,
		"api-testing/assets",
		(await import("node:crypto")).createHash("sha256").update(realpathSync(project)).digest("hex"),
		"suites",
		approved.assetRef,
		"cases.json",
	);
	const original = readFileSync(casesPath);
	writeFileSync(casesPath, Buffer.concat([original, Buffer.from(" ")]));
	await assert.rejects(reader.inspect("api", project, approved.assetRef), /changed/);
	writeFileSync(casesPath, original);
	check("API changed frozen evidence is rejected");
	const other = join(out, "other");
	mkdirSync(other);
	await assert.rejects(reader.read("api", other, first.runId));
	check("API cross-workspace result reference rejected");
	const ui = await ready({ after: (fn) => cleanup.push(fn) });
	assert.equal(ui.reviewed.decision, "approved");
	await bind("ui", "ui", ui.f.root, ui.assetRef, ui.f.fixture.url, "C1");
	const executed = await ui.service.start(ui.request);
	assert.equal(executed.run.data.exit_code, 0);
	notify(
		"ui_test_run",
		{ request: { operation: "start" } },
		{ details: { artifact_refs: [executed.run_ref] } },
		ui.f.root,
	);
	await automation.idle();
	assert.equal(runs.runs.find((r) => r.caseId === "ui")?.verdict, "通过");
	check(
		"UI real design gate, positive/negative diagnosis and formal Playwright evidence sync (review response controlled)",
	);
	const beforeRestart = runs.runs.length;
	automation.dispose();
	({ store, runs } = JSON.parse(readFileSync(join(out, "ledger.json"))));
	const next = await invoke({ action: "asset_run", assetRef: approved.assetRef });
	assert.equal(next.executionVerdict, "passed");
	automation = createAutomation(options);
	await automation.idle();
	assert.equal(runs.runs.length, beforeRestart + 1);
	check("restart imports missed native completion without replaying execution");
	result.status = "PASS";
} catch (error) {
	result.status = "FAIL";
	result.error = error.stack;
	throw error;
} finally {
	automation.dispose();
	await runner.dispose();
	await manager.dispose();
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
	for (const close of cleanup.reverse()) await close();
	writeFileSync(join(out, "summary.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}
