// Compare the original Web UI and the installed desktop UI against the same
// sidecar/workspace. No provider calls, bridge replacements or CSS redesign.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { transform } from "esbuild";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { launchNativeApp } from "./native-app.mjs";
import { CHROME_PATH } from "../lib/chrome.mjs";

const sourceHost = process.argv.includes("--source-host");
const prefixArg = process.argv.indexOf("--evidence-prefix");
const prefix =
	prefixArg >= 0
		? process.argv[prefixArg + 1]
		: `docs/desktop-delivery/evidence/T21-${sourceHost ? "source-host-" : ""}parity`;
assert(!existsSync(`${prefix}.json`), "Preserve previous evidence before rerunning");
const executablePath = resolve(process.argv[2]);
const fixture = mkdtempSync("/tmp/pi-parity-");
const workspaceEvidenceArg = process.argv.indexOf("--workspace-from");
const workspace = sourceHost
	? join(
			JSON.parse(
				readFileSync(
					workspaceEvidenceArg >= 0
						? process.argv[workspaceEvidenceArg + 1]
						: "docs/desktop-delivery/evidence/T21-parity.json",
					"utf8",
				),
			).fixture,
			"中文 workspace",
		)
	: join(fixture, "中文 workspace");
const userData = join(fixture, "desktop");
const agent = join(userData, "agent");
if (!sourceHost) mkdirSync(workspace);
mkdirSync(agent, { recursive: true });
writeFileSync(join(workspace, "中文 sample.txt"), "Independent parity fixture\n");
let providerRequests = 0;
const provider = createServer(async (req, res) => {
	for await (const _ of req) {
		/* consume local test input only */
	}
	providerRequests++;
	res.writeHead(400).end("No model requests in this visual test");
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
				apiKey: "local-only",
				models: [{ id: "parity", name: "Parity Fixture", contextWindow: 32000, maxTokens: 128 }],
			},
		},
	}),
);
writeFileSync(join(agent, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "local-only" } }));
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of [
	"ELECTRON_RUN_AS_NODE",
	"NODE_OPTIONS",
	"PI_WEB_DATA_DIR",
	"PI_CODING_AGENT_DIR",
	"PI_WEB_DESKTOP_URL",
	"PI_WEB_PORT",
	"DEEPSEEK_API_KEY",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
])
	delete env[key];
