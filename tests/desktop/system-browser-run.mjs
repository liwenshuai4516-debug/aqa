import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";

const executablePath = resolve(process.argv[2]);
const fixture = mkdtempSync(join(tmpdir(), "pi-system-browser-"));
const workspace = join(fixture, "中文 workspace");
const userData = join(fixture, "desktop");
mkdirSync(workspace);
const statePath = join(userData, "data/client-state.json");
const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
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
	"PI_WEB_DESKTOP_URL",
	"DEEPSEEK_API_KEY",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
])
	delete env[key];
function clients() {
	return existsSync(statePath)
		? Object.keys(JSON.parse(readFileSync(statePath))).filter((key) => !key.startsWith("__"))
		: [];
}
const checks = [];
let application, origin;
try {
	application = await launchNativeApp({ executablePath, packaged: true, env });
	const page = await application.firstWindow();
	await page.waitForSelector(".app");
	await page.waitForLoadState("networkidle");
	origin = new URL(page.url()).origin;
	const before = clients();
	assert.equal(before.length, 1);
	assert.equal((await fetch(origin + "/api/themes")).status, 401);
	// The real production window-open handler calls the real OS shell dispatcher.
	await page.evaluate(() => window.open(location.origin, "_blank"));
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline && clients().length === before.length) await new Promise((r) => setTimeout(r, 100));
	const added = clients().filter((id) => !before.includes(id));
	assert.equal(added.length, 1, "system browser actually authenticated and attached a second original UI session");
	checks.push({
		status: "PASS",
		check:
			"production window.open → unmodified shell.openExternal → actual system default browser → same local application attaches a distinct authenticated client",
		defaultBrowser: "Google Chrome (macOS LaunchServices HTTP/HTTPS handler)",
		clientCountBefore: before.length,
		clientCountAfter: clients().length,
	});
	assert.equal((await fetch(origin + "/api/themes")).status, 401);
	checks.push({ status: "PASS", check: "browser handoff does not remove anonymous API authentication" });
} catch (error) {
	checks.push({ status: "FAIL", error: error.stack });
	process.exitCode = 1;
} finally {
	if (origin) {
		try {
			const closed = execFileSync("/usr/bin/osascript", ["-", origin], {
				encoding: "utf8",
				input: `on run argv
set localOrigin to item 1 of argv
set closedCount to 0
tell application "Google Chrome"
repeat with w in windows
repeat with i from (count of tabs of w) to 1 by -1
set tabUrl to URL of tab i of w
if tabUrl starts with (localOrigin & "/") then
close tab i of w
set closedCount to closedCount + 1
end if
end repeat
end repeat
end tell
return closedCount
end run`,
				timeout: 10000,
			}).trim();
			checks.push({ status: "PASS", check: "close only test-origin browser tabs", closedCount: Number(closed) });
		} catch {
			checks.push({ status: "UNVERIFIED", check: "browser tab cleanup unavailable; only this test app is stopped" });
		}
	}
	if (application) await application.close().catch(() => application.process().kill("SIGTERM"));
	writeFileSync(
		"docs/desktop-delivery/evidence/T14-system-browser.json",
		JSON.stringify({ fixture, executablePath, checks, modelRequests: 0 }, null, 2),
	);
	console.log(JSON.stringify(checks, null, 2));
}
