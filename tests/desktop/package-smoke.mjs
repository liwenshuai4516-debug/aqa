import { _electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import WebSocket from "ws";
const executablePath = resolve(
	process.argv[2] ?? "release/mac-arm64/Pi Agent Desktop.app/Contents/MacOS/Pi Agent Desktop",
);
const fixture = mkdtempSync(join(tmpdir(), "pi-packaged-smoke-"));
const workspace = join(fixture, "中文 workspace");
mkdirSync(workspace);
const result = { platform: process.platform, architecture: process.arch, fixture, executablePath, checks: [] };
const env = {
	...process.env,
	PI_WEB_CWD: workspace,
	PI_DESKTOP_USER_DATA: join(fixture, "desktop"),
	PI_WEB_PORT: "18980",
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PI_WEB_DESKTOP_URL: "https://example.invalid/never-load",
};
for (const key of ["ELECTRON_RUN_AS_NODE", "PI_WEB_DATA_DIR", "PI_CODING_AGENT_DIR"]) delete env[key];
// A packaged app must start from a directory outside the source checkout, with no Node on PATH.
if (process.platform === "darwin") env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const packageRoot =
	process.platform === "darwin"
		? resolve(dirname(executablePath), "../Resources/app")
		: join(dirname(executablePath), "resources/app");
// Install from the shipped local resources using the original CLI, without network or a global Node.
for (const plugin of ["mermaid", "run-trace"]) {
	execFileSync(
		executablePath,
		[
			join(packageRoot, "bin/pi-web-ui.mjs"),
			"install",
			join(packageRoot, "plugins", plugin),
			"--data-dir",
			join(fixture, "desktop/data"),
			"--no-build",
		],
		{
			cwd: fixture,
			env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
			stdio: "pipe",
			timeout: 60000,
		},
	);
}
const app = await _electron.launch({
	executablePath,
	args: ["-r", resolve("node_modules/playwright-core/lib/server/electron/loader.js")],
	env,
	cwd: fixture,
	timeout: 60000,
	chromiumSandbox: true,
});
let ws;
async function until(predicate, timeout = 20000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("packaged test timed out");
}
try {
	const page = await app.firstWindow({ timeout: 60000 });
	await page.waitForSelector(".app", { timeout: 60000 });
	const info = await app.evaluate(({ app, BrowserWindow }) => ({
		packaged: app.isPackaged,
		path: app.getAppPath(),
		versions: process.versions,
		preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
	}));
	assert(info.packaged);
	assert(info.path.includes("Resources") || info.path.includes("resources"));
	assert.equal(info.preferences.sandbox, true);
	assert.equal(info.preferences.contextIsolation, true);
	assert.equal(info.preferences.nodeIntegration, false);
	const origin = new URL(page.url()).origin;
	assert.equal(new URL(origin).hostname, "127.0.0.1");
	const cookies = await app.evaluate(
		async ({ BrowserWindow }, url) => BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({ url }),
		origin,
	);
	const token = cookies.find((cookie) => cookie.name === "pi_web_token")?.value;
	assert(token);
	const auth = { Authorization: `Bearer ${token}` };
	assert.equal((await fetch(origin + "/api/themes")).status, 401);
	const health = await (await fetch(origin + "/api/health")).json();
	assert(health.piSdkCopies[0].path.startsWith(info.path) && health.piSdkCopies[0].version === "1.1.0");
	result.checks.push({
		id: "T06/T08",
		status: "PASS",
		behavior:
			"Packaged app starts outside source without Node PATH; ignores arbitrary dev URL; loads bundled SDK and secure renderer",
		sdk: health.piSdkCopies.map((copy) => ({ version: copy.version, bundled: copy.path.startsWith(info.path) })),
	});
	for (const path of [
		"/api/locales",
		"/themes/nord.css",
		"/plugins/mermaid/client/vendor/mermaid.bundle.mjs",
		"/plugins/run-trace/client/vendor/vis-timeline.bundle.mjs",
	]) {
		const response = await fetch(origin + path, { headers: auth });
		assert.equal(response.status, 200, `offline resource ${path}`);
		await response.body?.cancel();
	}
	result.checks.push({
		id: "T06",
		status: "PASS",
		behavior: "Bundled themes, language catalog and vendor assets served offline",
	});
	ws = new WebSocket(origin.replace("http:", "ws:") + "/ws", { headers: auth });
	const received = [];
	let output = "";
	ws.on("message", (data) => {
		const message = JSON.parse(data);
		received.push(message);
		if (message.type === "terminal_output" && message.terminalId === "packaged-pty") output += message.data;
	});
	await once(ws, "open");
	ws.send(JSON.stringify({ type: "hello", clientId: "packaged-" + randomUUID() }));
	await until(() => received.some((message) => message.type === "snapshot"));
	ws.send(JSON.stringify({ type: "terminal_create", terminalId: "packaged-pty", cwd: workspace, cols: 80, rows: 24 }));
	await until(() => output.length > 0);
	// stty reports actual PTY dimensions; split the marker so shell input echo cannot satisfy the assertion.
	const command =
		process.platform === "win32" ? "echo PACKAGE_PTY_OK\r" : "printf 'PACKAGED_%s\\n' 'PTY_OK'; stty size\r";
	ws.send(JSON.stringify({ type: "terminal_resize", terminalId: "packaged-pty", cols: 101, rows: 37 }));
	ws.send(JSON.stringify({ type: "terminal_input", terminalId: "packaged-pty", data: command }));
	await until(
		() =>
			output.includes(process.platform === "win32" ? "PACKAGE_PTY_OK" : "PACKAGED_PTY_OK") &&
			(process.platform === "win32" || output.includes("37 101")),
	);
	result.checks.push({
		id: "A06",
		status: "PASS",
		behavior: "Actual packaged native PTY creates, executes shell command and reports resized dimensions",
		output: output.slice(-1500),
	});
	ws.send(JSON.stringify({ type: "terminal_kill", terminalId: "packaged-pty" }));
	await until(() =>
		received.some((message) => message.type === "terminal_exit" && message.terminalId === "packaged-pty"),
	);
	result.checks.push({ id: "A06", status: "PASS", behavior: "Actual PTY close delivers exit event" });
	const png = await app.evaluate(async ({ BrowserWindow }) =>
		(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"),
	);
	writeFileSync(resolve("docs/desktop-delivery/evidence/packaged-smoke.png"), Buffer.from(png, "base64"));
	result.runtime = info.versions;
} catch (error) {
	result.checks.push({ status: "FAIL", error: error.stack });
	throw error;
} finally {
	ws?.close();
	await app.close();
	writeFileSync(resolve("docs/desktop-delivery/evidence/packaged-smoke.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
