/** Real Electron, isolated data, seeded SDK history; no model, CLI or business execution. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";
import { digest } from "../plugins/agent-evaluation/schema.mjs";
import electron from "electron";
import { enableAgentEvaluation } from "../scripts/enable-agent-evaluation.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
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
	]
		.map(JSON.stringify)
		.join("\n") + "\n",
);
await enableAgentEvaluation(repo, { agentDir, dataDir });
const settingsBefore = await readFile(join(agentDir, "settings.json"), "utf8");
await enableAgentEvaluation(repo, { agentDir, dataDir });
assert.equal(await readFile(join(agentDir, "settings.json"), "utf8"), settingsBefore);
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
let app, page;
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
					f.plugins.some((p) => p.id === "agent-evaluation" && p.version === "0.4.3" && p.active),
			),
		),
	);
	result.checks.push(
		"Real app loads plugin 0.4.3 in explicitly registered app directories; seeded SDK history opened without a model prompt",
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
									p.version === "0.4.3" &&
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
		"Actual /reload success notice and settings Rescan advance the catalog epoch for 0.4.3; skill, slash discovery and tool registration remain enabled",
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

	stage("language, theme, layout");
	await page.evaluate(() => {
		document.documentElement.lang = "zh-CN";
	});
	await page.getByRole("heading", { name: "Agent 评估中心" }).waitFor();
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
	stage("full app restart persistence");
	await writeFile(join(output, "app-first-process.log"), app.getLogs());
	await app.close();
	app = undefined;
	app = await launchNativeApp({
		executablePath: electron,
		packaged: false,
		env,
		mainPath: join(repo, "dist/desktop/main.js"),
	});
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	await settings("plugins");
	await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	assert.equal(await plugin().getByRole("switch").getAttribute("aria-checked"), "true");
	// The settings row omits version. Verify the live host plugin announcement after the restart.
	await page.addInitScript(() => {
		const Native = window.WebSocket;
		window.__evaluationFrames = [];
		window.WebSocket = class extends Native {
			constructor(...args) {
				super(...args);
				this.addEventListener("message", (e) => {
					try {
						window.__evaluationFrames.push(JSON.parse(e.data));
					} catch {}
				});
			}
		};
	});
	await closeSettings();
	await page.reload();
	await page.waitForSelector(".app");
	await until(() =>
		page.evaluate(() =>
			window.__evaluationFrames.some(
				(f) =>
					f.type === "plugins" &&
					f.plugins.some((p) => p.id === "agent-evaluation" && p.version === "0.4.3" && p.active),
			),
		),
	);
	await settings("plugins");
	await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
	await closeSettings();
	await settings("skills");
	assert.equal(await skill().getByRole("switch").getAttribute("aria-checked"), "true");
	await closeSettings();
	result.checks.push(
		"Graceful real Electron exit and a second native process load plugin 0.4.3 and preserve enabled skill/plugin registration",
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
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
