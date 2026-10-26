/** Synthetic cost accounting evidence seeded only with owned Electron stopped; original service/evaluator/UI on restart. */
import assert from "node:assert/strict";
import { readFile, writeFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import electron from "electron";
import { launchNativeApp } from "../../desktop/native-app.mjs";
import { EvaluationStore } from "../../../plugins/agent-evaluation/store.mjs";
import { digest } from "../../../plugins/agent-evaluation/schema.mjs";
const ref = ({ kind, id, revision }) => ({ kind, id, revision });
const phases = ["setup", "agent", "verification", "evaluation", "cleanup"];
const configs = {
	F08: {
		prices: [
			{
				provider: "fixture",
				model: "usage-usd",
				currency: "USD",
				version: "synthetic-v1",
				inputPerMillion: 2,
				outputPerMillion: 3,
				cacheReadPerMillion: 1,
				cacheWritePerMillion: 4,
			},
		],
		childWaitToolNames: [],
		checks: [],
	},
};
const usage = (callId, phase, amount, extra = {}) => ({
	callId,
	phase,
	source: "provider-measured",
	currency: "USD",
	amount,
	...extra,
});
const account = (calls = 0, actual = {}, estimated = {}, unknown = 0) => ({
	knownActualByCurrency: actual,
	knownEstimatedByCurrency: estimated,
	calls,
	unknownCalls: unknown,
	unversionedEstimates: [],
	observed: calls > 0,
});
const expected = (overrides = {}, unassigned = []) => ({
	phases: Object.fromEntries(phases.map((p) => [p, overrides[p] ?? account()])),
	unassigned,
});
const sdk = {
	message: {
		role: "assistant",
		content: [{ type: "text", text: "Synthetic usage; no model called" }],
		provider: "fixture",
		model: "usage-usd",
		usage: { input: 100, output: 20, cacheRead: 30, cacheWrite: 40 },
	},
};
export async function verifyUsageMatrix({ app: oldApp, repo, output, dataDir, env, sessionPath, original, until }) {
	const root = join(dataDir, "agent-evaluation"),
		sourceBytes = await readFile(sessionPath);
	await writeFile(join(output, "usage-before-app.log"), oldApp.getLogs());
	const process = oldApp.process();
	await oldApp.close();
	assert.ok(process.exitCode !== null || process.signalCode !== null);
	await assert.rejects(lstat(join(root, "writer.lock")), { code: "ENOENT" });
	const originalPath = join(root, "evaluations", `${original.id}.1.json`),
		originalBytes = await readFile(originalPath);
	const base = JSON.parse(await readFile(join(root, "contracts", `${original.data.contractRef.id}.1.json`), "utf8"));
	const context = {},
		identity = { domain: original.domain, sessionIds: [base.data.scope.sessionId], allowWrite: true };
	const store = new EvaluationStore({ dataDir, authorize: (c) => (c === context ? identity : undefined) });
	const rows = [];
	let sequence = 0;
	const write = (kind, data) => store.write(context, { kind, data, requestId: `usage-owned-${++sequence}` });
	try {
		const target = write("targets", {
			kind: "pi",
			clientVersion: "synthetic-usage",
			executableIdentity: "no-execution",
			adapterVersion: "1",
			configRef: "synthetic",
			capabilities: { history: "partial" },
			isolation: "owned-offline-fixture",
		});
		const cases = [
			{
				id: "sdk-provider-dedup",
				sdk: true,
				values: [
					usage("sdk:synthetic-usage:sdk", "agent", 0.25),
					usage("sdk:synthetic-usage:sdk", "agent", 0.25),
					usage("sdk:synthetic-usage:sdk", "agent", 9, { source: "estimated", priceVersion: "synthetic-v2" }),
					usage("parent-total", "agent", 999, { aggregate: true }),
				],
				expected: expected({ agent: account(1, { USD: 0.25 }) }),
			},
			{
				id: "five-phases",
				values: [
					...phases.map((p, i) => usage(`call-${p}`, p, i + 1)),
					usage("parent-total", "agent", 999, { aggregate: true }),
				],
				expected: expected(Object.fromEntries(phases.map((p, i) => [p, account(1, { USD: i + 1 })]))),
			},
			{
				id: "conflicting-amount",
				values: [usage("conflict", "agent", 1), usage("conflict", "agent", 2)],
				expected: expected({ agent: account(1, {}, {}, 1) }),
				gap: "conflicting-cost:conflict",
			},
			{
				id: "conflicting-phase",
				values: [usage("phase", "agent", 1), usage("phase", "setup", 1)],
				expected: expected({}, [{ callId: "phase", phases: ["agent", "setup"] }]),
				gap: "conflicting-cost-phase:phase",
			},
			{
				id: "currencies-and-unknown",
				values: [
					usage("usd", "agent", 1),
					usage("cny", "agent", 2, { currency: "CNY" }),
					usage("eur", "agent", 3, { source: "estimated", currency: "EUR", priceVersion: "synthetic-v1" }),
					{ callId: "missing", phase: "agent", source: "unknown" },
				],
				expected: expected({ agent: account(4, { USD: 1, CNY: 2 }, { EUR: 3 }, 1) }),
				gap: "usage-or-price-unavailable:missing",
			},
			{
				id: "sdk-duplicate",
				sdk: true,
				duplicateSdk: true,
				values: [],
				expected: expected({ agent: account(1, {}, { USD: 0.00045 }) }),
			},
			{
				id: "unversioned-and-aggregate",
				values: [
					usage("unversioned", "verification", 7, { source: "estimated" }),
					usage("aggregate", "cleanup", 999, { aggregate: true }),
					usage("invalid-phase", "other", 999),
				],
				expected: expected({
					verification: {
						...account(1, {}, {}, 1),
						unversionedEstimates: [{ callId: "unversioned", reportedAmount: 7, currency: "USD", counted: false }],
					},
				}),
				gap: "usage-or-price-unavailable:unversioned",
			},
		];
		for (const row of cases) {
			const contract = write("contracts", {
				...base.data,
				objective: `Synthetic usage boundary: ${row.id}`,
				conditions: [],
				constraints: [],
				environmentRefs: [],
				provenance: "Fixture-authored usage and SDK bodies; not real billing or SDK event capture",
			});
			const attempt = write("attempts", {
				contractRef: ref(contract),
				targetRef: ref(target),
				sourceSessionId: identity.sessionIds[0],
				configDigest: digest({ fixture: row.id }),
				state: "unknown",
			});
			const inputs = [];
			function add(kind, producer, value) {
				const index = inputs.length;
				inputs.push({
					kind: "evidence",
					requestId: `usage-${row.id}-${index}`,
					data: {
						attemptRef: ref(attempt),
						sourceId: "synthetic-usage",
						sourceEventId: `${row.id}-${index}`,
						sourceRevision: digest(value),
						sourceLocator: `synthetic-usage:${row.id}:${index}`,
						producer,
						availability: "available",
						origin: "harness-observed",
						kind,
						observedAt: "2026-10-26T00:00:00Z",
						content: JSON.stringify(value),
						redaction: [],
						truncated: false,
					},
				});
			}
			for (const value of row.values) add("usage-record", "synthetic-usage-v1", value);
			if (row.sdk) {
				add("message", "pi-evidence-v1", sdk);
				inputs.at(-1).data.sourceEventId = "sdk";
				if (row.duplicateSdk) {
					add("message", "pi-evidence-v1", sdk);
					inputs.at(-1).data.sourceEventId = "sdk";
				}
			}
			const evidence = store.writeEvidenceBatch(context, inputs);
			const snapshot = write("snapshots", {
				contractRef: ref(contract),
				attemptRefs: [ref(attempt)],
				sourceWatermarks: {},
				evidenceRefs: evidence.map(ref),
				coverage: "partial",
				gaps: ["synthetic-usage-fixture; not real billing or SDK capture"],
				sealedAt: "2026-10-26T00:00:00Z",
			});
			rows.push({
				...row,
				contractRef: ref(contract),
				attemptRef: ref(attempt),
				snapshotRef: ref(snapshot),
				evidenceRefs: evidence.map(ref),
				objective: contract.data.objective,
			});
		}
	} finally {
		store.close();
	}
	await writeFile(join(output, "usage-seed.json"), JSON.stringify(rows, null, 2));
	let app, page;
	try {
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
		});
		await page.reload();
		await until(() =>
			page.evaluate(() =>
				window.__evaluationFrames.some(
					(f) =>
						f.type === "plugins" &&
						f.plugins.some((p) => p.id === "agent-evaluation" && p.active && p.version === "0.4.32"),
				),
			),
		);
		async function rpc(action, data = {}) {
			const requestId = crypto.randomUUID(),
				offset = await page.evaluate(() => window.__evaluationFrames.length);
			await page.evaluate(
				(payload) =>
					window.__evaluationSocket.send(
						JSON.stringify({ type: "plugin_message", pluginId: "agent-evaluation", payload }),
					),
				{ action, requestId, ...data },
			);
			let reply;
			await until(async () => {
				reply = await page.evaluate(
					({ requestId, offset }) =>
						window.__evaluationFrames
							.slice(offset)
							.find((f) => f.type === "plugin_data" && f.payload?.requestId === requestId)?.payload,
					{ requestId, offset },
				);
				return !!reply;
			});
			assert.equal(reply.ok, true, JSON.stringify(reply.error));
			return reply.result;
		}
		if ((await rpc("describe")).sessionId !== identity.sessionIds[0]) {
			const offset = await page.evaluate(() => window.__evaluationFrames.length);
			await page.evaluate(
				(path) => window.__evaluationSocket.send(JSON.stringify({ type: "switch_session", path })),
				sessionPath,
			);
			await until(() =>
				page.evaluate(
					({ offset, id }) =>
						window.__evaluationFrames.slice(offset).some((f) => f.type === "snapshot" && f.state?.sessionId === id),
					{ offset, id: identity.sessionIds[0] },
				),
			);
		}
		const source = await rpc("describe"),
			bound = { sessionId: source.sessionId, conversationId: source.conversationId };
		assert.equal(source.sessionId, identity.sessionIds[0]);
		async function evaluate(reference, configuration) {
			const job = await rpc("evaluate", {
				...bound,
				ref: reference,
				...(configuration ? { configs: configuration } : {}),
			});
			let status;
			await until(async () => {
				status = await rpc("status", { ...bound, jobId: job.jobId });
				assert.notEqual(status.state, "failed", JSON.stringify(status));
				return status.state === "completed";
			});
			return rpc("get", { ...bound, ref: status.reportRef });
		}
		async function open(report, objective) {
			await page.getByText("Agent evaluation", { exact: true }).first().click();
			await page.locator(".aev").waitFor();
			const back = page.locator('.aev [data-action="back"]');
			if (await back.isVisible()) await back.click();
			const refresh = page.locator('.aev [data-action="refresh"]:not([disabled])');
			await refresh.waitFor();
			await refresh.click();
			await page.locator(`.aev [data-action="open"][data-id="${report.id}"]:not([disabled])`).click();
			await until(async () => (await page.locator(".aev section h2").first().innerText()).includes(objective));
			const metric = report.data.findings.find((f) => f.ruleId === "F08" && !f.conditionId);
			const article = page
				.locator(".aev article")
				.filter({ has: page.locator("h3", { hasText: "F08" }) })
				.filter({ hasText: "Observed intervals and cost subtotals only" });
			await article.locator("summary", { hasText: "Inspect structured configuration / metrics" }).click();
			assert.deepEqual(JSON.parse(await article.locator("pre").innerText()), metric.metrics);
			await page.screenshot({ path: join(output, `usage-${report.id}.png`) });
		}
		const results = [];
		for (const row of rows) {
			const report = await evaluate(row.snapshotRef, configs);
			const metric = report.data.findings.find((f) => f.ruleId === "F08" && !f.conditionId);
			const costs = metric.metrics.costs;
			assert.deepEqual(costs.phases, row.expected.phases);
			assert.deepEqual(costs.unassigned, row.expected.unassigned);
			assert.equal(metric.verdict, "inconclusive");
			assert.equal(report.data.summary.goal, "undetermined");
			assert.equal(metric.metrics.timing.wallMs, null);
			assert.equal(metric.metrics.modelThinkingMs, null);
			assert.equal(metric.metrics.unobservedTime, null);
			for (const phase of phases)
				assert.equal(costs.gaps.includes(`usage-not-observed:${phase}`), !row.expected.phases[phase].observed);
			if (row.gap) assert.ok(costs.gaps.includes(row.gap));
			await open(report, row.objective);
			results.push({
				scenario: row.id,
				reportRef: ref(report),
				snapshotRef: row.snapshotRef,
				metric,
				expected: row.expected,
				uiMetricsMatch: true,
			});
		}
		const first = results[0];
		const originalReport = await rpc("get", { ...bound, ref: first.reportRef });
		const path = join(root, "evaluations", `${first.reportRef.id}.1.json`),
			bytes = await readFile(path);
		const names = async (kind) => (await readdir(join(root, kind))).filter((n) => n.endsWith(".json")).sort();
		const attemptsBefore = await names("attempts"),
			snapshotsBefore = await names("snapshots");
		const replay = await evaluate(first.reportRef);
		assert.deepEqual(replay.data.configuration, originalReport.data.configuration);
		assert.deepEqual(
			replay.data.findings.filter((f) => f.ruleId === "F08"),
			originalReport.data.findings.filter((f) => f.ruleId === "F08"),
		);
		await open(replay, rows[0].objective);
		assert.deepEqual(await names("attempts"), attemptsBefore);
		assert.deepEqual(await names("snapshots"), snapshotsBefore);
		assert.deepEqual(await readFile(path), bytes);
		assert.deepEqual(await readFile(originalPath), originalBytes);
		assert.deepEqual(await readFile(sessionPath), sourceBytes);
		const result = {
			status: "PASS",
			cases: results,
			replay: {
				originalReportId: first.reportRef.id,
				replayReportId: replay.id,
				originalBytesUnchanged: true,
				createdAttempts: 0,
				createdSnapshots: 0,
			},
			sourceBytesUnchanged: true,
			originalReportBytesUnchanged: true,
			actualModelCalls: 0,
			actualCliCalls: 0,
			actualToolCalls: 0,
			provenance:
				"Fixture-authored usage-record and SDK bodies seeded through original store while app stopped. Actual native Electron/service/evaluator/UI, no plugin injection; provider-measured labels are synthetic fixture fields, not verified provider bills or real model calls.",
		};
		await writeFile(join(output, "usage-matrix.json"), JSON.stringify(result, null, 2));
		return { app, page, result };
	} catch (error) {
		if (app) {
			await writeFile(join(output, "usage-failed-app.log"), app.getLogs());
			await page?.screenshot({ path: join(output, "usage-failure.png") }).catch(() => {});
			await app.close();
		}
		throw error;
	}
}
