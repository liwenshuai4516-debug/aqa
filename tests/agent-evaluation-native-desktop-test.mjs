/** Real Electron reads prior synthetic native results; no runner, model, CLI or workspace writes. */
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
for (const item of ledger.store.cases) {
	const { engine, workspace } = item.automation;
	const references = await reader.list(engine, workspace);
	let selected;
	for (const reference of references) {
		try {
			const run = await reader.read(engine, workspace, reference);
			if (run.rows.length) {
				selected = { engine, workspace, reference, run };
				break;
			}
		} catch (error) {
			console.log(engine, String(error));
			/* Retain rejected historical runs; select a readable original. */
		}
	}
	assert.ok(selected, `No readable ${engine} original`);
	const sessionId = `native-desktop-${engine}`,
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
					content: [{ type: "text", text: `Inspect historical ${engine} results; no execution requested` }],
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
	assert.match(app.getLogs(), /\[plugin:agent-evaluation\] activated \(v0\.4\.23\)/);
	result.pluginVersion = "0.4.23";
	async function rpc(action, data = {}) {
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
		assert.equal(reply.ok, true, JSON.stringify(reply.error));
		return reply.result;
	}
	for (const source of sources) {
		const { engine, run } = source;
		const offset = await page.evaluate(() => window.__nativeFrames.length);
		await page.evaluate(
			(path) => window.__nativeSocket.send(JSON.stringify({ type: "switch_session", path })),
			source.path,
		);
		await until(() =>
			page.evaluate(
				(offset) =>
					window.__nativeFrames.slice(offset).some((f) => f.type === "transition_progress" && f.phase === "done"),
				offset,
			),
		);
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
				objective: `Read historical ${engine} run`,
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
				provenance: "human-confirmed synthetic read-only fixture",
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
		await page.screenshot({ path: join(output, `${engine}-native-run.png`) });
		if (sourceErrors && engine === "api") {
			const originalFile = join(fixture, "data", run.evidence[0].path),
				copiedFile = join(dataDir, run.evidence[0].path),
				originalBytes = await readFile(originalFile),
				copiedBytes = await readFile(copiedFile);
			assert.deepEqual(copiedBytes, originalBytes);
			await page.locator('.aev [data-action="evidence-native"]:not([disabled])').click();
			const sealed = page.locator(".aev [data-evidence-panel] pre");
			await until(async () => (await sealed.innerText()) === JSON.stringify(run, null, 2));
			const sealedText = await sealed.innerText();
			const openRun = () => page.locator('.aev [data-action="evidence-run"]:not([disabled])').click();
			async function expectError(code) {
				await openRun();
				await until(async () => (await page.locator('.aev [role="alert"]').innerText()).includes(code));
				assert.equal(await page.locator(".aev [data-native-run]").count(), 0);
				assert.equal(await sealed.innerText(), sealedText);
				assert.equal(await readFile(reportFile, "utf8"), before);
				await page.locator('.aev [role="alert"]').scrollIntoViewIfNeeded();
				await page.screenshot({ path: join(output, `api-${code}.png`) });
			}
			await rename(copiedFile, `${copiedFile}.held`);
			try {
				await expectError("EVIDENCE_GAP");
			} finally {
				await rename(`${copiedFile}.held`, copiedFile);
			}
			await openRun();
			await page.locator(".aev [data-native-run] tbody tr").first().waitFor();
			const changed = JSON.parse(copiedBytes);
			changed.finishedAt = "2026-10-25T00:00:00.000Z";
			assert.notEqual(changed.finishedAt, run.at);
			await writeFile(copiedFile, JSON.stringify(changed, null, 2) + "\n");
			try {
				await expectError("VERSION_CONFLICT");
			} finally {
				await writeFile(copiedFile, copiedBytes);
			}
			await openRun();
			await page.locator(".aev [data-native-run] tbody tr").first().waitFor();
			assert.equal(await page.locator('.aev [role="alert"]').innerText(), "");
			assert.equal(await sealed.innerText(), sealedText);
			assert.deepEqual(await readFile(originalFile), originalBytes);
			assert.deepEqual(await readFile(copiedFile), copiedBytes);
			result.checks.push({
				engine,
				missingOriginal: "EVIDENCE_GAP",
				changedOriginal: "VERSION_CONFLICT",
				sealedTextRetained: true,
				reportUnchanged: true,
				explicitRetryAfterRestoration: true,
				originalSourceUnchanged: true,
			});
		}
		assert.equal(await readFile(reportFile, "utf8"), before);
		result.checks.push({
			engine,
			runId: run.runId,
			rows: run.rows.length,
			status: run.rows[0].status,
			complete: run.complete,
			reportUnchanged: true,
			historicalExecutionNotPassed: true,
		});
		await page.locator('.aev [data-action="back"]').click();
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
