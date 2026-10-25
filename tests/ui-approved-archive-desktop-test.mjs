/** Existing independently approved six-feature result → real isolated Electron archival. Never executes the target. */
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile, symlink, realpath } from "node:fs/promises";
import { join, dirname, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { ArtifactStore, DesignReviewService, ResultReviewService, sha256 } from "pi-ui-testing";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { portUp } from "./lib/port-utils.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
import { waitUntil } from "../qa/ui/project-environment.mjs";
import { enableDataSpace } from "../scripts/enable-data-space.mjs";
import { validateResult } from "../.pi/skills/data-space-testing/scripts/validate-result.mjs";

const [directory] = process.argv.slice(2);
assert.ok(directory, "Usage: <original approved U05 evidence directory>; requires a verified prebuilt desktop");
const repo = fileURLToPath(new URL("..", import.meta.url)),
	source = resolve(directory);
assert.equal(process.env.PI_WEB_SMOKE_PREBUILT, "1", "Build separately; this test must never rebuild the app");
ensureBuild(repo, "approved-archive-desktop");
const load = async (name) => JSON.parse(await readFile(join(source, name), "utf8"));
const revision = await load("browser-v4-diagnostics.json"),
	delivered = await load("browser-v4-delivery.json"),
	formal = await load("browser-v4-formal.json");
assert.equal(delivered.status, "APPROVED_DELIVERED");
const reviewRef = (await load("native-review-10-authorization4.json")).tool.details.artifact_refs[0];
await new DesignReviewService(source, join(source, "ui-review-authority")).gate(revision.assetRef, reviewRef);
await new ResultReviewService(source, join(source, "ui-review-authority")).gate(
	delivered.report_ref,
	delivered.review_ref,
);
const sourceStore = new ArtifactStore(source);
const asset = await sourceStore.load(revision.assetRef),
	cases = await sourceStore.load(asset.data.cases_ref),
	scope = await sourceStore.load(asset.data.scope_ref);
assert.equal(cases.data.cases.length, 6);
const originalRefs = [
	revision.assetRef,
	formal.execution.run_ref,
	delivered.report_ref,
	delivered.review_ref,
	delivered.delivery_ref,
];
for (const ref of originalRefs) assert.equal(sha256(await readFile(join(source, ref.path))), ref.sha256);
const temporary = await realpath(await mkdtemp(join(tmpdir(), "u05-approved-desktop-")));
const workspace = join(temporary, "project"),
	userData = join(temporary, "desktop"),
	agentDir = join(userData, "agent"),
	dataDir = join(userData, "data");
const output = join(repo, "tests/scratch/ui-approved-archive-desktop", String(Date.now()));
await mkdir(output, { recursive: true });
await writeFile(join(output, "harness.mjs"), await readFile(fileURLToPath(import.meta.url)));
await mkdir(workspace, { recursive: true });
await mkdir(agentDir, { recursive: true });
// Public archival projection contains only the selected formal run. Never copy private approval authority or authentication.
const selectedRun = dirname(formal.execution.run_ref.path);
await cp(join(source, "qa"), join(workspace, "qa"), {
	recursive: true,
	filter: (path) => {
		const name = relative(source, path).replaceAll("\\", "/");
		if (name.startsWith("qa/ui/tasks") || name === "qa/ui/catalog.json") return false;
		if (
			name.startsWith("qa/ui/runs/") &&
			name !== selectedRun &&
			!selectedRun.startsWith(name + "/") &&
			!name.startsWith(selectedRun + "/")
		)
			return false;
		return true;
	},
});
await writeFile(join(workspace, "package.json"), '{"type":"module"}');
await symlink(join(repo, "node_modules"), join(workspace, "node_modules"), "dir");
for (const ref of originalRefs) assert.equal(sha256(await readFile(join(workspace, ref.path))), ref.sha256);
await assert.rejects(
	new DesignReviewService(workspace, join(temporary, "empty-authority")).gate(revision.assetRef, reviewRef),
	(error) => error.category === "review-rejected",
);
await writeFile(join(agentDir, "auth.json"), "{}");
await writeFile(join(agentDir, "models.json"), '{"providers":{}}');
await enableDataSpace(repo, { agentDir, dataDir });
await mkdir(join(dataDir, "data-space"), { recursive: true });
const featureMappings = cases.data.cases.map((c) => ({
	nativeModuleId: c.module_id,
	nativeFeatureId: c.feature_id,
	featureId: "desktop-" + c.feature_id,
}));
await writeFile(
	join(dataDir, "data-space/store.json"),
	JSON.stringify({
		version: 3,
		revision: 1,
		systems: [
			{ id: "desktop-u05", name: "U05 approved synthetic" },
			{ id: "other-project", name: "Other project" },
		],
		modules: [
			{ id: "desktop-names", systemId: "desktop-u05", name: "Names" },
			{ id: "other-names", systemId: "other-project", name: "Names" },
		],
		features: cases.data.cases.flatMap((c) => [
			{ id: "desktop-" + c.feature_id, moduleId: "desktop-names", name: c.feature_id },
			{ id: "other-" + c.feature_id, moduleId: "other-names", name: c.feature_id },
		]),
		cases: [],
		envs: [
			{ id: "desktop-u05-env", systemId: "desktop-u05", name: "Synthetic", baseUrl: scope.data.base_url },
			{ id: "other-env", systemId: "other-project", name: "Synthetic", baseUrl: scope.data.base_url },
		],
	}),
);
const port = 18978;
assert.equal(await portUp(port), false, "Preserve any existing port owner");
const env = { ...process.env };
for (const key of Object.keys(env))
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_|PI_)/.test(key) ||
		["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].includes(key)
	)
		delete env[key];
