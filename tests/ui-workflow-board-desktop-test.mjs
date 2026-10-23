/** Actual Electron + SDK + native workflow; controlled provider, no paid model or business requests. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { sha256 } from "pi-ui-testing";
import { partialReport, restorePartial } from "./fixtures/data-space/ui-partial-fixture.mjs";
import { enableUiTesting } from "../scripts/enable-ui-testing.mjs";
import { enableDataSpace } from "../scripts/enable-data-space.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
import { waitUntil } from "../qa/ui/project-environment.mjs";
import { portUp } from "./lib/port-utils.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "ui-workflow-board-desktop");
const output = join(repo, "tests/scratch/ui-workflow-board-desktop", String(Date.now()));
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "ui-workflow-board-"));
const cleanup = [];
const native = await partialReport({ after: (fn) => cleanup.push(fn) });
const workspace = native.f.root;
const userData = join(temporary, "desktop");
const agentDir = join(userData, "agent");
await mkdir(agentDir, { recursive: true });
await enableUiTesting(repo, agentDir);
const dataDir = join(userData, "data");
await enableDataSpace(repo, { agentDir, dataDir });
await mkdir(join(dataDir, "data-space"), { recursive: true });
await writeFile(
	join(dataDir, "data-space/store.json"),
	JSON.stringify({
		version: 3,
		revision: 1,
		systems: [{ id: "project", name: "Isolated U01 project" }],
		modules: [{ id: "module", systemId: "project", name: "Names" }],
		features: [{ id: "save", moduleId: "module", name: "Save" }],
		cases: [],
		envs: [{ id: "env", systemId: "project", name: "Synthetic", baseUrl: native.f.fixture.url, params: [] }],
	}),
);
const taskId = "desktop-partial";
const taskPath = `qa/ui/tasks/${taskId}/manifest.json`;
const result = {
	status: "FAIL",
	checks: [],
	providerRequests: 0,
	actualModelCalls: 0,
	businessRequests: 0,
	workspace,
	userData,
	runRef: native.execution.run_ref,
};
let restored;
const provider = createServer(async (req, res) => {
	try {
		// Consume the SDK request, but never retain prompts or authentication.
		for await (const _ of req) {
			/* drain */
		}
		const ordinal = ++result.providerRequests;
		let request;
		if (ordinal === 1)
			request = { operation: "start", input: { task_id: taskId, mode: "analyze", run_ref: native.execution.run_ref } };
		if ([2, 3, 5, 7, 9, 10].includes(ordinal)) {
			const ref = { path: taskPath, sha256: sha256(await readFile(join(workspace, taskPath))) };
			request = [5, 9].includes(ordinal)
				? { operation: "resume-task", task_ref: ref }
				: {
						operation: "checkpoint",
						task_ref: ref,
						stage: ordinal === 2 ? "analyze" : "result-review",
						output_refs:
							ordinal === 10 ? [restored.full.report_ref, restored.approved.review_ref] : [native.report.report_ref],
					};
		}
		const delta = request
			? {
					tool_calls: [
						{
							index: 0,
							id: `workflow_${ordinal}`,
							type: "function",
							function: { name: "ui_test_workflow", arguments: JSON.stringify({ request }) },
						},
					],
				}
			: { content: `CONTROLLED_WORKFLOW_${ordinal}` };
		res.writeHead(200, { "content-type": "text/event-stream" });
		for (const [value, finish] of [
			[delta, null],
			[{}, request ? "tool_calls" : "stop"],
		])
			res.write(
				`data: ${JSON.stringify({ id: "local-workflow", object: "chat.completion.chunk", model: "workflow", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`,
			);
		res.end("data: [DONE]\n\n");
	} catch (error) {
		result.providerError = error.message;
		res.writeHead(500);
		res.end("fixture failed");
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
				models: [{ id: "workflow", name: "Controlled workflow", contextWindow: 64000, maxTokens: 128 }],
			},
		},
	}),
);
const port = 18981;
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
try {
	app = await launchNativeApp({ executablePath: electron, packaged: false, env });
	page = await app.firstWindow();
	await app.context().addInitScript(() => {
		const Original = window.WebSocket;
		window.__workflowMessages = [];
		window.WebSocket = class extends Original {
			constructor(...args) {
				super(...args);
				window.__workflowSocket = this;
				this.addEventListener("message", (e) => {
					try {
						window.__workflowMessages.push(JSON.parse(e.data));
					} catch {}
				});
			}
		};
	});
	await page.reload();
	await page.waitForSelector(".app");
	const send = (message) => page.evaluate((m) => window.__workflowSocket.send(JSON.stringify(m)), message);
	await waitUntil(
		() => page.evaluate(() => window.__workflowMessages.some((m) => m.type === "ready")),
		"desktop ready",
	);
	await send({ type: "set_model", modelId: "fixture/workflow" });
	await waitUntil(
		() => page.evaluate(() => window.__workflowMessages.some((m) => m.state?.model?.id === "workflow")),
		"controlled provider",
	);
	const task = async () => JSON.parse(await readFile(join(workspace, taskPath), "utf8"));
	const settled = async (ordinal) => {
		await waitUntil(
			() =>
				page.evaluate(
					(n) =>
						window.__workflowMessages.some(
							(m) =>
								m.type === "snapshot" &&
								m.state?.isStreaming === false &&
								JSON.stringify(m.state.messages).includes(`CONTROLLED_WORKFLOW_${n}`),
						),
					ordinal,
				),
			"SDK turn complete",
			60000,
		);
	};
	await send({
		type: "prompt",
		text: "Analyze the existing fixture run and deliver only a partial report if evidence is missing.",
	});
	await settled(4);
	assert.equal((await task()).data.state, "blocked");
	await writeFile(join(output, "blocked-task.json"), JSON.stringify(await task(), null, 2));
	await page.locator(".plan-board").waitFor();
	await page.locator(".plan-board-head").click();
	assert.equal(await page.locator(".plan-board-count").innerText(), "1/2");
	assert.match(await page.locator(".plan-board-steps").innerText(), /完整|trace|证据/);
	assert.equal(await page.locator(".plan-board-implement").count(), 0);
	await page.screenshot({ path: join(output, "partial-blocked.png") });
	result.checks.push(
		"Native partial checkpoint blocks delivery; Electron board shows 1/2 and the evidence gap without an implementation button",
	);
	const partial = (await task()).data.output_refs.find((ref) => ref.path.endsWith(".md"));
	assert(partial);
	const partialContent = await readFile(join(workspace, partial.path), "utf8");
	assert.match(partialContent, /阶段报告；完整性未通过/);
	await writeFile(join(output, "partial-report.md"), partialContent);
	result.checks.push("Partial Markdown delivery exists and remains readable; native run was really executed");
	await page.reload();
	await page.waitForSelector(".plan-board");
	assert.equal(await page.locator(".plan-board-count").innerText(), "1/2");
	await send({ type: "prompt", text: "Explicitly resume the original task, retaining its prior evidence." });
	await settled(6);
	assert.equal((await task()).id, taskId);
	assert.equal((await task()).data.state, "running");
	await writeFile(join(output, "resumed-task.json"), JSON.stringify(await task(), null, 2));
	await page.locator(".plan-board-active").waitFor();
	assert.match(await page.locator(".plan-board-active").innerText(), /Review & deliver/);
	result.checks.push("Reload preserves the board; explicit same-task resume updates the active stage");
	await send({ type: "prompt", text: "Recheck the same partial report; do not rerun business actions." });
	await settled(8);
	assert.equal((await task()).data.state, "blocked");
	await writeFile(join(output, "reblocked-task.json"), JSON.stringify(await task(), null, 2));
	assert.equal((await task()).data.output_refs.filter((ref) => ref.path === partial.path).length, 1);
	assert.equal(await page.locator(".plan-board-count").innerText(), "1/2");
	assert.equal(await page.locator(".plan-board-active").count(), 0);
	await page.screenshot({ path: join(output, "reblocked.png") });
	result.checks.push(
		"Unrepaired evidence reblocks the same task without duplicating or overwriting the historical partial report",
	);
	// Only this isolated agent directory is inspected; use the native service's real review authority path.
	const sessionDirectories = (await readdir(join(agentDir, "sessions"), { withFileTypes: true })).filter((entry) =>
		entry.isDirectory(),
	);
	assert.equal(sessionDirectories.length, 1);
	const beforeRestore = native.f.fixture.state.browserRequests;
	assert.ok(beforeRestore > 0);
	restored = await restorePartial(
		native,
		join(agentDir, "sessions", sessionDirectories[0].name, "ui-review-authority"),
	);
	assert.equal(restored.approved.decision, "approved");
	await send({
		type: "prompt",
		text: "Evidence has been restored and the controlled review has completed. Explicitly resume and deliver the complete failed report for the original task.",
	});
	await settled(11);
	const completed = await task();
	assert.equal(completed.id, taskId);
	assert.equal(completed.data.state, "completed");
	assert.ok(completed.data.output_refs.some((ref) => ref.path === partial.path));
	const finalDelivery = completed.data.output_refs.filter(
		(ref) => ref.path.endsWith(".md") && ref.path !== partial.path,
	);
	assert.equal(finalDelivery.length, 1);
	const finalContent = await readFile(join(workspace, finalDelivery[0].path), "utf8");
	assert.match(finalContent, /\| failed \| 1 \|/);
	assert.equal(native.f.fixture.state.browserRequests, beforeRestore);
	await writeFile(join(output, "completed-task.json"), JSON.stringify(completed, null, 2));
	await writeFile(join(output, "complete-failed-report.md"), finalContent);
	assert.equal(await page.locator(".plan-board-count").innerText(), "2/2");
	await page.screenshot({ path: join(output, "completed-failed-report.png") });
	result.checks.push(
		"Restored evidence and controlled native review allow same-task complete delivery; Electron shows 2/2 while the original report truthfully records failed=1, with no browser replay",
	);
	const request = (body) =>
		page.evaluate(async (body) => {
			const response = await fetch("/plugins-api/data-space/automation", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!response.ok) throw new Error(`Data Space HTTP ${response.status}: ${await response.text()}`);
			return response.json();
		}, body);
	const imported = await request({
		action: "import",
		engine: "ui",
		workspace,
		assetRef: native.assetRef,
		envId: "env",
		featureMappings: [{ nativeModuleId: "names", nativeFeatureId: "save", featureId: "save" }],
	});
	assert.equal(imported.imported, 1);
	await request({
		action: "bind",
		workspace,
		caseId: imported.caseIds[0],
		engine: "ui",
		assetRef: native.assetRef,
		nativeCaseId: "C1",
		envId: "env",
	});
	const synced = await request({ action: "sync", engine: "ui", workspace, runRef: native.execution.run_ref });
	assert.equal(synced.complete, true);
	assert.equal(synced.items[0].verdict, "失败");
	const repeated = await request({ action: "sync-status", engine: "ui", workspace, runRef: native.execution.run_ref });
	assert.equal(repeated.items[0].resultId, synced.items[0].resultId);
	assert.equal(repeated.items[0].verdict, "失败");
	await writeFile(join(output, "data-space-sync.json"), JSON.stringify(repeated, null, 2));
	await page.locator("header button, .topbar button, nav button").filter({ hasText: "数据空间" }).first().click();
	await page.locator('.dsp-nav button[data-tab="cases"]').click();
	const row = page
		.locator("tr")
		.filter({ has: page.locator('[data-act="automation-open"]') })
		.first();
	await row.locator('[data-act="automation-open"]').click();
	await page.locator(".dsp-modal summary").filter({ hasText: "原生执行记录与证据" }).click();
	assert.match(await page.locator(".dsp-modal").innerText(), /失败/);
	await page.screenshot({ path: join(output, "data-space-failed.png") });
	result.checks.push(
		"Data Space keeps the same native batch as failed and preserves its result ID, independently of workflow delivery completion",
	);
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	await app?.close().catch((error) => {
		result.cleanupError = error.message;
		process.exitCode = 1;
	});
	provider.closeAllConnections();
	await new Promise((resolve) => provider.close(resolve));
	for (const fn of cleanup.reverse()) await fn();
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ...result, output }));
}
