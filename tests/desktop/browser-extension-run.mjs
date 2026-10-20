import { _electron, chromium } from "playwright-core";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const fixture = mkdtempSync(join(tmpdir(), "pi-real-extension-"));
const workspace = join(fixture, "中文 project");
mkdirSync(workspace);
const userData = join(fixture, "desktop");
const agent = join(userData, "agent");
mkdirSync(agent, { recursive: true });
const checks = [];
let app, context;
let requestCount = 0;
let toolResult;
const target = createServer((req, res) => {
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(
		'<title>D01 授权页面</title><h1 id="heading">原页面</h1><button id="action" onclick="document.querySelector(\'#heading\').textContent=\'已点击\'">执行</button><input id="input">',
	);
});
target.listen(0, "127.0.0.1");
await once(target, "listening");
const targetOrigin = `http://127.0.0.1:${target.address().port}`;
const provider = createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	const payload = JSON.parse(body);
	requestCount++;
	const lastUser = payload.messages.filter((m) => m.role === "user").at(-1);
	const browserTurn = JSON.stringify(lastUser).includes("BROWSER_TOOL");
	const result = payload.messages.findLast((m) => m.role === "tool");
	res.writeHead(200, { "content-type": "text/event-stream" });
	const delta = (d, finish = null) =>
		res.write(
			`data: ${JSON.stringify({ id: "d01", object: "chat.completion.chunk", created: Date.now(), model: payload.model, choices: [{ index: 0, delta: d, finish_reason: finish }] })}\n\n`,
		);
	if (browserTurn && !result) {
		delta({
			tool_calls: [
				{
					index: 0,
					id: "call_browser_1",
					type: "function",
					function: {
						name: "browser_page",
						arguments: JSON.stringify({ op: "read", what: "title", target: targetOrigin }),
					},
				},
			],
		});
		delta({}, "tool_calls");
	} else {
		if (result) toolResult = result.content;
		delta({ content: browserTurn ? "BROWSER_RETURN_OK" : "DESKTOP_HISTORY_OK" });
		delta({}, "stop");
	}
	res.end("data: [DONE]\n\n");
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
writeFileSync(
	join(agent, "models.json"),
	JSON.stringify({
		providers: {
			fixture: {
				api: "openai-completions",
				baseUrl: `http://127.0.0.1:${provider.address().port}`,
				apiKey: "local-fixture",
				models: [{ id: "d01", name: "Local D01", input: ["text"], contextWindow: 32000, maxTokens: 4096 }],
			},
		},
	}),
);
writeFileSync(join(agent, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "local-fixture" } }));
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
};
for (const key of ["ELECTRON_RUN_AS_NODE", "PI_WEB_DATA_DIR", "PI_CODING_AGENT_DIR", "PI_WEB_DESKTOP_URL"])
	delete env[key];
