// Actual installed app: renderer isolation, navigation and IPC sender boundaries.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";
import { waitForStablePage } from "../lib/page-stability.mjs";
const executablePath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve previous evidence");
const fixture = mkdtempSync("/tmp/pi-security-boundary-");
const workspace = join(fixture, "中文 workspace");
const userData = join(fixture, "desktop");
mkdirSync(workspace);
mkdirSync(join(userData, "agent"), { recursive: true });
writeFileSync(join(userData, "agent/auth.json"), "{}");
writeFileSync(join(userData, "agent/models.json"), "{}");
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of Object.keys(env)) {
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_|PI_PORTABLE)/.test(key) ||
		[
			"ELECTRON_RUN_AS_NODE",
			"NODE_OPTIONS",
			"PI_WEB_DATA_DIR",
			"PI_CODING_AGENT_DIR",
			"PI_CODING_AGENT_SESSION_DIR",
			"PI_WEB_DESKTOP_URL",
			"PI_WEB_PORT",
			"PORTABLE_EXECUTABLE_DIR",
		].includes(key)
	)
		delete env[key];
}
const result = {
	fixture,
	executablePath,
	status: "FAIL",
	realModelRequests: 0,
	checks: [],
	instrumentation:
		"Original installed executable and preload, isolated data. Test intercepts shell.openExternal only to record dispatch without opening external applications; creates disposable additional BrowserWindows using original preload to exercise real IPC sender rejection. No handler or policy replacement.",
};
let app, page;
function check(label, ok) {
	assert(ok, label);
	result.checks.push(label);
}
try {
	app = await launchNativeApp({ executablePath, packaged: true, env });
	page = await app.firstWindow();
	await waitForStablePage(page);
	await page.waitForSelector(".app");
	const origin = new URL(page.url()).origin;
	const renderer = await page.evaluate(() => ({
		require: typeof require,
		process: typeof process,
		ipc: typeof window.ipcRenderer,
		bridge: Object.keys(window.piDesktop).sort(),
	}));
	check(
		"Original renderer exposes no Node or general IPC access",
		renderer.require === "undefined" && renderer.process === "undefined" && renderer.ipc === "undefined",
	);
	result.renderer = renderer;
	const prefs = await app.evaluate(({ BrowserWindow }) => {
		const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
		return {
			sandbox: p.sandbox,
			contextIsolation: p.contextIsolation,
			nodeIntegration: p.nodeIntegration,
			nodeIntegrationInSubFrames: p.nodeIntegrationInSubFrames,
		};
	});
	result.webPreferences = prefs;
	check(
		"Installed window keeps sandbox and context isolation with Node disabled",
		prefs.sandbox === true &&
			prefs.contextIsolation === true &&
			prefs.nodeIntegration === false &&
			!prefs.nodeIntegrationInSubFrames,
	);
	await app.evaluate(({ shell, BrowserWindow }) => {
		globalThis.__securityMain = BrowserWindow.getAllWindows()[0];
		globalThis.__securityExternal = [];
		globalThis.__securityOriginalOpenExternal = shell.openExternal;
		shell.openExternal = async (url) => {
			globalThis.__securityExternal.push(url);
		};
	});
	for (const url of [
		"file:///tmp/pi-security-never-open",
		"data:text/html,blocked",
		"ftp://example.invalid/blocked",
		"pi-security-test://blocked",
	]) {
		await page.evaluate((u) => {
			window.open(u, "_blank");
		}, url);
	}
	await page.waitForTimeout(300);
	check(
		"Dangerous popup schemes never reach system external dispatch",
		await app.evaluate(() => globalThis.__securityExternal.length === 0),
	);
	check(
		"Blocked popups create no additional BrowserWindow",
		await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 1),
	);
	await page.evaluate(() => {
		location.href = "https://example.invalid/pi-security-external";
	});
	await page.waitForFunction(() => !!document.querySelector(".app"));
	await page.waitForTimeout(200);
	const external = await app.evaluate(() =>
		globalThis.__securityExternal.map((s) => {
			const u = new URL(s);
			return { origin: u.origin, pathname: u.pathname, hasToken: u.searchParams.has("token") };
		}),
	);
	result.externalDispatch = external;
	check(
		"Allowed external navigation is dispatched once without service token",
		external.length === 1 && external[0].origin === "https://example.invalid" && !external[0].hasToken,
	);
	check(
		"External navigation leaves original main document and service usable",
		new URL(page.url()).origin === origin &&
			(await page.evaluate(async () => (await fetch("/api/health")).status === 200)),
	);
	await page.evaluate(() => {
		const f = document.createElement("iframe");
		f.id = "security-frame";
		f.src = "/";
		document.body.append(f);
	});
	await page.waitForFunction(
		() => document.querySelector("#security-frame")?.contentDocument?.readyState === "complete",
	);
	const child = page.frames().find((f) => f.parentFrame() === page.mainFrame());
	assert(child, "Actual iframe must be attached");
	check(
		"Same-origin iframe has no desktop bridge or Node access",
		await child.evaluate(() => typeof window.piDesktop === "undefined" && typeof require === "undefined"),
	);
	await page.evaluate(() => document.querySelector("#security-frame").remove());
	// Original main accepts its own title-bar action. Foreign windows must not affect it.
	check(
		"Original main frame can invoke original window bridge",
		await page.evaluate(async () => {
			const accepted = await window.piDesktop.window.toggleMaximize();
			const restored = await window.piDesktop.window.toggleMaximize();
			return accepted === true && restored === true;
		}),
	);
	const foreign = await app.evaluate(async ({ BrowserWindow, app }) => {
		const main = globalThis.__securityMain;
		const w = new BrowserWindow({
			show: false,
			webPreferences: {
				preload: `${app.getAppPath()}/dist/desktop/preload.cjs`,
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		globalThis.__securityForeign = w;
		await w.loadURL(new URL("/api/health", main.webContents.getURL()).toString());
		return await w.webContents.executeJavaScript(
			`(async()=>({bridge:!!window.piDesktop,close:await window.piDesktop.window.close(),minimize:await window.piDesktop.window.minimize(),maximize:await window.piDesktop.window.toggleMaximize(),overlay:await window.piDesktop.setTitleBarOverlay({color:'#ffffff'})}))()`,
		);
	});
	result.foreignWindow = foreign;
	check(
		"Same-origin foreign BrowserWindow is denied original window operations",
		foreign.bridge &&
			foreign.close === false &&
			foreign.minimize === false &&
			foreign.maximize === false &&
			foreign.overlay === false,
	);
	check(
		"Rejected foreign close and minimize leave main alive and visible",
		await app.evaluate(
			() =>
				!globalThis.__securityMain.isDestroyed() &&
				globalThis.__securityMain.isVisible() &&
				!globalThis.__securityMain.isMinimized(),
		),
	);
	const foreignOtherOrigin = await app.evaluate(async () => {
		const w = globalThis.__securityForeign;
		await w.loadURL("data:text/html,<title>isolated foreign origin</title>");
		return w.webContents.executeJavaScript(
			`(async()=>({bridge:!!window.piDesktop,close:await window.piDesktop.window.close(),maximize:await window.piDesktop.window.toggleMaximize()}))()`,
		);
	});
	result.foreignOtherOrigin = foreignOtherOrigin;
	check(
		"Foreign-origin BrowserWindow with original preload is denied window operations",
		foreignOtherOrigin.bridge && foreignOtherOrigin.close === false && foreignOtherOrigin.maximize === false,
	);
	await app.evaluate(({ shell }) => {
		globalThis.__securityForeign.destroy();
		shell.openExternal = globalThis.__securityOriginalOpenExternal;
	});
	check(
		"Main service remains healthy after all rejected operations",
		await page.evaluate(async () => (await fetch("/api/health")).status === 200),
	);
	await page.screenshot({ path: output.replace(/\.json$/, "-main.png") });
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
	await page?.screenshot({ path: output.replace(/\.json$/, "-failure.png") }).catch(() => {});
} finally {
	await app?.close().catch((e) => {
		result.cleanupError = e.message;
		process.exitCode = 1;
	});
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
