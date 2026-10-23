/** Actual Electron + SDK + native workflow; controlled provider, no paid model or business requests. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { sha256 } from "pi-ui-testing";
import { partialReport } from "./fixtures/data-space/ui-partial-fixture.mjs";
import { enableUiTesting } from "../scripts/enable-ui-testing.mjs";
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
		if ([2, 3, 5, 7].includes(ordinal)) {
			const ref = { path: taskPath, sha256: sha256(await readFile(join(workspace, taskPath))) };
			request =
				ordinal === 5
					? { operation: "resume-task", task_ref: ref }
					: {
							operation: "checkpoint",
							task_ref: ref,
							stage: ordinal === 2 ? "analyze" : "result-review",
							output_refs: [native.report.report_ref],
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
