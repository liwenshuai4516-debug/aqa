/** Real Electron reads owned fixtures and optional scripted tool probes; no runner/real model/CLI. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink, cp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";
import electron from "electron";
import { TestAssetReader } from "../server/test-asset-reader.ts";
import { enableAgentEvaluation } from "../scripts/enable-agent-evaluation.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
const fixture = resolve(process.argv[2] ?? "missing-fixture");
const sourceErrors = process.argv.includes("--source-errors");
const nativeMatrix = process.argv.includes("--native-matrix");
const accessMatrix = process.argv.includes("--access-matrix");
const principalMatrix = process.argv.includes("--principal-matrix");
const modeMatrix = process.argv.includes("--mode-matrix");
const toolMatrix = process.argv.includes("--tool-matrix") || modeMatrix;
const collectionFault = process.argv.includes("--collection-fault");
const summary = JSON.parse(await readFile(join(fixture, "summary.json"), "utf8"));
assert.equal(summary.status, "PASS");
assert.match(summary.scope, /local synthetic targets/);
const ledger = JSON.parse(await readFile(join(fixture, "ledger.json"), "utf8"));
const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "agent-evaluation-native-desktop");
const output = await mkdtemp(join(tmpdir(), modeMatrix ? "aev-modes-" : "agent-evaluation-native-desktop-"));
const userData = join(output, "desktop"),
	agentDir = join(userData, "agent"),
	dataDir = join(userData, "data");
await mkdir(join(agentDir, "sessions"), { recursive: true });
await mkdir(join(dataDir, "api-testing"), { recursive: true });
// Keep the original workspace identity. Fault injection touches only this owned copy.
await cp(join(fixture, "data/api-testing/assets"), join(dataDir, "api-testing/assets"), { recursive: true });
await writeFile(join(agentDir, "auth.json"), "{}");
await writeFile(join(agentDir, "models.json"), '{"providers":{}}');
await enableAgentEvaluation(repo, { agentDir, dataDir });
await symlink(join(repo, "plugins/api-testing"), join(dataDir, "plugins/api-testing"), "dir");
const reader = new TestAssetReader(dataDir),
	sources = [];
const definitions = ledger.store.cases.map((item) => item.automation);
if (nativeMatrix) {
	const { createNativeMatrix } = await import("./fixtures/agent-evaluation/native-matrix.mjs");
	definitions.push(await createNativeMatrix(output));
}
for (const definition of definitions) {
	const { engine, workspace, synthetic = false } = definition;
	const references = definition.reference ? [definition.reference] : await reader.list(engine, workspace);
	let selected;
	for (const reference of references) {
		try {
			const run = await reader.read(engine, workspace, reference);
			if (run.rows.length) {
				selected = {
					engine,
					workspace,
					reference,
					run,
					synthetic,
					expectedRows: definition.expectedRows,
					sourceFiles: definition.sourceFiles,
				};
				break;
			}
		} catch (error) {
			console.log(engine, String(error));
			/* Retain rejected historical runs; select a readable original. */
		}
	}
	assert.ok(selected, `No readable ${engine} original`);
	const sessionId = `native-desktop-${engine}-${sources.length}`,
		path = join(agentDir, `sessions/${sessionId}.jsonl`);
	await writeFile(
		path,
		[
			{ type: "session", version: 3, id: sessionId, timestamp: "2026-10-24T00:00:00Z", cwd: workspace },
			{
				type: "message",
				id: "u1",
				parentId: null,
				timestamp: "2026-10-24T00:00:01Z",
				message: {
					role: "user",
					content: [
						{
							type: "text",
							text: `Inspect ${synthetic ? "synthetic never-launched plan" : "historical " + engine + " results"}; no execution requested`,
						},
					],
					timestamp: 1792800001000,
				},
			},
		]
			.map(JSON.stringify)
			.join("\n") + "\n",
	);
	sources.push({ ...selected, sessionId, path });
}
const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
assert.ok(port >= 8900);
await new Promise((r) => reservation.close(r));
const result = {
	status: "running",
	output,
	fixture,
	checks: [],
	actualModelCalls: 0,
	actualCliCalls: 0,
	nativeRunnerCalls: 0,
	sourceErrors,
	nativeMatrix,
	accessMatrix,
	principalMatrix,
	toolMatrix,
	collectionFault,
};
let app, page, scriptedTools;
async function until(fn) {
	const end = Date.now() + 30000;
	while (Date.now() < end) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("Timed out");
}
try {
	if (toolMatrix || collectionFault) {
		const { createToolChannelFixture } = await import("./fixtures/agent-evaluation/tool-channel.mjs");
		scriptedTools = await createToolChannelFixture(agentDir, modeMatrix ? 128000 : 32000);
	}
	app = await launchNativeApp({
		executablePath: electron,
		packaged: false,
		mainPath: join(repo, "dist/desktop/main.js"),
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			TMPDIR: process.env.TMPDIR,
			LANG: "en_US.UTF-8",
			PI_DESKTOP_USER_DATA: userData,
			PI_WEB_CWD: sources[0].workspace,
			PI_WEB_PORT: String(port),
			PI_WEB_PLUGIN_CATALOG_URL: "off",
			PI_WEB_SDK: "bundled",
		},
	});
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	const captureFrames = () => {
		const Native = window.WebSocket;
		window.__nativeFrames = [];
		window.WebSocket = class extends Native {
			constructor(...args) {
				super(...args);
				if (String(args[0]).includes("/ws")) {
					window.__nativeSocket = this;
					this.addEventListener("message", (e) => {
						try {
							window.__nativeFrames.push(JSON.parse(e.data));
						} catch {}
					});
				}
			}
		};
		localStorage.setItem("pi-web-ui:lang", "en");
	};
	await page.addInitScript(captureFrames);
	await page.reload();
	await page.waitForSelector(".app");
	await until(() => page.evaluate(() => window.__nativeFrames.some((f) => f.type === "ready")));
	const setup = page.locator(".setup-modal .modal-close");
	if (await setup.isVisible()) await setup.click();
	assert.match(app.getLogs(), /\[plugin:agent-evaluation\] activated \(v0\.4\.34\)/);
	result.pluginVersion = "0.4.34";
	async function rpc(action, data = {}, expectedError = undefined, targetPage = page) {
		const requestId = crypto.randomUUID();
		await targetPage.evaluate((m) => window.__nativeSocket.send(JSON.stringify(m)), {
			type: "plugin_message",
			pluginId: "agent-evaluation",
			payload: { action, requestId, ...data },
		});
		let reply;
		await until(async () => {
			reply = await targetPage.evaluate(
				(id) => window.__nativeFrames.find((f) => f.type === "plugin_data" && f.payload?.requestId === id)?.payload,
				requestId,
			);
			return !!reply;
		});
		if (expectedError) {
			assert.equal(reply.ok, false, JSON.stringify(reply));
			assert.equal(reply.error?.code, expectedError, JSON.stringify(reply));
			assert.equal(Object.hasOwn(reply, "result"), false, "Rejected request exposed a result");
			return reply;
		}
		assert.equal(reply.ok, true, JSON.stringify(reply.error));
		return reply.result;
	}
	async function switchSource(path, targetPage = page, expectedSession = undefined) {
		const offset = await targetPage.evaluate(() => window.__nativeFrames.length);
		await targetPage.evaluate(
			(path) => window.__nativeSocket.send(JSON.stringify({ type: "switch_session", path })),
			path,
		);
		await until(() =>
			targetPage.evaluate(
				({ offset, expectedSession }) =>
					window.__nativeFrames
						.slice(offset)
						.some((f) =>
							expectedSession
								? f.type === "snapshot" && f.state?.sessionId === expectedSession
								: f.type === "transition_progress" && f.phase === "done",
						),
				{ offset, expectedSession },
			),
		);
	}
	let peer;
	if (principalMatrix) {
		const existing = new Set(app.context().pages());
		await app.evaluate(async ({ BrowserWindow }, url) => {
			const main = BrowserWindow.getAllWindows()[0];
			const second = new BrowserWindow({
				width: 1200,
				height: 800,
				webPreferences: {
					preload: main.webContents.getLastWebPreferences().preload,
					contextIsolation: true,
					nodeIntegration: false,
					sandbox: true,
				},
			});
			await second.loadURL(url);
		}, page.url());
		await until(
			() =>
				!!app
					.context()
					.pages()
					.find((candidate) => !existing.has(candidate)),
		);
		peer = app
			.context()
			.pages()
			.find((candidate) => !existing.has(candidate));
		await peer.waitForSelector(".app");
		await peer.addInitScript(captureFrames);
		await peer.reload();
		await peer.waitForFunction(() => window.__nativeFrames?.some((frame) => frame.type === "ready"));
		assert.notEqual(
			await peer.evaluate(() => sessionStorage.getItem("pi-web-client-id")),
			await page.evaluate(() => sessionStorage.getItem("pi-web-client-id")),
		);
	}
	for (const source of sources) {
		const { engine, run } = source;
		await switchSource(source.path);
		const described = await rpc("describe");
		assert.equal(described.sessionId, source.sessionId);
		const bound = { conversationId: described.conversationId, sessionId: described.sessionId };
		const contractRef = await rpc("createContract", {
			...bound,
			data: {
				scope: {
					source: "pi",
					sessionId: source.sessionId,
					startMessageId: "u1",
					endMessageId: "u1",
					boundaryPrecision: "exact",
					childPolicy: "exclude",
					childSessionIds: [],
				},
				objective: source.synthetic ? "Read synthetic never-launched UI plan" : `Read historical ${engine} run`,
				conditions: [
					{
						id: "native",
						statement: "Inspect original historical result; current task execution remains unproven",
						sourceRef: "u1",
						sourceType: "user",
						required: true,
						applicableWhen: "always",
						ruleRef: "F02@1",
					},
				],
				constraints: [],
				environmentRefs: [],
				provenance: source.synthetic
					? "synthetic never-launched UI plan; no runner or approved execution outcome"
					: "human-confirmed synthetic read-only fixture",
				evaluationSubject: "agent-task",
			},
		});
		const attempt = await rpc("createAttempt", { ...bound, ref: contractRef });
		const collected = await rpc("collect", {
			...bound,
			ref: attempt,
			nativeRefs: [{ engine, reference: source.reference }],
		});
		const snapshot = await rpc("seal", { ...bound, ref: collected.checkpointRef });
		const job = await rpc("evaluate", {
			...bound,
			ref: snapshot,
			configs: { F02: { checks: [{ conditionId: "native", runId: run.runId }] } },
		});
		let status;
		await until(async () => {
			status = await rpc("status", { ...bound, jobId: job.jobId });
			return status.state === "completed";
		});
		const reportFile = join(dataDir, "agent-evaluation/evaluations", `${status.reportRef.id}.1.json`),
			before = await readFile(reportFile, "utf8");
		await page.getByText("Agent evaluation", { exact: true }).first().click();
		await page.locator(".aev").waitFor();
		const refresh = page.locator('.aev [data-action="refresh"]');
		if (await refresh.isVisible()) await page.locator('.aev [data-action="refresh"]:not([disabled])').click();
		await page.locator('.aev [data-action="open"]:not([disabled])').first().click();
		const finding = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F02" }) });
		assert.match(await finding.innerText(), /Inconclusive/i);
		await finding.locator('[data-action="evidence"]').first().click();
		await page.locator('.aev [data-action="evidence-run"]:not([disabled])').click();
		await page.locator(".aev [data-native-run] tbody tr").first().waitFor();
		const detail = page.locator(".aev [data-native-run]");
		assert.match(await detail.innerText(), new RegExp(run.runId));
		assert.equal(await detail.locator("tbody tr").count(), Math.min(run.rows.length, 20));
		assert.ok((await detail.innerText()).toLowerCase().includes(run.rows[0].status.toLowerCase()));
		const label = source.synthetic ? `${engine}-synthetic` : engine;
		if (source.synthetic || source.expectedRows) {
			assert.equal(run.rows.length, 41);
			if (source.synthetic) {
				assert.equal(run.complete, false);
				assert.ok(run.rows.every((row) => row.status === "unknown" && row.evidenceComplete === false));
			} else {
				assert.equal(run.complete, true);
				assert.deepEqual(run.rows, source.expectedRows);
				assert.equal(run.rows.filter((row) => row.status === "passed").length, 27);
				assert.equal(run.rows.filter((row) => row.status === "failed").length, 14);
			}
			const displayed = [],
				pageSizes = [];
			for (const offset of [0, 20, 40]) {
				await until(async () => (await detail.innerText()).includes(`${offset + 1}–${Math.min(offset + 20, 41)} / 41`));
				const cells = await detail
					.locator("tbody tr")
					.evaluateAll((rows) => rows.map((row) => [...row.cells].map((cell) => cell.textContent)));
				assert.deepEqual(
					cells,
					run.rows
						.slice(offset, offset + 20)
						.map((row) => [
							row.caseId,
							row.instanceId,
							{ passed: "Passed", failed: "Failed", unknown: "Unknown" }[row.status],
							row.evidenceComplete ? "Complete" : "Partial",
						]),
				);
				pageSizes.push(cells.length);
				displayed.push(...cells.map((row) => row[0]));
				await page.screenshot({ path: join(output, `${label}-page-${offset}.png`) });
				if (offset < 40) await detail.locator('[data-action="evidence-run-next"]:not([disabled])').click();
			}
			assert.equal(new Set(displayed).size, 41);
			assert.deepEqual(
				displayed,
				run.rows.map((row) => row.caseId),
			);
			assert.equal(await detail.locator('[data-action="evidence-run-next"]').count(), 0);
			await detail.locator('[data-action="evidence-run-first"]:not([disabled])').click();
			await until(async () => (await detail.innerText()).includes("1–20 / 41"));
			assert.equal(await detail.locator("tbody tr").count(), 20);
			assert.equal(await detail.locator('[data-action="evidence-run-first"]').count(), 0);
			result.checks.push({
				engine,
				synthetic: source.synthetic,
				pageSizes,
				returnedToFirst: true,
				exactOrderedRows: displayed,
				allUnknownIncomplete: source.synthetic,
				complete: run.complete,
				statusCounts: Object.fromEntries(
					[...new Set(run.rows.map((row) => row.status))].map((status) => [
						status,
						run.rows.filter((row) => row.status === status).length,
					]),
				),
				nativeRunnerCalls: 0,
				fixtureNativeRunnerCalls: summary.nativeRunnerCalls ?? null,
				historicalResultCannotProveCurrentAttempt: true,
			});
		}
		await page.screenshot({ path: join(output, `${label}-native-run.png`) });
		if (sourceErrors && (engine === "api" || source.synthetic || source.expectedRows)) {
			const copiedFile =
					engine === "api" ? join(dataDir, run.evidence[0].path) : join(source.workspace, source.reference.path),
				originalFile = engine === "ui" ? copiedFile : join(fixture, "data", run.evidence[0].path),
				originalBytes = await readFile(originalFile),
				copiedBytes = await readFile(copiedFile);
			assert.deepEqual(copiedBytes, originalBytes);
			await page.locator('.aev [data-action="evidence-native"]:not([disabled])').click();
			const sealed = page.locator(".aev [data-evidence-panel] pre");
			await until(async () => (await sealed.innerText()) === JSON.stringify(run, null, 2).slice(0, 4096));
			const sealedText = await sealed.innerText();
			const frozen = await rpc("get", { ...bound, ref: snapshot }),
				records = await Promise.all(frozen.data.evidenceRefs.map((ref) => rpc("get", { ...bound, ref }))),
				native = records.find((record) => record.data.kind === "native-test-run"),
				nativeRef = { kind: native.kind, id: native.id, revision: native.revision },
				expectedText = JSON.stringify(run, null, 2);
			async function verifySealedRun() {
				let text = "",
					nextOffset = 0;
				do {
					const body = await rpc("readEvidence", {
						...bound,
						ref: nativeRef,
						evidenceView: "native-run",
						offset: nextOffset,
					});
					assert.equal(body.contentDigest, native.contentRef.sha256);
					assert.equal(body.totalChars, expectedText.length);
					text += body.text;
					assert.ok(text.length <= expectedText.length);
					if (body.nextOffset != null) assert.ok(body.nextOffset > nextOffset);
					nextOffset = body.nextOffset;
				} while (nextOffset != null);
				assert.equal(text, expectedText);
			}
			await verifySealedRun();
			const openRun = () => page.locator('.aev [data-action="evidence-run"]:not([disabled])').click();
			async function expectError(code, scenario) {
				await openRun();
				await until(async () => (await page.locator('.aev [role="alert"]').innerText()).includes(code));
				assert.equal(await page.locator(".aev [data-native-run]").count(), 0);
				assert.equal(await sealed.innerText(), sealedText);
				assert.equal(await readFile(reportFile, "utf8"), before);
				await verifySealedRun();
				await page.locator('.aev [role="alert"]').scrollIntoViewIfNeeded();
				await page.screenshot({ path: join(output, `${label}-${scenario}-${code}.png`) });
			}
			await rename(copiedFile, `${copiedFile}.held`);
			try {
				await expectError("EVIDENCE_GAP", "missing");
			} finally {
				await rename(`${copiedFile}.held`, copiedFile);
			}
			await openRun();
			await page.locator(".aev [data-native-run] tbody tr").first().waitFor();
			const changed = JSON.parse(copiedBytes);
			if (engine === "api") changed.finishedAt = "2026-10-25T00:00:00.000Z";
			else changed.created_at = "2026-10-25T00:00:00.000Z";
			assert.notEqual(engine === "api" ? changed.finishedAt : changed.created_at, run.at);
			await writeFile(copiedFile, JSON.stringify(changed, null, 2) + "\n");
			try {
				await expectError(engine === "api" ? "VERSION_CONFLICT" : "EVIDENCE_GAP", "changed");
			} finally {
				await writeFile(copiedFile, copiedBytes);
			}
			await openRun();
			await page.locator(".aev [data-native-run] tbody tr").first().waitFor();
			assert.equal(await page.locator('.aev [role="alert"]').innerText(), "");
			assert.equal(await sealed.innerText(), sealedText);
			assert.deepEqual(await readFile(originalFile), originalBytes);
			assert.deepEqual(await readFile(copiedFile), copiedBytes);
			await verifySealedRun();
			result.checks.push({
				engine,
				synthetic: source.synthetic,
				missingOriginal: "EVIDENCE_GAP",
				changedOriginal: engine === "api" ? "VERSION_CONFLICT" : "EVIDENCE_GAP",
				sealedTextRetained: true,
				fullSealedCharsVerified: expectedText.length,
				reportUnchanged: true,
				explicitRetryAfterRestoration: true,
				originalSourceUnchanged: true,
			});
		}
		assert.equal(await readFile(reportFile, "utf8"), before);
		if (source.synthetic) {
			const { nativeMatrixFiles } = await import("./fixtures/agent-evaluation/native-matrix.mjs");
			assert.deepEqual(await nativeMatrixFiles(source.workspace), source.sourceFiles);
			await writeFile(join(output, "ui-source-files.json"), JSON.stringify(source.sourceFiles, null, 2));
			result.checks.push({
				engine,
				synthetic: true,
				sourceFiles: source.sourceFiles.length,
				allSourceFilesUnchanged: true,
			});
		}
		result.checks.push({
			engine,
			synthetic: source.synthetic,
			runId: run.runId,
			rows: run.rows.length,
			status: run.rows[0].status,
			complete: run.complete,
			reportUnchanged: true,
			historicalExecutionNotPassed: !source.synthetic,
			currentExecutionNotPassed: true,
		});
		await page.locator('.aev [data-action="back"]').click();
		if (accessMatrix) {
			const { nativeMatrixFiles } = await import("./fixtures/agent-evaluation/native-matrix.mjs");
			const originalReport = await rpc("get", { ...bound, ref: status.reportRef }),
				frozen = await rpc("get", { ...bound, ref: snapshot }),
				records = await Promise.all(frozen.data.evidenceRefs.map((ref) => rpc("get", { ...bound, ref }))),
				native = records.find((record) => record.data.kind === "native-test-run"),
				nativeRef = { kind: native.kind, id: native.id, revision: native.revision },
				storeBefore = await nativeMatrixFiles(join(dataDir, "agent-evaluation"));
			await writeFile(join(output, `${label}-access-store-before.json`), JSON.stringify(storeBefore, null, 2));
			const probes = [];
			for (const mode of ["same-workspace-other-session", "other-workspace"]) {
				const probeSession = `denied-${label}-${mode}`,
					probePath = join(agentDir, `sessions/${probeSession}.jsonl`),
					workspace = mode === "other-workspace" ? join(output, `denied-workspace-${label}`) : source.workspace;
				await mkdir(workspace, { recursive: true });
				const entries = (await readFile(source.path, "utf8")).trim().split("\n").map(JSON.parse);
				entries[0].id = probeSession;
				entries[0].cwd = workspace;
				entries[1].message.content[0].text = "Owned authorization probe only; no execution requested";
				await writeFile(probePath, entries.map(JSON.stringify).join("\n") + "\n");
				await switchSource(probePath);
				const current = await rpc("describe");
				assert.equal(current.sessionId, probeSession);
				assert.equal(current.principalId, described.principalId);
				if (mode === "other-workspace") assert.notEqual(current.workspaceId, described.workspaceId);
				else assert.equal(current.workspaceId, described.workspaceId);
				const selected = { conversationId: current.conversationId, sessionId: current.sessionId };
				const rejected = [];
				for (const [action, data] of [
					["get", { ref: status.reportRef }],
					["get", { ref: snapshot }],
					["readEvidence", { ref: nativeRef, evidenceView: "native-run" }],
					["inspectNativeRun", { ref: nativeRef }],
					["export", { ref: status.reportRef }],
					["collect", { ref: attempt }],
					["status", { jobId: originalReport.data.job.jobId }],
					[
						"get",
						{
							ref: status.reportRef,
							data: {
								principalId: "forged-owner",
								workspaceId: source.workspace,
								sessionIds: [source.sessionId],
								human: true,
							},
						},
					],
				]) {
					rejected.push({ action, reply: await rpc(action, { ...selected, ...data }, "PERMISSION_DENIED") });
				}
				const stale = await rpc(
						"get",
						{ ...selected, sessionId: source.sessionId, ref: status.reportRef },
						"VERSION_CONFLICT",
					),
					forged = await rpc(
						"get",
						{ ...selected, ref: status.reportRef, principalId: "forged-owner" },
						"INVALID_INPUT",
					),
					visible = await rpc("list", { ...selected, kind: "evaluations" });
				assert.equal(
					visible.items.some((row) => row.id === status.reportRef.id),
					false,
				);
				assert.deepEqual((await rpc("list", { ...selected, kind: "jobs" })).items, []);
				assert.deepEqual(await nativeMatrixFiles(join(dataDir, "agent-evaluation")), storeBefore);
				assert.equal(await readFile(reportFile, "utf8"), before);
				probes.push({
					mode,
					original: {
						principalId: described.principalId,
						workspaceId: described.workspaceId,
						sessionId: source.sessionId,
					},
					selected: {
						principalId: current.principalId,
						workspaceId: current.workspaceId,
						sessionId: current.sessionId,
					},
					rejected,
					stale,
					forged,
					oldReportAbsentFromList: true,
					entireStoreUnchanged: true,
				});
			}
			await switchSource(source.path);
			const restored = await rpc("describe");
			assert.equal(restored.sessionId, source.sessionId);
			const restoredBound = { conversationId: restored.conversationId, sessionId: restored.sessionId };
			assert.deepEqual(await rpc("get", { ...restoredBound, ref: status.reportRef }), originalReport);
			const reopened = await rpc("readEvidence", { ...restoredBound, ref: nativeRef, evidenceView: "native-run" });
			assert.equal(reopened.text, JSON.stringify(run, null, 2).slice(0, 4096));
			assert.deepEqual(await nativeMatrixFiles(join(dataDir, "agent-evaluation")), storeBefore);
			await writeFile(
				join(output, `${label}-access-store-after.json`),
				JSON.stringify(await nativeMatrixFiles(join(dataDir, "agent-evaluation")), null, 2),
			);
			await writeFile(join(output, `${label}-access-probes.json`), JSON.stringify(probes, null, 2));
			result.checks.push({
				engine,
				synthetic: source.synthetic,
				accessProbes: probes.length,
				rejectedPerProbe: 10,
				oldReportAbsentFromList: true,
				entireStoreUnchanged: true,
				originalSourceReopened: true,
			});
		}
		if (principalMatrix) {
			const { nativeMatrixFiles } = await import("./fixtures/agent-evaluation/native-matrix.mjs");
			const current = await rpc("describe"),
				mainBound = { conversationId: current.conversationId, sessionId: current.sessionId },
				originalReport = await rpc("get", { ...mainBound, ref: status.reportRef }),
				frozen = await rpc("get", { ...mainBound, ref: snapshot }),
				records = await Promise.all(frozen.data.evidenceRefs.map((ref) => rpc("get", { ...mainBound, ref }))),
				native = records.find((record) => record.data.kind === "native-test-run"),
				nativeRef = { kind: native.kind, id: native.id, revision: native.revision },
				storeBefore = await nativeMatrixFiles(join(dataDir, "agent-evaluation")),
				peerRpc = (action, data = {}, error = undefined) => rpc(action, data, error, peer);
			await switchSource(source.path, peer, source.sessionId);
			const selected = await peerRpc("describe");
			assert.notEqual(selected.principalId, current.principalId);
			assert.equal(selected.workspaceId, current.workspaceId);
			assert.equal(selected.sessionId, current.sessionId);
			assert.equal(selected.principalId, await peer.evaluate(() => sessionStorage.getItem("pi-web-client-id")));
			const selectedBound = { conversationId: selected.conversationId, sessionId: selected.sessionId },
				rejected = [];
			for (const [action, data] of [
				["get", { ref: status.reportRef }],
				["get", { ref: snapshot }],
				["readEvidence", { ref: nativeRef, evidenceView: "native-run" }],
				["inspectNativeRun", { ref: nativeRef }],
				["export", { ref: status.reportRef }],
				["collect", { ref: attempt }],
				["status", { jobId: originalReport.data.job.jobId }],
				[
					"get",
					{
						ref: status.reportRef,
						data: {
							principalId: current.principalId,
							workspaceId: current.workspaceId,
							sessionIds: [current.sessionId],
							human: true,
						},
					},
				],
			])
				rejected.push({ action, reply: await peerRpc(action, { ...selectedBound, ...data }, "PERMISSION_DENIED") });
			const visible = await peerRpc("list", { ...selectedBound, kind: "evaluations" });
			assert.deepEqual((await peerRpc("list", { ...selectedBound, kind: "jobs" })).items, []);
			assert.equal(
				visible.items.some((row) => row.id === status.reportRef.id),
				false,
			);
			const oldOwner = await rpc("describe", mainBound, "PERMISSION_DENIED");
			assert.deepEqual(await nativeMatrixFiles(join(dataDir, "agent-evaluation")), storeBefore);
			await peer.screenshot({ path: join(output, `${label}-second-window.png`) });
			await switchSource(source.path, page, source.sessionId);
			const restored = await rpc("describe");
			assert.equal(restored.principalId, current.principalId);
			assert.equal(restored.sessionId, current.sessionId);
			const restoredBound = { conversationId: restored.conversationId, sessionId: restored.sessionId };
			assert.deepEqual(await rpc("get", { ...restoredBound, ref: status.reportRef }), originalReport);
			assert.equal(
				(await rpc("readEvidence", { ...restoredBound, ref: nativeRef, evidenceView: "native-run" })).text,
				JSON.stringify(run, null, 2).slice(0, 4096),
			);
			const peerLostSource = await peerRpc("describe", selectedBound, "PERMISSION_DENIED"),
				storeAfter = await nativeMatrixFiles(join(dataDir, "agent-evaluation"));
			assert.deepEqual(storeAfter, storeBefore);
			assert.equal(await readFile(reportFile, "utf8"), before);
			await writeFile(
				join(output, `${label}-principal-probes.json`),
				JSON.stringify(
					{
						original: {
							principalId: current.principalId,
							workspaceId: current.workspaceId,
							sessionId: current.sessionId,
						},
						selected: {
							principalId: selected.principalId,
							workspaceId: selected.workspaceId,
							sessionId: selected.sessionId,
						},
						rejected,
						visible,
						oldOwner,
						peerLostSource,
						storeBefore,
						storeAfter,
					},
					null,
					2,
				),
			);
			result.checks.push({
				engine,
				synthetic: source.synthetic,
				secondWindowDifferentPrincipal: true,
				sameWorkspaceAndSDKSession: true,
				rejected: 10,
				entireStoreUnchanged: true,
				originalOwnerRecovered: true,
			});
		}
		if (toolMatrix && source === sources.at(-1)) {
			const { nativeMatrixFiles } = await import("./fixtures/agent-evaluation/native-matrix.mjs");
			const selected = await rpc("describe"),
				selectedBound = { conversationId: selected.conversationId, sessionId: selected.sessionId },
				originalReport = await rpc("get", { ...selectedBound, ref: status.reportRef }),
				storeBefore = await nativeMatrixFiles(join(dataDir, "agent-evaluation")),
				reviewData = {
					evaluationRef: status.reportRef,
					findingId: originalReport.data.findings[0].findingId,
					decision: "inconclusive",
					reason: "Explicit synthetic UI control, not an Agent human review",
				},
				steps = [
					{ id: "tool-positive-read", args: { action: "get", ref: status.reportRef }, allowed: true },
					{ id: "tool-denied-review", args: { action: "review", data: reviewData }, allowed: false },
					{
						id: "tool-denied-spoof",
						args: { action: "review", data: reviewData, human: true, channel: "ui", principalId: selected.principalId },
						allowed: false,
					},
				],
				results = [];
			await page.evaluate(() =>
				window.__nativeSocket.send(
					JSON.stringify({ type: "set_model", modelId: "offline-tool-fixture/offline-tool-fixture" }),
				),
			);
			await until(() =>
				page.evaluate(() =>
					window.__nativeFrames.some(
						(frame) =>
							["snapshot", "snapshot_delta"].includes(frame.type) && frame.state?.model?.id === "offline-tool-fixture",
					),
				),
			);
			if (modeMatrix) {
				const snap = await rpc("get", { ...selectedBound, ref: originalReport.data.snapshotRef });
				const attemptRef = snap.data.attemptRefs[0];
				assert.ok(attemptRef);
				for (const mode of ["readonly", "plan"])
					steps.push(
						{ id: `tool-${mode}-get`, mode, args: { action: "get", ref: status.reportRef }, allowed: true },
						{ id: `tool-${mode}-collect`, mode, args: { action: "collect", ref: attemptRef }, allowed: false },
					);
			}
			for (const step of steps) {
				if (step.mode) {
					const offset = await page.evaluate(() => window.__nativeFrames.length);
					await page.evaluate((mode) => {
						window.__nativeSocket.send(
							JSON.stringify({
								type: "dsh_permission_set",
								preset: mode === "readonly" ? "read-only" : "workspace-write-never",
							}),
						);
						window.__nativeSocket.send(JSON.stringify({ type: "set_plan_mode", enabled: mode === "plan" }));
					}, step.mode);
					await until(() =>
						page.evaluate(
							({ offset, mode }) =>
								window.__nativeFrames
									.slice(offset)
									.some(
										(f) =>
											["snapshot", "snapshot_delta"].includes(f.type) &&
											f.state?.permission === (mode === "readonly" ? "read-only" : "workspace-write-never") &&
											f.state?.planMode === (mode === "plan"),
									),
							{ offset, mode: step.mode },
						),
					);
				}
				const args = { requestId: crypto.randomUUID(), ...selectedBound, ...step.args };
				scriptedTools.select(step.id, args);
				await page.evaluate(
					(text) => window.__nativeSocket.send(JSON.stringify({ type: "prompt", text })),
					`Offline deterministic tool-channel probe ${step.id}; execute only the scripted fixture response`,
				);
				let transcript, toolResult;
				await until(async () => {
					transcript = (await readFile(source.path, "utf8")).trim().split("\n").map(JSON.parse);
					toolResult = transcript.find(
						(entry) =>
							entry.type === "message" && entry.message?.role === "toolResult" && entry.message.toolCallId === step.id,
					)?.message;
					return (
						!!toolResult &&
						transcript.some(
							(entry) =>
								entry.message?.role === "assistant" &&
								entry.message.content?.some(
									(block) => block.type === "text" && block.text === `SCRIPTED_FIXTURE_DONE:${step.id}`,
								),
						)
					);
				});
				assert.equal(toolResult.toolName, "agent_evaluation");
				assert.equal(toolResult.isError === true, !step.allowed, JSON.stringify(toolResult));
				if (step.allowed) assert.deepEqual(JSON.parse(toolResult.content[0].text), originalReport);
				else {
					const text = toolResult.content.map((block) => block.text ?? "").join("\n");
					if (step.mode)
						assert.match(
							text,
							step.mode === "plan"
								? /计划模式：只规划不实施，agent_evaluation 被拒/
								: /只读权限：agent_evaluation \(asset-write\) 被拒/,
						);
					else assert.ok(text.startsWith('Validation failed for tool "agent_evaluation":'), text);
					if (!step.mode) assert.ok(text.includes("- action: must be equal to one of the allowed values"), text);
					if (step.id === "tool-denied-spoof")
						assert.ok(text.includes("- root: must not have additional properties"), text);
				}
				assert.deepEqual(await nativeMatrixFiles(join(dataDir, "agent-evaluation")), storeBefore);
				assert.equal((await rpc("list", { ...selectedBound, kind: "reviews", ref: status.reportRef })).items.length, 0);
				assert.equal(await readFile(reportFile, "utf8"), before);
				results.push({ id: step.id, args, allowed: step.allowed, toolResult });
			}
			assert.equal(scriptedTools.observations.filter((entry) => entry.error).length, 0);
			assert.equal(scriptedTools.observations.length, modeMatrix ? 14 : 6);
			for (const observed of scriptedTools.observations) {
				assert.ok(observed.toolSchema.properties.action.enum.includes("get"));
				assert.equal(observed.toolSchema.properties.action.enum.includes("review"), false);
			}
			if (modeMatrix)
				await page.evaluate(() => {
					window.__nativeSocket.send(JSON.stringify({ type: "set_plan_mode", enabled: false }));
					window.__nativeSocket.send(JSON.stringify({ type: "dsh_permission_set", preset: "workspace-write-never" }));
				});
			const afterDenied = await nativeMatrixFiles(join(dataDir, "agent-evaluation"));
			assert.deepEqual(afterDenied, storeBefore);
			const reviewRef = await rpc("review", { ...selectedBound, data: reviewData }),
				review = await rpc("get", { ...selectedBound, ref: reviewRef });
			assert.equal(review.reviewer, selected.principalId);
			assert.deepEqual(review.data, reviewData);
			assert.equal((await rpc("list", { ...selectedBound, kind: "reviews", ref: status.reportRef })).items.length, 1);
			assert.equal(await readFile(reportFile, "utf8"), before);
			const afterHuman = await nativeMatrixFiles(join(dataDir, "agent-evaluation"));
			assert.deepEqual(
				afterHuman.filter((entry) => storeBefore.some((old) => old.path === entry.path)),
				storeBefore,
			);
			assert.deepEqual(
				afterHuman.filter((entry) => !storeBefore.some((old) => old.path === entry.path)).map((entry) => entry.path),
				[`reviews/${reviewRef.id}.1.json`],
			);
			await writeFile(
				join(output, "tool-channel-probes.json"),
				JSON.stringify(
					{
						results,
						observations: scriptedTools.observations,
						storeBefore,
						afterDenied,
						afterHuman,
						reviewRef,
						review,
						originalReportUnchanged: true,
					},
					null,
					2,
				),
			);
			result.checks.push({
				toolChannel: true,
				realModelCalls: 0,
				localScriptedResponses: modeMatrix ? 14 : 6,
				modeWriteRejections: modeMatrix ? 2 : 0,
				positiveRead: true,
				rejectedHumanReviewAttempts: 2,
				storeUnchangedAfterEachTool: true,
				humanUIControlAppended: true,
				originalReportUnchanged: true,
			});
		}
		if (collectionFault && source === sources.at(-1)) {
			const { verifyCollectionFault } = await import("./fixtures/agent-evaluation/collection-fault.mjs");
			result.checks.push(
				await verifyCollectionFault({
					page,
					rpc,
					until,
					scriptedTools,
					source,
					dataDir,
					output,
					reportRef: status.reportRef,
					reportFile,
					originalReportBytes: before,
				}),
			);
		}
	}
	result.status = "PASS";
} catch (error) {
	result.status = "FAIL";
	result.error = error.stack;
	process.exitCode = 1;
	await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
} finally {
	if (app) {
		await writeFile(join(output, "app.log"), app.getLogs());
		await app.close();
	}
	if (scriptedTools) {
		await writeFile(
			join(output, "tool-channel-observations.json"),
			JSON.stringify(scriptedTools.observations, null, 2),
		);
		await scriptedTools.close();
	}
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
