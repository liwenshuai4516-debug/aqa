// Actual package: ephemeral save/discard and original history UI across relaunch.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";
import { waitForStablePage } from "../lib/page-stability.mjs";
const executablePath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve evidence");
const fixture = mkdtempSync("/tmp/pi-session-ui-");
const workspace = join(fixture, "中文 workspace");
const userData = join(fixture, "desktop");
const agent = join(userData, "agent");
mkdirSync(workspace);
mkdirSync(agent, { recursive: true });
const result = { fixture, executablePath, status: "FAIL", realModelRequests: 0, checks: [] };
let localRequests = 0;
const provider = createServer(async (req, res) => {
	for await (const _ of req) {
	}
	localRequests++;
	const text = ["NORMAL_UI_REPLY", "PERSIST_UI_REPLY", "DISCARD_UI_REPLY"][localRequests - 1];
	assert(text, "Unexpected local request");
	res.writeHead(200, { "content-type": "text/event-stream" });
	for (const [delta, finish] of [
		[{ content: text }, null],
		[{}, "stop"],
	])
		res.write(
			`data: ${JSON.stringify({ id: "session-local", object: "chat.completion.chunk", model: "plan", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
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
		assert(Date.now() < end, "Session UI condition timeout");
		await new Promise((r) => setTimeout(r, 100));
	}
}
function sessions() {
	const files = [];
	function walk(dir) {
		if (!existsSync(dir)) return;
		for (const item of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, item.name);
			if (item.isDirectory()) walk(path);
			else if (item.name.endsWith(".jsonl")) files.push(path);
		}
	}
	walk(join(agent, "sessions"));
	return files;
}
const containing = (marker) => sessions().filter((path) => readFileSync(path, "utf8").includes(marker));
const send = (message) => page.evaluate((m) => window.__sessionSocket.send(JSON.stringify(m)), message);
async function launch() {
	app = await launchNativeApp({ executablePath, packaged: true, env });
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	assert(await waitForStablePage(page));
	await app.context().addInitScript(() => {
		const Original = window.WebSocket;
		window.__sessionMessages = [];
		window.WebSocket = class extends Original {
			constructor(...args) {
				super(...args);
				window.__sessionSocket = this;
				this.addEventListener("message", (e) => {
					try {
						window.__sessionMessages.push(JSON.parse(e.data));
					} catch {}
				});
			}
		};
	});
	await page.reload();
	assert(await waitForStablePage(page));
	await until(() => page.evaluate(() => window.__sessionMessages.some((m) => m.type === "ready")));
}
async function prompt(text, reply) {
	await page.locator(".inputbox textarea").fill(text);
	await page.locator(".inputbox textarea").press("Enter");
	await until(async () => (await page.locator(".messages").innerText()).includes(reply));
	await send({ type: "get_state" });
	await until(() =>
		page.evaluate(
			(marker) =>
				window.__sessionMessages.some(
					(m) =>
						m.type === "snapshot" &&
						m.state?.isStreaming === false &&
						JSON.stringify(m.state.messages).includes(marker),
				),
			reply,
		),
	);
}
async function ephemeral() {
	if (await page.locator(".ephemeral-chat-btn").isVisible()) await page.locator(".ephemeral-chat-btn").click();
	else {
		await page.locator(".plugin-topbar-more > button").click();
		await page.locator(".ephemeral-chat-btn").click();
	}
	await page.locator(".ephemeral-banner").waitFor();
}
async function openHistory(path, reply) {
	await page.locator(".panel-sessions").getByTitle(path, { exact: true }).click();
	await until(async () => (await page.locator(".messages").innerText()).includes(reply));
}
try {
	await launch();
	await send({ type: "set_model", modelId: "fixture/plan" });
	await until(() => page.evaluate(() => window.__sessionMessages.some((m) => m.state?.model?.id === "plan")));
	await prompt("普通对话 UI 留存验证", "NORMAL_UI_REPLY");
	await until(() => containing("NORMAL_UI_REPLY").length === 1);
	const normalPath = containing("NORMAL_UI_REPLY")[0];
	check("Regular conversation provides real on-disk control transcript", true);
	const beforeTemporary = sessions().length;
	await ephemeral();
	check("Original ephemeral entry displays in-memory session banner", true);
	await prompt("临时对话转正 UI 验证", "PERSIST_UI_REPLY");
	check(
		"Temporary reply creates no transcript in the original SDK session directory",
		sessions().length === beforeTemporary && containing("PERSIST_UI_REPLY").length === 0,
	);
	await page.screenshot({ path: output.replace(/\.json$/, "-ephemeral.png") });
	await page.locator(".ephemeral-save").click();
	await page.locator(".ephemeral-banner").waitFor({ state: "detached" });
	await until(() => containing("PERSIST_UI_REPLY").length === 1);
	const savedPath = containing("PERSIST_UI_REPLY")[0];
	check(
		"Original save button persists temporary conversation exactly once",
		savedPath !== normalPath && sessions().length === beforeTemporary + 1,
	);
	await openHistory(normalPath, "NORMAL_UI_REPLY");
	check(
		"Original history UI switches to regular conversation",
		!(await page.locator(".messages").innerText()).includes("PERSIST_UI_REPLY"),
	);
	await openHistory(savedPath, "PERSIST_UI_REPLY");
	check(
		"Original history UI switches to saved temporary conversation",
		!(await page.locator(".messages").innerText()).includes("NORMAL_UI_REPLY"),
	);
	await ephemeral();
	await prompt("临时对话退出丢弃 UI 验证", "DISCARD_UI_REPLY");
	check("Second unsaved temporary conversation remains off disk", containing("DISCARD_UI_REPLY").length === 0);
	await app.close();
	app = null;
	await launch();
	check(
		"Unpersisted temporary history is absent after full application relaunch",
		containing("DISCARD_UI_REPLY").length === 0,
	);
	await openHistory(savedPath, "PERSIST_UI_REPLY");
	check("Saved temporary transcript opens after full application relaunch", true);
	await openHistory(normalPath, "NORMAL_UI_REPLY");
	check("Regular transcript opens after full application relaunch", true);
	check(
		"Unsaved temporary conversation is absent from original history UI after relaunch",
		!(await page.locator(".panel-sessions").innerText()).includes("临时对话退出丢弃"),
	);
	await new Promise((r) => setTimeout(r, 1500));
	check("History switches and relaunch trigger no extra local model request", localRequests === 3);
	await page.screenshot({ path: output.replace(/\.json$/, "-restored.png") });
	result.normalPath = normalPath;
	result.savedPath = savedPath;
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
	result.localRequests = localRequests;
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}