Object.assign(env, {
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PI_WEB_SDK: "bundled",
});
const result = {
	status: "FAIL",
	checks: [],
	modelCalls: 0,
	targetExecutions: 0,
	source_refs: originalRefs,
	asset_ref: revision.assetRef,
	run_ref: formal.execution.run_ref,
	workspace,
	scope:
		"Existing six-feature approved synthetic evidence archival in isolated Electron; no target execution or new review; not full discovery-to-delivery desktop acceptance",
};
let app, page;
const logs = [];
const readStore = async () => JSON.parse(await readFile(join(dataDir, "data-space/store.json"), "utf8"));
const readRuns = async () =>
	JSON.parse(await readFile(join(dataDir, "data-space/runs.json"), "utf8").catch(() => '{"runs":[]}'));
const request = (path, body) =>
	page.evaluate(
		async ({ path, body }) => {
			const r = await fetch(
				`/plugins-api/data-space${path}`,
				body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {},
			);
			const data = await r.json();
			if (!r.ok) throw new Error(JSON.stringify(data));
			return data;
		},
		{ path, body },
	);
const launch = async () => {
	app = await launchNativeApp({ executablePath: electron, packaged: false, env });
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	const close = page.locator(".setup-modal .modal-close");
	if (await close.isVisible()) await close.click();
};
const stop = async () => {
	logs.push(app.getLogs());
	await app.close();
	app = undefined;
};
try {
	await launch();
	const input = { engine: "ui", assetRef: revision.assetRef, envId: "desktop-u05-env", workspace, featureMappings };
	const prepared = await request("/automation", {
		action: "initialize",
		engine: "ui",
		mode: "execute",
		targetUrl: scope.data.base_url,
		envId: "desktop-u05-env",
		workspace,
	});
	assert.equal(prepared.status, "configured");
	for (const check of ["network", "authentication", "role", "data"])
		assert.equal(prepared.preparation[check].state, "unknown");
	assert.equal((await readStore()).cases.length, 0);
	const pending = await request("/automation", { ...input, action: "archive-status" });
	assert.equal(pending.counts.pending, 6);
	const imported = await request("/automation", { ...input, action: "import" });
	assert.equal(imported.imported, 6);
	assert.equal(imported.classificationComplete, true);
	const draft = await readStore();
	assert.equal(draft.cases.length, 6);
	assert.ok(draft.cases.every((c) => c.status === "草稿" && c.automation === null));
	assert.deepEqual(new Set(draft.cases.map((c) => c.featureId)), new Set(featureMappings.map((m) => m.featureId)));
	for (const item of imported.items) {
		const c = cases.data.cases.find((c) => c.case_id === item.nativeCaseId);
		assert.equal(item.featureId, "desktop-" + c.feature_id);
	}
	result.imported = imported;
	result.checks.push(
		"Explicit envId and six module/feature mappings import exactly six unbound drafts; same-name other-project features remain untouched",
	);
	const before = JSON.stringify(await readStore());
	const archived = await request("/automation", { ...input, action: "archive-status" });
	assert.equal(archived.counts.existing, 6);
	assert.equal(JSON.stringify(await readStore()), before);
	const repeated = await request("/automation", { ...input, action: "import" });
	assert.equal(repeated.duplicate, 6);
	assert.equal((await readStore()).cases.length, 6);
	for (const item of imported.items) {
		const bound = await request("/automation", {
			action: "bind",
			engine: "ui",
			workspace,
			assetRef: revision.assetRef,
			nativeCaseId: item.nativeCaseId,
			caseId: item.caseId,
			envId: "desktop-u05-env",
		});
		assert.equal(bound.binding.nativeCaseId, item.nativeCaseId);
	}
	const synced = await request("/automation", {
		action: "sync",
		engine: "ui",
		workspace,
		runRef: formal.execution.run_ref,
	});
	assert.equal(synced.imported, 6);
	assert.equal((await readRuns()).runs.length, 6);
	result.checks.push(
		"Archive-status is read-only, repeat import adds no cases; separate bindings and selected old-run sync create exactly six passed rows without rerunning target",
	);
	await stop();
	await launch();
	await waitUntil(
		async () => {
			const r = await readRuns();
			return r.runs.length === 6 && r.runs.every((r) => r.verdict === "通过");
		},
		"six original results after real desktop restart",
		60000,
	);
	const runBytes = await readFile(join(dataDir, "data-space/runs.json"), "utf8");
	const receipt = await request("/automation", {
		action: "sync-status",
		engine: "ui",
		workspace,
		runRef: formal.execution.run_ref,
	});
	assert.equal(receipt.complete, true);
	assert.equal(receipt.counts.existing, 6);
	assert.ok(receipt.items.every((i) => i.projectId === "desktop-u05" && i.verdict === "通过"));
	assert.equal(await readFile(join(dataDir, "data-space/runs.json"), "utf8"), runBytes);
	result.receipt = receipt;
	result.checks.push(
		"Real Electron host restart recovers six distinct case/instance/version links; sync-status reads the same batch without changing runs.json",
	);
	await page.locator("header button, .topbar button, nav button").filter({ hasText: "数据空间" }).first().click();
	await page.locator('.dsp-nav button[data-tab="cases"]').click();
	const rows = page.locator(".case-table tbody tr");
	await waitUntil(async () => (await rows.count()) === 6, "six mapped desktop case rows", 30000);
	await page.screenshot({ path: join(output, "six-features.png") });
	const row = rows.filter({ has: page.locator(`[data-act="edit-case"][data-id="${imported.caseIds[0]}"]`) });
	await row.locator('[data-act="automation-open"]').click();
	await page.locator(".dsp-modal summary").filter({ hasText: "原生来源与修订" }).click();
	assert.ok((await page.locator(".dsp-modal").innerText()).includes(revision.assetRef.sha256));
	await page.locator(".dsp-modal summary").filter({ hasText: "原生执行记录与证据" }).click();
	assert.ok((await page.locator(".dsp-modal").innerText()).includes(receipt.runId));
	await page.locator('.dsp-modal textarea[data-f="runText"]').fill(JSON.stringify(formal.execution.run_ref));
	await page.locator('.dsp-modal [data-act="automation-sync"]').click();
	await waitUntil(
		async () => /已同步 0 条，重复 6 条/.test(await page.locator(".dsp-modal").innerText()),
		"desktop existing-run sync receipt",
		30000,
	);
	assert.equal((await readRuns()).runs.length, 6);
	await page.screenshot({ path: join(output, "source-and-run.png") });
	result.checks.push(
		"Actual desktop shows all six feature cases and immutable asset/run references; existing-run sync button reports 0 new / 6 duplicate and preserves six result rows",
	);
	const delivery = {
		format: "data-space-result/v1",
		context: {
			workspace,
			project: { id: "desktop-u05", name: "U05 approved synthetic" },
			environment: { id: "desktop-u05-env", name: "Synthetic" },
		},
		origin: "native",
		native: {
			engine: "ui",
			assetRef: revision.assetRef,
			runRef: formal.execution.run_ref,
			runId: receipt.runId,
			parentRunId: receipt.parentRunId || null,
		},
		results: receipt.items.map((i) => ({
			case: i.caseId,
			nativeCaseId: i.nativeCaseId,
			featureId: i.featureId,
			caseVersion: i.caseVersion,
			verdict: i.verdict,
			note: "Previously independently approved synthetic batch, synchronized without target replay",
		})),
		evidence: originalRefs,
		evidenceComplete: true,
		reportReview: {
			report_ref: delivered.report_ref,
			review_ref: delivered.review_ref,
			decision: "approved",
			verified_in_original_authority: true,
		},
		writeback: { method: "native-sync", status: "confirmed", receipt },
		gaps: [],
	};
	const validated = validateResult(delivery);
	assert.equal(validated.ok, true, JSON.stringify(validated.errors));
	assert.equal(
		validateResult({
			...delivery,
			context: { ...delivery.context, project: { id: "other-project", name: "Other project" } },
		}).ok,
		false,
	);
	await writeFile(join(output, "delivery.json"), JSON.stringify(delivery, null, 2));
	await writeFile(join(output, "delivery-validation.json"), JSON.stringify(validated, null, 2));
	result.checks.push(
		"Six-row structured delivery reconciles actual desktop receipt and original native review; cross-project contradictory delivery is rejected",
	);
	for (const ref of originalRefs) {
		assert.equal(sha256(await readFile(join(source, ref.path))), ref.sha256);
		assert.equal(sha256(await readFile(join(workspace, ref.path))), ref.sha256);
	}
	await writeFile(join(output, "store.json"), JSON.stringify(await readStore(), null, 2));
	await writeFile(join(output, "runs.json"), JSON.stringify(await readRuns(), null, 2));
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
	await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
} finally {
	await writeFile(join(output, "store.json"), JSON.stringify(await readStore(), null, 2));
	await writeFile(join(output, "runs.json"), JSON.stringify(await readRuns(), null, 2));
	if (app) await stop();
	await writeFile(join(output, "desktop.log"), logs.join("\n"));
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
