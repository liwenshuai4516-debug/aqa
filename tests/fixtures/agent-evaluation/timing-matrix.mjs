/** Synthetic timing evidence seeded only with owned Electron stopped; original service/evaluator/UI on restart. */
import assert from "node:assert/strict";
import { readFile, writeFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import electron from "electron";
import { launchNativeApp } from "../../desktop/native-app.mjs";
import { EvaluationStore } from "../../../plugins/agent-evaluation/store.mjs";
import { digest } from "../../../plugins/agent-evaluation/schema.mjs";
const ref = ({ kind, id, revision }) => ({ kind, id, revision });
const interval = (id, extra = {}) => ({
	id,
	phase: "agent",
	kind: "work",
	clockEpoch: "synthetic-process-1",
	startMs: 100,
	endMs: 10100,
	...extra,
});
const configs = (limit = 20000) => ({
	F08: {
		prices: [],
		childWaitToolNames: ["delegate-wait"],
		checks: [{ conditionId: "time-limit", maxAgentWallMs: limit }],
	},
});
export async function verifyTimingMatrix({ app: oldApp, repo, output, dataDir, env, sessionPath, original, until }) {
	const root = join(dataDir, "agent-evaluation"),
		sourceBytes = await readFile(sessionPath);
	await writeFile(join(output, "timing-before-app.log"), oldApp.getLogs());
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
	const write = (kind, data) => store.write(context, { kind, data, requestId: `timing-owned-${++sequence}` });
	try {
		const target = write("targets", {
			kind: "pi",
			clientVersion: "synthetic-timing",
			executableIdentity: "no-execution",
			adapterVersion: "1",
			configRef: "synthetic",
			capabilities: { history: "partial" },
			isolation: "owned-offline-fixture",
		});
		const cases = [
			{
				id: "parallel-wait",
				intervals: [interval("a"), interval("b"), interval("parent", { kind: "wait-child" }), interval("a")],
				wall: 10000,
				work: 20000,
				wait: 10000,
			},
			{
				id: "different-epochs",
				intervals: [interval("a"), interval("b", { clockEpoch: "synthetic-process-2" })],
				wall: null,
				work: 20000,
				wait: null,
				gap: "multiple-clock-epochs",
			},
			{
				id: "negative-interval",
				intervals: [interval("a"), interval("bad", { endMs: -1 })],
				wall: 10000,
				work: 10000,
				wait: null,
				gap: "invalid-or-non-monotonic-interval",
			},
			{ id: "live-wall-rollback", live: "rollback", wall: 10000, work: 10000, wait: null },
			{ id: "live-parallel-wait", live: "parallel", wall: 10000, work: 20000, wait: 10000 },
			{
				id: "live-epoch-mismatch",
				live: "epochs",
				wall: null,
				work: null,
				wait: null,
				gap: "monotonic-tool-interval-unavailable",
			},
			{
				id: "live-conflict",
				live: "conflict",
				wall: null,
				work: null,
				wait: null,
				gap: "monotonic-tool-interval-unavailable",
			},
		];
		for (const row of cases) {
			const contract = write("contracts", {
				...base.data,
				objective: `Synthetic timing boundary: ${row.id}`,
				conditions: [
					{
						id: "time-limit",
						statement: "Agent wall time must not exceed frozen upper bound",
						sourceRef: "fixture:AC16",
						sourceType: "user",
						required: true,
						applicableWhen: "synthetic timing coverage",
						ruleRef: "F08",
					},
				],
				constraints: [],
				environmentRefs: [],
				provenance:
					"Fixture-authored intervals/SDK and live event bodies; not actual elapsed runtime or SDK event capture",
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
					requestId: `timing-${row.id}-${index}`,
					data: {
						attemptRef: ref(attempt),
						sourceId: "synthetic-timing",
						sourceEventId: `${row.id}-${index}`,
						sourceRevision: digest(value),
						sourceLocator: `synthetic-timing:${row.id}:${index}`,
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
			for (const value of row.intervals ?? []) add("timing-interval", "synthetic-timing-v1", value);
			if (row.live)
				for (const [id, name] of row.live === "parallel"
					? [
							["a", "read"],
							["b", "read"],
							["parent", "delegate-wait"],
						]
					: [["a", "read"]]) {
					add("message", "pi-evidence-v1", {
						message: { role: "assistant", content: [{ type: "toolCall", id, name, arguments: {} }] },
					});
					add("message", "pi-evidence-v1", {
						message: {
							role: "toolResult",
							toolCallId: id,
							content: [{ type: "text", text: "synthetic result; never executed" }],
						},
					});
					const live = (type, monotonicAt, at, clockEpoch = "synthetic-process-1") =>
						add("tool-observation", "pi-live-v1", { type, toolCallId: id, clockEpoch, monotonicAt, at });
					live("tool_start", 100, 100000);
					live(
						"tool_end",
						10100,
						row.live === "rollback" ? 1 : 110000,
						row.live === "epochs" ? "synthetic-process-2" : "synthetic-process-1",
					);
					if (row.live === "conflict") live("tool_start", 500, 100001);
				}
			const evidence = store.writeEvidenceBatch(context, inputs);
			const snapshot = write("snapshots", {
				contractRef: ref(contract),
				attemptRefs: [ref(attempt)],
				sourceWatermarks: {},
				evidenceRefs: evidence.map(ref),
				coverage: "partial",
				gaps: ["synthetic-timing-fixture; not SDK capture or full agent span"],
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
	await writeFile(join(output, "timing-seed.json"), JSON.stringify(rows, null, 2));
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
						f.plugins.some((p) => p.id === "agent-evaluation" && p.active && p.version === "0.4.31"),
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
			await page.screenshot({ path: join(output, `timing-${report.id}.png`) });
		}
		const results = [];
		for (const row of rows) {
			const report = await evaluate(row.snapshotRef, configs());
			const metric = report.data.findings.find((f) => f.ruleId === "F08" && !f.conditionId),
				check = report.data.findings.find((f) => f.ruleId === "F08" && f.conditionId === "time-limit");
			assert.equal(metric.metrics.timing.wallMs, row.wall);
			assert.equal(metric.metrics.timing.cumulativeWorkMs, row.work);
			assert.equal(metric.metrics.timing.waitingChildMs, row.wait);
			assert.equal(metric.metrics.modelThinkingMs, null);
			assert.equal(metric.metrics.unobservedTime, null);
			assert.equal(metric.metrics.timing.phases.agent.completeSpan, false);
			assert.equal(check.verdict, "inconclusive");
			assert.ok(check.missingEvidence.includes("complete-monotonic-agent-coverage"));
			assert.equal(report.data.summary.goal, "undetermined");
			if (row.gap) assert.ok(metric.missingEvidence.some((gap) => gap.startsWith(row.gap)));
			await open(report, row.objective);
			results.push({
				scenario: row.id,
				reportRef: ref(report),
				snapshotRef: row.snapshotRef,
				metric,
				check,
				uiMetricsMatch: true,
			});
		}
		const row = rows.find((r) => r.id === "live-wall-rollback"),
			first = results.find((r) => r.scenario === row.id);
		const originalReport = await rpc("get", { ...bound, ref: first.reportRef });
		const path = join(root, "evaluations", `${first.reportRef.id}.1.json`),
			bytes = await readFile(path);
		const names = async (kind) => (await readdir(join(root, kind))).filter((n) => n.endsWith(".json")).sort();
		const attemptsBefore = await names("attempts"),
			snapshotsBefore = await names("snapshots");
		const changed = await evaluate(row.snapshotRef, configs(5000));
		assert.equal(
			changed.data.findings.find((f) => f.ruleId === "F08" && f.conditionId === "time-limit").verdict,
			"fail",
		);
		assert.notEqual(changed.data.configuration.profileId, originalReport.data.configuration.profileId);
		await open(changed, row.objective);
		const replay = await evaluate(first.reportRef);
		assert.deepEqual(replay.data.configuration, originalReport.data.configuration);
		assert.deepEqual(
			replay.data.findings.filter((f) => f.ruleId === "F08"),
			originalReport.data.findings.filter((f) => f.ruleId === "F08"),
		);
		await open(replay, row.objective);
		assert.deepEqual(await names("attempts"), attemptsBefore);
		assert.deepEqual(await names("snapshots"), snapshotsBefore);
		assert.deepEqual(await readFile(path), bytes);
		assert.deepEqual(await readFile(originalPath), originalBytes);
		assert.deepEqual(await readFile(sessionPath), sourceBytes);
		const result = {
			status: "PASS",
			cases: results,
			upperBound: {
				originalLimit: 20000,
				changedLimit: 5000,
				originalCheck: "inconclusive",
				changedCheck: "fail",
				originalReportId: first.reportRef.id,
				changedReportId: changed.id,
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
				"Fixture-authored timing intervals and Pi/live bodies seeded through original store while app stopped. Actual native Electron/service/evaluator/UI, no plugin injection; not real SDK capture, parallel execution, clock fault or elapsed-time measurement.",
		};
		await writeFile(join(output, "timing-matrix.json"), JSON.stringify(result, null, 2));
		return { app, page, result };
	} catch (error) {
		if (app) {
			await writeFile(join(output, "timing-failed-app.log"), app.getLogs());
			await page?.screenshot({ path: join(output, "timing-failure.png") }).catch(() => {});
			await app.close();
		}
		throw error;
	}
}
