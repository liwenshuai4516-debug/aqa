// Reproduce the desktop workspace mismatch, then verify app registration via real UI reload.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { portUp } from "./lib/port-utils.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
import { enableUiTesting } from "../scripts/enable-ui-testing.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "ui-testing-visibility-test");
const temporary = await mkdtemp(join(tmpdir(), "ui-testing-visibility-"));
const workspace = join(temporary, "different-workspace");
const userData = join(temporary, "desktop");
const agentDir = join(userData, "agent");
const output = join(repo, "tests/scratch/ui-workflow-visibility", String(Date.now()));
await mkdir(workspace);
await symlink(join(repo, "node_modules"), join(workspace, "node_modules"), "dir");
await mkdir(agentDir, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(join(agentDir, "auth.json"), "{}");
await writeFile(join(agentDir, "models.json"), '{"providers":{}}');
const port = 18975;
assert.equal(await portUp(port), false, "Isolated port must be free");
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PI_WEB_SDK: "bundled",
};
for (const key of Object.keys(env)) {
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_)/.test(key) ||
		[
			"ELECTRON_RUN_AS_NODE",
			"NODE_OPTIONS",
			"PI_WEB_TOKEN",
			"PI_WEB_DATA_DIR",
			"PI_CODING_AGENT_DIR",
			"PI_CODING_AGENT_SESSION_DIR",
			"PI_WEB_DESKTOP_URL",
		].includes(key)
	)
		delete env[key];
}
const result = { status: "FAIL", checks: [], actualModelCalls: 0, businessRequests: 0 };
let app;
let page;
const notices = [];
try {
	app = await launchNativeApp({ executablePath: electron, packaged: false, env });
	page = await app.firstWindow();
	page.on("websocket", (socket) =>
		socket.on("framereceived", ({ payload }) => {
			try {
				const message = JSON.parse(String(payload));
				if (message.type === "notice") notices.push(message.text);
			} catch {
				/* Ignore non-JSON frames. */
			}
		}),
	);
	await page.waitForSelector(".app");
	await page.reload();
	await page.waitForSelector(".app");
	const setup = page.locator(".setup-modal .modal-close");
	if (await setup.isVisible()) await setup.click();
	const input = page.locator("textarea").first();
	const command = async (text, expected) => {
		const after = notices.length;
		await input.fill(text);
		await input.press("Escape");
		await input.press("Enter");
		const deadline = Date.now() + 30_000;
		while (!notices.slice(after).some((notice) => expected.test(notice)) && Date.now() < deadline) await delay(50);
		const notice = notices.slice(after).find((notice) => expected.test(notice));
		assert.ok(notice, `No fresh response to ${text}: ${JSON.stringify(notices.slice(after))}`);
		return notice;
	};
	await input.waitFor({ state: "visible" });
	await input.fill("/ui");
	assert.equal(await page.locator(".slash-menu .slash-item").count(), 0);
	await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
	await page.locator('.settings-tab[data-tab="skills"]').click();
	assert.equal(await page.locator('.set-row-name [title="ui-testing-workflow"]').count(), 0);
	await page.screenshot({ path: join(output, "before-skills.png") });
	result.checks.push("reproduced missing UI skills and no /ui candidates in a different desktop workspace");
	await page.locator(".set-close-btn").click();
	await enableUiTesting(repo, agentDir);
	await command("/reload", /已重新加载|Reloaded extensions/);
	await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
	await page.locator('.settings-tab[data-tab="skills"]').click();
	const row = page
		.locator(".settings-modal .set-row")
		.filter({ has: page.locator('.set-row-name [title="ui-testing-workflow"]') });
	await row.waitFor();
	assert.equal(await row.getByRole("switch").getAttribute("aria-checked"), "true");
	for (const name of [
		"ui-test-workflow",
		"ui-discover-record",
		"ui-case-design",
		"ui-design-review",
		"ui-test-run",
		"ui-result-analysis",
		"ui-result-review",
		"ui-artifact-check",
	]) {
		await page.locator(`.settings-modal .set-row-name [title="${name}"]`).waitFor();
	}
	await page.screenshot({ path: join(output, "after-skills.png") });
	result.checks.push("/reload displays the named entry and eight original phase skills, enabled in desktop settings");
	const discoveryRow = () =>
		page.locator(".settings-modal .set-row").filter({
			has: page.locator('.set-row-name [title="ui-discover-record"]'),
		});
	await discoveryRow().getByRole("switch").click();
	await page.locator(".set-close-btn").click();
	await command("/reload", /已重新加载|Reloaded extensions/);
	await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
	await page.locator('.settings-tab[data-tab="skills"]').click();
	assert.equal(await discoveryRow().getByRole("switch").getAttribute("aria-checked"), "false");
	await page.locator(".set-close-btn").click();
	await input.fill("/ui-discover");
	assert.equal(await page.locator('.slash-name[title="/skill:ui-discover-record"]').count(), 0);
	await input.fill("");
	await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
	await page.locator('.settings-tab[data-tab="skills"]').click();
	await discoveryRow().getByRole("switch").click();
	await page.locator(".set-close-btn").click();
	await command("/reload", /已重新加载|Reloaded extensions/);
	await input.fill("/ui-discover");
	await page.locator('.slash-name[title="/skill:ui-discover-record"]').waitFor();
	await page.screenshot({ path: join(output, "discovery-restored.png") });
	await input.fill("");
	result.checks.push(
		"upgraded discovery skill disable/enable persists over desktop reload and gates its slash shortcut",
	);
	await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
	await page.locator('.settings-tab[data-tab="skills"]').click();
	await page.locator(".set-close-btn").click();
	await input.fill("/ui");
	const candidate = page
		.locator(".slash-item")
		.filter({ has: page.locator('.slash-name[title="/skill:ui-testing-workflow"]') });
	await candidate.waitFor();
	await page.screenshot({ path: join(output, "slash-ui.png") });
	await candidate.click();
	assert.equal(await input.inputValue(), "/skill:ui-testing-workflow ");
	result.checks.push(
		"/ui offers ui-testing-workflow and selection inserts the SDK skill shortcut without sending a model request",
	);
	result.mcpStatus = await command("/mcp", /^ui-playwright-test:/);
	await page.screenshot({ path: join(output, "mcp-status.png") });
	assert.match(result.mcpStatus, /^ui-playwright-test: connected, \d+ tools \(direct\)$/);
	result.checks.push("desktop MCP reports connected with direct tools");
	for (let round = 1; round <= 3; round++) {
		await command("/reload", /已重新加载|Reloaded extensions/);
		const status = await command("/mcp", /^ui-playwright-test:/);
		assert.match(status, /^ui-playwright-test: connected, \d+ tools \(direct\)$/);
	}
	result.checks.push("three further desktop reloads reconnect the test MCP");
	await command("/mcp reconnect ui-playwright-test", /Reconnected to MCP server "ui-playwright-test" \(connected/);
	const reconnected = await command("/mcp", /^ui-playwright-test:/);
	assert.match(reconnected, /^ui-playwright-test: connected, \d+ tools \(direct\)$/);
	result.checks.push("explicit MCP reconnect restores a connected tool catalog without running business tests");
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	try {
		await app?.close();
	} catch (error) {
		result.status = "FAIL";
		result.cleanupError = String(error);
		app?.process().kill("SIGTERM");
		process.exitCode = 1;
	}
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
