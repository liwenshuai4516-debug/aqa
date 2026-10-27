/** Verify the Data Space skill's desktop discovery and plugin ownership, without model or business calls. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { assetDigest, authState } from "pi-ui-testing";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { portUp } from "./lib/port-utils.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
import { waitUntil } from "../qa/ui/project-environment.mjs";
import { ready } from "./fixtures/data-space/ui-run-fixture.mjs";
import { enableDataSpace } from "../scripts/enable-data-space.mjs";
import { validateResult } from "../.pi/skills/data-space-testing/scripts/validate-result.mjs";

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
assert.equal(JSON.parse(await readFile(join(dataDir, "plugins/data-space/manifest.json"), "utf8")).version, "0.17.2");
await mkdir(join(dataDir, "data-space"), { recursive: true });
await writeFile(
	join(dataDir, "data-space/store.json"),
	JSON.stringify({
		version: 3,
		revision: 1,
		systems: [{ id: "desktop-project", name: "Desktop channel" }],
		modules: [{ id: "desktop-module", systemId: "desktop-project", name: "Names" }],
		features: [{ id: "desktop-save", moduleId: "desktop-module", name: "Save" }],
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
				script: {
					enabled: true,
					steps: [
						{
							url: "/login",
							extract: [
								{ key: "tenant", secret: false },
								{ key: "token", secret: true },
							],
						},
					],
				},
				scriptRun: { ok: true, at: "2026-10-23T00:00:00Z" },
				dynamic: [
					{ key: "tenant", value: "runtime-fixture", secret: false, expiresAt: "2099-01-01T00:00:00Z" },
					{ key: "token", value: "synthetic-dynamic-private", secret: true, expiresAt: "2099-01-01T00:00:00Z" },
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
	const preparationRequests = native.f.fixture.state.browserRequests;
	for (const input of [{ mode: "analyze" }, { mode: "view" }, { mode: "record", discovery: "source" }]) {
		const skipped = await request("/automation", { action: "initialize", engine: "ui", workspace, ...input });
		assert.equal(skipped.status, "not-required");
		assert.equal(skipped.channel, undefined);
	}
	await assert.rejects(readFile(join(dataDir, "data-space/channels.json")), { code: "ENOENT" });
	const initialized = await request("/automation", {
		action: "initialize",
		engine: "ui",
		mode: "execute",
		targetUrl: native.f.fixture.url,
		workspace,
	});
	assert.equal(initialized.status, "configured");
	assert.equal(initialized.parameters.tenant, "runtime-fixture");
	assert.equal(initialized.parameterSources.tenant.kind, "dynamic");
	assert.equal(initialized.preparation.parameters.dynamic, "reused");
	for (const check of ["network", "authentication", "role", "data"])
		assert.equal(initialized.preparation[check].state, "unknown");
	assert.equal(initialized.preparation.privateExecution.state, "not-ready");
	assert(!JSON.stringify(initialized).includes("synthetic-private"));
	assert(!JSON.stringify(initialized).includes("synthetic-dynamic-private"));
	assert.equal(native.f.fixture.state.browserRequests, preparationRequests);
	result.checks.push(
		"mode-aware preparation skips historical/source-only channels, reuses current public parameters, preserves unknown browser readiness and performs no target requests",
	);
	const beforePrivate = await readFile(join(dataDir, "data-space/store.json"), "utf8");
	const privateInput = {
		action: "prepare-private",
		engine: "ui",
		mode: "execute",
		systemId: "desktop-project",
		envId: "desktop-env",
		workspace,
		targetUrl: native.f.fixture.url,
		privateBindings: [{ parameterKey: "token", storageKey: "token" }],
	};
	const prepared = await request("/automation", privateInput);
	assert.equal(prepared.status, "prepared-private-execution");
	assert.equal(prepared.preparation.authentication, "unknown");
	assert.equal(prepared.preparation.recording, "unsupported");
	assert.ok(!JSON.stringify(prepared).includes("synthetic-dynamic-private"));
	const stateDirectory = join(dataDir, "data-space/private-browser");
	const owned = await readdir(stateDirectory);
	assert.equal(owned.length, 1);
	const privatePath = join(stateDirectory, owned[0], "state.json");
	const state = JSON.parse(await readFile(privatePath, "utf8"));
	assert.equal(state.pi_ui_private.reference, prepared.auth.reference);
	assert.equal(state.origins[0].localStorage[0].value, "synthetic-dynamic-private");
	assert.equal(await readFile(join(dataDir, "data-space/store.json"), "utf8"), beforePrivate);
	assert.equal(native.f.fixture.state.browserRequests, preparationRequests);
	// The desktop backend and this test are separate processes. Only the owned reference path crosses privately here.
	assert.equal(process.env[prepared.auth.reference], undefined);
	process.env[prepared.auth.reference] = privatePath;
	try {
		assert.equal(await authState({ base_url: native.f.fixture.url, auth: prepared.auth }, workspace), privatePath);
	} finally {
		delete process.env[prepared.auth.reference];
	}
	assert.ok(!JSON.stringify(prepared).includes(privatePath));
	await request("/automation", { action: "disconnect", engine: "ui", envId: "desktop-env", workspace });
	await assert.rejects(access(privatePath), { code: "ENOENT" });
	await request("/automation", {
		action: "initialize",
		engine: "ui",
		mode: "execute",
		envId: "desktop-env",
		workspace,
	});
	result.privateExecution = {
		prepared,
		selectedDynamicValueConsumed: true,
		noStoreWrite: true,
		noTargetRequest: true,
		disconnectRemovedOwnedState: true,
		nativeConsumption: "Owned-state authState compatibility check in test process; not a desktop Agent business run",
	};
	result.checks.push(
		"desktop prepare-private reuses a fresh private dynamic value, returns only an expiring reference, preserves store/network state and revokes on disconnect",
	);
	// 原生资产已存在但未获用户确认：不得自动入库。
	const readStore = async () => JSON.parse(await readFile(join(dataDir, "data-space/store.json"), "utf8"));
	assert.equal((await readStore()).cases.length, 0, "generated assets must not be imported implicitly");
	const featureMappings = [{ nativeModuleId: "names", nativeFeatureId: "save", featureId: "desktop-save" }];
	const archiveInput = { engine: "ui", assetRef: native.assetRef, envId: "desktop-env", workspace, featureMappings };
	const pending = await request("/automation", { ...archiveInput, action: "archive-status" });
	assert.equal(pending.counts.pending, 1);
	assert.equal((await readStore()).cases.length, 0, "receipt query must not import");
	const imported = await request("/automation", {
		featureMappings,
		action: "import",
		engine: "ui",
		assetRef: native.assetRef,
		envId: "desktop-env",
		workspace,
	});
	assert.equal(imported.imported, 1);
	assert.equal(imported.project.id, "desktop-project");
	assert.equal(imported.featureName, "Save");
	assert.equal(imported.classificationComplete, true);
	assert.equal(imported.items[0].nativeModuleId, "names");
	assert.equal(imported.items[0].featureId, "desktop-save");
	const drafts = await readStore();
	assert.equal(drafts.cases.length, 1);
	assert.equal(drafts.cases[0].status, "草稿");
	assert.equal(drafts.cases[0].automation, null, "import must not create an automation binding");
	assert.equal(drafts.cases[0].featureId, "desktop-save");
	const beforeQuery = JSON.stringify(drafts);
	const archived = await request("/automation", { ...archiveInput, action: "archive-status" });
	assert.equal(archived.counts.existing, 1);
	assert.equal(JSON.stringify(await readStore()), beforeQuery);
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
	const beforeSyncQuery = await readFile(join(dataDir, "data-space/runs.json"), "utf8");
	const syncReceipt = await request("/automation", {
		action: "sync-status",
		engine: "ui",
		runRef: executed.run_ref,
		workspace,
	});
	assert.equal(syncReceipt.complete, true);
	assert.equal(syncReceipt.counts.existing, 1);
	assert.equal(syncReceipt.items[0].projectId, "desktop-project");
	assert.equal(syncReceipt.items[0].verdict, "通过");
	assert.equal(await readFile(join(dataDir, "data-space/runs.json"), "utf8"), beforeSyncQuery);
	const synced = syncReceipt.items[0];
	const delivery = {
		format: "data-space-result/v1",
		context: {
			workspace: syncReceipt.workspace,
			project: { id: "desktop-project", name: "Desktop channel" },
			environment: { id: "desktop-env", name: "Synthetic" },
		},
		origin: "native",
		native: {
			engine: "ui",
			assetRef: native.assetRef,
			runRef: executed.run_ref,
			runId: syncReceipt.runId,
			parentRunId: syncReceipt.parentRunId || null,
		},
		results: [
			{
				case: synced.caseId,
				nativeCaseId: synced.nativeCaseId,
				featureId: synced.featureId,
				caseVersion: synced.caseVersion,
				verdict: synced.verdict,
				note: "Synthetic native run recovered after desktop restart",
			},
		],
		evidence: [executed.run_ref],
		evidenceComplete: null,
		reportReview: null,
		writeback: { method: "native-sync", status: "confirmed", receipt: syncReceipt },
		gaps: [],
	};
	const validation = validateResult(delivery);
	assert.equal(validation.ok, true, JSON.stringify(validation.errors));
	assert.equal(
		validateResult({
			...delivery,
			context: { ...delivery.context, project: { id: "wrong-project", name: "Synthetic" } },
		}).ok,
		false,
	);
	await writeFile(join(output, "delivery.json"), JSON.stringify(delivery, null, 2));
	await writeFile(join(output, "delivery-validation.json"), JSON.stringify(validation, null, 2));
	result.checks.push(
		"native delivery reconciles desktop run references and case versions; cross-project delivery is rejected",
	);
	const recoveredReceipt = await request("/automation", { ...archiveInput, action: "archive-status" });
	assert.equal(recoveredReceipt.classificationComplete, true);
	assert.equal(recoveredReceipt.counts.existing, 1);
	const repeated = await request("/automation", {
		featureMappings,
		action: "import",
		engine: "ui",
		assetRef: native.assetRef,
		envId: "desktop-env",
		workspace,
	});
	assert.equal(repeated.duplicate, 1);
	assert.equal((await readStore()).cases.length, 1);
	result.checks.push(
		"real Electron environment initialization, explicit mapped draft import by envId, read-only archive receipts before/after restart, separate binding, persisted channel and automatic native Playwright result recovery",
	);

	const originalAsset = await native.f.store.load(native.assetRef);
	const nextAsset = { ...originalAsset, data: { ...originalAsset.data, revision: "v2" } };
	nextAsset.data.content_sha256 = assetDigest(nextAsset);
	const nextRef = await native.f.store.put(nextAsset);
	const nextArchive = await request("/automation", { ...archiveInput, action: "import", assetRef: nextRef });
	assert.equal(nextArchive.imported, 1);
	const versioned = await readStore();
	assert.equal(versioned.cases.length, 2);
	assert.equal(versioned.cases[0].nativeSource.lineageId, versioned.cases[1].nativeSource.lineageId);
	assert(versioned.cases[0].nativeSource.lineageId);
	await page.locator("header button, .topbar button, nav button").filter({ hasText: "数据空间" }).first().click();
	await page.locator('.dsp-nav button[data-tab="cases"]').click();
	const selector = page.locator('[data-el="case-version"]');
	await selector.waitFor();
	const caseRows = page.locator(".case-table tbody tr");
	await waitUntil(async () => (await caseRows.count()) === 1, "recent case version");
	assert((await caseRows.innerText()).includes("v2"));
	await selector.selectOption("all");
	assert.equal(await caseRows.count(), 2);
	const oldRow = caseRows.filter({ has: page.locator(`[data-act="edit-case"][data-id="${imported.caseIds[0]}"]`) });
	await oldRow.locator('[data-act="automation-open"]').click();
	await page.locator(".dsp-modal summary").filter({ hasText: "原生来源与修订" }).click();
	assert((await page.locator(".dsp-modal").innerText()).includes(native.assetRef.sha256));
	await page.locator(".dsp-modal summary").filter({ hasText: "原生执行记录与证据" }).click();
	assert((await page.locator(".dsp-modal").innerText()).includes(syncReceipt.runId));
	await page.screenshot({ path: join(output, "version-history.png") });
	assert.equal((await readStore()).cases.length, 2);
	result.checks.push(
		"desktop recent/all imported revisions preserve old case bindings, native source refs and run evidence",
	);
	// A past diagnostic and configured channel cannot prove the current browser identity.
	await page.locator('.dsp-modal [data-act="close-modal"]').click();
	native.f.fixture.state.identityText = "Signed out";
	let blocked;
	try {
		blocked = await native.service.start({ ...native.request, request_id: "desktop-current-identity-expired" });
	} finally {
		native.f.fixture.state.identityText = "Names";
	}
	const preflightRef = blocked.run.data.output_refs.find((ref) => ref.path.endsWith("/preflight.json"));
	const preflight = JSON.parse(await readFile(join(workspace, preflightRef.path), "utf8"));
	assert.deepEqual([preflight.status, preflight.check], ["blocked", "identity"]);
	assert(!blocked.run.data.output_refs.some((ref) => ref.path.endsWith("/process-started.json")));
	const blockedSync = await request("/automation", {
		action: "sync",
		engine: "ui",
		runRef: blocked.run_ref,
		workspace,
	});
	assert.equal(blockedSync.items.length, 1);
	assert.equal(blockedSync.items[0].verdict, "阻塞");
	const savedRuns = JSON.parse(await readFile(join(dataDir, "data-space/runs.json"), "utf8")).runs;
	assert.equal(savedRuns.length, 2);
	assert(savedRuns.some((run) => run.id === synced.resultId && run.verdict === "通过"));
	const beforeBlockedQuery = native.f.fixture.state.browserRequests;
	const replayed = await native.service.start({ ...native.request, request_id: "desktop-current-identity-expired" });
	assert.equal(replayed.replayed, true);
	assert.deepEqual(replayed.run_ref, blocked.run_ref);
	assert.equal(native.f.fixture.state.browserRequests, beforeBlockedQuery);
	await oldRow.locator('[data-act="automation-open"]').click();
	await page.locator(".dsp-modal summary").filter({ hasText: "原生执行记录与证据" }).click();
	await waitUntil(
		async () => (await page.locator(".dsp-modal").innerText()).includes(blockedSync.runId),
		"current identity blocked record",
	);
	assert((await page.locator(".dsp-modal").innerText()).includes("阻塞"));
	await writeFile(
		join(output, "identity-blocked.json"),
		JSON.stringify({ preflight, runRef: blocked.run_ref, sync: blockedSync, replayed: replayed.replayed }, null, 2),
	);
	await page
		.locator(".dsp-modal details")
		.last()
		.locator("pre")
		.evaluate((element) => {
			const text = element.firstChild;
			const index = text.textContent.indexOf('"verdict": "阻塞"');
			if (index < 0) throw new Error("Blocked verdict is missing from the rendered record");
			const range = document.createRange();
			range.setStart(text, index);
			range.setEnd(text, index + 15);
			const body = element.closest(".dsp-modal-body");
			body.scrollTop += range.getBoundingClientRect().top - body.getBoundingClientRect().top - 80;
		});
	await page.screenshot({ path: join(output, "identity-blocked.png") });
	result.checks.push(
		"current identity expiration blocks native business execution; desktop shows blocked separately and preserves the previous passed result without replay",
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
