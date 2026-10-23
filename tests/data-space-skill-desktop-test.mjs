/** Verify the Data Space skill's desktop discovery and plugin ownership, without model or business calls. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { portUp } from "./lib/port-utils.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
import { waitUntil } from "../qa/ui/project-environment.mjs";
import { ready } from "./fixtures/data-space/ui-run-fixture.mjs";
import { enableDataSpace } from "../scripts/enable-data-space.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "data-space-skill-desktop");
const temporary = await mkdtemp(join(tmpdir(), "data-space-skill-desktop-"));
const cleanup = [];
const native = await ready({ after: (fn) => cleanup.push(fn) });
const workspace = native.f.root;
const userData = join(temporary, "desktop");
const agentDir = join(userData, "agent");
const dataDir = join(userData, "data");
const output = join(repo, "tests/scratch/data-space-skill-desktop", String(Date.now()));

await mkdir(agentDir, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(join(agentDir, "auth.json"), "{}");
await writeFile(join(agentDir, "models.json"), '{"providers":{}}');
await enableDataSpace(repo, { agentDir, dataDir });
await mkdir(join(dataDir, "data-space"), { recursive: true });
await writeFile(
	join(dataDir, "data-space/store.json"),
	JSON.stringify({
		version: 3,
		revision: 1,
		systems: [{ id: "desktop-project", name: "Desktop channel" }],
		modules: [],
		features: [],
		cases: [],
		envs: [
			{
				id: "desktop-env",
				systemId: "desktop-project",
				name: "Synthetic",
				baseUrl: native.f.fixture.url,
				params: [
					{ key: "tenant", value: "fixture", secret: false },
					{ key: "token", value: "synthetic-private", secret: true },
				],
			},
		],
	}),
);
const first = await readFile(join(agentDir, "settings.json"), "utf8");
await enableDataSpace(repo, { agentDir, dataDir });
assert.equal(await readFile(join(agentDir, "settings.json"), "utf8"), first);
const port = 18979;
assert.equal(await portUp(port), false, "Isolated port must be free");
const env = { ...process.env };
for (const key of Object.keys(env)) {
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_|PI_)/.test(key) ||
		["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key)
	)
		delete env[key];
}
Object.assign(env, {
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PI_WEB_SDK: "bundled",
});
const result = { status: "FAIL", checks: [], actualModelCalls: 0, businessRequests: 0 };
let app;
let page;
try {
	app = await launchNativeApp({ executablePath: electron, packaged: false, env });
	page = await app.firstWindow();
	const notices = [];
	page.on("websocket", (s) =>
		s.on("framereceived", ({ payload }) => {
			try {
				const frame = JSON.parse(String(payload));
				if (frame.type === "notice") notices.push(frame.text);
			} catch {}
		}),
	);
	await page.waitForSelector(".app");
	await page.reload();
	await page.waitForSelector(".app");
	const setup = page.locator(".setup-modal .modal-close");
	if (await setup.isVisible()) await setup.click();
	const input = page.locator("textarea").first();
	await input.waitFor({ state: "visible" });
	const reload = async () => {
		const after = notices.length;
		await input.fill("/reload");
		await input.press("Escape");
		await input.press("Enter");
		await waitUntil(
			() => notices.slice(after).some((s) => /已重新加载|Reloaded extensions/.test(s)),
			"desktop reload",
			60000,
		);
	};
	const settings = async (tab) => {
		await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
		await page.locator(`.settings-tab[data-tab="${tab}"]`).click();
	};
	const close = () => page.locator(".set-close-btn").click();
	const skill = () =>
		page.locator(".settings-modal .set-row").filter({
			has: page.locator('.set-row-name [title="data-space-testing"]'),
		});
	const candidate = () =>
		page.locator(".slash-item").filter({ has: page.locator('.slash-name[title="/skill:data-space-testing"]') });
	const plugin = () =>
		page.locator(".settings-modal .set-row").filter({
			has: page.locator(".set-row-name", { hasText: /数据空间|Data Space/ }),
		});
	await settings("skills");
	await skill().waitFor();
	assert.match(await skill().innerText(), /数据空间测试数据规范/);
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "true");
	await page.screenshot({ path: join(output, "skill.png") });
	await close();
	await input.fill("/data");
	await candidate().waitFor();
	await candidate().click();
	assert.equal(await input.inputValue(), "/skill:data-space-testing ");
	await input.fill("");
	result.checks.push(
		"app-level registration is idempotent; desktop discovers the skill in another workspace and completes /data",
	);
	await settings("skills");
	await skill().getByRole("switch").click();
	await close();
	await reload();
	await settings("skills");
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "false");
	await close();
	await input.fill("/data");
	assert.equal(await candidate().count(), 0);
	await input.fill("");
	await settings("skills");
	await skill().getByRole("switch").click();
	await close();
	await reload();
	result.checks.push("individual skill disabling survives reload, hides the shortcut, and can be restored");
	await settings("plugins");
	await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	await plugin().getByRole("switch").click();
	await waitUntil(
		async () => (await plugin().getByRole("switch").getAttribute("aria-checked")) === "false",
		"plugin off",
	);
	await close();
	await reload();
	await settings("skills");
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "false");
	await page.screenshot({ path: join(output, "plugin-blocked.png") });
	await close();
	await input.fill("/data");
	assert.equal(await candidate().count(), 0);
	await input.fill("");
	await settings("plugins");
	await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	assert.equal(await plugin().getByRole("switch").getAttribute("aria-checked"), "false");
	await plugin().getByRole("switch").click();
	await waitUntil(
		async () => (await plugin().getByRole("switch").getAttribute("aria-checked")) === "true",
		"plugin on",
	);
	await close();
	await reload();
	await settings("skills");
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "true");
	await close();
	await input.fill("/data");
	await candidate().waitFor();
	await input.fill("");
	result.checks.push(
		"plugin disabling gates its skill across reload; enabling restores discovery without changing the skill preference",
	);
	await settings("tools");
	for (const name of ["data_space_cases", "data_space_env", "data_space_record_result", "data_space_automation"]) {
		const row = page
			.locator(".settings-modal .set-row")
			.filter({ has: page.locator(".set-row-name", { hasText: name }) });
		await row.waitFor();
		assert.equal(await row.getByRole("switch").getAttribute("aria-checked"), "true");
	}
	await page.screenshot({ path: join(output, "tools.png") });
	await close();
	result.checks.push("desktop tool management exposes all four existing Data Space tools");
	const request = (path, body) =>
		page.evaluate(
			async ({ path, body }) => {
				const response = await fetch(
					`/plugins-api/data-space${path}`,
					body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {},
				);
				if (!response.ok) throw new Error(`Data Space HTTP ${response.status}`);
				return response.json();
			},
			{ path, body },
		);
	const initialized = await request("/automation", {
		action: "initialize",
		engine: "ui",
		targetUrl: native.f.fixture.url,
		workspace,
	});
	assert.equal(initialized.status, "configured");
	assert.equal(initialized.parameters.tenant, "fixture");
	assert(!JSON.stringify(initialized).includes("synthetic-private"));
	// 原生资产已存在但未获用户确认：不得自动入库。
	const readStore = async () => JSON.parse(await readFile(join(dataDir, "data-space/store.json"), "utf8"));
	assert.equal((await readStore()).cases.length, 0, "generated assets must not be imported implicitly");
	const imported = await request("/automation", {
		action: "import",
		engine: "ui",
		assetRef: native.assetRef,
		envId: "desktop-env",
		workspace,
	});
	assert.equal(imported.imported, 1);
	assert.equal(imported.project.id, "desktop-project");
	assert.equal(imported.featureName, "UI用例");
	const drafts = await readStore();
	assert.equal(drafts.cases.length, 1);
	assert.equal(drafts.cases[0].status, "草稿");
	assert.equal(drafts.cases[0].automation, null, "import must not create an automation binding");
	assert.equal(drafts.modules.find((m) => m.id === drafts.features[0].moduleId).name, "测试用例");
	const bound = await request("/automation", {
		action: "bind",
		caseId: imported.caseIds[0],
		engine: "ui",
		assetRef: native.assetRef,
		nativeCaseId: "C1",
		envId: "desktop-env",
		workspace,
	});
	assert.equal(bound.binding.nativeCaseId, "C1");
	const executed = await native.service.start(native.request);
	assert.equal(executed.run.data.exit_code, 0);
	// Settings switches gate tools; only a real host restart reactivates plugins.
	await app.close();
	app = await launchNativeApp({ executablePath: electron, packaged: false, env });
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	await waitUntil(
		async () => {
			const saved = JSON.parse(
				await readFile(join(dataDir, "data-space/runs.json"), "utf8").catch(() => '{"runs":[]}'),
			);
			return saved.runs.length === 1 && saved.runs[0].verdict === "通过";
		},
		"desktop channel recovery",
		60000,
	);
	const repeated = await request("/automation", {
		action: "import",
		engine: "ui",
		assetRef: native.assetRef,
		envId: "desktop-env",
		workspace,
	});
	assert.equal(repeated.duplicate, 1);
	assert.equal((await readStore()).cases.length, 1);
	result.checks.push(
		"real Electron environment initialization, explicit draft import by envId, separate binding, persisted channel and automatic native Playwright result recovery",
	);
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	await writeFile(join(output, "desktop.log"), app?.getLogs() ?? "");
	await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	await app?.close();
	for (const close of cleanup.reverse()) await close();
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
