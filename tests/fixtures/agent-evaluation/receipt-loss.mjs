/** Suppress real replies before application delivery on the owned desktop socket; retain wire receipts. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function fingerprint(root) {
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
}
function connection(page, until) {
	return async (request, sendOnly = false) => {
		const offset = await page.evaluate(() => window.__evaluationFrames.length);
		await page.evaluate(
			(payload) =>
				window.__evaluationSocket.send(
					JSON.stringify({ type: "plugin_message", pluginId: "agent-evaluation", payload }),
				),
			request,
		);
		if (sendOnly) return;
		let reply;
		await until(async () => {
			reply = await page.evaluate(
				({ offset, requestId }) =>
					window.__evaluationFrames
						.slice(offset)
						.find((frame) => frame.type === "plugin_data" && frame.payload?.requestId === requestId)?.payload,
				{ offset, requestId: request.requestId },
			);
			return !!reply;
		});
		assert.equal(reply.ok, true, JSON.stringify(reply.error));
		return reply.result;
	};
}
async function bind(page, until, rpc, sessionPath) {
	let source = await rpc({ action: "describe", requestId: crypto.randomUUID() });
	if (source.sessionId !== "evaluation-desktop") {
		const offset = await page.evaluate(() => window.__evaluationFrames.length);
		await page.evaluate(
			(path) => window.__evaluationSocket.send(JSON.stringify({ type: "switch_session", path })),
			sessionPath,
		);
		await until(() =>
			page.evaluate(
				({ offset, sessionPath }) =>
					window.__evaluationFrames
						.slice(offset)
						.some(
							(frame) =>
								(frame.type === "snapshot" && frame.state?.sessionId === "evaluation-desktop") ||
								(frame.type === "transition_progress" && frame.phase === "done" && frame.target === sessionPath),
						),
				{ offset, sessionPath },
			),
		);
		source = await rpc({ action: "describe", requestId: crypto.randomUUID() });
	}
	assert.equal(source.sessionId, "evaluation-desktop");
	return { sessionId: source.sessionId, conversationId: source.conversationId };
}

export async function beginReceiptLoss({ page, until, output, dataDir, sessionPath }) {
	const requests = [],
		root = join(dataDir, "agent-evaluation");
	await page.reload();
	await page.waitForSelector(".app");
	await until(() => page.evaluate(() => window.__evaluationFrames.some((frame) => frame.type === "ready")));
	const rpc = connection(page, until),
		bound = await bind(page, until, rpc, sessionPath);
	const before = await fingerprint(root);
	await page.evaluate(() => {
		window.__receiptLossDropIds = [];
		window.__receiptLossDropped = [];
	});
	async function lose(action, data) {
		const request = { action, requestId: crypto.randomUUID(), ...bound, ...data };
		await page.evaluate((id) => window.__receiptLossDropIds.push(id), request.requestId);
		await rpc(request, true);
		let dropped;
		await until(async () => {
			dropped = await page.evaluate(
				(id) => window.__receiptLossDropped.find((frame) => frame.payload?.requestId === id),
				request.requestId,
			);
			return !!dropped;
		});
		const receipt = dropped.payload;
		assert.equal(receipt.ok, true, JSON.stringify(receipt.error));
		await writeFile(
			join(output, "receipt-loss-delivery-diagnostic.json"),
			JSON.stringify(
				{
					request,
					dropped,
					renderer: await page.evaluate(
						(id) => window.__evaluationFrames.filter((frame) => frame.payload?.requestId === id),
						request.requestId,
					),
				},
				null,
				2,
			),
		);
		assert.equal(
			await page.evaluate(
				(id) => window.__evaluationFrames.some((frame) => frame.payload?.requestId === id),
				request.requestId,
			),
			false,
		);
		const saved = { request, receipt: receipt.result, rendererReceivedOriginal: false };
		requests.push(saved);
		await writeFile(join(output, "receipt-loss-requests.json"), JSON.stringify(requests, null, 2));
		return receipt.result;
	}
	const contract = await lose("createContract", {
		data: {
			scope: {
				source: "pi",
				sessionId: bound.sessionId,
				startMessageId: "u1",
				endMessageId: "a1",
				boundaryPrecision: "exact",
				childPolicy: "exclude",
				childSessionIds: [],
			},
			objective: "Dropped reply recovery; owned offline history, no execution",
			conditions: [],
			constraints: [],
			environmentRefs: [],
			provenance: "Trusted transport-loss fixture, not real Agent or business execution",
			evaluationSubject: "agent-task",
		},
	});
	const attempt = await lose("createAttempt", { ref: contract });
	const collected = await lose("collect", { ref: attempt });
	const snapshot = await lose("seal", { ref: collected.checkpointRef });
	const job = await lose("evaluate", { ref: snapshot });
	let status;
	await until(async () => {
		status = await rpc({ action: "status", requestId: crypto.randomUUID(), ...bound, jobId: job.jobId });
		assert.notEqual(status.state, "failed", JSON.stringify(status));
		return status.state === "completed";
	});
	const report = await rpc({ action: "get", requestId: crypto.randomUUID(), ...bound, ref: status.reportRef });
	const finding = report.data.findings.find((row) => row.ruleId === "F06");
	const review = await lose("review", {
		data: {
			evaluationRef: status.reportRef,
			findingId: finding.findingId,
			decision: "inconclusive",
			reason: "Transport loss test review; no semantic approval",
		},
	});
	const afterWrites = await fingerprint(root);
	for (const saved of requests) {
		await page.evaluate((id) => {
			window.__receiptLossDropIds = window.__receiptLossDropIds.filter((value) => value !== id);
		}, saved.request.requestId);
		const replay = await rpc(saved.request);
		if (saved.request.action === "evaluate") assert.equal(replay.jobId, saved.receipt.jobId);
		else assert.deepEqual(replay, saved.receipt);
		assert.deepEqual(await fingerprint(root), afterWrites, saved.request.action);
	}
	for (const kind of ["contracts", "targets", "attempts", "snapshots", "evaluations", "reviews"])
		assert.equal(
			Object.keys(afterWrites).filter((name) => name.startsWith(kind + "/")).length -
				Object.keys(before).filter((name) => name.startsWith(kind + "/")).length,
			1,
			kind,
		);
	const pending = {
		requests,
		bound,
		reportRef: status.reportRef,
		review,
		sessionPath,
		afterWrites,
		before,
		rendererDroppedReplies: requests.length,
		droppedFrames: await page.evaluate(() => window.__receiptLossDropped),
		sameProcessReplaysCreatedFiles: 0,
	};
	assert.equal(pending.droppedFrames.length, 6);
	await writeFile(join(output, "receipt-loss-before-restart.json"), JSON.stringify(pending, null, 2));
	return pending;
}

export async function verifyReceiptLoss({ page, until, output, dataDir, pending }) {
	const rpc = connection(page, until),
		bound = await bind(page, until, rpc, pending.sessionPath),
		root = join(dataDir, "agent-evaluation");
	assert.deepEqual(bound, pending.bound, "Exact selected source binding must be retained for replay");
	const before = await fingerprint(root);
	// The new native process owns a new writer lease; every other saved store byte must survive.
	const withoutLock = (files) => Object.fromEntries(Object.entries(files).filter(([name]) => name !== "writer.lock"));
	assert.deepEqual(withoutLock(before), withoutLock(pending.afterWrites));
	const replayed = [];
	for (const saved of pending.requests) {
		const result = await rpc(saved.request);
		if (saved.request.action === "evaluate") assert.equal(result.jobId, saved.receipt.jobId);
		else assert.deepEqual(result, saved.receipt);
		assert.deepEqual(await fingerprint(root), before, saved.request.action);
		replayed.push({ action: saved.request.action, requestId: saved.request.requestId, sameReferenceOrJob: true });
	}
	await page.getByText("Agent evaluation", { exact: true }).first().click();
	await page.locator(".aev").waitFor();
	const back = page.locator('.aev [data-action="back"]');
	if (await back.isVisible()) await back.click();
	const refresh = page.locator('.aev [data-action="refresh"]:not([disabled])');
	await refresh.waitFor();
	await refresh.click();
	await page.locator(`.aev [data-action="open"][data-id="${pending.reportRef.id}"]:not([disabled])`).click();
	await until(async () =>
		(await page.locator(".aev section h2").first().innerText()).includes("Dropped reply recovery"),
	);
	const finding = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F06" }) });
	await finding.locator("summary", { hasText: "Human reviews" }).click();
	assert.match(await finding.innerText(), /Transport loss test review; no semantic approval/);
	assert.match(await finding.innerText(), /Original verdict:/);
	assert.deepEqual(await fingerprint(root), before);
	await page.screenshot({ path: join(output, "receipt-loss-restored-review.png") });
	const result = {
		droppedRequests: pending.rendererDroppedReplies,
		droppedFrames: pending.droppedFrames.length,
		replayed,
		sourceBindingRetained: true,
		sameProcessReplaysCreatedFiles: 0,
		restartedReplaysCreatedFiles: 0,
		allStoredBytesUnchangedExceptNewWriterLease: true,
		uiReportAndReviewReopened: true,
		actualModelCalls: 0,
		actualCliCalls: 0,
		actualToolExecutions: 0,
		provenance:
			"Real native desktop, original production service/store. Test receiver intercepts six actual successful server replies before application event delivery. Native wire reception is retained separately from delivered application frames. Explicit original-key requests over trusted socket, not UI automatic timeout/retry. Full native restart, no execution or production injection.",
	};
	await writeFile(join(output, "receipt-loss.json"), JSON.stringify(result, null, 2));
	return result;
}
