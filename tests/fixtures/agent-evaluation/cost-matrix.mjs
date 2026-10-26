/** Actual Electron renders synthetic SDK usage; no provider bill or model invocation. */
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const price = (model, currency, factor = 1) => ({
	provider: "fixture",
	model,
	currency,
	version: "synthetic-price-v1",
	inputPerMillion: 2 * factor,
	outputPerMillion: 3 * factor,
	cacheReadPerMillion: factor,
	cacheWritePerMillion: 4 * factor,
});
const usd = price("usage-usd", "USD"),
	cny = price("usage-cny", "CNY", 2);
const cases = [
	{ id: "missing", end: "missing", prices: [], unknown: 1, estimated: {} },
	{ id: "unversioned", end: "unversioned", prices: [], unknown: 1, estimated: {} },
	{ id: "versioned", end: "usd", prices: [usd], unknown: 0, estimated: { USD: 0.00045 } },
	{ id: "mixed", end: "cny", prices: [usd, cny], unknown: 0, estimated: { USD: 0.00045, CNY: 0.0009 } },
	{ id: "ambiguous", end: "usd", prices: [usd, { ...usd, version: "synthetic-price-v2" }], unknown: 1, estimated: {} },
];
export async function installCostFixture(agentDir, workspace) {
	const sessionId = "evaluation-cost-matrix",
		sessionPath = join(agentDir, "sessions/evaluation-cost-matrix.jsonl");
	const entries = [{ type: "session", version: 3, id: sessionId, timestamp: "2026-10-26T00:00:00Z", cwd: workspace }];
	let parentId = null;
	for (const [id, usage] of [
		["missing", undefined],
		["unversioned", { cost: { total: 0.5 } }],
		["usd", { input: 100, output: 20, cacheRead: 30, cacheWrite: 40, cost: { total: 999 } }],
		["cny", { input: 100, output: 20, cacheRead: 30, cacheWrite: 40, cost: { total: 999 } }],
	]) {
		const message = {
			role: "assistant",
			content: [{ type: "text", text: `Synthetic usage ${id}; no model called.` }],
			provider: "fixture",
			model: `usage-${id}`,
			stopReason: "stop",
			...(usage ? { usage } : {}),
		};
		entries.push({
			type: "message",
			id,
			parentId,
			timestamp: new Date(1792972800000 + entries.length * 1000).toISOString(),
			message,
		});
		parentId = id;
	}
	await writeFile(sessionPath, entries.map(JSON.stringify).join("\n") + "\n");
	return { sessionId, sessionPath };
}
export async function verifyCostMatrix({ page, fixture, dataDir, output, until }) {
	const root = join(dataDir, "agent-evaluation");
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
				({ offset, requestId }) =>
					window.__evaluationFrames
						.slice(offset)
						.find((f) => f.type === "plugin_data" && f.payload?.requestId === requestId)?.payload,
				{ offset, requestId },
			);
			return !!reply;
		});
		assert.equal(reply.ok, true, JSON.stringify(reply.error));
		return reply.result;
	}
	const sourceBefore = await rpc("describe");
	if (sourceBefore.sessionId !== fixture.sessionId) {
		const offset = await page.evaluate(() => window.__evaluationFrames.length);
		await page.evaluate(
			(path) => window.__evaluationSocket.send(JSON.stringify({ type: "switch_session", path })),
			fixture.sessionPath,
		);
		await until(() =>
			page.evaluate(
				({ offset, sessionId }) =>
					window.__evaluationFrames
						.slice(offset)
						.some((f) => f.type === "snapshot" && f.state?.sessionId === sessionId),
				{ offset, sessionId: fixture.sessionId },
			),
		);
	}
	const source = await rpc("describe");
	assert.equal(source.sessionId, fixture.sessionId);
	const bound = { sessionId: source.sessionId, conversationId: source.conversationId };
	const records = async (kind) => (await readdir(join(root, kind))).filter((n) => n.endsWith(".json")).sort();
	async function completed(job) {
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
		const finding = report.data.findings.find((f) => f.ruleId === "F08");
		const article = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F08" }) });
		await article.locator("summary", { hasText: "Inspect structured configuration / metrics" }).click();
		assert.deepEqual(JSON.parse(await article.locator("pre").innerText()), finding.metrics);
		assert.match(await article.innerText(), /Known amounts are subtotals, not a complete bill/);
		await page.screenshot({ path: join(output, `cost-${report.id}.png`) });
	}
	const results = [];
	let frozen;
	for (const row of cases) {
		const start = ["versioned", "mixed", "ambiguous"].includes(row.id) ? "usd" : row.end;
		const objective = `Synthetic cost boundary: ${row.id}`;
		const contractRef = await rpc("createContract", {
			...bound,
			data: {
				scope: {
					source: "pi",
					sessionId: fixture.sessionId,
					startMessageId: start,
					endMessageId: row.end,
					boundaryPrecision: "exact",
					childPolicy: "exclude",
					childSessionIds: [],
				},
				objective,
				conditions: [],
				constraints: [],
				environmentRefs: [],
				evaluationSubject: "agent-task",
				provenance: "Fixture-authored SDK usage and prices; no provider/model execution or real bill",
			},
		});
		const attempt = await rpc("createAttempt", { ...bound, ref: contractRef });
		const checkpoint = await rpc("collect", { ...bound, ref: attempt });
		const snapshotRef = await rpc("seal", { ...bound, ref: checkpoint.checkpointRef });
		const report = await completed(
			await rpc("evaluate", {
				...bound,
				ref: snapshotRef,
				configs: { F08: { prices: row.prices, checks: [], childWaitToolNames: [] } },
			}),
		);
		const finding = report.data.findings.find((f) => f.ruleId === "F08"),
			costs = finding.metrics.costs;
		assert.equal(finding.verdict, "inconclusive");
		assert.equal(report.data.summary.goal, "undetermined");
		assert.deepEqual(costs.phases.agent.knownActualByCurrency, {});
		assert.deepEqual(costs.phases.agent.knownEstimatedByCurrency, row.estimated);
		assert.equal(costs.phases.agent.unknownCalls, row.unknown);
		assert.equal(costs.phases.agent.calls, row.id === "mixed" ? 2 : 1);
		assert.equal(finding.metrics.timing.wallMs, null);
		assert.equal(finding.metrics.modelThinkingMs, null);
		for (const phase of ["setup", "verification", "evaluation", "cleanup"]) {
			assert.equal(costs.phases[phase].observed, false);
			assert.ok(finding.missingEvidence.includes(`usage-not-observed:${phase}`));
		}
		if (row.id === "ambiguous") assert.ok(finding.missingEvidence.some((gap) => gap.startsWith("ambiguous-price:")));
		if (["unversioned", "ambiguous"].includes(row.id)) {
			assert.equal(costs.phases.agent.unversionedEstimates[0].counted, false);
			assert.equal(costs.phases.agent.unversionedEstimates[0].reportedAmount, row.id === "unversioned" ? 0.5 : 999);
		}
		await open(report, objective);
		results.push({
			scenario: row.id,
			reportRef: { kind: report.kind, id: report.id, revision: report.revision },
			snapshotRef,
			configuration: report.data.configuration,
			finding,
			uiMetricsMatch: true,
		});
		if (row.id === "versioned") frozen = { report, objective };
	}
	await open(frozen.report, frozen.objective);
	const attemptsBefore = await records("attempts"),
		snapshotsBefore = await records("snapshots"),
		reportsBefore = await records("evaluations");
	const originalPath = join(root, "evaluations", `${frozen.report.id}.1.json`),
		originalBytes = await readFile(originalPath);
	await page.locator('.aev [data-action="configure"]').click();
	await page.locator('.aev form[data-form="configuration"]').waitFor();
	await page
		.locator(".aev [data-configuration] details")
		.filter({ has: page.locator("summary", { hasText: "F08" }) })
		.locator("summary")
		.first()
		.click();
	await page.locator('.aev [name="config-prices-0-version"]').fill("synthetic-price-v2");
	await page.locator('.aev [name="config-prices-0-inputPerMillion"]').fill("4");
	await page.locator('.aev form[data-form="configuration"] button[type="submit"]').click();
	let changed;
	await until(async () => {
		const alert = await page.locator('.aev [role="alert"]').innerText();
		if (alert) throw new Error(alert);
		const status = page.locator('.aev [data-action="status"]:not([disabled])');
		if (await status.isVisible()) await status.click();
		const names = (await records("evaluations")).filter((n) => !reportsBefore.includes(n));
		if (names.length !== 1) return false;
		changed = JSON.parse(await readFile(join(root, "evaluations", names[0]), "utf8"));
		return (await page.locator(".aev article h3").count()) > 0;
	});
	assert.deepEqual(changed.data.snapshotRef, frozen.report.data.snapshotRef);
	assert.notEqual(changed.data.configuration.profileId, frozen.report.data.configuration.profileId);
	assert.equal(
		changed.data.findings.find((f) => f.ruleId === "F08").metrics.costs.phases.agent.knownEstimatedByCurrency.USD,
		0.00065,
	);
	await open(changed, frozen.objective);
	const again = await completed(
		await rpc("evaluate", {
			...bound,
			ref: { kind: frozen.report.kind, id: frozen.report.id, revision: frozen.report.revision },
		}),
	);
	assert.deepEqual(again.data.configuration, frozen.report.data.configuration);
	assert.deepEqual(again.data.snapshotRef, frozen.report.data.snapshotRef);
	assert.deepEqual(
		again.data.findings.find((f) => f.ruleId === "F08"),
		frozen.report.data.findings.find((f) => f.ruleId === "F08"),
	);
	await open(again, frozen.objective);
	assert.deepEqual(await records("attempts"), attemptsBefore);
	assert.deepEqual(await records("snapshots"), snapshotsBefore);
	assert.deepEqual(await readFile(originalPath), originalBytes);
	const result = {
		cases: results,
		uiPriceRevision: {
			originalReportId: frozen.report.id,
			changedReportId: changed.id,
			replayedReportId: again.id,
			originalUsdEstimate: 0.00045,
			changedUsdEstimate: 0.00065,
			originalBytesUnchanged: true,
			createdAttempts: 0,
			createdSnapshots: 0,
		},
		actualModelCalls: 0,
		actualCliCalls: 0,
		provenance:
			"Actual Electron and unmodified service/engine/store; fixture-authored SDK usage and prices, no provider billing verification, no provider-measured cost evidence.",
	};
	await writeFile(join(output, "cost-matrix.json"), JSON.stringify(result, null, 2));
	return result;
}
