// Actual package: original plan entry, SDK tool gating and board implementation.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";
import { waitForStablePage } from "../lib/page-stability.mjs";
const executablePath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve evidence");
const fixture = mkdtempSync("/tmp/pi-plan-ui-");
const workspace = join(fixture, "中文 workspace");
const userData = join(fixture, "desktop");
const agent = join(userData, "agent");
mkdirSync(workspace);
mkdirSync(agent, { recursive: true });
const result = { fixture, executablePath, status: "FAIL", realModelRequests: 0, checks: [], requests: [] };
const proof = join(workspace, "plan-proof.txt");
const provider = createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	const payload = JSON.parse(body);
	const n = result.requests.length + 1;
	result.requests.push({
		ordinal: n,
		tools: (payload.tools ?? []).map((t) => t.function.name),
		toolResults: payload.messages.filter((m) => m.role === "tool").map((m) => m.content),
	});
	let name, args, text;
	if (n === 1) {
		name = "plan_update";
		args = { steps: [{ id: "desktop-step", title: "中文计划：确认后写入测试文件", status: "pending" }] };
	} else if (n === 2 || n === 4) {
		name = "write";
		args = { path: "plan-proof.txt", content: "PLAN_IMPLEMENTED" };
	} else text = n === 3 ? "LOCAL_PLAN_READY" : "LOCAL_IMPLEMENTED";
	const delta = name
		? {
				tool_calls: [
					{ index: 0, id: `plan_${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
				],
			}
		: { content: text };
	res.writeHead(200, { "content-type": "text/event-stream" });
	for (const [d, finish] of [
		[delta, null],
		[{}, name ? "tool_calls" : "stop"],
	])
		res.write(
			`data: ${JSON.stringify({ id: "plan-local", object: "chat.completion.chunk", model: "plan", choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`,
		);
	res.end("data: [DONE]\n\n");
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
writeFileSync(join(agent, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "local-only" } }));
writeFileSync(
	join(agent, "models.json"),
	JSON.stringify({
		providers: {
			fixture: {
				api: "openai-completions",
				apiKey: "local-only",
				baseUrl: `http://127.0.0.1:${provider.address().port}`,
				models: [{ id: "plan", name: "Local plan fixture", contextWindow: 32000, maxTokens: 128 }],
			},
		},
	}),
);
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_TOOL_LAZY_LOADING: "0",
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of Object.keys(env))
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_)/.test(key) ||
		[
			"ELECTRON_RUN_AS_NODE",
			"NODE_OPTIONS",
			"PI_WEB_DATA_DIR",
			"PI_CODING_AGENT_DIR",
			"PI_CODING_AGENT_SESSION_DIR",
			"PI_WEB_DESKTOP_URL",
			"PI_WEB_PORT",
		].includes(key)
	)
		delete env[key];
let app, page;
const check = (label, ok) => {
	assert(ok, label);
	result.checks.push(label);
};
async function until(fn) {
	const end = Date.now() + 30000;
	while (!(await fn())) {
		assert(Date.now() < end, "Plan UI condition timeout");
		await new Promise((r) => setTimeout(r, 100));
	}
}
const send = (message) => page.evaluate((m) => window.__planSocket.send(JSON.stringify(m)), message);
const observed = (predicate) => page.evaluate(predicate);
try {
	app = await launchNativeApp({ executablePath, packaged: true, env });
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	assert(await waitForStablePage(page));
	await app.context().addInitScript(() => {
		const Original = window.WebSocket;
		window.__planMessages = [];
		window.WebSocket = class extends Original {
			constructor(...args) {
				super(...args);
				window.__planSocket = this;
				this.addEventListener("message", (e) => {
					try {
						window.__planMessages.push(JSON.parse(e.data));
					} catch {}
				});
			}
		};
	});
	await page.reload();
	assert(await waitForStablePage(page));
	await until(() => observed(() => window.__planMessages.some((m) => m.type === "ready")));
	await send({ type: "set_model", modelId: "fixture/plan" });
	await until(() => observed(() => window.__planMessages.some((m) => m.state?.model?.id === "plan")));
	await page.locator(".goalbar-hint").click();
	await page.locator(".goalbar-input").fill("只规划测试文件的写入，先建立计划再等待确认。");
	await page.locator(".goalbar-btn.action.plan").click();
	await until(() => observed(() => window.__planMessages.some((m) => m.state?.planMode === true)));
	check("Original goal bar plan action enables server plan mode", true);
	await until(
		() =>
			result.requests.length >= 3 &&
			result.requests[2].toolResults.some((x) => /not found|Plan mode|计划模式/.test(JSON.stringify(x))),
	);
	check(
		"SDK excludes write from model tools while planning",
		result.requests.slice(0, 3).every((r) => !r.tools.includes("write") && !r.tools.includes("edit")),
	);
	check("Forced write call is rejected without creating a file", !existsSync(proof));
	await until(() => observed(() => window.__planMessages.some((m) => JSON.stringify(m).includes("LOCAL_PLAN_READY"))));
	await send({ type: "get_state" });
	await until(() =>
		observed(() =>
			window.__planMessages.some(
				(m) =>
					m.type === "snapshot" &&
					m.state?.isStreaming === false &&
					JSON.stringify(m.state.messages).includes("LOCAL_PLAN_READY"),
			),
		),
	);
	await page.locator(".plan-board").waitFor();
	await page.locator(".plan-board-head").click();
	check(
		"Actual plan_update tool creates original board with Chinese step",
		(await page.locator(".plan-board-steps").innerText()).includes("中文计划：确认后写入测试文件"),
	);
	await page.screenshot({ path: output.replace(/\.json$/, "-planning.png") });
	const beforeImplement = await observed(() => window.__planMessages.length);
	await page.locator(".plan-board-head .plan-board-implement").click();
	await until(() => existsSync(proof));
	await until(() => result.requests.length >= 5);
	check(
		"Original board implement action disables server plan mode",
		await page.evaluate(
			(mark) => window.__planMessages.slice(mark).some((m) => m.state?.planMode === false),
			beforeImplement,
		),
	);
	check("Write tool becomes available after user implementation action", result.requests[3].tools.includes("write"));
	check(
		"SDK implementation writes exact expected file bytes",
		readFileSync(proof).equals(Buffer.from("PLAN_IMPLEMENTED")),
	);
	await until(() => observed(() => window.__planMessages.some((m) => JSON.stringify(m).includes("LOCAL_IMPLEMENTED"))));
	await page.screenshot({ path: output.replace(/\.json$/, "-implemented.png") });
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	await page?.screenshot({ path: output.replace(/\.json$/, "-failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	await app?.close().catch((error) => {
		result.cleanupError = error.message;
		process.exitCode = 1;
	});
	provider.closeAllConnections();
	await new Promise((r) => provider.close(r));
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(
		JSON.stringify({
			status: result.status,
			checks: result.checks.length,
			requests: result.requests.length,
			error: result.error,
		}),
	);
}
