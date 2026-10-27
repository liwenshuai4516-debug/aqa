/** Real native asset reader + original intake, isolated data only. No test execution. */
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, symlink, realpath, chmod } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactStore, sha256 } from "pi-ui-testing";
import { scope, cases } from "../data-space/ui-artifacts.mjs";
import { normalizeStore } from "../../../plugins/data-space/model.mjs";
import { createAutomation } from "../../../plugins/data-space/automation.mjs";
import { atomicJson } from "../../../plugins/data-space/durable.mjs";
export async function installDataSpace({ repo, workspace, dataDir }) {
	const { TestAssetReader } = await import("../../../dist/server/test-asset-reader.js");
	workspace = await realpath(workspace);
	await symlink(join(repo, "plugins/data-space"), join(dataDir, "plugins/data-space"), "dir");
	const store = new ArtifactStore(workspace),
		requirement = "EC09 isolated 75-case intake fixture. No model or test execution.\n";
	await writeFile(join(workspace, "requirements.md"), requirement);
	const declared = scope();
	declared.data.base_url = "http://localhost:18999";
	declared.data.sources[0].ref = { path: "requirements.md", sha256: sha256(requirement) };
	const scopeRef = await store.put(declared),
		rules = await store.putFile("qa/ui/cases/ec09/data-rules.json", "{}\n"),
		draft = cases(),
		template = draft.data.cases[0];
	draft.id = "ec09";
	draft.data.scope_ref = scopeRef;
	draft.data.sources = declared.data.sources;
	draft.data.data_rules_ref = rules;
	draft.data.cases = Array.from({ length: 75 }, (_, i) => {
		const c = structuredClone(template);
		c.case_id = `EC09-${i + 1}`;
		c.steps[0].assertion_ids = [`EC09-A${i + 1}`];
		c.assertions[0].assertion_id = `EC09-A${i + 1}`;
		c.title = `EC09 isolated case ${i + 1}`;
		c.priority = i < 28 ? "P0" : "P1";
		return c;
	});
	const assetRef = await store.put(draft);
	let state = {
		...normalizeStore({
			systems: [{ id: "ec09-project", name: "EC09 isolated project" }],
			modules: [],
			features: [],
			cases: [],
			envs: [{ id: "ec09-env", systemId: "ec09-project", name: "EC09 test", baseUrl: "http://localhost:18999" }],
		}),
		revision: 1,
		version: 3,
	};
	const path = join(dataDir, "data-space/store.json"),
		reader = new TestAssetReader(dataDir);
	const host = {
		dataDir,
		testing: {
			inspect: (...a) => reader.inspect(...a),
			list: async () => [],
			read: () => {
				throw new Error("No run expected");
			},
		},
		onToolEvent: () => () => {},
		broadcast: () => {},
		log: () => {},
	};
	const automation = createAutomation({
		host,
		store: () => state,
		runs: () => ({ revision: 1, runs: [] }),
		commitStore: (s) => {
			state = s;
			atomicJson(path, state);
		},
		commitRuns: () => {
			throw new Error("No native result writes allowed");
		},
	});
	await automation.idle();
	atomicJson(path, state);
	await automation.call(workspace, { action: "initialize", engine: "ui", envId: "ec09-env" });
	const receipt = await automation.call(workspace, { action: "import", engine: "ui", assetRef, envId: "ec09-env" });
	assert.equal(receipt.imported, 75);
	const duplicate = await automation.call(workspace, { action: "import", engine: "ui", assetRef, envId: "ec09-env" });
	assert.equal(duplicate.imported, 0);
	automation.dispose();
	return { assetRef, receipt, duplicate, businessBytes: await readFile(path, "utf8"), path };
}
export async function verifyDataSpace({ page, until, output, dataDir, fixture, original, settings, closeSettings }) {
	const back = page.locator('.aev [data-action="back"]');
	if (await back.count()) await back.click();
	const row = page.locator(`.aev [data-action="open"][data-id="${original.id}"]`);
	while (!(await row.count())) {
		await page.locator('.aev [data-action="next"]').click();
		await page.waitForTimeout(100);
	}
	await row.click();
	await page.locator('.aev [data-action="data-space"]').click();
	await page.locator('.aev [data-project-operation="inspect"]').click();
	await page
		.locator('.aev [name="statement"]')
		.fill("All 75 selected native cases are present in EC09 isolated project at observation time.");
	await page.locator('.aev [name="confirmed"]').check();
	await page.locator('.aev [data-form="data-space-score"] button').click();
	await until(async () => {
		const error = await page.locator('.aev [role="alert"]').innerText();
		if (error) throw new Error(error);
		return !(await page.locator('.aev [data-form="data-space-score"]').count());
	});
	await until(async () => {
		const alert = await page.locator('.aev [role="alert"]').innerText();
		if (alert) throw new Error(alert);
		const status = page.locator('.aev [data-action="status"]:not([disabled])');
		if (await status.count()) await status.click();
		return (await page.locator(".aev article h3").allTextContents()).some((t) => t.includes("F03"));
	});
	const finding = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F03" }) });
	assert.match(await finding.innerText(), /Pass/);
	await page.locator('.aev [data-action="data-space"]').click();
	await page.locator('.aev [data-project-operation="sync"]').click();
	await until(async () => /Synchronized/.test(await page.locator(".aev [data-project-status]").innerText()));
	const ledgerPath = join(dataDir, "data-space/evaluation-index.json"),
		first = await readFile(ledgerPath, "utf8");
	assert.equal(JSON.parse(first).reports.length, 1);
	await page.locator('.aev [data-project-operation="sync"]').click();
	await until(async () => /Synchronized/.test(await page.locator(".aev [data-project-status]").innerText()));
	assert.equal(await readFile(ledgerPath, "utf8"), first);
	await page.locator(".aev [data-project-panel]").screenshot({ path: join(output, "data-space-synced-en.png") });
	await page.evaluate(() => {
		document.documentElement.lang = "zh-CN";
	});
	await page.getByRole("heading", { name: "数据空间专项诊断", exact: true }).waitFor();
	await page.setViewportSize({ width: 800, height: 650 });
	assert.equal(
		await page.locator(".aev [data-project-panel]").evaluate((el) => el.scrollWidth <= el.clientWidth),
		true,
	);
	await page.locator(".aev [data-project-panel]").screenshot({ path: join(output, "data-space-synced-zh-narrow.png") });
	await page.setViewportSize({ width: 1280, height: 850 });
	await page.evaluate(() => {
		document.documentElement.lang = "en";
	});
	await settings("plugins");
	await page.getByRole("tab", { name: /Plugin list|插件列表/ }).click();
	const plugin = page
		.locator(".settings-modal .set-row")
		.filter({ has: page.locator(".set-row-name", { hasText: /Data Space|数据空间/ }) });
	await plugin.getByRole("switch").click();
	await closeSettings();
	await page.locator('.aev [data-project-operation="status"]').click();
	await until(async () => /PERMISSION_DENIED/.test(await page.locator(".aev [data-project-status]").innerText()));
	await page.locator('.aev [data-action="reevaluate"]').click();
	await until(async () => {
		const b = page.locator('.aev [data-action="status"]:not([disabled])');
		if (await b.count()) await b.click();
		return (
			!!(await page.locator(".aev article h3").count()) && !(await page.locator(".aev [data-project-panel]").count())
		);
	});
	await settings("plugins");
	await page.getByRole("tab", { name: /Plugin list|插件列表/ }).click();
	await plugin.getByRole("switch").click();
	await closeSettings();
	assert.equal(
		await readFile(fixture.path, "utf8"),
		fixture.businessBytes,
		"diagnosis/synchronization never re-imports cases or changes business data",
	);

	// A new report needs its own index; a genuine filesystem write denial must stay visible.
	await page.locator('.aev [data-action="data-space"]').click();
	const directory = join(dataDir, "data-space");
	await chmod(directory, 0o500);
	try {
		await page.locator('.aev [data-project-operation="sync"]').click();
		await until(async () => /EACCES|EPERM/.test(await page.locator(".aev [data-project-status]").innerText()));
		assert.equal(await readFile(ledgerPath, "utf8"), first);
		await page.locator(".aev [data-project-panel]").screenshot({ path: join(output, "data-space-write-failed.png") });
	} finally {
		await chmod(directory, 0o700);
	}
	// Plan restrictions apply to UI index writes too. Queries continue to work.
	const togglePlan = async (enabled) => {
		const offset = await page.evaluate(() => window.__evaluationFrames.length);
		await page.evaluate(
			(enabled) => window.__evaluationSocket.send(JSON.stringify({ type: "set_plan_mode", enabled })),
			enabled,
		);
		await until(() =>
			page.evaluate(
				({ offset, enabled }) =>
					window.__evaluationFrames
						.slice(offset)
						.some((f) => f.type === "notice" && (f.textEn ?? "").includes(enabled ? "Plan mode on" : "Plan mode off")),
				{ offset, enabled },
			),
		);
	};
	await togglePlan(true);
	await page.locator('.aev [data-project-operation="sync"]').click();
	await until(async () => /disabled/.test(await page.locator('.aev [role="alert"]').innerText()));
	assert.equal(await readFile(ledgerPath, "utf8"), first);
	await page.locator('.aev [data-project-operation="status"]').click();
	await until(async () => /Synchronization failed/.test(await page.locator(".aev [data-project-status]").innerText()));
	await togglePlan(false);
	await page.locator('.aev [data-project-operation="sync"]').click();
	await until(async () => /Synchronized/.test(await page.locator(".aev [data-project-status]").innerText()));
	const recovered = JSON.parse(await readFile(ledgerPath, "utf8"));
	assert.equal(recovered.reports.length, 2);
	const latest = recovered.reports[1];
	// Rename through the existing authenticated Data Space API; cases and environments are retained.
	const renamed = await page.evaluate(async () => {
		const state = await (await fetch("/plugins-api/data-space/state")).json();
		const systems = state.systems.map((p) => ({ ...p, name: "EC09 renamed isolated project" }));
		const response = await fetch("/plugins-api/data-space/save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...state, systems, baseRevision: state.revision }),
		});
		return { status: response.status, body: await response.json() };
	});
	assert.equal(renamed.status, 200, JSON.stringify(renamed));
	const afterRename = JSON.parse(await readFile(fixture.path, "utf8")),
		beforeRename = JSON.parse(fixture.businessBytes);
	assert.deepEqual(afterRename.cases, beforeRename.cases);
	assert.deepEqual(afterRename.envs, beforeRename.envs);
	await page.locator('.aev [data-project-operation="status"]').click();
	await until(async () => /Synchronized/.test(await page.locator(".aev [data-project-status]").innerText()));
	assert.deepEqual(JSON.parse(await readFile(ledgerPath, "utf8")).reports[1].projectRef, latest.projectRef);

	await writeFile(
		join(output, "data-space-receipts.json"),
		JSON.stringify(
			{
				firstIntake: fixture.receipt,
				repeatIntake: fixture.duplicate,
				index: recovered,
				projectRenamed: true,
				writeDeniedAndRecovered: true,
				planWriteDenied: true,
			},
			null,
			2,
		),
	);
	return {
		status: "PASS",
		cases: 75,
		indexCount: 2,
		duplicateIndexCount: 1,
		projectRenamed: true,
		writeDeniedAndRecovered: true,
		planWriteDenied: true,
		businessUnchanged: true,
		modelCalls: 0,
		testExecutions: 0,
		index: latest,
	};
}
export async function reopenDataSpace({ page, until, dataDir, result }) {
	const offset = await page.evaluate(() => window.__evaluationFrames.length),
		requestId = crypto.randomUUID();
	await page.evaluate(
		(payload) =>
			window.__evaluationSocket.send(JSON.stringify({ type: "plugin_message", pluginId: "agent-evaluation", payload })),
		{
			action: "projectReportStatus",
			requestId,
			ref: { kind: "evaluations", id: result.index.evaluationId, revision: 1 },
			data: { projectRef: result.index.projectRef },
		},
	);
	let reply;
	await until(async () => {
		reply = await page.evaluate(
			({ offset, requestId }) =>
				window.__evaluationFrames
					.slice(offset)
					.find((f) => f.type === "plugin_data" && f.payload?.requestId === requestId)?.payload,
			{ offset, requestId },
		);
		return !!reply;
	});
	assert.equal(reply.ok, true, JSON.stringify(reply));
	assert.equal(reply.result.status, "synced");
	assert.equal(reply.result.receipt.key, result.index.key);
	assert.equal(
		JSON.parse(await readFile(join(dataDir, "data-space/evaluation-index.json"), "utf8")).reports.length,
		result.indexCount,
	);
}
