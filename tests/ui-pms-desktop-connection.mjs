/** Connect the actual selected Data Space through Electron's normal authenticated renderer.
 * Temporary UI/agent profile; selected Data Space remains at its real location. No model calls.
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, cp, readdir, lstat, access, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { sha256, ArtifactStore } from "pi-ui-testing";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { portUp } from "./lib/port-utils.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";

assert.ok(process.argv.includes("--connect-selected-data"), "Explicit selected-data connection required");
assert.equal(process.env.PI_WEB_SMOKE_PREBUILT, "1", "Never rebuild inside this entry");
const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "pms-desktop-connection");
const output = join(repo, "tests/scratch/ui-pms-desktop-connection", String(Date.now()));
await mkdir(output, { recursive: true });
await cp(fileURLToPath(import.meta.url), join(output, "harness.mjs"));
const intakeIndex = process.argv.indexOf("--intake-source-cases");
const intake = intakeIndex < 0 ? undefined : JSON.parse(await readFile(process.argv[intakeIndex + 1], "utf8"));
if (intake) {
	assert.equal(intake.status, "SOURCE_ONLY_NOT_REVIEWED_NOT_EXECUTABLE");
	const saved = await new ArtifactStore(intake.root).load(intake.casesRef);
	assert.equal(saved.data.cases.length, 3);
	assert.ok(saved.data.cases.every((c) => c.title.startsWith("源码草稿：")));
}
const dataDir = join(homedir(), "Library/Application Support/Pi Agent Desktop/data");
const storePath = join(dataDir, "data-space/store.json"),
	before = await readFile(storePath);
// A new UI profile must not resume unrelated tasks from the selected data directory.
await assert.rejects(access(join(dataDir, "scheduler-tasks.json")), { code: "ENOENT" });
const pluginVersions = [];
for (const id of await readdir(join(dataDir, "plugins"))) {
	const directory = join(dataDir, "plugins", id);
	let source, installed;
	try {
		source = JSON.parse(await readFile(join(repo, "plugins", id, "manifest.json")));
		installed = JSON.parse(await readFile(join(directory, "manifest.json")));
	} catch {
		throw new Error("Plugin manifests require explicit reconciliation");
	}
	const linked = (await lstat(directory)).isSymbolicLink();
	assert.ok(
		linked || source.version.localeCompare(installed.version, undefined, { numeric: true }) <= 0,
		"Preserve installed plugin versions",
	);
	try {
		const schedule = JSON.parse(await readFile(join(directory, "schedules.json")));
		assert.equal(
			Array.isArray(schedule) ? schedule.length : (schedule.tasks ?? schedule.schedules ?? []).length,
			0,
			"Do not start saved plugin schedules",
		);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	pluginVersions.push({ id, installed: installed.version, source: source.version, linked });
}
const port = 18979;
assert.equal(await portUp(port), false, "Preserve existing listener");
const privateProfile = await mkdtemp(join(tmpdir(), "pms-native-private-"));
const env = { ...process.env };
for (const key of Object.keys(env))
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_|PI_)/.test(key) ||
		["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key)
	)
		delete env[key];
Object.assign(env, {
	PI_DESKTOP_USER_DATA: join(privateProfile, "ui-profile"),
	PI_CODING_AGENT_DIR: join(privateProfile, "agent"),
	PI_WEB_DATA_DIR: dataDir,
	PI_WEB_CWD: intake?.root ?? repo,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PI_WEB_SDK: "bundled",
});
const result = {
	status: "blocked",
	modelCalls: 0,
	nativeCaseImports: 0,
	selectedStoreModified: false,
	pluginVersions,
	actualDataDirectory: dataDir,
	temporaryUiAgentProfile: true,
	prebuiltServerSha256: sha256(await readFile(join(repo, "dist/server/index.js"))),
	prebuiltDesktopSha256: sha256(await readFile(join(repo, "dist/desktop/main.js"))),
};
await writeFile(join(output, "plan.json"), JSON.stringify(result, null, 2));
let app;
const beforeEnvs = sha256(JSON.stringify(JSON.parse(before).envs));
try {
	app = await launchNativeApp({ executablePath: electron, packaged: false, env });
	const page = await app.firstWindow();
	await page.waitForLoadState("domcontentloaded");

	result.nativeReadAttempts = [];
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			result.nativeState = await page.evaluate(async () => {
				const response = await fetch("/plugins-api/data-space/state", { credentials: "same-origin" });
				if (!response.ok || !response.headers.get("content-type")?.includes("application/json"))
					return {
						httpStatus: response.status,
						jsonResponse: response.headers.get("content-type")?.includes("application/json") ?? false,
						selectedProjectMatched: false,
					};
				const data = await response.json();
				const project = data.systems?.find((p) => p.id === "e2f5d42d-2781-4e68-a452-4c87c7d1d346");
				const environment = data.envs?.find(
					(e) => e.id === "f46a32da-2eac-43ca-86b8-2fa5eca5385c" && e.systemId === project?.id,
				);
				const moduleIds = new Set((data.modules ?? []).filter((m) => m.systemId === project?.id).map((m) => m.id));
				const featureIds = new Set((data.features ?? []).filter((f) => moduleIds.has(f.moduleId)).map((f) => f.id));
				return {
					httpStatus: response.status,
					ok: data.ok,
					selectedProjectMatched: project?.name === "项目管理系统",
					selectedEnvironmentMatched: !!environment,
					revision: data.revision,
					modules: moduleIds.size,
					features: featureIds.size,
					cases: (data.cases ?? []).filter((x) => featureIds.has(x.featureId)).length,
				};
			});
			result.nativeReadAttempts.push({ httpStatus: result.nativeState.httpStatus });
			if (result.nativeState.httpStatus === 200 && result.nativeState.selectedProjectMatched) break;
		} catch (error) {
			if (!/Execution context was destroyed|navigation/i.test(error.message)) throw error;
			result.nativeReadAttempts.push({ state: "renderer-navigation" });
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	result.status =
		result.nativeState?.httpStatus === 200 &&
		result.nativeState.selectedProjectMatched &&
		result.nativeState.selectedEnvironmentMatched
			? "selected-desktop-native-connection-verified"
			: "native-connection-blocked";
	if (!intake && result.status === "selected-desktop-native-connection-verified" && result.nativeState.cases === 3) {
		const close = page.locator(".setup-modal .modal-close");
		if (await close.isVisible()) await close.click();
		await page.locator("header button, .topbar button, nav button").filter({ hasText: "数据空间" }).first().click();
		await page.locator('.dsp-nav button[data-tab="cases"]').click();
		const rows = page.locator(".case-table tbody tr").filter({ hasText: "源码草稿：" });
		await rows.first().waitFor({ state: "visible" });
		result.visibleSourceDrafts = await rows.count();
		result.visibleDraftStatusLabels = await rows.getByText("草稿", { exact: true }).count();
		assert.equal(result.visibleSourceDrafts, 3);
		assert.equal(result.visibleDraftStatusLabels, 3);
	}
	if (intake && result.status === "selected-desktop-native-connection-verified") {
		result.intake = await page.evaluate(
			async (input) => {
				const request = async (path, body) => {
					const response = await fetch(
						"/plugins-api/data-space" + path,
						body
							? {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify(path === "/automation" ? { ...body, workspace: input.root } : body),
								}
							: {},
					);
					if (!response.ok) throw new Error("Native selected-project operation rejected");
					return response.json();
				};
				const systemId = "e2f5d42d-2781-4e68-a452-4c87c7d1d346",
					envId = "f46a32da-2eac-43ca-86b8-2fa5eca5385c";
				const inspected = await request("/automation", { action: "inspect", engine: "ui", assetRef: input.casesRef });
				if (inspected.executable !== false || inspected.cases.length !== 3)
					throw new Error("Non-executable native drafts required");
				let state = await request("/state");
				const moduleId = "pms-contract-source-module";
				const definitions = [
					["authentication", "登录与权限初始化"],
					["drafts", "账号与业务类型草稿"],
					["contract-state", "合同状态显示"],
				];
				const ownedFeatures = definitions.map(([id, name]) => ({
					id: "pms-source-" + id,
					moduleId,
					name,
					note: "公开源码声明草稿；未评审、未执行",
				}));
				if (!state.modules.some((m) => m.id === moduleId)) {
					if (state.modules.some((m) => m.systemId === systemId))
						throw new Error("Reconcile existing project directories before intake");
					state = await request("/save", {
						...state,
						baseRevision: state.revision,
						modules: [
							...state.modules,
							{ id: moduleId, systemId, name: "经营合同", note: "源码声明草稿；不代表业务测试通过" },
						],
						features: [...state.features, ...ownedFeatures],
					});
				}
				if (
					!state.modules.some((m) => m.id === moduleId && m.systemId === systemId) ||
					ownedFeatures.some((f) => !state.features.some((x) => x.id === f.id && x.moduleId === moduleId))
				)
					throw new Error("Selected feature mapping mismatch");
				const featureMappings = definitions.map(([id]) => ({
					nativeModuleId: "operation-contract",
					nativeFeatureId: id,
					featureId: "pms-source-" + id,
				}));
				const args = { engine: "ui", assetRef: input.casesRef, envId, featureMappings };
				const pending = await request("/automation", { ...args, action: "archive-status" });
				const imported = await request("/automation", { ...args, action: "import" });
				const after = await request("/automation", { ...args, action: "archive-status" });
				const duplicate = await request("/automation", { ...args, action: "import" });
				const final = await request("/state");
				const rows = final.cases.filter(
					(c) => c.nativeSource?.assetRef?.sha256 === input.casesRef.sha256 && c.nativeSource?.envId === envId,
				);
				return {
					pending,
					imported,
					after,
					duplicate,
					revision: final.revision,
					caseCount: rows.length,
					allDraft: rows.every((c) => c.status === "草稿"),
					allUnbound: rows.every((c) => c.automation === null),
					caseRows: rows.map((c) => ({
						id: c.id,
						featureId: c.featureId,
						title: c.title,
						status: c.status,
						nativeSource: c.nativeSource,
						automation: c.automation,
						steps: c.steps,
					})),
					nativeRuns: final.runs?.length ?? 0,
				};
			},
			{ casesRef: intake.casesRef, root: intake.root },
		);
		assert.equal(result.intake.caseCount, 3);
		assert.equal(result.intake.allDraft, true);
		assert.equal(result.intake.allUnbound, true);
		assert.equal(result.intake.after.classificationComplete, true);
		assert.equal(result.intake.duplicate.imported, 0);
		assert.equal(result.intake.duplicate.duplicate, 3);
		result.nativeCaseImports = result.intake.imported.imported;
		result.status = "selected-desktop-source-drafts-imported";
	}
} catch (error) {
	result.errorCategory = /Execution context was destroyed|navigation/i.test(error.message)
		? "renderer-navigation"
		: /closed|disposed/i.test(error.message)
			? "renderer-closed"
			: /Timeout/i.test(error.message)
				? "readiness-timeout"
				: /JSON|Unexpected token/i.test(error.message)
					? "response-not-json"
					: "other-runtime-error";
	result.runtimeDiagnostic = app
		? Object.fromEntries(
				[
					"Cannot find module",
					"ERR_MODULE_NOT_FOUND",
					"EADDRINUSE",
					"Failed to load",
					"401",
					"permission denied",
					"window loaded",
				].map((marker) => [marker, app.getLogs().includes(marker)]),
			)
		: undefined;
	result.blocker = "native-app-or-authenticated-renderer-unavailable";
} finally {
	if (app) {
		await app.close();
		result.ownedAppClosed = true;
	}
	await rm(privateProfile, { recursive: true, force: true });
	result.privateProfileRemoved = true;
	const after = await readFile(storePath);
	result.selectedStoreModified = sha256(before) !== sha256(after);
	result.environmentsUnchanged = beforeEnvs === sha256(JSON.stringify(JSON.parse(after).envs));
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
}
console.log(JSON.stringify({ output, ...result }, null, 2));
assert.equal(result.environmentsUnchanged, true, "Environment changes require reconciliation");
if (!intake) assert.equal(result.selectedStoreModified, false, "Reconcile changes before any selected-store write");
assert.equal(
	result.status,
	intake ? "selected-desktop-source-drafts-imported" : "selected-desktop-native-connection-verified",
);
