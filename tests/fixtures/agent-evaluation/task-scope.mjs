/** Actual desktop selection and trusted service requests over owned, synthetic SDK history. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function installTaskScopeFixture(agentDir, workspace) {
	const sessionId = "evaluation-two-tasks",
		sessionPath = join(agentDir, "sessions/evaluation-two-tasks.jsonl");
	const entries = [{ type: "session", version: 3, id: sessionId, timestamp: "2026-10-26T00:00:00Z", cwd: workspace }];
	let parentId = null;
	for (const task of ["A", "B"]) {
		for (const [suffix, message] of [
			[
				"user",
				{
					role: "user",
					content: [
						{ type: "text", text: `Synthetic task ${task}: diagnose efficiency only; no business completion claim.` },
					],
				},
			],
			[
				"call",
				{
					role: "assistant",
					content: [
						{ type: "toolCall", id: `call-${task}`, name: "read", arguments: { path: `synthetic-${task}.txt` } },
					],
					stopReason: "toolUse",
				},
			],
			[
				"result",
				{
					role: "toolResult",
					toolCallId: `call-${task}`,
					toolName: "read",
					isError: false,
					content: [{ type: "text", text: `Synthetic result ${task}; no tool executed.` }],
				},
			],
		]) {
			const id = `${task}-${suffix}`;
			entries.push({
				type: "message",
				id,
				parentId,
				timestamp: new Date(1792972800000 + entries.length * 1000).toISOString(),
				message,
			});
			parentId = id;
		}
	}
	await writeFile(sessionPath, entries.map(JSON.stringify).join("\n") + "\n");
	return { sessionId, sessionPath };
}

export async function verifyTaskScope({ page, fixture, dataDir, output, until }) {
	const root = join(dataDir, "agent-evaluation"),
		ref = ({ kind, id, revision }) => ({ kind, id, revision });
	async function rpc(action, data = {}, requestId = crypto.randomUUID()) {
		const offset = await page.evaluate(() => window.__evaluationFrames.length);
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
	const frameOffset = await page.evaluate(() => window.__evaluationFrames.length);
	await page.evaluate(
		(path) => window.__evaluationSocket.send(JSON.stringify({ type: "switch_session", path })),
		fixture.sessionPath,
	);
	await until(() =>
		page.evaluate(
			({ frameOffset, sessionId }) =>
				window.__evaluationFrames
					.slice(frameOffset)
					.some((frame) => frame.type === "snapshot" && frame.state?.sessionId === sessionId),
			{ frameOffset, sessionId: fixture.sessionId },
		),
	);
	const source = await rpc("describe");
	assert.equal(source.sessionId, fixture.sessionId);
	const bound = { sessionId: source.sessionId, conversationId: source.conversationId };
	const records = async (kind) =>
		Promise.all(
			(await readdir(join(root, kind)))
				.filter((name) => name.endsWith(".json"))
				.map(async (name) => JSON.parse(await readFile(join(root, kind, name), "utf8"))),
		);
	const scoped = async (kind) => {
		const contracts = (await records("contracts")).filter((row) => row.data.scope.sessionId === fixture.sessionId);
		if (kind === "contracts") return contracts;
		const ids = new Set(contracts.map((row) => row.id));
		return (await records(kind)).filter((row) => ids.has(row.data.contractRef?.id));
	};
	await page.evaluate(() => {
		window.__taskScopeRequests = [];
		const send = window.__evaluationSocket.send.bind(window.__evaluationSocket);
		window.__evaluationSocket.send = (value) => {
			const message = JSON.parse(value);
			if (message.type === "plugin_message" && message.pluginId === "agent-evaluation")
				window.__taskScopeRequests.push(message.payload);
			return send(value);
		};
	});
	async function openList() {
		await page.getByText("Agent evaluation", { exact: true }).first().click();
		await page.locator(".aev").waitFor();
		const back = page.locator('.aev [data-action="back"]');
		if (await back.isVisible()) await back.click();
		const refresh = page.locator('.aev [data-action="refresh"]:not([disabled])');
		await refresh.waitFor();
		await refresh.click();
		await until(async () => (await page.locator(".aev").innerText()).includes(source.sourceId));
		await page.locator('.aev [data-action="new"]:not([disabled])').waitFor();
	}
	async function waitReport() {
		await until(async () => {
			const error = await page.locator('.aev [role="alert"]').innerText();
			if (error) throw new Error(error);
			const status = page.locator('.aev [data-action="status"]:not([disabled])');
			if (await status.isVisible()) await status.click();
			return (await page.locator(".aev article h3").count()) > 0;
		});
	}
	const reports = [];
	for (const task of ["A", "B"]) {
		await openList();
		await page.locator('.aev [data-action="new"]:not([disabled])').click();
		await page.locator('.aev [name="start"]').selectOption(`${task}-user`);
		await page.locator('.aev [name="end"]').selectOption(`${task}-result`);
		await page.locator('.aev [name="objective"]').fill(`Efficiency diagnosis ${task}; goal unspecified`);
		await page.locator('.aev [name="conditions"]').fill("");
		await page.locator('.aev [name="paths"]').fill("");
		await page.locator('.aev button[type="submit"]').click();
		await waitReport();
		const [report] = (await scoped("evaluations")).filter((row) => !reports.some((old) => old.id === row.id));
		assert.ok(report);
		const contract = await rpc("get", { ...bound, ref: report.data.contractRef });
		assert.equal(contract.data.scope.startMessageId, `${task}-user`);
		assert.equal(contract.data.scope.endMessageId, `${task}-result`);
		assert.equal(contract.data.scope.boundaryPrecision, "exact");
		assert.deepEqual(contract.data.conditions, []);
		assert.deepEqual(contract.data.constraints, []);
		assert.equal(report.data.summary.goal, "undetermined");
		const outcomes = report.data.findings.find((finding) => finding.ruleId === "F06").metrics;
		assert.equal(outcomes.calls, 1);
		assert.equal(outcomes.counts.succeeded, 1);
		assert.equal(outcomes.counts.unknown, 0);
		const metrics = report.data.findings.find((finding) => finding.ruleId === "F08");
		assert.equal(metrics.verdict, "inconclusive");
		assert.equal(metrics.metrics.timing.wallMs, null);
		assert.equal(metrics.metrics.modelThinkingMs, null);
		const finding = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F08" }) });
		await finding.locator("summary").filter({ hasText: "Inspect structured configuration / metrics" }).click();
		assert.match(await finding.innerText(), /modelThinkingMs/);
		await page.screenshot({ path: join(output, `task-${task}-efficiency.png`) });
		reports.push(report);
	}
	assert.notEqual(reports[0].data.contractRef.id, reports[1].data.contractRef.id);
	const before = { attempts: await scoped("attempts"), snapshots: await scoped("snapshots") };
	assert.equal(before.attempts.length, 2);
	assert.equal(before.snapshots.length, 2);
	const sourceChecks = [];
	for (const [index, report] of reports.entries()) {
		const task = ["A", "B"][index],
			snapshot = await rpc("get", { ...bound, ref: report.data.snapshotRef });
		const evidence = await Promise.all(snapshot.data.evidenceRefs.map((ref) => rpc("get", { ...bound, ref })));
		const selected = evidence.filter((row) => row.data.producer === "pi-evidence-v1");
		assert.equal(selected.length, 3);
		assert.deepEqual(
			selected.map((row) => row.data.sourceLocator).sort(),
			["user", "call", "result"].map((suffix) => `pi:${fixture.sessionId}#${task}-${suffix}`).sort(),
		);
		for (const row of selected) {
			assert.equal(
				row.data.attemptRef.id,
				before.attempts.find((attempt) => attempt.data.contractRef.id === report.data.contractRef.id).id,
			);
			assert.ok(JSON.stringify(row.data.sourceLocator).includes(`${task}-`), JSON.stringify(row.data.sourceLocator));
		}
		sourceChecks.push({ task, report: ref(report), sourceLocators: selected.map((row) => row.data.sourceLocator) });
	}
	const firstRequests = await page.evaluate(() =>
		["createContract", "createAttempt", "collect", "seal", "evaluate"].map((action) =>
			window.__taskScopeRequests.find((request) => request.action === action),
		),
	);
	const recordNames = async () => {
		const files = {};
		async function scan(directory, prefix = "") {
			for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
				a.name.localeCompare(b.name),
			)) {
				const path = join(directory, entry.name),
					name = prefix + entry.name;
				if (entry.isDirectory()) await scan(path, name + "/");
				else if (entry.isFile())
					files[name] = createHash("sha256")
						.update(await readFile(path))
						.digest("hex");
				else assert.fail(`Unexpected store entry ${name}`);
			}
		}
		await scan(root);
		return files;
	};
	const beforeReplay = await recordNames();
	const replayChecks = [];
	for (const request of firstRequests) {
		assert.ok(request);
		const { action, requestId, ...data } = request;
		const replayed = await rpc(action, data, requestId);
		const originalReply = await page.evaluate(
			(id) =>
				window.__evaluationFrames.find((frame) => frame.type === "plugin_data" && frame.payload?.requestId === id)
					?.payload.result,
			requestId,
		);
		if (action === "evaluate") assert.equal(replayed.jobId, originalReply.jobId);
		else assert.deepEqual(replayed, originalReply);
		replayChecks.push({ action, requestId, sameReceipt: true });
	}
	assert.deepEqual(await recordNames(), beforeReplay);
	// Submit distinct evaluations together through the original desktop connection.
	const jobs = await Promise.all(reports.map((report) => rpc("evaluate", { ...bound, ref: ref(report) })));
	const rescored = await Promise.all(
		jobs.map(async (job) => {
			let status;
			await until(async () => {
				status = await rpc("status", { ...bound, jobId: job.jobId });
				return status.state === "completed";
			});
			return rpc("get", { ...bound, ref: status.reportRef });
		}),
	);
	for (const [index, again] of rescored.entries()) {
		assert.deepEqual(again.data.contractRef, reports[index].data.contractRef);
		assert.deepEqual(again.data.snapshotRef, reports[index].data.snapshotRef);
		assert.deepEqual(again.data.configuration, reports[index].data.configuration);
		await openList();
		await page.locator(`.aev [data-action="open"][data-id="${again.id}"]:not([disabled])`).click();
		await until(async () =>
			(await page.locator(".aev section h2").first().innerText()).includes(`Efficiency diagnosis ${["A", "B"][index]}`),
		);
		assert.match(
			await page.locator(".aev").innerText(),
			new RegExp(`${["A", "B"][index]}-user → ${["A", "B"][index]}-result`),
		);
		await page.screenshot({ path: join(output, `task-${["A", "B"][index]}-rescored.png`) });
	}
	assert.deepEqual(await scoped("attempts"), before.attempts);
	// Replay the original UI attachment's exact key; no additional attempt is created.
	const attachment = await page.evaluate(
		(id) => window.__taskScopeRequests.find((request) => request.action === "createAttempt" && request.ref?.id === id),
		reports[0].data.contractRef.id,
	);
	assert.ok(attachment);
	const attached = await rpc("createAttempt", { ...bound, ref: attachment.ref }, attachment.requestId);
	const repeated = await rpc("createAttempt", { ...bound, ref: attachment.ref }, attachment.requestId);
	assert.deepEqual(repeated, attached);
	assert.equal(attached.id, before.attempts.find((attempt) => attempt.data.contractRef.id === attachment.ref.id).id);
	assert.deepEqual(await scoped("attempts"), before.attempts);
	assert.deepEqual(await scoped("snapshots"), before.snapshots);
	for (const report of reports)
		assert.deepEqual(JSON.parse(await readFile(join(root, "evaluations", `${report.id}.1.json`), "utf8")), report);
	const result = {
		sourceChecks,
		replayChecks,
		rescored: rescored.map(ref),
		concurrentRequests: jobs.length,
		goalWithoutConditions: "undetermined",
		timingWithoutMonotonicEvidence: null,
		repeatedAttemptReceipt: attached,
		originalReportsUnchanged: true,
		reScoringCreatedAttempts: 0,
		reScoringCreatedSnapshots: 0,
		replayCreatedAttempts: 0,
		actualModelCalls: 0,
		actualToolExecutions: 0,
		provenance:
			"Actual desktop UI selects two tasks in one seeded SDK session; original service/engine/store unchanged. Synthetic tool history, no business/model execution.",
	};
	await writeFile(join(output, "task-scope.json"), JSON.stringify(result, null, 2));
	return result;
}
