/** Actual Electron/SDK/tool flow with a local controlled provider; no paid model or PMS data. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, readdir, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { UiWorkflowService, RuntimeAdmissionService, assetDigest, capabilities } from "pi-ui-testing";
import { ready } from "./fixtures/data-space/ui-run-fixture.mjs";
import { response } from "./fixtures/data-space/ui-design-fixture.mjs";
import { enableUiTesting } from "../scripts/enable-ui-testing.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
import { waitUntil } from "../qa/ui/project-environment.mjs";
import { portUp } from "./lib/port-utils.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "ui-u03-u07-desktop");
const output = join(repo, "tests/scratch/ui-u03-u07/desktop", String(Date.now()));
await mkdir(output, { recursive: true });
const cleanup = [];
const d = await ready({ after: (fn) => cleanup.push(fn) });
const { f } = d,
	workspace = f.root;
const runtime = {
	tools: ["read", ...capabilities.map((c) => c.tool)],
	skills: [
		"ui-discover-record",
		"ui-case-design",
		"ui-design-review",
		"ui-test-run",
		"ui-result-analysis",
		"ui-result-review",
	],
};
const workflow = new UiWorkflowService(workspace, f.authority, runtime);
const sourceId = "desktop-create-and-run";
await workflow.start({ task_id: sourceId, mode: "new", scope_ref: d.asset.data.scope_ref, discovery: "source" });
const inventory = await f.store.load(d.asset.data.inventory_ref);
inventory.id = "desktop-inventory";
inventory.data.draft_refs = [
	await f.store.putFile("qa/ui/inventories/desktop-inventory/source.ts", "// controlled source"),
];
const inventoryRef = await f.store.put(inventory);
const asset = structuredClone(d.asset);
asset.id = "desktop-candidate";
asset.data.inventory_ref = inventoryRef;
asset.data.content_sha256 = assetDigest(asset);
const assetRef = await f.store.put(asset);
await workflow.handoff({ task_id: sourceId, stage: "discover-record", output_refs: [inventoryRef] });
const designed = await workflow.handoff({ task_id: sourceId, stage: "case-design", output_refs: [assetRef] });
const reviewed = await f.service.assess(designed.task_ref, assetRef, "desktop-design", response);
await workflow.handoff({ task_id: sourceId, stage: "design-review", output_refs: [reviewed.review_ref] });
await new RuntimeAdmissionService(workspace, f.authority).diagnose(
	assetRef,
	reviewed.review_ref,
	d.specRef,
	"desktop-ready",
);
const temporary = await mkdtemp(join(tmpdir(), "ui-u03-u07-desktop-"));
const userData = join(temporary, "desktop"),
	agentDir = join(userData, "agent");
await mkdir(agentDir, { recursive: true });
await enableUiTesting(repo, agentDir);
const result = {
	status: "FAIL",
	checks: [],
	providerRequests: 0,
	actualModelCalls: 0,
	businessRequests: 0,
	receipts: [],
	workspace,
	userData,
};
let pending,
	marker = 0;
const provider = createServer(async (req, res) => {
	try {
		let raw = "";
		for await (const chunk of req) raw += chunk;
		const body = JSON.parse(raw);
		result.providerRequests++;
		const call = pending;
		pending = undefined;
		if (!call) {
			const last = [...body.messages].reverse().find((m) => m.role === "tool");
			result.receipts.push(
				JSON.parse(typeof last.content === "string" ? last.content : last.content.map((c) => c.text ?? "").join("")),
			);
		}
		const delta = call
			? {
					tool_calls: [
						{
							index: 0,
							id: `u03_${marker}`,
							type: "function",
							function: { name: call.tool, arguments: JSON.stringify({ request: call.request }) },
						},
					],
				}
			: { content: `U03_U07_DONE_${marker}` };
		res.writeHead(200, { "content-type": "text/event-stream" });
		for (const [value, finish] of [
			[delta, null],
			[{}, call ? "tool_calls" : "stop"],
		])
			res.write(
				`data: ${JSON.stringify({ id: "local-u03", object: "chat.completion.chunk", model: "workflow", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`,
			);
		res.end("data: [DONE]\n\n");
	} catch (error) {
		result.providerError = error.stack;
		res.writeHead(500);
		res.end("fixture error");
	}
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
await writeFile(join(agentDir, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "local-only" } }));
await writeFile(
	join(agentDir, "models.json"),
	JSON.stringify({
		providers: {
			fixture: {
				api: "openai-completions",
				apiKey: "local-only",
				baseUrl: `http://127.0.0.1:${provider.address().port}`,
				models: [{ id: "workflow", name: "Controlled U03 U07", contextWindow: 64000, maxTokens: 512 }],
			},
		},
	}),
);
const port = 18983;
assert.equal(await portUp(port), false);
const env = { ...process.env };
for (const key of Object.keys(env))
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_|PI_)/.test(key) ||
		["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key)
	)
		delete env[key];
Object.assign(env, {
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PI_WEB_SDK: "bundled",
	PI_WEB_TOOL_LAZY_LOADING: "0",
});
let app, page;
const send = (message) => page.evaluate((m) => window.__u03socket.send(JSON.stringify(m)), message);
async function launch() {
	app = await launchNativeApp({ executablePath: electron, packaged: false, env });
	page = await app.firstWindow();
	await app.context().addInitScript(() => {
		const Original = window.WebSocket;
		window.__u03messages = [];
		window.WebSocket = class extends Original {
			constructor(...args) {
				super(...args);
				window.__u03socket = this;
				this.addEventListener("message", (e) => {
					try {
						window.__u03messages.push(JSON.parse(e.data));
					} catch {}
				});
			}
		};
	});
	await page.reload();
	await page.waitForSelector(".app");
	await waitUntil(() => page.evaluate(() => window.__u03messages.some((m) => m.type === "ready")), "desktop ready");
	await send({ type: "set_model", modelId: "fixture/workflow" });
	await waitUntil(
		() => page.evaluate(() => window.__u03messages.some((m) => m.state?.model?.id === "workflow")),
		"fixture model",
	);
}
async function tool(tool, request) {
	pending = { tool, request };
	marker++;
	await send({
		type: "prompt",
		text: `Controlled local U03/U07 request ${marker}: ${request.operation}. Keep the original scope and review gates.`,
	});
	await page.getByText(`U03_U07_DONE_${marker}`, { exact: true }).waitFor({ timeout: 60000 });
	const receipt = result.receipts.at(-1);
	assert(receipt, result.providerError);
	return receipt;
}
try {
	await launch();
	const sessions = (await readdir(join(agentDir, "sessions"), { withFileTypes: true })).filter((e) => e.isDirectory());
	assert.equal(sessions.length, 1);
	// Seed only this isolated SDK session with the controlled fixture's genuine native authority receipts.
	await cp(f.authority, join(agentDir, "sessions", sessions[0].name, "ui-review-authority"), { recursive: true });
	const before = f.fixture.state.browserRequests;
	await tool("ui_test_workflow", {
		operation: "start",
		input: { task_id: sourceId, mode: "new", scope_ref: asset.data.scope_ref, discovery: "source" },
	});
	const continued = await tool("ui_test_workflow", {
		operation: "continue-execute",
		task_id: sourceId,
		authorized_asset_ref: assetRef,
	});
	assert.equal(continued.status, "completed", JSON.stringify(continued));
	const childId = continued.output.task.id;
	assert.deepEqual(continued.output.execution_scope.case_ids, ["C1"]);
	assert.equal(f.fixture.state.browserRequests, before);
	const reused = await tool("ui_design_diagnose", {
		operation: "reuse",
		asset_ref: assetRef,
		review_ref: reviewed.review_ref,
		spec_ref: d.specRef,
	});
	assert.equal(reused.output.reused, true);
	assert.equal(f.fixture.state.browserRequests, before);
	result.checks.push(
		"SDK continuation registers a distinct whole-asset execute task; valid diagnostic reuse launches no browser",
	);
	const run = await tool("ui_test_run", {
		operation: "start",
		input: {
			...d.request,
			task_id: childId,
			request_id: "desktop-formal",
			asset_ref: assetRef,
			review_ref: reviewed.review_ref,
		},
	});
	assert.equal(run.status, "completed", JSON.stringify(run));
	const executedRequests = f.fixture.state.browserRequests;
	assert(executedRequests > before);
	const analyzed = await tool("ui_result_analysis", { operation: "analyze-task", task_id: childId });
	assert.equal(analyzed.output.summary.counts.passed, 1, JSON.stringify(analyzed));
	assert.equal(analyzed.output.workflow.task.data.stage, "result-review");
	await page.locator(".plan-board").waitFor();
	assert.equal(await page.locator(".plan-board-count").innerText(), "5/6");
	await page.locator(".plan-board-head").click();
	await page.screenshot({ path: join(output, "candidate-pending.png") });
	const duplicate = await tool("ui_result_analysis", { operation: "analyze-task", task_id: childId });
	assert.equal(duplicate.output.replayed, true);
	assert.deepEqual(duplicate.output.report_ref, analyzed.output.report_ref);
	const denied = await tool("ui_test_workflow", {
		operation: "handoff",
		task_id: childId,
		stage: "result-review",
		output_refs: [analyzed.output.report_ref],
	});
	assert.equal(denied.status, "blocked");
	assert.equal((await workflow.find(childId)).task.data.state, "running");
	assert.equal(f.fixture.state.browserRequests, executedRequests);
	result.checks.push(
		"Actual SDK run passes; analyze-task creates one report candidate, duplicate lookup is stable, unreviewed delivery remains blocked and Electron shows 5/6",
	);
	const view = await tool("ui_test_workflow", {
		operation: "start",
		input: { task_id: "desktop-view", mode: "view", run_ref: run.output.run_ref },
	});
	assert.deepEqual(view.output.directory, []);
	assert.equal(
		(await tool("ui_result_analysis", { operation: "analyze-task", task_id: "desktop-view" })).status,
		"blocked",
	);
	assert.equal(f.fixture.state.browserRequests, executedRequests);
	await writeFile(join(output, "first-desktop.log"), app.getLogs());
	await app.close();
	app = undefined;
	await launch();
	await page.locator(".plan-board").waitFor();
	assert.equal(await page.locator(".plan-board-count").innerText(), "5/6");
	const reopened = await tool("ui_test_workflow", {
		operation: "continue-execute",
		task_id: sourceId,
		authorized_asset_ref: assetRef,
	});
	assert.equal(reopened.output.task.id, childId);
	assert.equal(
		(await tool("ui_result_analysis", { operation: "analyze-task", task_id: childId })).output.replayed,
		true,
	);
	assert.equal(f.fixture.state.browserRequests, executedRequests);
	assert.equal(await page.locator(".plan-board-count").innerText(), "5/6");
	await page.screenshot({ path: join(output, "restarted.png") });
	result.checks.push(
		"Full Electron exit/restart preserves both tasks and pending approval; repeated continuation/analysis and view do not replay browser actions",
	);
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	if (app) await writeFile(join(output, "last-desktop.log"), app.getLogs());
	await app?.close().catch((error) => {
		result.cleanupError = error.message;
		process.exitCode = 1;
	});
	provider.closeAllConnections();
	await new Promise((resolve) => provider.close(resolve));
	for (const fn of cleanup.reverse()) await fn();
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ status: result.status, error: result.error, checks: result.checks, output }));
}
