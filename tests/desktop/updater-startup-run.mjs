import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";

// Clone the internal package; never modify the deliverable or a user's installation.
const fixture = mkdtempSync(join(tmpdir(), "pi-updater-startup-"));
const bundle = join(fixture, "Pi Agent Desktop.app");
execFileSync("cp", ["-cR", resolve("release/mac-arm64/Pi Agent Desktop.app"), bundle]);
const root = join(bundle, "Contents/Resources/app");
assert.equal(readFileSync(join(root, "dist/desktop/main.js"), "utf8"), readFileSync("dist/desktop/main.js", "utf8"));
const executablePath = join(bundle, "Contents/MacOS/Pi Agent Desktop");
const workspace = join(fixture, "中文 workspace");
mkdirSync(workspace);
const cases = [
	["absent", null],
	["malformed", '{"url":'],
	["invalid-url", JSON.stringify({ url: "invalid" })],
	["http", JSON.stringify({ url: "http://example.invalid/releases" })],
	["credentials", JSON.stringify({ url: "https://fixture-user:fixture-password@example.invalid/releases" })],
	["upstream", JSON.stringify({ url: "https://github.com/xing-shuyin/pi-web-ui/releases" })],
];
const checks = [];
for (const [name, config] of cases) {
	if (process.env.PI_DESKTOP_UPDATE_CASE && process.env.PI_DESKTOP_UPDATE_CASE !== name) continue;
	const configPath = join(root, "desktop-update.json");
	if (config === null) rmSync(configPath, { force: true });
	else writeFileSync(configPath, config);
	const userData = join(fixture, name);
	const reservation = createServer().listen(0, "127.0.0.1");
	await once(reservation, "listening");
	const port = reservation.address().port;
	await new Promise((resolvePort) => reservation.close(resolvePort));
	assert(port >= 8900);
	const env = {
		...process.env,
		PI_DESKTOP_USER_DATA: userData,
		PI_WEB_CWD: workspace,
		PI_WEB_PORT: String(port),
		PI_WEB_PLUGIN_CATALOG_URL: "off",
		PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
	};
	for (const key of [
		"ELECTRON_RUN_AS_NODE",
		"PI_WEB_DATA_DIR",
		"PI_CODING_AGENT_DIR",
		"PI_CODING_AGENT_SESSION_DIR",
		"PI_WEB_DESKTOP_URL",
	])
		delete env[key];
	let application;
	try {
		application = await launchNativeApp({ executablePath, packaged: true, env });
		const page = await application.firstWindow();
		await page.waitForSelector(".app");
		// The original frontend may reload once after its WebSocket build-ID check.
		await page.waitForLoadState("networkidle");
		await page.waitForSelector(".app");
		const errors = await page.evaluate(async () => {
			const results = [];
			for (const operation of ["check", "download", "quitAndInstall"]) {
				try {
					await window.piDesktop.updater[operation]();
					results.push({ operation, unexpectedlySucceeded: true });
				} catch (error) {
					results.push({ operation, message: error.message });
				}
			}
			return results;
		});
		for (const result of errors) {
			assert(!result.unexpectedlySucceeded, result.operation);
			assert.match(result.message, /自动更新/);
			assert(!result.message.includes("No handler registered"));
			assert(!result.message.includes("fixture-password"));
		}
		const health = await page.evaluate(async () => (await fetch("/api/health")).status);
		assert.equal(health, 200);
		assert.equal(application.process().exitCode, null);
		await application.close();
		application = null;
		const logs = readdirSync(join(userData, "logs"))
			.map((file) => readFileSync(join(userData, "logs", file), "utf8"))
			.join("\n");
		assert(!logs.includes("fixture-password"));
		assert(!logs.includes("桌面版启动失败"));
		checks.push({ name, status: "PASS", errors, health, cleanQuit: true, configSecretAbsentFromLogs: true });
	} catch (error) {
		checks.push({ name, status: "FAIL", error: error.stack });
		process.exitCode = 1;
	} finally {
		if (application) await application.close().catch(() => application.process().kill("SIGTERM"));
	}
	console.log(name, checks.at(-1).status);
}
const result = {
	fixture,
	instrumentation:
		"native clone of current internal package (compiled main verified identical); only updater configuration varied; real preload IPC and sidecar; no updater network or provider requests",
	checks,
};
const output = process.env.PI_DESKTOP_UPDATE_EVIDENCE ?? "updater-startup.json";
assert.equal(output, output.split("/").at(-1));
writeFileSync(join("docs/desktop-delivery/evidence", output), JSON.stringify(result, null, 2));
