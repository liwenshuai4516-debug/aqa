/** Real Electron, isolated data, seeded SDK history; no model, CLI or business execution. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { digest } from "../plugins/agent-evaluation/schema.mjs";
import electron from "electron";
import { enableAgentEvaluation } from "../scripts/enable-agent-evaluation.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
import { verifyOfflineImport, reopenOfflineImport } from "./fixtures/agent-evaluation/offline-import.mjs";
import { installActiveJobProbe, verifyActiveJobs } from "./fixtures/agent-evaluation/active-jobs.mjs";
import { longEvidenceText, verifyEvidenceMatrix } from "./fixtures/agent-evaluation/evidence-matrix.mjs";
import { installRollbackFixture, verifyRollback } from "./fixtures/agent-evaluation/rollback.mjs";
import { verifyScale } from "./fixtures/agent-evaluation/scale.mjs";
const scale = process.argv.includes("--scale");
assert.ok(
	!(scale && (process.argv.includes("--rollback") || process.argv.includes("--active-jobs"))),
	"Run scale separately from rollback and injected active jobs",
);
const evidenceMatrix = process.argv.includes("--evidence-matrix");
const rollback = process.argv.includes("--rollback");
assert.ok(!(rollback && process.argv.includes("--active-jobs")), "Run rollback separately from injected active jobs");
const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "agent-evaluation-desktop");
const output = await mkdtemp(join(tmpdir(), "agent-evaluation-desktop-"));
const userData = join(output, "desktop"),
	agentDir = join(userData, "agent"),
	dataDir = join(userData, "data"),
	workspace = join(output, "workspace");
for (const path of [agentDir, workspace, join(agentDir, "sessions")]) await mkdir(path, { recursive: true });
await writeFile(join(agentDir, "auth.json"), "{}");
await writeFile(join(agentDir, "models.json"), '{"providers":{}}');
await writeFile(join(workspace, "result.json"), '{"ok":true}');
const sessionPath = join(agentDir, "sessions/2026-10-24T00-00-00-000Z_evaluation-desktop.jsonl");
await writeFile(
	sessionPath,
	[
		{ type: "session", version: 3, id: "evaluation-desktop", timestamp: "2026-10-24T00:00:00Z", cwd: workspace },
		{
			type: "message",
			id: "u1",
			parentId: null,
			timestamp: "2026-10-24T00:00:01Z",
			message: {
				role: "user",
				content: [{ type: "text", text: "Verify result.json (synthetic offline fixture)" }],
				timestamp: 1792800001000,
			},
		},
		{
			type: "message",
			id: "a1",
			parentId: "u1",
			timestamp: "2026-10-24T00:00:02Z",
			message: {
				role: "assistant",
				timestamp: 1792800002000,
				content: [
					{
						type: "text",
						text: evidenceMatrix ? longEvidenceText : "Offline source navigation fixture; no model was called.",
					},
				],
				stopReason: "stop",
				model: "offline-fixture",
				provider: "fixture",
				api: "offline",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
		},
	]
		.map(JSON.stringify)
		.join("\n") + "\n",
);
await enableAgentEvaluation(repo, { agentDir, dataDir });
const settingsBefore = await readFile(join(agentDir, "settings.json"), "utf8");
await enableAgentEvaluation(repo, { agentDir, dataDir });
assert.equal(await readFile(join(agentDir, "settings.json"), "utf8"), settingsBefore);
if (rollback) await installRollbackFixture(repo, dataDir, agentDir);
const activeJobProbe = process.argv.includes("--active-jobs")
	? await installActiveJobProbe(repo, dataDir, output)
	: undefined;
const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
assert.ok(port >= 8900);
await new Promise((r) => reservation.close(r));
const env = {
	PATH: process.env.PATH,
	HOME: process.env.HOME,
	TMPDIR: process.env.TMPDIR,
	LANG: "en_US.UTF-8",
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PI_WEB_SDK: "bundled",
};
const result = {
	status: "running",
	output,
	userData,
	agentDir,
	dataDir,
	workspace,
	checks: [],
	actualModelCalls: 0,
	actualCliCalls: 0,
};
let app, page, overrideServer;
async function until(fn, timeout = 30000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`Timeout at ${result.stage}`);
}
const stage = (name) => {
	result.stage = name;
	console.log(name);
};
try {
	stage("launch real Electron");
	app = await launchNativeApp({
		executablePath: electron,
		packaged: false,
		env,
		mainPath: join(repo, "dist/desktop/main.js"),
	});
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	await page.addInitScript(() => {
		const Native = window.WebSocket;
		window.__evaluationFrames = [];
		window.WebSocket = class extends Native {
			constructor(...args) {
				super(...args);
				if (String(args[0]).includes("/ws")) {
					window.__evaluationSocket = this;
					this.addEventListener("message", (e) => {
						try {
							window.__evaluationFrames.push(JSON.parse(e.data));
						} catch {}
					});
				}
			}
		};
		localStorage.setItem("pi-web-ui:lang", "en");
	});
	await page.reload();
	await page.waitForSelector(".app");
	await until(() => page.evaluate(() => window.__evaluationFrames.some((f) => f.type === "ready")));
	const setup = page.locator(".setup-modal .modal-close");
	if (await setup.isVisible()) await setup.click();
	const send = (message) => page.evaluate((m) => window.__evaluationSocket.send(JSON.stringify(m)), message);
	await send({ type: "switch_session", path: sessionPath });
	await until(() =>
		page.evaluate(() =>
			window.__evaluationFrames.some((f) =>
				JSON.stringify(f.state?.messages ?? []).includes("synthetic offline fixture"),
			),
		),
	);
	await until(() =>
		page.evaluate(() =>
			window.__evaluationFrames.some(
				(f) =>
					f.type === "plugins" &&
					f.plugins.some((p) => p.id === "agent-evaluation" && p.version === "0.4.21" && p.active),
			),
		),
	);
	result.checks.push(
		"Real app loads plugin 0.4.21 in explicitly registered app directories; seeded SDK history opened without a model prompt",
	);
	stage("settings and slash discovery");
	const settings = async (tab) => {
		await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
		await page.locator(`.settings-tab[data-tab="${tab}"]`).click();
	};
	const closeSettings = () => page.locator(".set-close-btn").click();
	const skill = () =>
		page.locator(".settings-modal .set-row").filter({ has: page.locator('.set-row-name [title="agent-evaluation"]') });
	const plugin = () =>
		page
			.locator(".settings-modal .set-row")
			.filter({ has: page.locator(".set-row-name", { hasText: /Agent 评估中心|Agent evaluation/ }) });
	await settings("skills");
	await skill().waitFor();
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "true");
	await closeSettings();
	const input = page.locator("textarea").first();
	await input.fill("/agent-eval");
	const candidate = page.locator('.slash-name[title="/skill:agent-evaluation"]');
	await candidate.waitFor();
	await input.fill("");
	await settings("tools");
	const tool = page
		.locator(".settings-modal .set-row")
		.filter({ has: page.locator(".set-row-name", { hasText: "agent_evaluation" }) });
	await tool.waitFor();
	assert.equal(await tool.getByRole("switch").getAttribute("aria-checked"), "true");
	await page.screenshot({ path: join(output, "tools.png") });
	await closeSettings();
	result.checks.push("Skill, slash completion and agent_evaluation tool appear in actual desktop management");
	stage("explicit reload and plugin rescan");
	let frameOffset = await page.evaluate(() => window.__evaluationFrames.length);
	await input.fill("/reload");
	await page.locator("button.send").click();
	await until(() =>
		page.evaluate(
			(offset) =>
				window.__evaluationFrames
					.slice(offset)
					.some(
						(f) =>
							f.type === "notice" &&
							f.level === "info" &&
							[f.text, f.textEn].some((text) => /Reloaded extensions|已重新加载扩展/.test(text ?? "")),
					),
			frameOffset,
		),
	);
	await settings("skills");
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "true");
	await closeSettings();
	await settings("plugins");
	await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	frameOffset = await page.evaluate(() => window.__evaluationFrames.length);
	const previousEpoch = await page.evaluate(() =>
		Math.max(...window.__evaluationFrames.filter((f) => f.type === "plugins").map((f) => f.epoch)),
	);
	await page
		.locator(".settings-modal")
		.getByRole("button", { name: /^(Rescan|重新扫描)$/ })
		.click();
	await until(() =>
		page.evaluate(
			({ offset, epoch }) =>
				window.__evaluationFrames
					.slice(offset)
					.some(
						(f) =>
							f.type === "plugins" &&
							f.epoch > epoch &&
							f.plugins.some(
								(p) =>
									p.id === "agent-evaluation" &&
									p.version === "0.4.21" &&
									p.agentTools?.some((tool) => tool.name === "agent_evaluation"),
							),
					),
			{ offset: frameOffset, epoch: previousEpoch },
		),
	);
	assert.equal(await plugin().getByRole("switch").getAttribute("aria-checked"), "true");
	await closeSettings();
	await settings("tools");
	await tool.waitFor();
	assert.equal(await tool.getByRole("switch").getAttribute("aria-checked"), "true");
	await closeSettings();
	await input.fill("/agent-eval");
	await candidate.waitFor();
	await input.fill("");
	result.checks.push(
		"Actual /reload success notice and settings Rescan advance the catalog epoch for 0.4.21; skill, slash discovery and tool registration remain enabled",
	);
	stage("product diagnosis flow");
	const openView = async () => {
		await page.getByText("Agent evaluation", { exact: true }).first().click();
		await page.locator(".aev").waitFor();
	};
	await send({ type: "switch_session", path: sessionPath });
	await until(() =>
		page
			.locator(".msg")
			.filter({ hasText: "synthetic offline fixture" })
			.count()
			.catch(() => 0),
	);
	await openView();
	await page.locator('.aev [data-action="new"]:not([disabled])').waitFor();
	assert.equal(await page.locator(".aev [role=alert]").innerText(), "");
	await page.locator('.aev [data-action="new"]').click();
	await page.locator('.aev [name="objective"]').fill("Offline desktop check of result.json");
	await page.locator('.aev [name="paths"]').fill("result.json");
	await page.locator('.aev [name="format"]').selectOption("json");
	await page.locator('.aev button[type="submit"]').click();
	await until(async () => {
		const error = await page.locator(".aev [role=alert]").innerText();
		if (error) throw new Error(error);
		if (await page.locator('.aev [data-action="status"]:not([disabled])').isVisible())
			await page.locator('.aev [data-action="status"]').click();
		return (await page.locator(".aev article h3").count()) > 0;
	});
	const artifact = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F01" }) });
	assert.match(await artifact.innerText(), /Pass/);
	await page.screenshot({ path: join(output, "detail-en.png") });
	await artifact.locator('[data-action="evidence"]').first().click();
	await page.locator(".aev [data-evidence-panel] pre").waitFor();
	assert.match(await page.locator(".aev [data-evidence-panel]").innerText(), /result.json/);
	await page.locator('.aev [data-action="evidence-artifact"]').click();
	await until(async () => (await page.locator(".aev [data-evidence-panel] pre").innerText()) === '{"ok":true}');
	assert.equal(await page.locator(".aev [data-evidence-panel]").evaluate((el) => el === document.activeElement), true);
	await page.locator('.aev [data-action="evidence-raw"]').click();
	await until(async () => (await page.locator(".aev [data-evidence-panel] pre").innerText()).includes('"exists":true'));
	result.checks.push(
		"Actual desktop switches between sealed file text and original evidence, retaining keyboard focus",
	);
	await artifact.locator("summary", { hasText: "Human reviews" }).click();
	await artifact.locator('[name="reason"]').fill("Manual semantic review is still needed.");
	await artifact.locator('button[type="submit"]').click();
	await until(() => artifact.locator(".review").count());
	await artifact.locator("summary", { hasText: "Human reviews" }).click();
	assert.match(await artifact.innerText(), /Manual semantic review is still needed/);
	assert.match(await artifact.innerText(), /Original verdict: Pass/);
	result.checks.push(
		"Actual desktop select/create/collect/seal/score, evidence paging, append human review and retain original verdict",
	);
	stage("native redacted export");
	const exportPath = join(output, "export.json");
	const downloadSession = await page.context().newCDPSession(page);
	await downloadSession.send("Browser.setDownloadBehavior", { behavior: "default" });
	await downloadSession.detach();
	await app.evaluate(({ BrowserWindow }, path) => {
		globalThis.__evaluationDownload = undefined;
		BrowserWindow.getAllWindows()[0].webContents.session.once("will-download", (_event, item) => {
			item.setSavePath(path);
			item.once("done", (_event, state) => {
				globalThis.__evaluationDownload = state;
			});
		});
	}, exportPath);
	await page.locator('.aev [data-action="export"]').click();
	await until(async () => (await app.evaluate(() => globalThis.__evaluationDownload)) === "completed");
	const exported = JSON.parse(await readFile(exportPath, "utf8"));
	const { manifestDigest, ...body } = exported;
	assert.equal(digest(body), manifestDigest);
	assert.equal(exported.records.filter((r) => r.kind === "reviews").length, 1);
	assert.equal(exported.records.filter((r) => r.kind === "evaluations").length, 1);
	result.checks.push(
		"Actual Electron blob download reopens as a valid redacted export, including separate review and verifiable manifest",
	);

	stage("frozen re-scoring and contract revision");
	const storeRoot = join(dataDir, "agent-evaluation");
	const names = async (kind) => (await readdir(join(storeRoot, kind))).filter((file) => file.endsWith(".json"));
	const reports = async () =>
		Promise.all(
			(await names("evaluations")).map(async (file) =>
				JSON.parse(await readFile(join(storeRoot, "evaluations", file), "utf8")),
			),
		);
	const [original] = await reports();
	const originalFile = join(storeRoot, "evaluations", `${original.id}.1.json`);
	const originalBytes = await readFile(originalFile, "utf8");
	if (evidenceMatrix) {
		stage("actual Electron long evidence, read-error recovery and painted latency matrix");
		result.evidenceMatrix = await verifyEvidenceMatrix({
			page,
			output,
			dataDir,
			repo,
			original,
			exported,
			names,
			until,
		});
		result.checks.push(
			"Actual Electron pages the complete long evidence, escapes markup/redacts the fixture secret, measures five painted list/report/evidence actions, preserves the sealed view on a real missing-pack error and recovers by explicit retry without creating records",
		);
	}
	const attemptsBefore = await names("attempts"),
		snapshotsBefore = await names("snapshots");
	// Only this isolated fixture changes. Frozen re-scoring must keep the old valid bytes.
	await writeFile(join(workspace, "result.json"), "invalid JSON from a later observation");
	await page.locator('.aev [data-action="reevaluate"]').click();
	const waitForDifferentReport = async (oldId) =>
		until(async () => {
			const error = await page.locator(".aev [role=alert]").innerText();
			if (error) throw new Error(error);
			if (await page.locator('.aev [data-action="status"]:not([disabled])').isVisible())
				await page.locator('.aev [data-action="status"]').click();
			return (
				(await page.locator(".aev article h3").count()) > 0 &&
				!(await page.locator(".aev small").first().innerText()).includes(oldId)
			);
		});
	await waitForDifferentReport(original.id);
	assert.match(await artifact.innerText(), /Pass/);
	const rescored = (await reports()).find((record) => record.id !== original.id);
	assert.ok(rescored);
	assert.deepEqual(rescored.data.snapshotRef, original.data.snapshotRef);
	assert.deepEqual(rescored.data.configuration, original.data.configuration);
	assert.equal(rescored.data.configDigest, original.data.configDigest);
	assert.deepEqual(await names("attempts"), attemptsBefore);
	assert.deepEqual(await names("snapshots"), snapshotsBefore);
	assert.equal(await readFile(originalFile, "utf8"), originalBytes);
	assert.equal(await page.locator(".aev .review").count(), 0);
	await page.locator('.aev [data-action="revise"]').click();
	await page.locator('.aev form[data-form="revision"]').waitFor();
	assert.equal(await page.locator('.aev [name="conditions-0-statement"]').getAttribute("readonly"), "");
	await page.locator('.aev [name="objective"]').fill("Revised offline desktop diagnosis");
	await page.locator('.aev [name="additionalConditions"]').fill("Human confirms semantic correctness");
	assert.ok(
		await page
			.locator('.aev form[data-form="revision"] button[type="submit"]')
			.evaluate((el) => el.getBoundingClientRect().height >= 36),
	);
	await page.screenshot({ path: join(output, "revision-en.png") });
	await page.setViewportSize({ width: 800, height: 650 });
	assert.equal(await page.locator(".aev").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
	await page.screenshot({ path: join(output, "revision-narrow.png") });
	await page.setViewportSize({ width: 1280, height: 850 });
	await page.locator('.aev form[data-form="revision"] button[type="submit"]').click();
	await waitForDifferentReport(rescored.id);
	assert.match(await artifact.innerText(), /Fail/);
	const revised = (await reports()).find((record) => ![original.id, rescored.id].includes(record.id));
	assert.ok(revised);
	assert.equal(revised.data.contractRef.id, original.data.contractRef.id);
	assert.equal(revised.data.contractRef.revision, 2);
	assert.notDeepEqual(revised.data.snapshotRef, original.data.snapshotRef);
	const contractFile = join(storeRoot, "contracts", `${revised.data.contractRef.id}.2.json`);
	const revisedContract = JSON.parse(await readFile(contractFile, "utf8"));
	const originalContract = JSON.parse(
		await readFile(join(storeRoot, "contracts", `${original.data.contractRef.id}.1.json`), "utf8"),
	);
	assert.deepEqual(revisedContract.data.scope, originalContract.data.scope);
	assert.equal(revisedContract.data.objective, "Revised offline desktop diagnosis");
	const manual = revisedContract.data.conditions.find(
		(condition) => condition.statement === "Human confirms semantic correctness",
	);
	assert.ok(manual);
	assert.ok(
		revised.data.findings.some((finding) => finding.conditionId === manual.id && finding.verdict === "inconclusive"),
	);
	assert.equal((await names("attempts")).length, attemptsBefore.length + 1);
	assert.equal((await names("snapshots")).length, snapshotsBefore.length + 1);
	assert.equal(await readFile(originalFile, "utf8"), originalBytes);
	await page.locator('.aev [data-action="back"]').click();
	await page.locator('.aev [data-action="open"][data-id="' + original.id + '"]:not([disabled])').click();
	await artifact.locator("summary", { hasText: "Human reviews" }).click();
	assert.match(await artifact.innerText(), /Manual semantic review is still needed/);
	assert.match(await artifact.innerText(), /Original verdict: Pass/);
	result.revisionChecks = {
		originalId: original.id,
		rescoredId: rescored.id,
		revisedId: revised.id,
		originalSnapshotRef: original.data.snapshotRef,
		revisedSnapshotRef: revised.data.snapshotRef,
		contractRevision: revised.data.contractRef.revision,
		reScoreAddedAttempts: 0,
		revisionAddedAttempts: 1,
		originalBytesUnchanged: true,
	};
	result.checks.push(
		"Actual desktop re-scoring preserves the exact frozen snapshot/configuration and creates no attempt; revision keeps the selection and old reports/reviews, re-observes changed fixture bytes, and leaves added semantic requirements inconclusive",
	);

	stage("fixed-scope observation start, status, stop and scoring");
	await writeFile(join(workspace, "result.json"), '{"ok":true}');
	const observationAttemptsBefore = await names("attempts");
	const oldReportIds = (await reports()).map((record) => record.id);
	await page.locator('.aev [data-action="watch-start"]').click();
	await page.locator('.aev [data-action="watch-score"]:not([disabled])').waitFor();
	assert.match(await page.locator(".aev [data-observation]").innerText(), /Observing/);
	await page.locator('.aev [data-action="watch-status"]').click();
	await page.locator('.aev [data-action="watch-stop"]:not([disabled])').waitFor();
	await page.screenshot({ path: join(output, "observation-en.png") });
	await page.locator('.aev [data-action="watch-stop"]').click();
	await page.locator('.aev [data-action="watch-dismiss"]:not([disabled])').waitFor();
	assert.match(await page.locator(".aev [data-observation]").innerText(), /Stopped/);
	assert.equal(await page.locator('.aev [data-action="watch-stop"]').count(), 0);
	await page.locator('.aev [data-action="watch-score"]').click();
	await waitForDifferentReport(original.id);
	const observationReport = (await reports()).find((record) => !oldReportIds.includes(record.id));
	assert.ok(observationReport);
	assert.notDeepEqual(observationReport.data.snapshotRef, original.data.snapshotRef);
	// A newly configured snapshot profile hashes the fully expanded configs; every rule/version/config must match.
	assert.deepEqual(observationReport.data.configuration.rules, original.data.configuration.rules);
	assert.equal(observationReport.data.configuration.profileVersion, original.data.configuration.profileVersion);
	assert.deepEqual(await names("attempts"), observationAttemptsBefore);
	assert.equal(await readFile(originalFile, "utf8"), originalBytes);
	assert.match(await artifact.innerText(), /Pass/);
	await page.locator('.aev [data-action="watch-dismiss"]').click();
	await until(async () => (await page.locator(".aev [data-observation]").count()) === 0);
	await page.locator('.aev [data-action="back"]').click();
	await page.locator('.aev [data-action="open"][data-id="' + original.id + '"]:not([disabled])').click();
	await page.locator('.aev [data-action="watch-start"]:not([disabled])').waitFor();
	result.observationChecks = {
		reportId: observationReport.id,
		addedAttempts: 0,
		oldReportUnchanged: true,
		realRunEvents: "not executed; synthetic event behavior is covered separately by unit tests",
	};
	result.checks.push(
		"Actual desktop observation starts from the fixed selection, returns a durable checkpoint, checks status, stops, scores a new snapshot with the original configuration and dismisses without changing the old report or executing a business task",
	);

	stage("sealed snapshot rule configuration");
	const configurationAttemptsBefore = await names("attempts"),
		configurationSnapshotsBefore = await names("snapshots");
	const configurationReportIds = (await reports()).map((record) => record.id);
	await page.locator('.aev [data-action="configure"]').click();
	await page.locator('.aev form[data-form="configuration"]').waitFor();
	assert.equal(await page.locator('.aev [data-action="config-add"][data-rule="F02"]').isDisabled(), true);
	const schemaField = page.locator('.aev [name="config-F01-0-jsonSchema"]');
	await schemaField.fill("invalid JSON");
	await page.locator('.aev form[data-form="configuration"] button[type="submit"]').click();
	await until(async () => (await page.locator('.aev [role="alert"]').innerText()).includes("Enter valid JSON"));
	assert.equal(await schemaField.inputValue(), "invalid JSON");
	assert.equal((await reports()).length, configurationReportIds.length);
	await page.screenshot({ path: join(output, "configuration-invalid-en.png") });
	await schemaField.fill('{"type":"object","required":["missing-from-frozen-fixture"]}');
	await page
		.locator(".aev [data-configuration] details")
		.filter({ has: page.locator("summary", { hasText: "F07" }) })
		.locator("summary")
		.click();
	await page.locator('.aev [name="config-pollingToolNames"]').fill("offline-poll");
	await page.setViewportSize({ width: 800, height: 650 });
	assert.equal(await page.locator(".aev").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
	assert.equal(
		await page.locator(".aev [data-configuration]").evaluate((el) =>
			[...el.querySelectorAll("label input,label select,label textarea")].every((control) => {
				const bounds = control.getBoundingClientRect(),
					label = control.parentElement.getBoundingClientRect();
				return !bounds.width || (bounds.left >= label.left - 1 && bounds.right <= label.right + 1);
			}),
		),
		true,
	);
	await page.screenshot({ path: join(output, "configuration-narrow-en.png") });
	await page.setViewportSize({ width: 1280, height: 850 });
	await page.locator('.aev form[data-form="configuration"] button[type="submit"]').click();
	await waitForDifferentReport(original.id);
	const configuredReport = (await reports()).find((record) => !configurationReportIds.includes(record.id));
	assert.ok(configuredReport);
	assert.deepEqual(configuredReport.data.snapshotRef, original.data.snapshotRef);
	assert.deepEqual(configuredReport.data.contractRef, original.data.contractRef);
	assert.notEqual(configuredReport.data.configDigest, original.data.configDigest);
	assert.deepEqual(
		configuredReport.data.configuration.rules.find((rule) => rule.id === "F07").config.pollingToolNames,
		["offline-poll"],
	);
	assert.deepEqual(
		configuredReport.data.configuration.rules.find((rule) => rule.id === "F01").config.checks[0].jsonSchema.required,
		["missing-from-frozen-fixture"],
	);
	assert.deepEqual(await names("attempts"), configurationAttemptsBefore);
	assert.deepEqual(await names("snapshots"), configurationSnapshotsBefore);
	assert.equal(await readFile(originalFile, "utf8"), originalBytes);
	assert.match(await artifact.innerText(), /Fail/);
	result.configurationChecks = {
		reportId: configuredReport.id,
		sameSnapshot: true,
		sameContract: true,
		addedAttempts: 0,
		addedSnapshots: 0,
		changedConfigDigest: true,
		originalBytesUnchanged: true,
		invalidInputPreserved: true,
	};
	result.checks.push(
		"Actual desktop configuration edits F01 structure and F07 polling through forms, retains malformed input without a report, then scores the original sealed snapshot with new persisted configs and no collection, attempt or snapshot; old report bytes remain unchanged",
	);
	await page.locator('.aev [data-action="back"]').click();
	await page.locator('.aev [data-action="open"][data-id="' + original.id + '"]:not([disabled])').click();
	await page.locator('.aev [data-action="configure"]:not([disabled])').waitFor();

	stage("new rule binding remains unknown until checks are configured");
	await page.locator('.aev [data-action="back"]').click();
	await page.locator('.aev [data-action="open"][data-id="' + revised.id + '"]:not([disabled])').click();
	await page.locator('.aev [data-action="revise"]:not([disabled])').click();
	await page.locator('.aev form[data-form="revision"]').waitFor();
	const bindingAttemptsBefore = await names("attempts"),
		bindingSnapshotsBefore = await names("snapshots");
	const bindingReportIds = (await reports()).map((record) => record.id);
	await page.locator('.aev [name="additionalConditions"]').fill("result.json is a valid JSON object");
	await page.locator('.aev [name="additionalRuleRef"]').selectOption("F01@1");
	assert.deepEqual(
		await page
			.locator('.aev [name="additionalRuleRef"] option')
			.evaluateAll((options) => options.map((option) => option.value)),
		["", "F01@1", "F02@1", "F04@1", "F05@1", "F08@1"],
	);
	await page.screenshot({ path: join(output, "binding-revision-en.png") });
	await page.locator('.aev form[data-form="revision"] button[type="submit"]').click();
	await waitForDifferentReport(revised.id);
	const bindingReport = (await reports()).find((record) => !bindingReportIds.includes(record.id));
	assert.ok(bindingReport);
	const bindingContract = JSON.parse(
		await readFile(
			join(
				storeRoot,
				"contracts",
				`${bindingReport.data.contractRef.id}.${bindingReport.data.contractRef.revision}.json`,
			),
			"utf8",
		),
	);
	assert.equal(bindingContract.revision, 3);
	assert.deepEqual(bindingContract.data.scope, revisedContract.data.scope);
	const bindingCondition = bindingContract.data.conditions.find(
		(condition) => condition.statement === "result.json is a valid JSON object",
	);
	assert.ok(bindingCondition);
	assert.equal(bindingCondition.ruleRef, "F01@1");
	assert.equal(bindingCondition.sourceType, "user");
	assert.equal(
		bindingReport.data.findings.find((finding) => finding.conditionId === bindingCondition.id).verdict,
		"inconclusive",
	);
	assert.equal(
		bindingReport.data.configuration.rules
			.find((rule) => rule.id === "F01")
			.config.checks.some((check) => check.conditionId === bindingCondition.id),
		false,
	);
	assert.equal((await names("attempts")).length, bindingAttemptsBefore.length + 1);
	assert.equal((await names("snapshots")).length, bindingSnapshotsBefore.length + 1);
	await page.locator('.aev [data-action="configure"]').click();
	await page.locator('.aev form[data-form="configuration"]').waitFor();
	await page.locator('.aev [data-action="config-add"][data-rule="F01"]').click();
	const addedCheck = page.locator('.aev [data-config-row="F01"]').last();
	await addedCheck.locator('[data-field="conditionId"]').selectOption(bindingCondition.id);
	await addedCheck.locator('[data-field="path"]').fill("result.json");
	await addedCheck.locator('[data-field="format"]').selectOption("json");
	await addedCheck.locator('[data-field="jsonSchema"]').fill('{"type":"object"}');
	await page.setViewportSize({ width: 800, height: 650 });
	assert.equal(await page.locator(".aev").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
	await page.screenshot({ path: join(output, "binding-configuration-narrow.png") });
	await page.setViewportSize({ width: 1280, height: 850 });
	await page.locator('.aev form[data-form="configuration"] button[type="submit"]').click();
	await waitForDifferentReport(bindingReport.id);
	const bindingConfiguredReport = (await reports()).find(
		(record) => !bindingReportIds.includes(record.id) && record.id !== bindingReport.id,
	);
	assert.ok(bindingConfiguredReport);
	assert.equal(
		bindingConfiguredReport.data.findings.find((finding) => finding.conditionId === bindingCondition.id).verdict,
		"pass",
	);
	assert.deepEqual(bindingConfiguredReport.data.snapshotRef, bindingReport.data.snapshotRef);
	assert.deepEqual(bindingConfiguredReport.data.contractRef, bindingReport.data.contractRef);
	assert.equal((await names("attempts")).length, bindingAttemptsBefore.length + 1);
	assert.equal((await names("snapshots")).length, bindingSnapshotsBefore.length + 1);
	assert.equal(await readFile(originalFile, "utf8"), originalBytes);
	assert.deepEqual(JSON.parse(await readFile(contractFile, "utf8")), revisedContract);
	result.bindingChecks = {
		conditionId: bindingCondition.id,
		contractRevision: bindingContract.revision,
		unconfiguredVerdict: "inconclusive",
		configuredVerdict: "pass",
		sameSnapshotForConfiguration: true,
		revisionAddedAttempts: 1,
		configurationAddedAttempts: 0,
		oldReportUnchanged: true,
		oldContractUnchanged: true,
	};
	result.checks.push(
		"Actual desktop adds an installed rule binding in a new contract revision, keeps it inconclusive without configuration, then configures a matching artifact check on that sealed snapshot; the old contract/report remain unchanged and no task runs",
	);
	await page.locator('.aev [data-action="back"]').click();
	await page.locator('.aev [data-action="open"][data-id="' + original.id + '"]:not([disabled])').click();
	await page.locator('.aev [data-action="configure"]:not([disabled])').waitFor();

	stage("language, theme, layout");
	await page.evaluate(() => {
		document.documentElement.lang = "zh-CN";
	});
	await page.getByRole("heading", { name: "Agent 评估中心" }).waitFor();
	await page.locator('.aev [data-action="configure"]').click();
	await page.locator('.aev form[data-form="configuration"]').waitFor();
	assert.match(await page.locator(".aev [data-configuration]").innerText(), /核验规则与费用配置/);
	await page.screenshot({ path: join(output, "configuration-zh.png") });
	await page.locator('.aev [data-action="discard-configuration"]').click();
	await page.screenshot({ path: join(output, "detail-zh.png") });
	await page.setViewportSize({ width: 800, height: 650 });
	await page.screenshot({ path: join(output, "detail-narrow.png") });
	assert.equal(await page.locator(".aev").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
	await page.setViewportSize({ width: 1280, height: 850 });
	await page.evaluate(() => {
		document.documentElement.lang = "en";
	});
	result.checks.push(
		"Chinese/English live labels and narrow layout fit verified; screenshots retained for visual inspection",
	);
	await page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const link = document.createElement("link");
				link.rel = "stylesheet";
				link.href = "/themes/white.css";
				link.id = "evaluation-light-test";
				link.onload = resolve;
				link.onerror = reject;
				document.head.append(link);
			}),
	);
	await page.screenshot({ path: join(output, "detail-light.png") });
	result.lightColors = await page
		.locator(".aev")
		.evaluate((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
	assert.notEqual(result.lightColors.color, result.lightColors.background);
	await page.evaluate(() => document.getElementById("evaluation-light-test").remove());
	result.checks.push(
		"Actual light theme stylesheet loads; report remains readable with inherited foreground/background tokens",
	);

	if (activeJobProbe) {
		stage("active scoring cancellation and synchronous plugin unload");
		result.activeJobProbe = activeJobProbe;
		result.activeJobChecks = await verifyActiveJobs({
			page,
			output,
			dataDir,
			probe: activeJobProbe,
			plugin,
			until,
			settings,
			closeSettings,
			reports,
			names,
			originalFile,
			originalBytes,
			openView,
		});
		result.checks.push(
			"Controlled F01 delay in an isolated plugin copy: actual desktop cancel, Rescan and settings disable cancel running scoring; settings disable also stops observation. Late results cannot change reports or writer locks.",
		);
	}

	stage("plugin disable and reload persistence");
	await settings("plugins");
	await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	await plugin().getByRole("switch").click();
	await until(async () => (await plugin().getByRole("switch").getAttribute("aria-checked")) === "false");
	await closeSettings();
	await page.reload();
	await page.waitForSelector(".app");
	await settings("plugins");
	await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	assert.equal(await plugin().getByRole("switch").getAttribute("aria-checked"), "false");
	await closeSettings();
	await settings("skills");
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "false");
	await closeSettings();
	await settings("plugins");
	await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	await plugin().getByRole("switch").click();
	await until(async () => (await plugin().getByRole("switch").getAttribute("aria-checked")) === "true");
	await closeSettings();
	await page.reload();
	await page.waitForSelector(".app");
	await settings("skills");
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "true");
	await closeSettings();
	result.checks.push(
		"Plugin disabled state survives page reload and gates the owned skill; re-enable restores the skill",
	);
	stage("offline ATIF upload, human confirmation and existing report UI");
	const offline = await verifyOfflineImport({ page, output, dataDir, until, reports, openView, app });
	result.offlineImport = { reportId: offline.reportId, sha256: offline.sha256, rawBytes: offline.rawBytes };
	result.checks.push(
		"Actual Electron uploads a >128 KiB inert ATIF fixture in bounded chunks, rejects malformed input, separates child selection, requires human source/condition confirmation and uses the existing provisional report with private original paging",
	);
	stage("desktop identity is withheld from a secondary renderer");
	const nativeClientId = await page.evaluate(() => sessionStorage.getItem("pi-web-client-id"));
	const secondaryClientId = await app.evaluate(
		async ({ BrowserWindow }, preload) => {
			const primary = BrowserWindow.getAllWindows()[0];
			const secondary = new BrowserWindow({
				show: false,
				webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
			});
			try {
				await secondary.loadURL(primary.webContents.getURL());
				return await secondary.webContents.executeJavaScript('sessionStorage.getItem("pi-web-client-id")');
			} finally {
				secondary.destroy();
			}
		},
		join(repo, "dist/desktop/preload.cjs"),
	);
	assert.notEqual(secondaryClientId, nativeClientId);
	result.secondaryRenderer = { distinctClientId: true };
	result.checks.push(
		"An actual secondary renderer with the same preload and service origin cannot obtain the main window native identity",
	);
	stage("full app restart persistence");
	await writeFile(join(output, "app-first-process.log"), app.getLogs());
	await app.close();
	app = undefined;
	const restartReservation = createServer().listen(0, "127.0.0.1");
	await once(restartReservation, "listening");
	const restartPort = restartReservation.address().port;
	assert.ok(restartPort >= 8900 && restartPort !== port);
	await new Promise((resolve) => restartReservation.close(resolve));
	env.PI_WEB_PORT = String(restartPort);
	app = await launchNativeApp({
		executablePath: electron,
		packaged: false,
		env,
		mainPath: join(repo, "dist/desktop/main.js"),
	});
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	let holdRestartSettings = true;
	const heldRestartSettings = [];
	await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => {
		const server = socket.connectToServer();
		server.onMessage((message) => {
			if (holdRestartSettings && JSON.parse(String(message)).type === "settings_state")
				heldRestartSettings.push(() => socket.send(message));
			else socket.send(message);
		});
		socket.onMessage((message) => server.send(message));
	});
	// The settings row omits version. Verify the live host plugin announcement after the restart.
	await page.addInitScript(() => {
		const Native = window.WebSocket;
		window.__evaluationFrames = [];
		window.WebSocket = class extends Native {
			constructor(...args) {
				super(...args);
				if (String(args[0]).includes("/ws")) window.__evaluationSocket = this;
				this.addEventListener("message", (e) => {
					try {
						window.__evaluationFrames.push(JSON.parse(e.data));
					} catch {}
				});
			}
		};
	});
	await page.reload();
	await page.waitForSelector(".app");
	await until(() =>
		page.evaluate(() =>
			window.__evaluationFrames.some(
				(f) =>
					f.type === "plugins" &&
					f.plugins.some((p) => p.id === "agent-evaluation" && p.version === "0.4.21" && p.active),
			),
		),
	);
	stage("settings opened before cold-start settings arrive");
	await until(() => heldRestartSettings.length > 0);
	await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
	assert.equal(await page.locator(".settings-modal").count(), 0);
	holdRestartSettings = false;
	heldRestartSettings.splice(0).forEach((deliver) => deliver());
	await page.locator(".settings-modal").waitFor({ timeout: 5000 });
	await page.locator('.settings-tab[data-tab="plugins"]').click();
	await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	assert.equal(await plugin().getByRole("switch").getAttribute("aria-checked"), "true");
	await closeSettings();
	await settings("skills");
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "true");
	await closeSettings();
	result.checks.push(
		"Graceful real Electron exit and a second native process load plugin 0.4.21 and preserve enabled skill/plugin registration",
	);
	result.checks.push(
		"Settings opened while settings_state is deliberately held render correctly when the real server reply arrives, without changing React hook order",
	);

	stage("reopen the original report after a full native restart");
	const restartedClientId = await page.evaluate(() => sessionStorage.getItem("pi-web-client-id"));
	result.historyChecks = {
		originalPrincipalId: original.domain.principalId,
		restartedClientId,
		changedServicePort: restartPort !== port,
	};
	assert.equal(restartedClientId, original.domain.principalId, "Native client identity must survive full exit");
	const historyAttempts = await names("attempts"),
		historySnapshots = await names("snapshots"),
		historyReports = await names("evaluations");
	const restartSwitchOffset = await page.evaluate(() => window.__evaluationFrames.length);
	await send({ type: "switch_session", path: sessionPath });
	await until(() =>
		page.evaluate(
			({ offset, target }) =>
				window.__evaluationFrames
					.slice(offset)
					.some((frame) => frame.type === "transition_progress" && frame.phase === "done" && frame.target === target),
			{ offset: restartSwitchOffset, target: sessionPath },
		),
	);
	await until(() => page.locator(".msg").filter({ hasText: "synthetic offline fixture" }).count());
	await openView();
	// The restored plugin view deliberately keeps its prior fixed source until an explicit refresh.
	await page.locator('.aev [data-action="refresh"]:not([disabled])').click();
	await page.locator('.aev [data-action="open"][data-id="' + original.id + '"]:not([disabled])').click();
	await page.locator(".aev article h3").first().waitFor();
	const historicalArtifact = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F01" }) });
	assert.equal(await page.locator(".aev [role=alert]").innerText(), "");
	await historicalArtifact.locator("summary", { hasText: "Human reviews" }).click();
	assert.match(await historicalArtifact.innerText(), /Original verdict: Pass/);
	assert.match(await historicalArtifact.innerText(), /Manual semantic review is still needed/);
	assert.equal(await readFile(originalFile, "utf8"), originalBytes);
	await writeFile(join(workspace, "result.json"), "changed after restart for sealed view probe");
	await historicalArtifact.locator('[data-action="evidence"]').first().click();
	await page.locator(".aev [data-evidence-panel] pre").waitFor();
	assert.match(await page.locator(".aev [data-evidence-panel]").innerText(), /result.json/);
	await page.locator('.aev [data-action="evidence-artifact"]').click();
	await until(async () => (await page.locator(".aev [data-evidence-panel] pre").innerText()) === '{"ok":true}');
	assert.equal(await readFile(join(workspace, "result.json"), "utf8"), "changed after restart for sealed view probe");
	result.checks.push(
		"After full native restart, sealed file view retains original bytes despite later workspace changes",
	);
	assert.deepEqual(await names("attempts"), historyAttempts);
	assert.deepEqual(await names("snapshots"), historySnapshots);
	assert.deepEqual(await names("evaluations"), historyReports);
	result.historyChecks.reportReopened = true;
	result.historyChecks.originalBytesUnchanged = true;
	result.checks.push(
		"Full native exit/restart restores the owned desktop client identity and reopens the original immutable report, review and evidence after explicit source authorization",
	);

	await page.screenshot({ path: join(output, "history-reopened.png") });
	stage("reveal the SDK source message in the actual desktop");
	const sourceFinding = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F08" }) });
	await sourceFinding.locator('[data-action="evidence"]').first().click();
	await page.locator('.aev [data-action="evidence-source"]:not([disabled])').waitFor();
	const rejected = await page.evaluate(() =>
		window.__piWebUiHost.sessions.revealMessage({
			conversationId: "foreign",
			sessionId: "evaluation-desktop",
			messageId: "missing",
		}),
	);
	assert.equal(rejected.ok, false);
	await page.locator('.aev [data-action="evidence-source"]').click();
	await page.locator(".msg-flash").filter({ hasText: "Offline source navigation fixture" }).waitFor();
	await page.screenshot({ path: join(output, "source-message.png") });
	assert.equal(await readFile(originalFile, "utf8"), originalBytes);
	assert.deepEqual(await names("attempts"), historyAttempts);
	assert.deepEqual(await names("snapshots"), historySnapshots);
	assert.deepEqual(await names("evaluations"), historyReports);
	result.checks.push(
		"Actual desktop resolves a sealed SDK evidence entry to the exact visible source message after restart, highlights it, refuses a foreign target and creates no report/attempt/snapshot",
	);
	stage("offline report and original reopen after a full native restart");
	await openView();
	await reopenOfflineImport({ page, until, fixture: offline });
	assert.deepEqual(await names("attempts"), historyAttempts);
	assert.deepEqual(await names("snapshots"), historySnapshots);
	assert.deepEqual(await names("evaluations"), historyReports);
	result.checks.push(
		"A second real native process reopens the offline report and pages the exact private original without creating records or executing the trajectory",
	);
	if (rollback) {
		stage("plugin revert, full userData backup restore and unsupported older format");
		const restored = await verifyRollback({
			app,
			page,
			repo,
			output,
			userData,
			dataDir,
			env,
			sessionPath,
			original,
			offline,
			until,
		});
		app = restored.app;
		page = restored.page;
		result.rollback = restored.result;
		result.checks.push(
			"Actual native plugin revert to 0.4.19 and complete stopped userData restores retain the original identity/reports/reviews/private original; unsupported 0.4.18 rejects without rewriting evidence or replaying tasks",
		);
	}
	if (scale) {
		stage("50-report and 1000-evidence native scale matrix");
		const scaled = await verifyScale({ app, repo, output, userData, dataDir, env, sessionPath, original, until });
		app = scaled.app;
		page = scaled.page;
		result.scale = scaled.result;
		result.checks.push(
			"Actual Electron traverses every report list page and opens seven-finding reports backed by a synthetic 1000-evidence snapshot; native service returns every reference without loss",
		);
	}
	stage("development URL cannot acquire the native identity");
	await writeFile(join(output, "app-restarted-process.log"), app.getLogs());
	await app.close();
	app = undefined;
	overrideServer = createHttpServer((_req, res) => {
		res.setHeader("Content-Type", "text/html");
		res.end("<!doctype html><title>Isolated development override</title><p>Offline identity boundary probe</p>");
	}).listen(0, "127.0.0.1");
	await once(overrideServer, "listening");
	const overridePort = overrideServer.address().port;
	assert.ok(overridePort >= 8900);
	page = undefined;
	app = await launchNativeApp({
		executablePath: electron,
		packaged: false,
		env: { ...env, PI_WEB_DESKTOP_URL: `http://127.0.0.1:${overridePort}` },
		mainPath: join(repo, "dist/desktop/main.js"),
		readyMarker: "[desktop] app ready",
	});
	// This legacy override does not set serverHealthy, so it creates no normal app window.
	// Probe the actual IPC denial in an explicit renderer; do not claim override UI acceptance.
	const overrideProbe = await app.evaluate(
		async ({ BrowserWindow }, { preload, url }) => {
			const normalWindowCount = BrowserWindow.getAllWindows().length;
			const probe = new BrowserWindow({
				show: false,
				webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
			});
			try {
				await probe.loadURL(url);
				return {
					clientId: await probe.webContents.executeJavaScript('sessionStorage.getItem("pi-web-client-id")'),
					normalWindowCount,
				};
			} finally {
				probe.destroy();
			}
		},
		{ preload: join(repo, "dist/desktop/preload.cjs"), url: `http://127.0.0.1:${overridePort}` },
	);
	assert.equal(overrideProbe.clientId, null);
	assert.equal(await readFile(join(userData, "client-identity"), "utf8"), `${nativeClientId}\n`);
	result.developmentOverride = {
		nativeIdentityWithheld: true,
		originalIdentityUnchanged: true,
		probeRenderer: true,
		normalWindowCount: overrideProbe.normalWindowCount,
	};
	result.checks.push(
		"A real renderer under development URL override receives no native client identity and cannot replace the persisted ID; probe-only, not override UI acceptance",
	);

	result.status = "PASS";
} catch (error) {
	result.status = "FAIL";
	result.error = error.stack;
	if (page)
		await writeFile(
			join(output, "frames.json"),
			JSON.stringify(await page.evaluate(() => window.__evaluationFrames ?? []).catch(() => []), null, 2),
		);
	process.exitCode = 1;
	await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
} finally {
	if (app) {
		await writeFile(join(output, "app.log"), app.getLogs());
		await app.close();
	}
	if (overrideServer) await new Promise((resolve) => overrideServer.close(resolve));
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
