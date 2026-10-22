import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";

const fixture = mkdtempSync(join(tmpdir(), "pi-artifact-install-"));
const checks = [];
const mount = join(fixture, "mount");
mkdirSync(mount);
for (const format of ["dmg", "zip"]) {
	const destination = join(fixture, format + " 中文 installation");
	mkdirSync(destination);
	const artifact = resolve(`release/Pi-Agent-Desktop-0.109.0-arm64.${format}`);
	let application;
	try {
		if (format === "dmg") {
			execFileSync("hdiutil", ["attach", artifact, "-readonly", "-nobrowse", "-mountpoint", mount], { stdio: "pipe" });
			try {
				execFileSync("cp", ["-cR", join(mount, "Pi Agent Desktop.app"), destination]);
			} finally {
				execFileSync("hdiutil", ["detach", mount], { stdio: "pipe" });
			}
		} else {
			execFileSync("ditto", ["-x", "-k", artifact, destination]);
		}
		const bundle = join(destination, "Pi Agent Desktop.app");
		for (const path of [
			"dist/desktop/main.js",
			"dist/server/agent/agent-service-daemon.js",
			"dist/server/agent/agent-service.js",
		])
			assert.equal(readFileSync(join(bundle, "Contents/Resources/app", path), "utf8"), readFileSync(path, "utf8"));
		const reservation = createServer().listen(0, "127.0.0.1");
		await once(reservation, "listening");
		const port = reservation.address().port;
		await new Promise((r) => reservation.close(r));
		assert(port >= 8900);
		const workspace = join(fixture, format + " 中文 workspace");
		mkdirSync(workspace);
		const env = {
			...process.env,
			PI_DESKTOP_USER_DATA: join(fixture, format + "-data"),
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
		application = await launchNativeApp({
			executablePath: join(bundle, "Contents/MacOS/Pi Agent Desktop"),
			packaged: true,
			env,
		});
		const page = await application.firstWindow();
		await page.waitForSelector(".app");
		await page.waitForLoadState("networkidle");
		const info = await application.evaluate(({ app, BrowserWindow }) => ({
			packaged: app.isPackaged,
			appPath: app.getAppPath(),
			loaded: BrowserWindow.getAllWindows()[0].webContents.getURL().startsWith("http://127.0.0.1:"),
		}));
		assert(info.packaged && info.loaded && info.appPath.startsWith(destination.replace(/^\/var\//, "/private/var/")));
		const health = await page.evaluate(async () => (await fetch("/api/health")).status);
		assert.equal(health, 200);
		await application.close();
		application = null;
		checks.push({
			format,
			status: "PASS",
			artifact,
			destination,
			currentCompiledMain: true,
			mountedDmgDetachedBeforeLaunch: format === "dmg",
			info,
			health,
			cleanQuit: true,
		});
	} catch (error) {
		checks.push({ format, status: "FAIL", error: error.stack });
		process.exitCode = 1;
	} finally {
		if (application) await application.close().catch(() => application.process().kill("SIGTERM"));
	}
	console.log(format, checks.at(-1).status);
}
writeFileSync(
	process.argv[2] ?? "docs/desktop-delivery/evidence/T13-installed-artifacts.json",
	JSON.stringify(
		{
			fixture,
			checks,
			limitation:
				"same macOS user, no quarantine/download or clean-account Gatekeeper validation; no signing or upgrade test",
		},
		null,
		2,
	),
);
