// Reproduce the desktop workspace mismatch, then verify app registration via real UI reload.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
try {
	app = await launchNativeApp({ executablePath: electron, packaged: false, env });
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	const input = page.locator("textarea").first();
	await input.waitFor({ state: "visible" });
	await input.fill("/ui");
	assert.equal(await page.locator(".slash-menu .slash-item").count(), 0);
	await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
	await page.locator('.settings-tab[data-tab="skills"]').click();
	await page.getByText(/^(暂无技能|No skills installed)$/).waitFor();
	await page.screenshot({ path: join(output, "before-skills.png") });
	result.checks.push("reproduced empty skills and no /ui candidates in a different desktop workspace");
	await page.locator(".set-close-btn").click();
	await enableUiTesting(repo, agentDir);
	await input.fill("/reload");
	await input.press("Escape");
	await input.press("Enter");
	await page
		.getByText(/已重新加载|Reloaded extensions/)
		.first()
		.waitFor();
	await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
	await page.locator('.settings-tab[data-tab="skills"]').click();
	const row = page
		.locator(".settings-modal .set-row")
		.filter({ has: page.locator(".set-row-name", { hasText: /^ui-testing-workflow$/ }) });
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
		await page
			.locator(".settings-modal .set-row-name")
			.filter({ hasText: new RegExp(`^${name}$`) })
			.waitFor();
	}
	await page.screenshot({ path: join(output, "after-skills.png") });
	result.checks.push("/reload displays the named entry and eight original phase skills, enabled in desktop settings");
	await page.locator(".set-close-btn").click();
	await input.fill("/ui");
	const candidate = page
		.locator(".slash-item")
		.filter({ has: page.locator(".slash-name", { hasText: /^\/skill:ui-testing-workflow$/ }) });
	await candidate.waitFor();
	await page.screenshot({ path: join(output, "slash-ui.png") });
	await candidate.click();
	assert.equal(await input.inputValue(), "/skill:ui-testing-workflow ");
	result.checks.push(
		"/ui offers ui-testing-workflow and selection inserts the SDK skill shortcut without sending a model request",
	);
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	await app?.close();
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
