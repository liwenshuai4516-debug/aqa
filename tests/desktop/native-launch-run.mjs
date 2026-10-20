import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const executable = resolve(process.argv[2] ?? "release/mac-arm64/Pi Agent Desktop.app/Contents/MacOS/Pi Agent Desktop");
const fixture = mkdtempSync(join(tmpdir(), "pi-native-launch-"));
const workspace = join(fixture, "中文 workspace");
mkdirSync(workspace);
const checks = [];
async function freePort() {
	const s = createServer();
	s.listen(0, "127.0.0.1");
	await once(s, "listening");
	const port = s.address().port;
	await new Promise((r) => s.close(r));
	return port;
}
const port = await freePort();
for (let iteration = 1; iteration <= 3; iteration++) {
	const debugPort = await freePort();
	let child, browser;
	let blocker;
	let logs = "";
	try {
		if (iteration === 2) {
			blocker = createServer();
			blocker.listen(port, "127.0.0.1");
			await once(blocker, "listening");
		}
		const env = {
			...process.env,
			PI_DESKTOP_USER_DATA: join(fixture, "desktop"),
			PI_WEB_CWD: workspace,
			PI_WEB_PORT: String(port),
			PI_WEB_PLUGIN_CATALOG_URL: "off",
			PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
		};
		for (const key of [
			"ELECTRON_RUN_AS_NODE",
			"NODE_OPTIONS",
			"PI_WEB_DATA_DIR",
			"PI_CODING_AGENT_DIR",
			"PI_WEB_DESKTOP_URL",
		])
			delete env[key];
		child = spawn(executable, [`--remote-debugging-port=${debugPort}`], {
			cwd: fixture,
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.stdout.on("data", (d) => (logs += d));
		child.stderr.on("data", (d) => (logs += d));
		const deadline = Date.now() + 60000;
		let endpoint;
		while (Date.now() < deadline) {
			try {
				const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
				if (r.ok) {
					endpoint = (await r.json()).webSocketDebuggerUrl;
					break;
				}
			} catch {}
			if (child.exitCode !== null) throw new Error("native app exited before window");
			await new Promise((r) => setTimeout(r, 100));
		}
		assert(endpoint, "native debugging endpoint ready");
		while (!logs.includes("[desktop] window loaded") && Date.now() < deadline) {
			if (child.exitCode !== null) throw new Error("native app exited before page load");
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert(logs.includes("[desktop] window loaded"), "native page loads before automation attaches");
		browser = await chromium.connectOverCDP(endpoint);
		let page;
		while (Date.now() < deadline) {
			page = browser.contexts().flatMap((context) => context.pages())[0];
			if (page) break;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		assert(page, "existing native application window discovered");
		await page.waitForSelector(".app", { timeout: 45000 });
		await page.waitForFunction(() => window.piDesktop?.isDesktop === true);
		if (iteration === 2) assert.notEqual(new URL(page.url()).port, String(port));
		else assert.equal(new URL(page.url()).port, String(port));
		if (iteration === 1) {
			await page.evaluate(() => {
				localStorage.setItem("pi-web-ui:theme", "nord");
				localStorage.setItem("pi-web-ui:lang", "en");
			});
		} else {
			assert.deepEqual(
				await page.evaluate(() => [localStorage.getItem("pi-web-ui:theme"), localStorage.getItem("pi-web-ui:lang")]),
				["nord", "en"],
			);
		}
		await page.screenshot({ path: resolve(`docs/desktop-delivery/evidence/native-launch-${iteration}.png`) });
		const session = await browser.newBrowserCDPSession();
		const exited = once(child, "exit");
		void session.send("Browser.close").catch(() => {});
		await Promise.race([
			exited,
			new Promise((_, reject) => setTimeout(() => reject(new Error("native menu quit timeout")), 15000)),
		]);
		assert.equal(child.exitCode, 0);
		checks.push({
			iteration,
			status: "PASS",
			check:
				"Packaged executable launched without Playwright Electron loader, no Node PATH, Chinese workspace; real window renders; browser close protocol exits normally",
			portConflict: iteration === 2,
			preferencesRestored: iteration > 1,
		});
	} catch (error) {
		checks.push({
			iteration,
			status: "FAIL",
			error: error.stack,
			logs: logs.replace(/token=[^\s&#]+/g, "token=REDACTED"),
		});
		throw error;
	} finally {
		await browser?.close().catch(() => {});
		if (child && child.exitCode === null) child.kill("SIGTERM");
		if (blocker) await new Promise((resolve) => blocker.close(resolve));
		writeFileSync(
			resolve("docs/desktop-delivery/evidence/native-launch.json"),
			JSON.stringify({ fixture, checks }, null, 2),
		);
	}
}
console.log(JSON.stringify(checks, null, 2));
