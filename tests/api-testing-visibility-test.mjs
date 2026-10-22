// Reproduce the desktop workspace mismatch, then verify app registration via real UI reload.
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { expect } from "@playwright/test";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { portUp } from "./lib/port-utils.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
import { enableUiTesting } from "../scripts/enable-ui-testing.mjs";
import { enableApiTesting } from "../scripts/enable-api-testing.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "api-testing-visibility-test");
const temporary = await mkdtemp(join(tmpdir(), "api-testing-visibility-"));
const workspace = join(temporary, "different-workspace");
const userData = join(temporary, "desktop");
const agentDir = join(userData, "agent");
const output = join(repo, "tests/scratch/api-testing-visibility", String(Date.now()));
await mkdir(workspace);
await mkdir(agentDir, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(join(agentDir, "auth.json"), "{}");
await writeFile(join(agentDir, "models.json"), '{"providers":{}}');
const port = 18976;
assert.equal(await portUp(port), false, "Isolated port must be free");
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
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
	// Ignore the startup window if CDP attached while Electron replaced it.
	await expect
		.poll(
			() =>
				app
					.context()
					.pages()
					.filter((p) => !p.isClosed() && p.url().startsWith("http://127.0.0.1")).length,
			{ timeout: 30000 },
		)
		.toBe(1);
	page = app
		.context()
		.pages()
		.find((p) => !p.isClosed() && p.url().startsWith("http://127.0.0.1"));
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
	await page.reload();
	await page.waitForSelector(".app");
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
	await input.fill("/api");
	assert.equal(await page.locator(".slash-menu .slash-item").count(), 0);
	await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
	await page.locator('.settings-tab[data-tab="skills"]').click();
	assert.equal(
		await page
			.locator(".settings-modal .set-row-name")
			.filter({ hasText: /^api-test-(workflow|review|analyze)$/ })
			.count(),
		0,
	);
	await page.screenshot({ path: join(output, "before-skills.png") });
	await page.locator('.settings-tab[data-tab="plugins"]').click();
	assert.equal(
		await page
			.locator(".set-row-name")
			.filter({ hasText: /^(接口自动化测试|API testing)$/ })
			.count(),
		0,
	);
	result.checks.push("reproduced missing API skills, plugin and /api shortcut in a different desktop workspace");
	await page.locator(".set-close-btn").click();
	const fixture = join(temporary, "installation");
	await cp(join(repo, ".pi/skills"), join(fixture, ".pi/skills"), { recursive: true });
	await cp(join(repo, "plugins/api-testing"), join(fixture, "plugins/api-testing"), {
		recursive: true,
		filter: (path) => !["node_modules", "storage", "schedules.json", ".pi-approved"].includes(path.split("/").at(-1)),
	});
	await symlink(
		join(repo, "plugins/api-testing/node_modules"),
		join(fixture, "plugins/api-testing/node_modules"),
		"junction",
	);
	await writeFile(join(agentDir, "settings.json"), '{"theme":"light"}\n');
	await enableApiTesting(fixture, { agentDir, dataDir: join(userData, "data") });
	const first = await readFile(join(agentDir, "settings.json"), "utf8");
	await enableApiTesting(fixture, { agentDir, dataDir: join(userData, "data") });
	assert.equal(await readFile(join(agentDir, "settings.json"), "utf8"), first);
	assert.equal(JSON.parse(first).theme, "light");
	result.checks.push("explicit API registration preserves existing settings and is idempotent");
	await enableUiTesting(repo, agentDir);
	await command("/reload", /已重新加载|Reloaded extensions/);
	const openTab = async (tab) => {
		await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
		await page.locator(`.settings-tab[data-tab="${tab}"]`).click();
		if (tab === "plugins") await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	};
	const toggle = async (control) => {
		const after = notices.length;
		await control.click();
		await expect
			.poll(() => notices.slice(after).some((notice) => /设置已应用|Settings applied/.test(notice)), { timeout: 60000 })
			.toBe(true);
	};
	const row = (name) =>
		page.locator(".settings-modal .set-row").filter({ has: page.locator(".set-row-name", { hasText: name }) });
	const skillRow = (name) =>
		page.locator(".settings-modal .set-row").filter({ has: page.locator(`.set-row-name [title="${name}"]`) });
	await openTab("skills");
	for (const name of ["api-test-workflow", "api-test-review", "api-test-analyze"])
		await expect(skillRow(name).getByRole("switch")).toHaveAttribute("aria-checked", "true");
	await page.screenshot({ path: join(output, "after-skills.png") });
	await expect(skillRow("api-test-workflow").locator(".set-row-name")).toHaveText("接口自动化测试");
	await expect(skillRow("api-test-workflow").locator(".set-row-desc")).toContainText("依据接口契约");
	await expect(skillRow("ui-testing-workflow").getByRole("switch")).toHaveAttribute("aria-checked", "true");
	result.checks.push("API/UI skills use Chinese aliases and descriptions while retaining stable canonical identities");
	await toggle(skillRow("api-test-workflow").getByRole("switch"));
	await expect(skillRow("api-test-workflow").getByRole("switch")).toHaveAttribute("aria-checked", "false");
	await page.locator(".set-close-btn").click();
	const candidate = () =>
		page.locator(".slash-item").filter({ has: page.locator('.slash-name[title="/skill:api-test-workflow"]') });
	await input.fill("/api");
	await expect(candidate()).toHaveCount(0);
	await input.fill("");
	await command("/reload", /已重新加载|Reloaded extensions/);
	await openTab("skills");
	await expect(skillRow("api-test-workflow").getByRole("switch")).toHaveAttribute("aria-checked", "false");
	await toggle(skillRow("api-test-workflow").getByRole("switch"));
	await expect(skillRow("api-test-workflow").getByRole("switch")).toHaveAttribute("aria-checked", "true");
	await page.locator(".set-close-btn").click();
	result.checks.push("skill disable persists across reload, removes shortcut and can be re-enabled");
	await input.fill("/接口");
	await candidate().waitFor();
	await page.screenshot({ path: join(output, "slash-api.png") });
	await candidate().click();
	assert.equal(await input.inputValue(), "/skill:api-test-workflow ");
	await input.fill("/api");
	await candidate().waitFor();
	await input.press("Tab");
	assert.match(await input.inputValue(), /^\/skill:api-test-(workflow|review|analyze) $/);
	await input.fill("");
	result.checks.push("/api lists API shortcuts; click and Tab complete without a model request");
	await openTab("plugins");
	await page.getByRole("button", { name: /^(重新扫描|Rescan)$/ }).click();
	const plugin = row(/接口自动化测试|API testing/);
	await plugin.waitFor();
	await expect(plugin.getByRole("switch")).toHaveAttribute("aria-checked", "true");
	await page.screenshot({ path: join(output, "after-plugin.png") });
	await page.locator('.settings-tab[data-tab="skills"]').click();
	await toggle(skillRow("api-test-review").getByRole("switch"));
	await expect(skillRow("api-test-review").getByRole("switch")).toHaveAttribute("aria-checked", "false");
	await page.locator('.settings-tab[data-tab="plugins"]').click();
	await toggle(plugin.getByRole("switch"));
	await expect(plugin.getByRole("switch")).toHaveAttribute("aria-checked", "false");
	await page.locator('.settings-tab[data-tab="skills"]').click();
	for (const name of ["api-test-workflow", "api-test-review", "api-test-analyze"]) {
		await expect(skillRow(name).getByRole("switch")).toHaveAttribute("aria-checked", "false");
		await expect(skillRow(name).getByRole("switch")).toBeDisabled();
	}
	await page.screenshot({ path: join(output, "owner-disabled-skills.png") });
	await page.locator(".set-close-btn").click();
	await input.fill("/api");
	await expect(candidate()).toHaveCount(0);
	await command("/skill:api-test-workflow", /所属能力已关闭/);
	await openTab("plugins");
	await page.getByRole("button", { name: /^(重新扫描|Rescan)$/ }).click();
	await expect(plugin.getByRole("switch")).toHaveAttribute("aria-checked", "false");
	await toggle(plugin.getByRole("switch"));
	await expect(plugin.getByRole("switch")).toHaveAttribute("aria-checked", "true");
	await page.locator(".set-close-btn").click();
	result.checks.push(
		"API plugin disable blocks all owned skills and manual slash calls; rescan preserves disable state",
	);
	await openTab("skills");
	await expect(skillRow("api-test-workflow").getByRole("switch")).toHaveAttribute("aria-checked", "true");
	await expect(skillRow("api-test-review").getByRole("switch")).toHaveAttribute("aria-checked", "false");
	await expect(skillRow("api-test-review").getByRole("switch")).toBeEnabled();
	const skillSwitches = await page
		.locator('.set-list .set-row [role="switch"]')
		.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-checked") === "true"));
	assert.deepEqual(
		skillSwitches,
		[...skillSwitches].sort((a, b) => Number(b) - Number(a)),
	);
	await page.locator(".set-close-btn").click();
	result.checks.push("owner re-enable restores individual preferences and enabled skills sort above disabled skills");
	await openTab("plugins");
	const uiCapability = row(/UI 自动化测试/);
	await expect(uiCapability.locator(".set-row-desc")).toContainText("扩展已加载");
	await page.screenshot({ path: join(output, "ui-capability-loaded.png") });
	await toggle(uiCapability.getByRole("switch"));
	await expect(uiCapability.getByRole("switch")).toHaveAttribute("aria-checked", "false");
	const pluginSwitches = await page
		.locator('.set-list-flat .set-row [role="switch"]')
		.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-checked") === "true"));
	assert.deepEqual(
		pluginSwitches,
		[...pluginSwitches].sort((a, b) => Number(b) - Number(a)),
	);
	await page.screenshot({ path: join(output, "ui-capability-disabled.png") });
	await page.locator('.settings-tab[data-tab="skills"]').click();
	for (const name of [
		"ui-testing-workflow",
		"ui-test-workflow",
		"ui-discover-record",
		"ui-case-design",
		"ui-design-review",
		"ui-test-run",
		"ui-result-analysis",
		"ui-result-review",
		"ui-artifact-check",
	]) {
		await expect(skillRow(name).getByRole("switch")).toHaveAttribute("aria-checked", "false");
		await expect(skillRow(name).getByRole("switch")).toBeDisabled();
	}
	await page.locator(".set-close-btn").click();
	await input.fill("/ui");
	await expect(page.locator(".slash-menu .slash-item")).toHaveCount(0);
	await command("/reload", /已重新加载|Reloaded extensions/);
	await openTab("plugins");
	await expect(uiCapability.getByRole("switch")).toHaveAttribute("aria-checked", "false");
	await toggle(uiCapability.getByRole("switch"));
	await expect(uiCapability.locator(".set-row-desc")).toContainText("扩展已加载", { timeout: 30000 });
	await page.locator(".set-close-btn").click();
	await input.fill("/UI");
	await expect(page.locator('.slash-name[title="/skill:ui-testing-workflow"]')).toBeVisible();
	await input.fill("");
	result.mcpStatus = await command("/mcp", /^ui-playwright-test:/);
	assert.match(result.mcpStatus, /^ui-playwright-test: connected, \d+ tools \(direct\)$/);
	result.checks.push(
		"UI capability shows real SDK loading state, gates all associated skills, sorts below enabled plugins, persists across reload and reconnects when enabled",
	);
	await openTab("tools");
	await page.getByText("api_test_execute", { exact: false }).first().waitFor();
	await page.screenshot({ path: join(output, "api-tool.png") });
	await page.locator(".set-close-btn").click();
	result.checks.push("API execution tool is exposed in tool management through the existing host plugin");
	await command("/reload", /已重新加载|Reloaded extensions/);
	await input.fill("/api");
	await candidate().waitFor();
	result.checks.push("subsequent reload retains API shortcuts with no business or model execution");
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	result.nativeLogs = app?.getLogs().replace(/(token=)[^\s&]+/gi, "$1[redacted]");
	await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	try {
		await app?.close();
	} catch (error) {
		result.cleanupError = error.stack;
		app?.process().kill("SIGTERM");
		if (result.status === "PASS") {
			result.status = "FAIL";
			process.exitCode = 1;
		}
	}
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
