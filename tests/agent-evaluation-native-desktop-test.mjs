/** Real Electron reads historical results and optional owned plan/access probes; no runner/model/CLI. */
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
const summary = JSON.parse(await readFile(join(fixture, "summary.json"), "utf8"));
assert.equal(summary.status, "PASS");
assert.match(summary.scope, /local synthetic targets/);
const ledger = JSON.parse(await readFile(join(fixture, "ledger.json"), "utf8"));
const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "agent-evaluation-native-desktop");
const output = await mkdtemp(join(tmpdir(), "agent-evaluation-native-desktop-"));
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
				selected = { engine, workspace, reference, run, synthetic, sourceFiles: definition.sourceFiles };
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
};
let app, page;
async function until(fn) {
	const end = Date.now() + 30000;
	while (Date.now() < end) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("Timed out");
}
try {
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
	await page.addInitScript(() => {
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
	});
	await page.reload();
	await page.waitForSelector(".app");
	await until(() => page.evaluate(() => window.__nativeFrames.some((f) => f.type === "ready")));
	const setup = page.locator(".setup-modal .modal-close");
	if (await setup.isVisible()) await setup.click();
	assert.match(app.getLogs(), /\[plugin:agent-evaluation\] activated \(v0\.4\.24\)/);
	result.pluginVersion = "0.4.24";
	async function rpc(action, data = {}, expectedError = undefined) {
		const requestId = crypto.randomUUID();
		await page.evaluate((m) => window.__nativeSocket.send(JSON.stringify(m)), {
			type: "plugin_message",
			pluginId: "agent-evaluation",
			payload: { action, requestId, ...data },
		});
		let reply;
		await until(async () => {
			reply = await page.evaluate(
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
	async function switchSource(path) {
		const offset = await page.evaluate(() => window.__nativeFrames.length);
		await page.evaluate((path) => window.__nativeSocket.send(JSON.stringify({ type: "switch_session", path })), path);
		await until(() =>
			page.evaluate(
				(offset) =>
					window.__nativeFrames.slice(offset).some((f) => f.type === "transition_progress" && f.phase === "done"),
				offset,
			),
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
		if (source.synthetic) {
			assert.equal(run.rows.length, 41);
			assert.equal(run.complete, false);
			assert.ok(run.rows.every((row) => row.status === "unknown" && row.evidenceComplete === false));
			const displayed = [],
				pageSizes = [];
			for (const offset of [0, 20, 40]) {
				await until(async () => (await detail.innerText()).includes(`${offset + 1}–${Math.min(offset + 20, 41)} / 41`));
				const cells = await detail
					.locator("tbody tr")
					.evaluateAll((rows) => rows.map((row) => [...row.cells].map((cell) => cell.textContent)));
				assert.deepEqual(
					cells,
					run.rows.slice(offset, offset + 20).map((row) => [row.caseId, row.instanceId, "Unknown", "Partial"]),
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
				synthetic: true,
				pageSizes,
				returnedToFirst: true,
				exactOrderedRows: displayed,
				allUnknownIncomplete: true,
				nativeRunnerCalls: 0,
			});
		}
		await page.screenshot({ path: join(output, `${label}-native-run.png`) });
		if (sourceErrors && (engine === "api" || source.synthetic)) {
			const copiedFile =
					engine === "api" ? join(dataDir, run.evidence[0].path) : join(source.workspace, source.reference.path),
				originalFile = source.synthetic ? copiedFile : join(fixture, "data", run.evidence[0].path),
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
				rejectedPerProbe: 9,
				oldReportAbsentFromList: true,
				entireStoreUnchanged: true,
				originalSourceReopened: true,
			});
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
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