const result = {
	fixture,
	executablePath,
	sourceHost,
	status: "FAIL",
	checks: [],
	scenes: [],
	caveats: [
		sourceHost
			? "Original desktop TS is transformed read-only and runs the current frozen business build with bundled SDK; this isolates host presentation, not an independent rebuild of the original backend."
			: "Both hosts use the same actual packaged sidecar and frozen frontend, with separate authenticated clients; this isolates browser/desktop presentation, not every original backend behavior.",
		"Chrome and Electron Chromium versions may differ; pixel differences are reported and inspected, not treated as proof of equivalence alone.",
		"Settings screenshots crop only the actual modal; chat screenshots mask only live host metrics and time labels, and hide the caret.",
	],
};
let application, browser;
const check = (label, condition) => {
	assert(condition, label);
	result.checks.push(label);
};
async function chip(page, name) {
	const target = () =>
		page.locator(`button[data-tip="${name}"],button[title="${name}"]`).filter({ visible: true }).first();
	if (!(await target().count())) await page.locator(".plugin-topbar-more > button").click();
	await target().click();
}
async function capture(page, mode, name, modal = false) {
	await page.evaluate(() => document.fonts.ready);
	if (!modal) {
		await page.locator(".inputbox textarea").click();
		await page.keyboard.press("Escape");
		await page.evaluate(() => document.querySelector(".messages")?.scrollTo(0, 0));
		await page.waitForTimeout(3500);
	}
	await page.waitForTimeout(250);
	const selector = modal ? ".settings-modal" : ".app";
	const state = await page.evaluate((selector) => {
		const root = document.querySelector(selector);
		const css = getComputedStyle(document.documentElement);
		const body = document.querySelector(".settings-modal .modal-body");
		return {
			viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
			documentWidth: document.documentElement.scrollWidth,
			theme: localStorage.getItem("pi-web-ui:theme"),
			locale: localStorage.getItem("pi-web-ui:lang"),
			palette: Object.fromEntries(["--bg", "--text", "--accent"].map((k) => [k, css.getPropertyValue(k).trim()])),
			rect: root.getBoundingClientRect().toJSON(),
			text: (body ?? root).innerText,
			controls: [...root.querySelectorAll("input,textarea,select,button")].map((e) => ({
				tag: e.tagName,
				type: e.type,
				label: e.getAttribute("aria-label") ?? e.title ?? "",
				disabled: e.disabled,
			})),
		};
	}, selector);
	const text = state.text;
	delete state.text;
	state.textSha256 = createHash("sha256").update(text).digest("hex");
	const path = `${prefix}-${mode}-${name}.png`;
	const options = { path, animations: "disabled" };
	if (modal) await page.locator(selector).screenshot(options);
	else await page.screenshot({ ...options, mask: [page.locator(".status-host-metrics,.project-time,.session-time")] });
	result.scenes.push({ mode, name, path, state });
}
async function scenarios(page, mode, resize) {
	await page.waitForSelector(".app");
	await page.getByRole("button", { name: "Parity Fixture", exact: true }).waitFor({ timeout: 30000 });
	await chip(page, (await page.getByRole("button", { name: "Settings", exact: true }).count()) ? "Language" : "语言");
	await page.getByText("简体中文", { exact: true }).click();
	await page.getByRole("button", { name: "设置", exact: true }).waitFor();
	// Reset through the original UI so first-visit locale cannot seed different phrases.
	await page.getByRole("button", { name: "设置", exact: true }).click();
	await page.locator('.settings-tab[data-tab="quick"]').click();
	await page.getByRole("button", { name: "恢复默认短语", exact: true }).click();
	await page.keyboard.press("Escape");
	await page.locator(".settings-modal").waitFor({ state: "hidden" });
	await page.addStyleTag({ content: "* { caret-color: transparent !important; }" });
	await page.locator(".inputbox textarea").fill("相同草稿 · UTF-8 · " + "LongIdentifier".repeat(12));
	await page.locator(".inputbox textarea").blur();
	await capture(page, mode, "dark-chat");
	await page.getByRole("button", { name: "设置", exact: true }).click();
	const initialTabCount = await page.locator(".settings-tab").count();
	for (const id of ["models", "prompt", "tools", "approval-rules", "skills", "plugins", "mcp", "layout"]) {
		const tab = page.locator(`.settings-tab[data-tab="${id}"]`);
		await tab.click();
		await page.waitForFunction(
			(id) => document.querySelector(`.settings-tab[data-tab="${id}"]`)?.getAttribute("aria-current") === "true",
			id,
		);
		await capture(page, mode, `settings-${id}`, true);
	}
	await page.locator(".settings-search-input").fill("MCP");
	check(
		`${mode}: settings search filters navigation and retains MCP`,
		(await page.locator(".settings-tab").count()) < initialTabCount &&
			(await page.locator('.settings-tab[data-tab="mcp"]').count()) === 1,
	);
	await page.keyboard.press("Escape");
	await page.locator(".settings-modal").waitFor({ state: "hidden" });
	await chip(page, "主题");
	await page
		.locator(".dd-item")
		.filter({ hasText: /^白色(?:[（(]|$)/ })
		.first()
		.click();
	await page.waitForFunction(
		() => localStorage.getItem("pi-web-ui:theme") === "white" && document.getElementById("theme-stylesheet")?.sheet,
	);
	await chip(page, "语言");
	await page.getByText("English", { exact: true }).click();
	await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
	await capture(page, mode, "light-english-chat");
	await page.reload();
	await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
	check(
		`${mode}: light theme and English persist after renderer reload`,
		await page.evaluate(
			() => localStorage.getItem("pi-web-ui:theme") === "white" && localStorage.getItem("pi-web-ui:lang") === "en",
		),
	);
	check(
		`${mode}: original composer draft survives reload`,
		(await page.locator(".inputbox textarea").inputValue()) === "相同草稿 · UTF-8 · " + "LongIdentifier".repeat(12),
	);
	await resize(800, 640);
	await capture(page, mode, "narrow-light-chat");
	check(
		`${mode}: narrow viewport has no document horizontal overflow`,
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
	);
	await page.getByRole("button", { name: "Settings", exact: true }).click();
	await page.locator('.settings-tab[data-tab="layout"]').click();
	await capture(page, mode, "narrow-settings-layout", true);
	check(
		`${mode}: narrow settings stay inside the viewport`,
		await page.locator(".settings-modal").evaluate((e) => {
			const r = e.getBoundingClientRect();
			return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1;
		}),
	);
	await page.keyboard.press("Escape");
	await resize(1280, 860);
}
try {
	if (sourceHost) {
		const directory = resolve("dist/desktop-parity-source");
		mkdirSync(directory, { recursive: true });
		const source = "/Users/liyingjun/Desktop/SW-QA/pi-web-ui-main/desktop";
		result.sourceHashes = {};
		for (const name of readdirSync(source)) {
			if (!/\.(ts|cts)$/.test(name) || name.endsWith(".d.ts")) continue;
			const text = readFileSync(join(source, name), "utf8");
			result.sourceHashes[name] = createHash("sha256").update(text).digest("hex");
			const { code } = await transform(text, {
				loader: "ts",
				format: name.endsWith(".cts") ? "cjs" : "esm",
				target: "node24",
			});
			writeFileSync(join(directory, name.replace(/\.cts$/, ".cjs").replace(/\.ts$/, ".js")), code);
		}
		const harness = join(directory, "harness.mjs");
		writeFileSync(
			harness,
			`import {app, BrowserWindow} from 'electron'; app.setPath('userData', ${JSON.stringify(userData)}); app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', () => console.log('[parity] original window loaded'))); await import('./main.js');`,
		);
		application = await launchNativeApp({
			executablePath,
			packaged: false,
			mainPath: harness,
			readyMarker: "[parity] original window loaded",
			env: {
				...env,
				PI_CODING_AGENT_DIR: agent,
				PI_WEB_DATA_DIR: join(userData, "data"),
				PI_WEB_SDK: "bundled",
				PI_WEB_TOKEN: randomUUID(),
			},
		});
	} else application = await launchNativeApp({ executablePath, packaged: true, env });
	const desktop = await application.firstWindow();
	await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 860));
	await desktop.waitForSelector(".app");
	const initial = await desktop.evaluate(() => ({
		width: innerWidth,
		height: innerHeight,
		dpr: devicePixelRatio,
		userAgent: navigator.userAgent,
	}));
	result.desktop = initial;
	const origin = new URL(desktop.url()).origin;
	const cookies = await application.evaluate(
		async ({ BrowserWindow }, url) => BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({ url }),
		origin,
	);
	const token = cookies.find((c) => c.name === "pi_web_token")?.value;
	assert(token, "Actual sidecar auth cookie required");
	await scenarios(desktop, "desktop", (width, height) =>
		application.evaluate(
			({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
			[width, height],
		),
	);
	browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true, args: ["--no-sandbox"] });
	result.chromeVersion = browser.version();
	const context = await browser.newContext({
		viewport: { width: 1280, height: 860 },
		deviceScaleFactor: initial.dpr,
		locale: "zh-CN",
	});
	await context.addCookies([{ name: "pi_web_token", value: token, url: origin, httpOnly: true, sameSite: "Lax" }]);
	const web = await context.newPage();
	await web.goto(origin);
	await scenarios(web, "web", (width, height) => web.setViewportSize({ width, height }));
	for (const scene of result.scenes.filter((s) => s.mode === "desktop")) {
		const other = result.scenes.find((s) => s.mode === "web" && s.name === scene.name);
		check(
			`${scene.name}: same viewport, theme, language and palette`,
			JSON.stringify({
				viewport: scene.state.viewport,
				theme: scene.state.theme,
				locale: scene.state.locale,
				palette: scene.state.palette,
			}) ===
				JSON.stringify({
					viewport: other.state.viewport,
					theme: other.state.theme,
					locale: other.state.locale,
					palette: other.state.palette,
				}),
		);
		if (scene.name.startsWith("settings-"))
			check(`${scene.name}: same visible settings content`, scene.state.textSha256 === other.state.textSha256);
	}
	check("No model requests were issued", providerRequests === 0);
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	await browser?.close().catch(() => {});
	await application?.close().catch(() => {});
	provider.closeAllConnections();
	await new Promise((r) => provider.close(r));
	result.providerRequests = providerRequests;
	writeFileSync(`${prefix}.json`, JSON.stringify(result, null, 2));
	console.log(
		JSON.stringify({
			status: result.status,
			error: result.error,
			scenes: result.scenes.length,
			checks: result.checks.length,
			fixture,
		}),
	);
}
