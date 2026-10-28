/** Actual Electron/SDK/tool flow with a local controlled provider; no paid model or PMS data. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, readdir, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import {
	UiWorkflowService,
	UiRunService,
	RuntimeAdmissionService,
	assetDigest,
	capabilities,
	reconcileRun,
} from "pi-ui-testing";
import { ready } from "./fixtures/data-space/ui-run-fixture.mjs";
import { response, validCode } from "./fixtures/data-space/ui-design-fixture.mjs";
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
const recoveryChecks = process.argv.includes("--m1-recovery");
const d = await ready(
	{ after: (fn) => cleanup.push(fn) },
	recoveryChecks
		? {
				globalSetupSource:
					"import {existsSync} from 'node:fs';export default async function(){if(existsSync(process.cwd()+'/.m1-pause'))await new Promise(()=>{});}",
			}
		: undefined,
);
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
let recovery;
if (recoveryChecks) {
	const second = validCode
		.slice(validCode.indexOf("test('C1"))
		.replace("C1 Name persists", "C2 Name persists")
		.replace("A1 Name", "A2 Name")
		.replace(
			"await test.step",
			"if(existsSync(process.cwd()+'/.m1-fail-c2'))await page.getByRole('listitem').evaluate(e=>e.textContent='wrong');await test.step",
		);
	const made = await f.make("m1-two", "import {existsSync} from 'node:fs';\n" + validCode + "\n" + second, (cases) => {
		const next = structuredClone(cases.data.cases[0]);
		next.case_id = "C2";
		next.assertions[0].assertion_id = "A2";
		next.steps[0].assertion_ids = ["A2"];
		cases.data.cases.push(next);
	});
	made.asset.data.bindings.push({
		...made.asset.data.bindings[0],
		case_id: "C2",
		test_title: "C2 Name persists",
		assertion_ids: ["A2"],
	});
	const spec = structuredClone(d.spec);
	spec.probes[0].assertion_ids.push("A2");
	const specRef = await f.store.putFile("qa/ui/scopes/scope-1/m1-two-diagnostic.json", JSON.stringify(spec));
	made.asset.data.files.push(
		...d.asset.data.files.filter(
			(r) => !r.path.endsWith(".spec.ts") && !made.asset.data.files.some((x) => x.path === r.path),
		),
		specRef,
	);
	made.asset.id = "m1-two-case-asset";
	made.asset.data.content_sha256 = assetDigest(made.asset);
	const assetRef = await f.store.put(made.asset);
	const review = await f.service.assess(f.taskRef, assetRef, "m1-two-review", response);
	assert.equal(
		(
			await new RuntimeAdmissionService(workspace, f.authority).diagnose(
				assetRef,
				review.review_ref,
				specRef,
				"m1-two-ready",
			)
		).runtime_ready,
		true,
	);
	recovery = { assetRef, reviewRef: review.review_ref };
}
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
const pageState = async (check) => {
	try {
		return await page.evaluate(check);
	} catch (error) {
		if (/Execution context was destroyed/.test(error.message)) return false;
		throw error;
	}
};
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
	await page.reload().catch((error) => {
		if (!/ERR_ABORTED|frame was detached/.test(error.message)) throw error;
	});
	await page.waitForSelector(".app");
	await waitUntil(() => pageState(() => window.__u03messages.some((m) => m.type === "ready")), "desktop ready");
	await send({ type: "set_model", modelId: "fixture/workflow" });
	await waitUntil(
		() => pageState(() => window.__u03messages.some((m) => m.state?.model?.id === "workflow")),
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
	if (recoveryChecks) {
		const parentTask = "m1-desktop-failed-parent";
		await tool("ui_test_workflow", {
			operation: "start",
			input: { task_id: parentTask, mode: "execute", asset_ref: recovery.assetRef },
		});
		await writeFile(join(workspace, ".m1-fail-c2"), "synthetic");
		const parent = await tool("ui_test_run", {
			operation: "start",
			input: {
				...d.request,
				task_id: parentTask,
				request_id: "m1-parent",
				asset_ref: recovery.assetRef,
				review_ref: recovery.reviewRef,
			},
		});
		assert.equal(parent.status, "completed", JSON.stringify(parent));
		const parentRef = parent.output.run_ref;
		const parentBytes = await readFile(join(workspace, parentRef.path));
		const parentResult = await reconcileRun(workspace, parentRef);
		assert.equal(parentResult.data.counts.passed, 1);
		assert.equal(parentResult.data.counts.failed, 1);
		const plan = await tool("ui_test_run", {
			operation: "plan-recovery",
			parent_run_ref: parentRef,
			intent: "rerun-failed",
		});
		assert.deepEqual(
			plan.selected.map((item) => item.case_id),
			["C2"],
		);
		assert.deepEqual(plan.blockers, []);
		await rm(join(workspace, ".m1-fail-c2"));
		const subsetTask = "m1-desktop-failed-subset";
		await tool("ui_test_workflow", {
			operation: "start",
			input: { task_id: subsetTask, mode: "rerun-failed", run_ref: parentRef },
		});
		const subset = await tool("ui_test_run", {
			operation: "start",
			input: {
				...d.request,
				task_id: subsetTask,
				request_id: "m1-subset",
				asset_ref: recovery.assetRef,
				review_ref: recovery.reviewRef,
				parent_run_ref: parentRef,
			},
		});
		assert.equal(subset.status, "completed", JSON.stringify(subset));
		assert.equal(subset.output.run.data.parent_run_id, parent.output.run.id);
		assert.deepEqual(
			subset.output.run.data.plan.map((item) => item.case_id),
			["C2"],
		);
		const childResult = await reconcileRun(workspace, subset.output.run_ref);
		assert.equal(childResult.data.counts.passed, 1);
		assert.deepEqual(await readFile(join(workspace, parentRef.path)), parentBytes);
		result.recovery = {
			parentRef,
			subsetRef: subset.output.run_ref,
			parentCounts: parentResult.data.counts,
			subsetCounts: childResult.data.counts,
			selected: ["C2"],
		};
		result.checks.push("Electron reruns only the failed case and preserves the original mixed-result parent");

		const cancelTask = "m1-desktop-cancel",
			cancelRequest = "m1-running-cancel";
		await tool("ui_test_workflow", {
			operation: "start",
			input: { task_id: cancelTask, mode: "execute", asset_ref: recovery.assetRef },
		});
		await writeFile(join(workspace, ".m1-pause"), "synthetic");
		const request = {
			...d.request,
			task_id: cancelTask,
			request_id: cancelRequest,
			asset_ref: recovery.assetRef,
			review_ref: recovery.reviewRef,
		};
		pending = { tool: "ui_test_run", request: { operation: "start", input: request } };
		marker++;
		await send({ type: "prompt", text: `Controlled local cancellation ${marker}.` });
		const runService = new UiRunService(workspace, f.authority);
		let running;
		await waitUntil(
			async () => {
				try {
					running = await runService.status(cancelTask, cancelRequest);
					if (running.run.data.state !== "running") return false;
					await readFile(join(workspace, running.run_ref.path.replace("manifest.json", "process-started.json")));
					return true;
				} catch {
					return false;
				}
			},
			"running native process",
			30000,
		);
		const started = JSON.parse(
			await readFile(join(workspace, running.run_ref.path.replace("manifest.json", "process-started.json"))),
		);
		assert.ok(Number.isInteger(started.pid) && started.pid > 0);
		await send({ type: "abort" });
		let cancelled;
		await waitUntil(
			async () => {
				try {
					cancelled = await runService.status(cancelTask, cancelRequest);
					return cancelled.run.data.state === "interrupted";
				} catch {
					return false;
				}
			},
			"cancelled native process",
			30000,
		);
		const summaryRef = cancelled.run.data.output_refs.find((ref) => ref.path.endsWith("/execution-summary.json"));
		const summary = JSON.parse(await readFile(join(workspace, summaryRef.path)));
		assert.equal(summary.status, "cancelled");
		assert.ok(cancelled.run.data.output_refs.some((ref) => ref.path.endsWith("/process-started.json")));
		const processRef = cancelled.run.data.output_refs.find((ref) => ref.path.endsWith("/process.json"));
		const processResult = JSON.parse(await readFile(join(workspace, processRef.path)));
		assert.ok(processResult.code === "ABORT_ERR" || processResult.signal);
		await waitUntil(
			() => {
				try {
					process.kill(started.pid, 0);
					return false;
				} catch (error) {
					if (error.code === "ESRCH") return true;
					throw error;
				}
			},
			"native process exited",
			10000,
		);
		const cancelledBytes = await readFile(join(workspace, cancelled.run_ref.path));
		const afterCancelRequests = f.fixture.state.browserRequests;
		await app.close();
		app = undefined;
		await launch();
		const observed = await tool("ui_test_run", { operation: "status", task_id: cancelTask, request_id: cancelRequest });
		assert.equal(observed.output.run.data.state, "interrupted");
		const unsafeResume = await tool("ui_test_run", {
			operation: "plan-recovery",
			parent_run_ref: cancelled.run_ref,
			intent: "resume",
		});
		assert.ok(unsafeResume.blockers.length > 0);
		assert.equal(f.fixture.state.browserRequests, afterCancelRequests);
		assert.deepEqual(await readFile(join(workspace, cancelled.run_ref.path)), cancelledBytes);
		await rm(join(workspace, ".m1-pause"));
		result.cancellation = {
			runRef: cancelled.run_ref,
			state: cancelled.run.data.state,
			summary: summary.status,
			businessStarted: summary.business_started,
			processStarted: true,
			processExitObserved: true,
			recoveryBlocked: true,
			noReplay: true,
		};
		result.checks.push(
			"Electron abort stops an observed native process, retains the interrupted batch and blocks blind recovery after restart",
		);
	}
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
