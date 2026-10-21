// Actual installed app: explicit portable root, SDK session and native PTY persistence.
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
const fixture = mkdtempSync("/tmp/pi-portable-ui-");
const portableRoot = join(fixture, "中文 portable root");
const dataRoot = join(portableRoot, "data");
const workspace = join(dataRoot, "workspace");
const userData = join(dataRoot, "electron");
const agent = join(dataRoot, "agent");
const ordinaryData = join(fixture, "ordinary desktop sentinel");
mkdirSync(ordinaryData);
writeFileSync(join(ordinaryData, "sentinel.txt"), "KEEP_ORDINARY_DATA");
mkdirSync(workspace, { recursive: true });
mkdirSync(agent, { recursive: true });
const result = { fixture, executablePath, status: "FAIL", realModelRequests: 0, checks: [] };
let localRequests = 0;
const provider = createServer(async (req, res) => {
	for await (const _ of req) {
	}
	localRequests++;
	const text = localRequests === 1 ? "PORTABLE_UI_REPLY" : null;
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
	PI_DESKTOP_USER_DATA: ordinaryData,
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
			"PI_WEB_CWD",
			"PI_PORTABLE",
			"PI_PORTABLE_ROOT",
			"PORTABLE_EXECUTABLE_DIR",
			"PI_PORTABLE_DATA_DIR",
			"PI_PORTABLE_HOME",
			"NPM_CONFIG_PREFIX",
			"NPM_CONFIG_CACHE",
			"GIT_CONFIG_GLOBAL",
		].includes(key)
	)
		delete env[key];
env.PI_PORTABLE_ROOT = portableRoot;
env.PI_PORTABLE_HOME = join(dataRoot, "home");
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
try {
	await launch();
	const info = await app.evaluate(({ app }) => ({
		userData: app.getPath("userData"),
		sessionData: app.getPath("sessionData"),
		web: process.env.PI_WEB_DATA_DIR,
		agent: process.env.PI_CODING_AGENT_DIR,
		workspace: process.env.PI_WEB_CWD,
		portable: process.env.PI_PORTABLE,
		home: process.env.PI_PORTABLE_HOME,
	}));
	result.paths = info;
	check("Installed app activates original portable branch", info.portable === "1");
	check(
		"Electron userData and sessionData use portable root",
		info.userData === userData && info.sessionData === join(userData, "session"),
	);
	check(
		"Original business, SDK and workspace paths stay under portable data",
		info.web === join(dataRoot, "web") && info.agent === agent && info.workspace === workspace,
	);
	await send({ type: "set_model", modelId: "fixture/plan" });
	await until(() => page.evaluate(() => window.__sessionMessages.some((m) => m.state?.model?.id === "plan")));
	await prompt("便携会话重启验证", "PORTABLE_UI_REPLY");
	await until(() => containing("PORTABLE_UI_REPLY").length === 1);
	const transcript = containing("PORTABLE_UI_REPLY")[0];
	check("Bundled SDK persists real reply under portable agent directory", transcript.startsWith(agent));
	await send({ type: "terminal_create", terminalId: "portable-pty", cwd: workspace, cols: 80, rows: 24 });
	await until(() =>
		page.evaluate(() =>
			window.__sessionMessages.some((m) => m.type === "terminal_output" && m.terminalId === "portable-pty"),
		),
	);
	await send({
		type: "terminal_input",
		terminalId: "portable-pty",
		data: "printf '%s' 'PORTABLE_PTY_OK' > portable-proof.txt\r",
	});
	await until(
		() =>
			existsSync(join(workspace, "portable-proof.txt")) &&
			readFileSync(join(workspace, "portable-proof.txt"), "utf8") === "PORTABLE_PTY_OK",
	);
	check("Actual packaged PTY writes exact file inside portable workspace", true);
	await send({ type: "terminal_kill", terminalId: "portable-pty" });
	await until(() =>
		page.evaluate(() =>
			window.__sessionMessages.some((m) => m.type === "terminal_exit" && m.terminalId === "portable-pty"),
		),
	);
	check("Portable PTY closes through original terminal protocol", true);
	await page.evaluate(() => localStorage.setItem("pi-web-ui:theme", "nord"));
	await app.close();
	app = null;
	check(
		"Portable shutdown persists desktop preferences under portable userData",
		JSON.parse(readFileSync(join(userData, "ui-preferences.json"), "utf8"))["pi-web-ui:theme"] === "nord",
	);
	await launch();
	check(
		"Portable desktop preferences restore after full application restart",
		(await page.evaluate(() => localStorage.getItem("pi-web-ui:theme"))) === "nord",
	);
	await page.locator(".panel-sessions").getByTitle(transcript, { exact: true }).click();
	await until(async () => (await page.locator(".messages").innerText()).includes("PORTABLE_UI_REPLY"));
	check("Original history restores portable session after full application restart", true);
	check(
		"Portable workspace file remains byte exact",
		readFileSync(join(workspace, "portable-proof.txt"), "utf8") === "PORTABLE_PTY_OK",
	);
	check(
		"Portable mode leaves ordinary explicit userData untouched",
		readdirSync(ordinaryData).length === 1 &&
			readFileSync(join(ordinaryData, "sentinel.txt"), "utf8") === "KEEP_ORDINARY_DATA",
	);
	check("History restore and restart produce no extra local provider request", localRequests === 1);
	await page.screenshot({ path: output.replace(/\.json$/, "-restored.png") });
	result.transcript = transcript;
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
	console.log(JSON.stringify(result, null, 2));
}
