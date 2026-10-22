/** Real host/browser management acceptance, without model calls or personal configuration. */
import assert from "node:assert/strict";
import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { CHROME_PATH } from "./lib/chrome.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { createProjectEnvironment, waitUntil } from "../qa/ui/project-environment.mjs";
import { enableDataSpace } from "../scripts/enable-data-space.mjs";
const repo = fileURLToPath(new URL("../", import.meta.url));
ensureBuild(repo, "data-space-browser");
const out = join(repo, "tests/scratch/data-space-browser", String(Date.now()));
await mkdir(out, { recursive: true });
const checks = [],
	result = { status: "running", checks, actualModelCalls: 0, businessRequests: 0 };
const fixture = await createProjectEnvironment({
	prepare: async (f) => {
		await enableDataSpace(repo, { agentDir: f.agentDir, dataDir: f.dataDir });
		const first = await readFile(join(f.agentDir, "settings.json"), "utf8");
		await enableDataSpace(repo, { agentDir: f.agentDir, dataDir: f.dataDir });
		assert.equal(await readFile(join(f.agentDir, "settings.json"), "utf8"), first);
		checks.push("registration is idempotent and preserves settings");
	},
});
let browser;
try {
	browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH || undefined });
	const context = await browser.newContext();
	await context.addCookies([{ name: "pi_web_token", value: encodeURIComponent(fixture.token), url: fixture.url }]);
	const page = await context.newPage();
	const notices = [],
		errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("websocket", (s) =>
		s.on("framereceived", ({ payload }) => {
			try {
				const f = JSON.parse(String(payload));
				if (f.type === "notice") notices.push(f.text);
			} catch {}
		}),
	);
	await page.goto(fixture.url);
	await page.waitForSelector(".app");
	await page.locator(".setup-modal .modal-close").click();
	const input = page.locator("textarea").first();
	await input.waitFor({ state: "visible" });
	const command = async (text) => {
		const n = notices.length;
		await input.fill(text);
		await input.press("Escape");
		await input.press("Enter");
		await waitUntil(() => notices.slice(n).some((s) => /已重新加载|Reloaded extensions/.test(s)), text, 60000);
	};
	const settings = async (tab) => {
		await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
		await page.locator(`.settings-tab[data-tab="${tab}"]`).click();
	};
	const close = () => page.locator(".set-close-btn").click();
	const skill = () =>
		page
			.locator(".settings-modal .set-row")
			.filter({ has: page.locator('.set-row-name [title="data-space-testing"]') });
	const candidate = () =>
		page.locator(".slash-item").filter({ has: page.locator('.slash-name[title="/skill:data-space-testing"]') });
	await settings("skills");
	await skill().getByRole("switch").waitFor();
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "true");
	await page.screenshot({ path: join(out, "skills.png") });
	await close();
	await input.fill("/data");
	await candidate().waitFor();
	await input.press("Tab");
	assert.match(await input.inputValue(), /skill:data-space-testing/);
	checks.push("skill appears in settings and /data completes the real skill command");
	await input.fill("");
	await settings("skills");
	await skill().getByRole("switch").click();
	await close();
	await command("/reload");
	await input.fill("/data");
	assert.equal(await candidate().count(), 0);
	await input.fill("");
	await settings("skills");
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "false");
	await skill().getByRole("switch").click();
	await close();
	checks.push("skill disable persists after reload and can be restored");
	await settings("plugins");
	await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	const plugin = page
		.locator(".set-row")
		.filter({ has: page.locator(".set-row-name", { hasText: /数据空间|Data Space/ }) });
	await plugin.waitFor();
	await page.screenshot({ path: join(out, "plugins.png") });
	await plugin.getByRole("switch").click();
	await waitUntil(
		async () => (await plugin.getByRole("switch").getAttribute("aria-checked")) === "false",
		"disable plugin",
	);
	await close();
	await command("/reload");
	await settings("plugins");
	await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	assert.equal(await plugin.getByRole("switch").getAttribute("aria-checked"), "false");
	await plugin.getByRole("switch").click();
	await waitUntil(
		async () => (await plugin.getByRole("switch").getAttribute("aria-checked")) === "true",
		"enable plugin",
	);
	await close();
	checks.push("host plugin management supports disable, reload persistence and re-enable");
	await settings("tools");
	for (const name of ["data_space_cases", "data_space_record_result", "data_space_automation"]) {
		const row = page
			.locator(".settings-modal .set-row")
			.filter({ has: page.locator(".set-row-name", { hasText: name }) });
		await row.waitFor();
		assert.equal(await row.getByRole("switch").getAttribute("aria-checked"), "true");
	}
	const autoTool = page
		.locator(".settings-modal .set-row")
		.filter({ has: page.locator(".set-row-name", { hasText: "data_space_automation" }) });
	await autoTool.getByRole("switch").click();
	await close();
	await command("/reload");
	await settings("tools");
	assert.equal(await autoTool.getByRole("switch").getAttribute("aria-checked"), "false");
	await autoTool.getByRole("switch").click();
	await close();
	checks.push("all three plugin tools are manageable; tool disabling persists after reload");
	await page.getByRole("tab", { name: /^(数据空间|Data Space)$/ }).click();
	await page.waitForSelector(".dsp-body");
	// Existing seed cases are synthetic. Open the case library, then the new association panel.
	await page.locator('[data-act="tab"][data-tab="cases"]').first().click();
	await page.locator('[data-act="automation-open"]').first().click();
	await page.getByText("读取原生资产", { exact: true }).waitFor();
	await page.screenshot({ path: join(out, "automation.png") });
	assert.equal((await page.locator('[data-f="envId"] option').count()) > 1, true);
	checks.push("case automation association UI loads with project-scoped environments");
	await page.locator('[data-f="assetText"]').fill('{"path":"invalid","sha256":"x"}');
	await page.locator('[data-act="automation-inspect"]').click();
	await waitUntil(
		async () =>
			(await page.locator('.dsp-modal [role="status"]').textContent()).includes("Invalid UI artifact reference"),
		"invalid asset rejected",
	);
	checks.push("invalid native asset is visibly rejected without saving an association");
	await page.locator('[data-act="close-modal"]').click();
	await page.reload();
	await page.waitForSelector(".app");
	assert.deepEqual(errors, []);
	checks.push("refresh keeps native UI stable without browser errors");
	result.status = "PASS";
} catch (error) {
	result.status = "FAIL";
	result.error = error.stack;
	throw error;
} finally {
	if (browser) await browser.close();
	result.cleanup = await fixture.dispose();
	await writeFile(join(out, "summary.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ out, ...result }));
}
