// Actual package UI and SDK discovery, isolated local skill, no model credentials.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";
import { waitForStablePage } from "../lib/page-stability.mjs";

const executablePath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve evidence");
const fixture = mkdtempSync("/tmp/pi-preset-skill-");
const userData = join(fixture, "desktop");
const workspace = join(fixture, "中文 workspace");
const agent = join(userData, "agent");
const skillDir = join(agent, "skills", "desktop-proof");
mkdirSync(workspace);
mkdirSync(skillDir, { recursive: true });
const skillPath = join(skillDir, "SKILL.md");
const skillBytes = Buffer.from(
	"---\nname: desktop-proof\ndescription: Local desktop acceptance fixture.\n---\nOnly inspect the independent test workspace.\n",
);
writeFileSync(skillPath, skillBytes);
writeFileSync(join(agent, "auth.json"), "{}");
writeFileSync(join(agent, "models.json"), '{"providers":{}}');
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of Object.keys(env))
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_)/.test(key) ||
		[
			"ELECTRON_RUN_AS_NODE",
			"NODE_OPTIONS",
			"PI_WEB_DATA_DIR",
			"PI_CODING_AGENT_DIR",
			"PI_CODING_AGENT_SESSION_DIR",
			"PI_WEB_DESKTOP_URL",
			"PI_WEB_PORT",
		].includes(key)
	)
		delete env[key];
const result = { fixture, executablePath, status: "FAIL", checks: [], realModelRequests: 0 };
let app, page;
const check = (text, ok) => {
	assert(ok, text);
	result.checks.push(text);
};
async function launch() {
	app = await launchNativeApp({ executablePath, packaged: true, env });
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	assert(await waitForStablePage(page));
	await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
	await page.waitForSelector(".settings-modal");
}
const tab = (name) => page.locator(`.settings-tab[data-tab="${name}"]`).click();
const skillRow = () =>
	page.locator(".settings-modal .set-row").filter({ has: page.locator(".set-row-name", { hasText: "desktop-proof" }) });
const presetRow = () =>
	page.locator(".settings-modal .set-row").filter({ has: page.locator(".set-row-name", { hasText: "中文恢复预设" }) });
async function skillState(enabled) {
	await skillRow().getByRole("switch").waitFor();
	await page.waitForFunction(
		({ enabled }) => {
			const row = [...document.querySelectorAll(".settings-modal .set-row")].find(
				(r) => r.querySelector(".set-row-name")?.textContent === "desktop-proof",
			);
			return row?.querySelector('[role="switch"]')?.getAttribute("aria-checked") === String(enabled);
		},
		{ enabled },
	);
}
try {
	await launch();
	await tab("skills");
	await skillState(true);
	check("Packaged SDK discovers local skill and settings displays enabled state", await skillRow().isVisible());
	await skillRow().getByRole("switch").click();
	await skillState(false);
	check("Original skill switch disables discovered skill", true);
	await skillRow().locator(".tpl-chip").click();
	await page.waitForFunction(() =>
		[...document.querySelectorAll(".settings-modal .set-row")]
			.find((r) => r.querySelector(".set-row-name")?.textContent === "desktop-proof")
			?.querySelector(".tpl-chip")
			?.classList.contains("on"),
	);
	check("Original full-text skill option can be enabled", true);
	await tab("presets");
	const save = page.locator(".set-preset-save .set-save-btn");
	check("Empty preset name cannot be saved", await save.isDisabled());
	await page.locator(".set-preset-save input").fill("中文恢复预设");
	await save.click();
	await presetRow().waitFor();
	check("Chinese preset saved through original UI", await presetRow().isVisible());
	await tab("skills");
	await skillRow().getByRole("switch").click();
	await skillState(true);
	await tab("presets");
	await presetRow().locator(".set-uninstall").click();
	await tab("skills");
	await skillState(false);
	check("Applying saved preset restores disabled skill", true);
	await app.close();
	app = null;
	await launch();
	await tab("skills");
	await skillState(false);
	check("Skill disabled state survives full application quit and relaunch", true);
	check(
		"Full-text preference survives full application relaunch",
		(await skillRow().locator(".tpl-chip.on").count()) === 1,
	);
	await tab("presets");
	await presetRow().waitFor();
	check("Named preset survives full application relaunch", true);
	await page.screenshot({ path: output.replace(/\.json$/, "-presets.png") });
	await presetRow().locator(".set-icon-btn.danger").click();
	await presetRow().waitFor({ state: "detached" });
	check("Preset deletion removes original UI entry", true);
	await app.close();
	app = null;
	const stored = JSON.parse(readFileSync(join(userData, "data", "client-state.json"), "utf8"));
	const values = Object.values(stored);
	check(
		"Persisted original configuration retains disabled skill and deletes preset",
		values.some(
			(v) =>
				v.settings?.disabledSkills?.includes("desktop-proof") && v.settings?.skillsFullText?.includes("desktop-proof"),
		) && !values.some((v) => v.presets?.some((p) => p.name === "中文恢复预设")),
	);
	check("Skill file bytes remain unchanged", readFileSync(skillPath).equals(skillBytes));
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	if (page) await page.screenshot({ path: output.replace(/\.json$/, "-failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	await app?.close().catch((error) => {
		result.cleanupError = error.message;
		process.exitCode = 1;
	});
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}
