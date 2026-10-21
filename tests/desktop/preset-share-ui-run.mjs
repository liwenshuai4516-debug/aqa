// Actual package import/export UI, original server whitelist and dry-run behavior.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";
import { waitForStablePage } from "../lib/page-stability.mjs";

const executablePath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve evidence");
const fixture = mkdtempSync("/tmp/pi-preset-share-");
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
	PI_WEB_PRESET_CATALOG_URL: "off",
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
const stateFile = join(userData, "data", "client-state.json");
const persisted = () => JSON.parse(readFileSync(stateFile, "utf8"));
const presets = () => persisted().__settings__?.presets ?? [];
const importedName = "中文白名单导入";
const marker = "DESKTOP_IMPORT_PROMPT";
const modal = () => page.locator(".preset-share-modal");
const closeShare = () => modal().locator(".preset-share-head button").last().click();
try {
	await launch();
	await tab("presets");
	await page.locator(".set-preset-share-btn.primary").click();
	await modal()
		.getByRole("button", { name: /^(导出 JSON|Export JSON)$/ })
		.click();
	await modal().locator(".preset-share-json").waitFor();
	const exported = JSON.parse(await modal().locator(".preset-share-json").inputValue());
	check(
		"Original export UI returns parseable preset document",
		exported.format && exported.version && typeof exported.settings === "object",
	);
	result.exportedFormat = { format: exported.format, version: exported.version };
	await closeShare();
	await page.locator(".set-preset-share-actions .set-preset-share-btn").nth(1).click();
	await modal().locator(".preset-share-input").fill("{invalid json");
	await modal()
		.getByRole("button", { name: /^(预览|Preview)$/ })
		.click();
	await modal().locator(".preset-share-error").waitFor();
	check("Malformed JSON displays original server error and creates no preset", presets().length === 0);
	const doc = {
		...exported,
		name: importedName,
		settings: { promptMode: "replace", customSystemPrompt: marker, desktopUnexpectedField: "DROP_ME" },
	};
	const importedFile = join(fixture, "中文导入.json");
	writeFileSync(importedFile, JSON.stringify(doc));
	await modal().locator('input[type="file"]').setInputFiles(importedFile);
	await modal().locator(".preset-share-preview-name", { hasText: importedName }).waitFor();
	check("Original file import creates preview with Chinese preset name", true);
	check(
		"Preview reports unknown field ignored",
		(await modal().locator(".preset-share-warn").allTextContents()).join(" ").includes("desktopUnexpectedField"),
	);
	check("Dry-run preview leaves presets unmodified on disk", presets().length === 0);
	// Deselect all through the original UI; confirmation must remain disabled.
	await modal()
		.getByRole("button", { name: /^(全不选|None)$/ })
		.click();
	const confirm = modal().locator(".preset-share-preview .btn.primary");
	check("No selected fields disables import confirmation", await confirm.isDisabled());
	const promptItem = modal()
		.locator(".preset-share-pick-item")
		.filter({ has: page.locator(".preset-share-pick-code", { hasText: /^customSystemPrompt$/ }) });
	await promptItem.locator('input[type="checkbox"]').check();
	await confirm.click();
	await modal().locator(".preset-share-ok").waitFor();
	check(
		"Confirmed selective import persists only selected prompt field",
		presets().some(
			(p) =>
				p.name === importedName &&
				p.customSystemPrompt === marker &&
				!("promptMode" in p) &&
				!("desktopUnexpectedField" in p),
		),
	);
	check(
		"Import without apply preserves current live settings",
		persisted().__settings__.settings.customSystemPrompt !== marker,
	);
	await closeShare();
	const row = page
		.locator(".settings-modal .set-row")
		.filter({ has: page.locator(".set-row-name", { hasText: importedName }) });
	await row.waitFor();
	await row.locator(".set-uninstall").click();
	// Wait on actual original storage, rather than assuming a UI click is complete.
	const deadline = Date.now() + 10000;
	while (persisted().__settings__.settings.customSystemPrompt !== marker && Date.now() < deadline)
		await new Promise((r) => setTimeout(r, 100));
	check(
		"Applying imported preset changes original persisted system prompt",
		persisted().__settings__.settings.customSystemPrompt === marker,
	);
	await row.locator(".set-icon-btn").first().click();
	await modal()
		.getByRole("button", { name: /^(导出 JSON|Export JSON)$/ })
		.click();
	await modal().locator(".preset-share-json").waitFor();
	await page.waitForFunction((name) => {
		const value = document.querySelector(".preset-share-modal .preset-share-json")?.value;
		return value && JSON.parse(value).name === name;
	}, importedName);
	const roundtrip = JSON.parse(await modal().locator(".preset-share-json").inputValue());
	check(
		"Imported preset reexports selected data without unknown field",
		roundtrip.name === importedName &&
			roundtrip.settings.customSystemPrompt === marker &&
			!("desktopUnexpectedField" in roundtrip.settings),
	);
	await page.screenshot({ path: output.replace(/\.json$/, "-export.png") });
	writeFileSync(output.replace(/\.json$/, "-roundtrip.json"), JSON.stringify(roundtrip, null, 2));
	await app.close();
	app = null;
	await launch();
	await tab("presets");
	await page.locator(".settings-modal .set-row-name", { hasText: importedName }).waitFor();
	check(
		"Imported preset and applied prompt survive application relaunch",
		presets().some((p) => p.name === importedName) && persisted().__settings__.settings.customSystemPrompt === marker,
	);
	check("Local skill fixture is unchanged by preset import", readFileSync(skillPath).equals(skillBytes));
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	await page?.screenshot({ path: output.replace(/\.json$/, "-failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	await app?.close().catch((error) => {
		result.cleanupError = error.message;
		process.exitCode = 1;
	});
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}
