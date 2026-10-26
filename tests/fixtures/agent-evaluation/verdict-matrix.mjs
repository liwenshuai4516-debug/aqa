/** Real desktop report rendering of synthetic call history, not actual tool execution. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const cases = [
	{
		id: "denied-stop-complete",
		outcome: "denied",
		expected: ["undetermined", "pass", "inconclusive", "pass", "complete"],
	},
	{
		id: "failed-stop-complete",
		outcome: "failed",
		expected: ["undetermined", "pass", "inconclusive", "pass", "complete"],
	},
	{
		id: "failed-stop",
		outcome: "failed",
		artifact: false,
		expected: ["not-achieved", "inconclusive", "fail", "inconclusive", "partial"],
	},
	{
		id: "denied-stop",
		outcome: "denied",
		artifact: false,
		expected: ["not-achieved", "inconclusive", "fail", "inconclusive", "partial"],
	},
	{
		id: "failed-continue",
		outcome: "failed",
		dependent: true,
		artifact: true,
		expected: ["achieved", "fail", "fail", "fail", "partial"],
	},
	{
		id: "success-continue",
		outcome: "succeeded",
		dependent: true,
		artifact: true,
		expected: ["achieved", "pass", "pass", "pass", "partial"],
	},
	{
		id: "unknown-prerequisite",
		outcome: "unknown",
		expected: ["undetermined", "inconclusive", "inconclusive", "inconclusive", "partial"],
	},
	{
		id: "partial-stop",
		outcome: "failed",
		unfinished: true,
		expected: ["undetermined", "inconclusive", "inconclusive", "inconclusive", "partial"],
	},
	{
		id: "cancelled-stop",
		outcome: "cancelled",
		expected: ["undetermined", "pass", "inconclusive", "pass", "complete"],
	},
	{
		id: "advisory-violation",
		outcome: "failed",
		dependent: true,
		artifact: true,
		advisory: true,
		expected: ["achieved", "pass", "pass", "fail", "partial"],
	},
];

export async function installVerdictFixture(agentDir, workspace) {
	const sessionId = "evaluation-verdict-matrix",
		sessionPath = join(agentDir, "sessions/evaluation-verdict-matrix.jsonl");
	const entries = [{ type: "session", version: 3, id: sessionId, timestamp: "2026-10-26T00:00:00Z", cwd: workspace }];
	let parentId = null;
	const add = (id, message) => {
		entries.push({
			type: "message",
			id,
			parentId,
			timestamp: new Date(1792972800000 + entries.length * 1000).toISOString(),
			message,
		});
		parentId = id;
	};
	for (const row of cases) {
		add(`${row.id}-user`, {
			role: "user",
			content: [
				{
					type: "text",
					text: `Synthetic scenario ${row.id}. Dependent step requires successful prerequisite. Artifact requirement, if configured, concerns existence/JSON only; fixture creates it, not an Agent. No actual tools execute.`,
				},
			],
		});
		const call = (suffix) =>
			add(`${row.id}-${suffix}-call`, {
				role: "assistant",
				content: [
					{ type: "toolCall", id: `${row.id}-${suffix}`, name: "read", arguments: { path: `${row.id}-${suffix}.txt` } },
				],
			});
		const result = (suffix, outcome) =>
			add(`${row.id}-${suffix}-result`, {
				role: "toolResult",
				toolCallId: `${row.id}-${suffix}`,
				toolName: "read",
				isError: outcome !== "succeeded",
				...(outcome === "denied" ? { denied: true } : {}),
				...(outcome === "cancelled" ? { cancelled: true } : {}),
				content: [{ type: "text", text: `Synthetic ${outcome}; no tool executed.` }],
			});
		call("prerequisite");
		if (row.outcome !== "unknown") result("prerequisite", row.outcome);
		if (row.dependent) {
			call("dependent");
			result("dependent", "succeeded");
		}
		if (row.unfinished) call("diagnostic");
		row.endMessageId = parentId;
		if (row.artifact) await writeFile(join(workspace, `${row.id}.json`), '{"fixture":true}');
	}
	await writeFile(sessionPath, entries.map(JSON.stringify).join("\n") + "\n");
	return { sessionId, sessionPath };
}

export async function verifyVerdictMatrix({ page, fixture, dataDir, output, until }) {
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
						.find((frame) => frame.type === "plugin_data" && frame.payload?.requestId === requestId)?.payload,
				{ offset, requestId },
			);
			return !!reply;
		});
		assert.equal(reply.ok, true, JSON.stringify(reply.error));
		return reply.result;
	}
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
					.some((frame) => frame.type === "snapshot" && frame.state?.sessionId === sessionId),
			{ offset, sessionId: fixture.sessionId },
		),
	);
	const source = await rpc("describe");
	assert.equal(source.sessionId, fixture.sessionId);
	const bound = { sessionId: source.sessionId, conversationId: source.conversationId },
		results = [];
	for (const row of cases) {
		const condition = (id, statement, required = true) => ({
			id,
			statement,
			sourceRef: `${row.id}-user`,
			sourceType: "user",
			required,
			applicableWhen: "always",
			ruleRef: id === "artifact" ? "F01@1" : "F04@1",
		});
		const contract = await rpc("createContract", {
			...bound,
			data: {
				scope: {
					source: "pi",
					sessionId: fixture.sessionId,
					startMessageId: `${row.id}-user`,
					endMessageId: row.endMessageId,
					boundaryPrecision: "exact",
					childPolicy: "exclude",
					childSessionIds: [],
				},
				objective: `Verdict boundary: ${row.id}`,
				conditions:
					row.artifact === undefined
						? []
						: [condition("artifact", "Owned artifact exists and is valid JSON; no semantic/Agent-production claim")],
				constraints: [condition("dependency", "Dependent step requires a successful prerequisite", !row.advisory)],
				environmentRefs: [],
				provenance:
					"Trusted offline test contract; seeded SDK history and fixture-owned artifacts, not actual tools/model/business execution",
				evaluationSubject: "agent-task",
			},
		});
		const attempt = await rpc("createAttempt", { ...bound, ref: contract });
		const collected = await rpc("collect", {
			...bound,
			ref: attempt,
			artifactPaths: row.artifact === undefined ? [] : [`${row.id}.json`],
		});
		const snapshotRef = await rpc("seal", { ...bound, ref: collected.checkpointRef });
		const job = await rpc("evaluate", {
			...bound,
			ref: snapshotRef,
			configs: {
				F01: {
					checks:
						row.artifact === undefined ? [] : [{ conditionId: "artifact", path: `${row.id}.json`, format: "json" }],
				},
				F04: {
					checks: [
						{
							conditionId: "dependency",
							prerequisiteToolCallId: `${row.id}-prerequisite`,
							dependentToolCallId: `${row.id}-dependent`,
						},
					],
				},
			},
		});
		let status;
		await until(async () => {
			status = await rpc("status", { ...bound, jobId: job.jobId });
			assert.notEqual(status.state, "failed", JSON.stringify(status));
			return status.state === "completed";
		});
		const report = await rpc("get", { ...bound, ref: status.reportRef }),
			snapshot = await rpc("get", { ...bound, ref: snapshotRef });
		const summary = report.data.summary,
			dependency = report.data.findings.find((f) => f.ruleId === "F04"),
			outcomes = report.data.findings.find((f) => f.ruleId === "F06").metrics;
		assert.deepEqual(
			[summary.goal, summary.behavior, summary.deliveryVerdict, dependency.verdict, snapshot.data.coverage],
			row.expected,
			row.id,
		);
		const expectedCounts = {
			succeeded: row.dependent ? 1 : 0,
			failed: 0,
			denied: 0,
			cancelled: 0,
			unknown: row.unfinished ? 1 : 0,
		};
		expectedCounts[row.outcome]++;
		assert.deepEqual(outcomes.counts, expectedCounts, row.id);
		assert.ok(dependency.evidenceRefs.length > 0);
		assert.deepEqual(dependency.attributions, []); // Outcome alone does not establish who caused it.
		if (row.artifact !== undefined)
			assert.equal(report.data.findings.find((f) => f.ruleId === "F01").verdict, row.artifact ? "pass" : "fail");
		if (row.expected[4] === "partial") assert.ok(snapshot.data.gaps.length > 0);
		const metrics = report.data.findings.find((f) => f.ruleId === "F08");
		assert.equal(metrics.metrics.timing.wallMs, null);
		const bytes = await readFile(join(dataDir, "agent-evaluation/evaluations", `${report.id}.1.json`));
		await page.getByText("Agent evaluation", { exact: true }).first().click();
		await page.locator(".aev").waitFor();
		const back = page.locator('.aev [data-action="back"]');
		if (await back.isVisible()) await back.click();
		const refresh = page.locator('.aev [data-action="refresh"]:not([disabled])');
		await refresh.waitFor();
		await refresh.click();
		await page.locator(`.aev [data-action="open"][data-id="${report.id}"]:not([disabled])`).click();
		await until(async () =>
			(await page.locator(".aev section h2").first().innerText()).includes(`Verdict boundary: ${row.id}`),
		);
		const article = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F04" }) });
		await article.waitFor();
		const header = await page.locator(".aev section").first().innerText();
		const goals = { achieved: "Achieved", "not-achieved": "Not achieved", undetermined: "Undetermined" };
		assert.ok(header.includes(goals[summary.goal]), row.id);
		assert.ok(
			header.includes({ pass: "Pass", fail: "Fail", inconclusive: "Inconclusive" }[summary.deliveryVerdict]),
			row.id,
		);
		const label = { pass: "Pass", fail: "Fail", inconclusive: "Inconclusive" };
		assert.ok((await article.innerText()).includes(label[dependency.verdict]));
		assert.ok((await page.locator(".aev").innerText()).includes(dependency.reason));
		await page.screenshot({ path: join(output, `verdict-${row.id}.png`) });
		assert.deepEqual(await readFile(join(dataDir, "agent-evaluation/evaluations", `${report.id}.1.json`)), bytes);
		results.push({
			scenario: row.id,
			reportRef: status.reportRef,
			snapshotRef,
			summary,
			dependency,
			outcomes,
			coverage: snapshot.data.coverage,
			gaps: snapshot.data.gaps,
			uiOpened: true,
			originalReportUnchanged: true,
		});
		await writeFile(
			join(output, "verdict-matrix.json"),
			JSON.stringify(
				{
					results,
					actualModelCalls: 0,
					actualToolExecutions: 0,
					provenance:
						"Actual Electron renders original service reports; contracts created through trusted desktop connection. Seeded SDK calls and fixture-created artifacts; no tool execution, causal clock or timing claim.",
				},
				null,
				2,
			),
		);
	}
	return { scenarios: results.length, results };
}
