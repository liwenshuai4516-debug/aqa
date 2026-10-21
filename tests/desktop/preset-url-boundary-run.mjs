// Real installed UI/server negative URL paths. No fetch or permission overrides.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";
import { waitForStablePage } from "../lib/page-stability.mjs";

const executablePath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve previous evidence");
const fixture = mkdtempSync("/tmp/pi-preset-url-");
const userData = join(fixture, "desktop");
const workspace = join(fixture, "中文 workspace");
mkdirSync(workspace);
mkdirSync(join(userData, "agent"), { recursive: true });
writeFileSync(join(userData, "agent/auth.json"), "{}");
writeFileSync(join(userData, "agent/models.json"), '{"providers":{}}');
const requests = [];
const server = createServer((req, res) => {
	requests.push({ method: req.method, url: req.url });
	res.writeHead(200, { "content-type": "application/json" });
	res.end('{"presets":[]}');
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const localUrl = `http://127.0.0.1:${server.address().port}`;
const env = { ...process.env };
for (const key of Object.keys(env))
	if (
		/(KEY|TOKEN|PASSWORD|SECRET)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_|PI_WEB_|PI_CODING_AGENT_|PI_DESKTOP_)/.test(key) ||
		["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key)
	)
		delete env[key];
Object.assign(env, {
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PI_WEB_PRESET_CATALOG_URL: `${localUrl}/index.json`,
	PI_WEB_PRESET_REPO: "off",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
});
const result = { fixture, executablePath, status: "FAIL", checks: [], responses: [], requests, paidRequests: 0 };
const check = (name, ok) => {
	assert(ok, name);
	result.checks.push(name);
};
let app, page;
async function waitResponse(type, start) {
	const deadline = Date.now() + 15000;
	while (Date.now() < deadline) {
		const response = result.responses.slice(start).find((r) => r.type === type);
		if (response) return response;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`Missing original ${type} response`);
}
try {
	app = await launchNativeApp({ executablePath, packaged: true, env });
	page = await app.firstWindow();
	page.on("websocket", (ws) =>
		ws.on("framereceived", ({ payload }) => {
			try {
				const msg = JSON.parse(String(payload));
				if (["preset_import_result", "preset_catalog_result"].includes(msg.type)) result.responses.push(msg);
			} catch {}
		}),
	);
	// Only reconnect the test page if its existing socket predates observation.
	await page.reload();
	await page.waitForSelector(".app");
	assert(await waitForStablePage(page));
	await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
	await page.locator('.settings-tab[data-tab="presets"]').click();
	await page.locator(".set-preset-share-actions .set-preset-share-btn").nth(1).click();
	const modal = page.locator(".preset-share-modal");
	const catalog = await waitResponse("preset_catalog_result", 0);
	check("Original catalog request rejects loopback source", catalog.ok === false && catalog.entries.length === 0);
	await modal.locator(".preset-share-tab").nth(2).click();
	await modal.locator(".preset-share-error").waitFor();
	check(
		"Catalog error remains visible in original browse pane",
		!!(await modal.locator(".preset-share-error").textContent()),
	);
	const refreshStart = result.responses.length;
	await modal.locator(".preset-share-url-row button").click();
	const refreshed = await waitResponse("preset_catalog_result", refreshStart);
	check("Refresh completes with original rejection without hanging", refreshed.ok === false);
	await modal.locator(".preset-share-tab").nth(1).click();
	for (const url of [
		"file:///tmp/private-preset.json",
		`${localUrl}/preset.json`,
		"http://localhost/private.json",
		"http://10.0.0.1/private.json",
	]) {
		const start = result.responses.length;
		await modal.locator(".preset-share-url-row input").fill(url);
		await modal.locator(".preset-share-url-row button").click();
		const reply = await waitResponse("preset_import_result", start);
		check(
			`Original server rejects ${new URL(url).protocol}//${new URL(url).hostname}`,
			reply.ok === false && !!reply.error,
		);
		await modal.locator(".preset-share-error").waitFor();
	}
	check("No blocked local import or catalog reaches the listening HTTP server", requests.length === 0);
	const stateFile = join(userData, "data/client-state.json");
	const persisted = () => JSON.parse(readFileSync(stateFile, "utf8"));
	check("Rejected URLs create no persisted presets", (persisted().__settings__?.presets ?? []).length === 0);
	const start = result.responses.length;
	await modal.locator(".preset-share-input").fill(
		JSON.stringify({
			format: "pi-web-ui-preset",
			version: 1,
			name: "错误后可预览",
			settings: { customSystemPrompt: "LOCAL_PREVIEW_ONLY" },
		}),
	);
	await modal.getByRole("button", { name: /^(预览|Preview)$/ }).click();
	const preview = await waitResponse("preset_import_result", start);
	await modal.locator(".preset-share-preview-name", { hasText: "错误后可预览" }).waitFor();
	check("Valid paste preview still works after URL failures", preview.ok === true && preview.dryRun === true);
	check(
		"Recovery preview does not write a preset or apply its prompt",
		(persisted().__settings__?.presets ?? []).length === 0 &&
			persisted().__settings__?.settings?.customSystemPrompt !== "LOCAL_PREVIEW_ONLY",
	);
	await page.screenshot({ path: output.replace(/\.json$/, "-recovery.png") });
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
	await new Promise((r) => server.close(r));
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}
