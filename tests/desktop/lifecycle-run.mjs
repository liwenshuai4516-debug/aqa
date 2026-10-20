import { _electron } from "playwright-core";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
const fixture = mkdtempSync(join(tmpdir(), "pi-desktop-lifecycle-"));
const workspace = join(fixture, "中文 project");
mkdirSync(workspace);
const userData = join(fixture, "desktop");
mkdirSync(userData);
const evidence = resolve("docs/desktop-delivery/evidence");
const results = [];
const record = results.push.bind(results);
results.push = (...entries) => {
	console.log(
		entries.map((entry) => `${entry.id ?? "test"}: ${entry.status} ${entry.check ?? entry.error}`).join("\n"),
	);
	return record(...entries);
};
const executablePath =
	process.env.PI_DESKTOP_TEST_EXECUTABLE || resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const packaged = !!process.env.PI_DESKTOP_TEST_EXECUTABLE;
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = String(reservation.address().port);
await new Promise((resolve) => reservation.close(resolve));
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: port,
	PI_WEB_PLUGIN_CATALOG_URL: "off",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.PI_WEB_DATA_DIR;
delete env.PI_CODING_AGENT_DIR;
delete env.PI_WEB_DESKTOP_URL;
async function launch() {
	const application = await _electron.launch({
		...(packaged ? { executablePath } : {}),
		args: packaged
			? ["-r", resolve("node_modules/playwright-core/lib/server/electron/loader.js")]
			: [resolve("dist/desktop/main.js")],
		env,
		timeout: 60000,
	});
	application.process().stderr.on("data", (chunk) => {
		const text = chunk.toString();
		if (text.includes("[desktop]") || text.includes("preload")) process.stderr.write(text);
	});
	let page;
	try {
		page = await application.firstWindow({ timeout: 30000 });
	} catch (error) {
		console.log(
			"Window discovery diagnostics",
			await application.evaluate(({ BrowserWindow, app }) => ({
				ready: app.isReady(),
				windows: BrowserWindow.getAllWindows().map((window) => ({
					id: window.id,
					visible: window.isVisible(),
					loading: window.webContents.isLoading(),
					url: window.webContents.getURL().replace(/token=[^&#]*/g, "token=REDACTED"),
				})),
			})),
		);
		console.log(
			"Automation pages",
			application
				.context()
				.pages()
				.map((page) => page.url().replace(/token=[^&#]*/g, "token=REDACTED")),
		);
		await application.close().catch(() => {});
		throw error;
	}
	await page.waitForSelector(".app", { timeout: 60000 });
	await page.waitForFunction(() => window.piDesktop?.isDesktop === true);
	await page.waitForLoadState("networkidle", { timeout: 15000 });
	const origin = new URL(page.url()).origin;
	return { application, page, origin };
}
async function until(check, timeout = 10000) {
	const end = Date.now() + timeout;
	do {
		try {
			if (await check()) return;
		} catch {
			/* Renderer may be navigating during recovery. */
		}
		await new Promise((r) => setTimeout(r, 100));
	} while (Date.now() < end);
	throw new Error("condition timeout");
}
function childPid(application) {
	const output = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
	const row = output.split("\n").find((line) => {
		const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
		return match && Number(match[2]) === application.process().pid && match[3].includes("sidecar.js");
	});
	assert(row, "sidecar is a child owned by app");
	return Number(row.trim().split(/\s+/)[0]);
}
function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
let run;
let blocker;
try {
	run = await launch();
	const pid = childPid(run.application);
	const prefs = await run.application.evaluate(({ BrowserWindow }) =>
		BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
	);
	assert.equal(prefs.sandbox, true);
	assert.equal(prefs.contextIsolation, true);
	assert.equal(prefs.nodeIntegration, false);
	const health = await (await fetch(run.origin + "/api/health")).json();
	assert(health.piSdkCopies.some((copy) => copy.version === "1.1.0" && copy.path.includes("node_modules")));
	assert.equal((await fetch(run.origin + "/api/themes")).status, 401);
	const cookies = await run.application.evaluate(
		async ({ BrowserWindow }, origin) =>
			BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({ url: origin }),
		run.origin,
	);
	const token = cookies.find((cookie) => cookie.name === "pi_web_token")?.value;
	assert(token);
	assert.equal(
		(await fetch(run.origin + "/api/themes", { headers: { Authorization: `Bearer ${token}` } })).status,
		200,
	);
	results.push({
		id: "T04/A13",
		status: "PASS",
		check: "real window, sandbox, private token authentication, bundled SDK",
		health,
	});
	await run.page.evaluate(() => window.piDesktop.window.minimize());
	await until(() => run.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()));
	await run.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
	await until(() => run.application.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isMinimized()));
	await run.page.evaluate(() => {
		window.__desktopFullscreen = null;
		window.piDesktop.onFullScreenChange((value) => {
			window.__desktopFullscreen = value;
		});
	});
	await run.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(true));
	await run.page.waitForFunction(() => window.__desktopFullscreen === true);
	await run.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false));
	await run.page.waitForFunction(() => window.__desktopFullscreen === false);
	results.push({
		id: "A14",
		status: "PASS",
		check: "real minimize/restore and fullscreen enter/leave, preload event delivered",
	});
	await run.page.evaluate(() => {
		localStorage.setItem("pi-web-ui:theme", "nord");
		localStorage.setItem("pi-web-ui:lang", "en");
		localStorage.setItem("pi-web-ui:left-panel-width", "319");
		localStorage.setItem("unrelated-identity", "do-not-copy");
	});
	await until(() => {
		try {
			return (
				JSON.parse(readFileSync(join(userData, "ui-preferences.json"), "utf8"))["pi-web-ui:left-panel-width"] === "319"
			);
		} catch {
			return false;
		}
	});
	const saved = JSON.parse(readFileSync(join(userData, "ui-preferences.json"), "utf8"));
	assert.equal(saved["unrelated-identity"], undefined);
	const png = await run.application.evaluate(async ({ BrowserWindow }) =>
		(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"),
	);
	writeFileSync(
		join(evidence, packaged ? "packaged-electron.png" : "desktop-electron.png"),
		Buffer.from(png, "base64"),
	);
	await run.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
	assert(alive(pid));
	await until(
		async () => await run.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length === 0),
	);
	const nextWindow = run.application.waitForEvent("window");
	await run.application.evaluate(({ app }) => app.emit("activate"));
	run.page = await nextWindow;
	await run.page.waitForSelector(".app");
	assert.equal(childPid(run.application), pid);
	await until(async () => (await run.page.evaluate(() => localStorage.getItem("pi-web-ui:lang"))) === "en");
	results.push({ id: "T05", status: "PASS", check: "close window + Dock activate recreates UI on same sidecar PID" });
	// Intercept native dialog only for controlled crash test. The real process is terminated.
	await run.application.evaluate(({ dialog }) => {
		dialog.showMessageBox = async (options) => {
			globalThis.__desktopRecoveryDialog = options;
			return { response: 0, checkboxChecked: false };
		};
	});
	process.kill(pid, "SIGKILL");
	await until(async () => {
		try {
			return childPid(run.application) !== pid;
		} catch {
			return false;
		}
	}, 20000);
	await run.page.waitForSelector(".app", { timeout: 60000 });
	await until(async () => await run.application.evaluate(() => !!globalThis.__desktopRecoveryDialog));
	await until(
		async () => (await run.page.evaluate(() => fetch("/api/themes").then((response) => response.status))) === 200,
		20000,
	);
	const recovered = childPid(run.application);
	assert.notEqual(recovered, pid);
	results.push({
		id: "T05",
		status: "PASS",
		check: "real sidecar crash shows recovery dialog and creates fresh process without replay command",
	});
	await run.application.close();
	run = null;
	await until(() => !alive(recovered));
	results.push({ id: "T05", status: "PASS", check: "graceful app quit waits for owned sidecar exit" });
	blocker = createServer((_req, res) => res.end("unrelated service"));
	blocker.listen(Number(port), "127.0.0.1");
	await once(blocker, "listening");
	run = await launch();
	assert.notEqual(new URL(run.origin).port, port);
	await until(
		async () =>
			await run.page.evaluate(
				() =>
					localStorage.getItem("pi-web-ui:theme") === "nord" &&
					localStorage.getItem("pi-web-ui:lang") === "en" &&
					localStorage.getItem("pi-web-ui:left-panel-width") === "319" &&
					localStorage.getItem("unrelated-identity") === null,
			),
	);
	assert.equal(await (await fetch("http://127.0.0.1:" + port)).text(), "unrelated service");
	results.push({
		id: "T04/A11",
		status: "PASS",
		check: "occupied port falls back; allowlisted preferences restored; identity not copied; unrelated server survives",
	});
	await run.application.close();
	run = null;
	await new Promise((r) => blocker.close(r));
	blocker = null;
	run = await launch();
	assert.equal(new URL(run.origin).port, port);
	await until(async () => (await run.page.evaluate(() => localStorage.getItem("pi-web-ui:lang"))) === "en");
	results.push({
		id: "T04/A11",
		status: "PASS",
		check: "restart after fallback returns to preferred port with preferences intact",
	});
	const allLogs = readdirSync(join(userData, "logs"))
		.map((name) => readFileSync(join(userData, "logs", name), "utf8"))
		.join("\n");
	assert(!allLogs.includes(token));
	results.push({ id: "T04", status: "PASS", check: "launch token absent from persistent logs" });
} catch (error) {
	results.push({ status: "FAIL", error: error.stack });
	throw error;
} finally {
	if (run) await run.application.close().catch(() => {});
	if (blocker) await new Promise((r) => blocker.close(r));
	writeFileSync(
		join(evidence, packaged ? "packaged-lifecycle.json" : "desktop-lifecycle.json"),
		JSON.stringify({ fixture, packaged, platform: process.platform, architecture: process.arch, results }, null, 2),
	);
	console.log(JSON.stringify(results, null, 2));
}
