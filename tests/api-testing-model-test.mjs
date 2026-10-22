/** Opt-in acceptance: configured real model + isolated fixture + real private MCP/Newman. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { PluginManager } from "../server/plugins.ts";
import { ClientSession } from "../server/agent/agent-service.ts";
import { ApiTestingRunner } from "../server/api-testing-runner.ts";
import { completeWithIsolatedSession } from "../server/plugin-llm.ts";

assert(
	process.argv.includes("--use-configured-model"),
	"Explicit --use-configured-model is required; consumes configured model quota",
);
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtime = resolve(process.env.API_TEST_RUNTIME ?? "tests/scratch/api-testing-p1-1/runtime");
const model = process.env.API_TEST_MODEL ?? "gpt/gpt-6.1-sol";
const output = mkdtempSync(join(tmpdir(), "api-testing-p1-4-model-"));
const project = join(output, "project"),
	data = join(output, "data"),
	pluginRoot = join(data, "plugins/api-testing");
mkdirSync(project);
cpSync(join(repo, "plugins/api-testing"), pluginRoot, { recursive: true, filter: (p) => !p.includes("node_modules") });
symlinkSync(join(runtime, "node_modules"), join(pluginRoot, "node_modules"), "dir");
const contract = JSON.parse(readFileSync(join(repo, "tests/fixtures/api-testing-workflow/contract.json")));
contract.paths["/records/{id}"].get.description =
	"Acceptance scenario: the existing isolated record is r-2. A positive 200 scenario must request r-2. r-1 does not exist and returns 404. No other records exist.";
writeFileSync(join(project, "source.json"), JSON.stringify(contract));
const calls = [],
	checks = [],
	runs = [];
const summary = {
	task: "P1-4",
	scope: "real configured model; isolated synthetic fixture; real MCP/Newman",
	model,
	calls,
	checks,
	runs,
	status: "running",
	startedAt: new Date().toISOString(),
};
const save = () => writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
const check = (name) => {
	checks.push({ name, status: "passed" });
	save();
};
let defect = true,
	hits = 0,
	phase = "generation";
const server = createServer((req, res) => {
	hits++;
	res.setHeader("Content-Type", "application/json");
	const found = req.url === "/records/r-2";
	res.statusCode = found ? 200 : 404;
	res.end(
		JSON.stringify(found ? { id: defect ? 42 : "r-2", status: "active", example: "synthetic" } : { error: "missing" }),
	);
});
const manager = new PluginManager(data, project);
const runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
manager.mcpCaller = runner.call;
manager.llmProvider = async (pluginId, req) => {
	assert.equal(pluginId, "api-testing");
	assert(calls.length < 4, "Acceptance model budget is four calls total");
	const record = { phase, requestedModel: model, startedAt: new Date().toISOString(), status: "pending" };
	calls.push(record);
	save();
	const result = await completeWithIsolatedSession(
		{ cwd: project, agentDir: process.env.PI_CODING_AGENT_DIR ?? getAgentDir() },
		{ ...req, model },
	);
	record.status = result.ok ? "completed" : "unavailable";
	if (result.ok) {
		record.model = result.model;
		record.usage = result.usage ?? "unknown";
	}
	writeFileSync(
		join(output, `model-${calls.length}.json`),
		JSON.stringify(result.ok ? { ...record, text: result.text } : record, null, 2) + "\n",
	);
	save();
	return result;
};
const conv = {
	id: "model-acceptance",
	cwd: project,
	session: {},
	agentPreset: "standard",
	planMode: false,
	delegateMode: false,
};
const context = {
	clientId: "isolated-acceptance",
	convs: new Map([[conv.id, conv]]),
	settingsSvc: { current: { disabledPlugins: [], disabledPluginTools: [] } },
	pluginToolsProvider: () => manager.getAgentTools(),
	goalReviewTurnOf: () => false,
};
const invoke = async (params) =>
	JSON.parse(
		(
			await ClientSession.prototype.enabledPluginToolDefs
				.call(context, "standard", conv.id)[0]
				.execute("acceptance", params, undefined, undefined)
		).content[0].text,
	);
save();
try {
	await new Promise((ok, fail) => {
		server.once("error", fail);
		server.listen(0, "127.0.0.1", ok);
	});
	const port = server.address().port;
	assert(port >= 8900);
	await manager.ensureLoaded();
	const generated = await manager.llmProvider("api-testing", {
		system: "Generate one contract-grounded API test case. Return only JSON, no Markdown. Do not generate scripts.",
		prompt: JSON.stringify({
			contract,
			task: "Design one positive getRecord case for the existing fixture record. Assert the required id field has type string, with no extra assertions. Output exactly {cases:[{id,operationId,request:{path:{id}},status,checks:[{kind:'type',pointer:'/id',value:'string'}]}]} with JSON double quotes.",
		}),
		maxChars: 1800,
		timeoutMs: 30000,
	});
	assert(generated.ok, "Configured model generation was unavailable; see sanitized evidence");
	const { cases } = JSON.parse(generated.text);
	assert.equal(cases.length, 1);
	assert.equal(cases[0].request.path.id, "r-2");
	check("actual-model-generated-case-from-contract");
	const corrupted = structuredClone(cases);
	corrupted[0].request.path.id = "r-1";
	const prepared = await invoke({
		action: "prepare",
		sourcePath: "source.json",
		operationIds: ["getRecord"],
		cases: corrupted,
		baseUrl: `http://127.0.0.1:${port}`,
		outputPath: "draft-incorrect",
	});
	phase = "independent-review-deliberate-error";
	const returned = await invoke({ action: "review", runRef: prepared.workflowRef, model });
	assert.equal(
		returned.phase,
		"revise",
		"Real independent review must return the deliberately incorrect request/status mapping",
	);
	check("actual-independent-model-returns-deliberate-semantic-error");
	await invoke({ action: "revise", runRef: prepared.workflowRef, cases, outputPath: "draft-corrected" });
	phase = "independent-review-corrected";
	const approved = await invoke({ action: "review", runRef: prepared.workflowRef, model });
	assert.equal(approved.phase, "approved");
	check("corrected-model-generated-case-independently-approved");
	const failed = await invoke({ action: "run", runRef: prepared.workflowRef });
	runs.push(failed);
	assert.equal(failed.executionVerdict, "failed");
	assert(failed.openFindings > 0);
	check("real-mcp-newman-recorded-fixture-contract-defect");
	const count = calls.length;
	const unfixed = await invoke({ action: "retest", runRef: prepared.workflowRef, priorRunId: failed.runId });
	runs.push(unfixed);
	assert.equal(unfixed.executionVerdict, "failed");
	assert(unfixed.openFindings > 0);
	defect = false;
	const fixed = await invoke({ action: "retest", runRef: prepared.workflowRef, priorRunId: unfixed.runId });
	runs.push(fixed);
	assert.equal(fixed.executionVerdict, "passed");
	assert.equal(fixed.openFindings, 0);
	assert.equal(calls.length, count);
	const findings = JSON.parse(readFileSync(fixed.findingsPath));
	assert(findings.some((f) => f.status === "closed" && f.firstSeen === failed.runId));
	check("unfixed-remains-open-fix-closes-with-first-evidence-and-zero-model-recalls");
	const requests = hits;
	await invoke({ action: "report", runRef: prepared.workflowRef, runId: fixed.runId });
	assert.equal(hits, requests);
	assert.equal(calls.length, count);
	check("historical-report-does-not-call-model-or-interface");
	summary.status = "passed-real-model-fixture";
} catch (error) {
	summary.status = "failed";
	summary.failure =
		error instanceof assert.AssertionError
			? error.message
			: "Runtime/model output failed; inspect sanitized local evidence";
	process.exitCode = 1;
} finally {
	summary.fixtureRequests = hits;
	summary.finishedAt = new Date().toISOString();
	save();
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
	await manager.dispose();
	await runner.dispose();
	console.log(
		JSON.stringify({
			status: summary.status,
			checks: checks.length,
			modelCalls: calls.length,
			evidence: join(output, "summary.json"),
		}),
	);
}