async function until(predicate, timeout = 30000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("D01 condition timeout");
}
try {
	app = await _electron.launch({ args: [resolve("dist/desktop/main.js")], env, timeout: 60000 });
	const desktop = await app.firstWindow();
	await desktop.waitForSelector(".app", { timeout: 60000 });
	await desktop.waitForFunction(() => typeof window.__piWebUiHost?.compose === "function");
	await app.evaluate(({ shell }) => {
		shell.openExternal = async (url) => {
			globalThis.__handoffUrl = url;
		};
	});
	await desktop.evaluate(() => window.open(location.origin, "_blank"));
	await until(() => app.evaluate(() => !!globalThis.__handoffUrl));
	const launchUrl = await app.evaluate(() => globalThis.__handoffUrl);
	const origin = new URL(launchUrl).origin;
	assert(new URL(launchUrl).searchParams.get("token"));
	assert.equal((await fetch(origin + "/api/themes")).status, 401);
	// Route the requested system-browser URL to a fresh controlled real Chrome profile, never the user's profile.
	const extension = resolve("plugins/page-picker/extension");
	context = await chromium.launchPersistentContext(join(fixture, "chrome"), {
		executablePath:
			"/Users/liyingjun/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
		headless: false,
		args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
	});
	const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
	const extensionId = new URL(worker.url()).host;
	await context.addInitScript(() => {
		const NativeWebSocket = window.WebSocket;
		window.WebSocket = class extends NativeWebSocket {
			constructor(...args) {
				super(...args);
				if (String(args[0]).includes("/ws")) window.__testSocket = this;
			}
		};
	});
	const browserPage = await context.newPage();
	const frames = [];
	browserPage.on("websocket", (socket) => {
		socket.on("framesent", (event) => {
			try {
				frames.push({ direction: "out", ...JSON.parse(event.payload) });
			} catch {}
		});
		socket.on("framereceived", (event) => {
			try {
				frames.push({ direction: "in", ...JSON.parse(event.payload) });
			} catch {}
		});
	});
	await browserPage.goto(launchUrl);
	await browserPage.waitForSelector(".app");
	await browserPage.waitForFunction(() => !!window.__piWebUiHost);
	assert.equal(await browserPage.evaluate(() => fetch("/api/themes").then((r) => r.status)), 200);
	checks.push({
		id: "D01/A12",
		status: "PASS",
		check:
			"Desktop external-window handler produces authenticated same-service URL; fresh real Chrome profile loads same application",
		extensionId,
		extensionVersion: await worker.evaluate(() => chrome.runtime.getManifest().version),
		note: "OS shell dispatch intercepted to route into isolated test browser; default personal browser not modified",
	});
	const options = await context.newPage();
	await options.goto(`chrome-extension://${extensionId}/options.html`);
	await options.locator("#serverUrl").fill(origin);
	await options.locator("#serverUrl").blur();
	await options.locator("#token").fill(new URL(launchUrl).searchParams.get("token"));
	await options.locator("#token").blur();
	await options.locator("#aiControl").check();
	await options.locator("#aiPageInput").fill(targetOrigin);
	await options.locator("#aiGrant").click();
	await until(async () =>
		JSON.stringify(await worker.evaluate(() => chrome.storage.local.get("aiPages"))).includes(targetOrigin),
	);
	const targetPage = await context.newPage();
	await targetPage.goto(targetOrigin);
	// Original extension code calls the real chrome.scripting/tabs/runtime APIs. No fake chrome transport.
	await options.evaluate(() => chrome.runtime.sendMessage({ type: "page-picker:pairs-changed" }));
	await browserPage.waitForFunction(() => typeof window.__piBridge?.call === "function");
	const call = (op, args = {}) =>
		browserPage.evaluate(async ({ op, args }) => window.__piWebUiHost.pageCall({ op, args, timeoutMs: 10000 }), {
			op,
			args,
		});
	const read = await call("read", { what: "title" });
	assert(read.ok, JSON.stringify(read));
	assert(JSON.stringify(read).includes("D01 授权页面"));
	const clicked = await call("click", { selector: "#action" });
	assert(clicked.ok);
	await targetPage.waitForFunction(() => document.querySelector("#heading").textContent === "已点击");
	const typed = await call("type", { selector: "#input", text: "真实扩展输入" });
	assert(typed.ok);
	assert.equal(await targetPage.locator("#input").inputValue(), "真实扩展输入");
	const denied = await call("eval", { code: "1+1" });
	assert.equal(denied.ok, false);
	checks.push({
		id: "D01/A12",
		status: "PASS",
		check:
			"Real loaded MV3 extension UI grants target; original host bridge reads title, clicks and types into real target tab; eval denied by default",
	});
	// Original UI sends through its original WebSocket; use the page's existing host send API.
	await app.context().addInitScript(() => {
		const NativeWebSocket = window.WebSocket;
		window.WebSocket = class extends NativeWebSocket {
			constructor(...args) {
				super(...args);
				if (String(args[0]).includes("/ws")) window.__testSocket = this;
			}
		};
	});
	await desktop.reload();
	await desktop.waitForSelector(".app");
	await desktop.waitForFunction(() => window.__testSocket?.readyState === 1);
	const send = async (page, message) =>
		page.evaluate((message) => window.__testSocket.send(JSON.stringify(message)), message);
	await send(desktop, { type: "set_model", modelId: "fixture/d01" });
	await send(desktop, { type: "prompt", text: "Create desktop history." });
	await desktop.waitForFunction(() => document.body.textContent.includes("DESKTOP_HISTORY_OK"), { timeout: 30000 });
	await send(browserPage, { type: "get_state" });
	await until(() => frames.some((m) => m.type === "conversations" && m.elsewhere?.some((c) => c.title && c.owner)));
	const elsewhere = frames.findLast((m) => m.type === "conversations" && m.elsewhere?.length)?.elsewhere;
	const owned = elsewhere.find((c) => !c.pseudo);
	assert(owned);
	await send(browserPage, { type: "take_over_conversation", owner: owned.owner, id: owned.convId });
	await browserPage.waitForFunction(() => document.body.textContent.includes("DESKTOP_HISTORY_OK"));
	const browserIdentity = frames.find((m) => m.direction === "out" && m.type === "hello")?.clientId;
	assert(browserIdentity);
	assert.notEqual(browserIdentity, owned.owner);
	await send(browserPage, { type: "set_settings", disabledAgentTools: [] });
	await send(browserPage, { type: "prompt", text: "BROWSER_TOOL: read the authorized page title." });
	await browserPage.waitForFunction(() => document.body.textContent.includes("BROWSER_RETURN_OK"), { timeout: 30000 });
	assert(JSON.stringify(toolResult).includes("D01 授权页面"));
	assert(frames.some((m) => m.type === "page_request"));
	assert(frames.some((m) => m.type === "page_response"));
	checks.push({
		id: "D01/A10/A12",
		status: "PASS",
		check:
			"Browser has independent client identity, explicitly takes over desktop conversation, then real SDK browser_page request travels through original WS, real extension and target page; tool result returns to local test provider",
		providerRequests: requestCount,
	});
	await browserPage.screenshot({ path: resolve("docs/desktop-delivery/evidence/D01-browser.png") });
	console.log(JSON.stringify(checks, null, 2));
} catch (error) {
	checks.push({ status: "FAIL", error: error.stack });
	throw error;
} finally {
	console.log("Closing test browser");
	await context?.close();
	console.log("Closing test desktop");
	await app?.close().catch(() => {});
	target.closeAllConnections();
	provider.closeAllConnections();
	console.log("Saving evidence");
	await new Promise((r) => target.close(r));
	await new Promise((r) => provider.close(r));
	writeFileSync(
		resolve("docs/desktop-delivery/evidence/D01-browser.json"),
		JSON.stringify({ fixture, checks }, null, 2),
	);
}
