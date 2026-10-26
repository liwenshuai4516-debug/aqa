/** Actual SDK/desktop observation under an owned store lock fault; no external model or business writes. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nativeMatrixFiles } from "./native-matrix.mjs";

export async function verifyCollectionFault({
	page,
	rpc,
	until,
	scriptedTools,
	source,
	dataDir,
	output,
	reportRef,
	reportFile,
	originalReportBytes,
}) {
	const selected = await rpc("describe"),
		bound = { conversationId: selected.conversationId, sessionId: selected.sessionId },
		originalReport = await rpc("get", { ...bound, ref: reportRef }),
		root = join(dataDir, "agent-evaluation"),
		lock = join(root, "writer.lock"),
		lockBytes = await readFile(lock),
		observations = [],
		responseOffset = scriptedTools.observations.length;
	assert.equal(selected.sessionId, source.sessionId);
	await page.locator('.aev [data-action="open"]:not([disabled])').first().click();
	await page.locator('.aev [data-action="watch-start"]:not([disabled])').click();
	await page.locator('.aev [data-action="watch-status"]:not([disabled])').waitFor();
	const watchId = await page.evaluate(
		() =>
			window.__nativeFrames.filter((frame) => frame.type === "plugin_data" && frame.payload?.result?.watchId).at(-1)
				.payload.result.watchId,
	);
	const status = () => rpc("watchStatus", { ...bound, watchId });
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
	const transcript = async () => (await readFile(source.path, "utf8")).trim().split("\n").map(JSON.parse);
	async function task(id) {
		scriptedTools.select(id, { ...bound, action: "get", ref: reportRef, requestId: crypto.randomUUID() });
		await page.evaluate(
			(text) => window.__nativeSocket.send(JSON.stringify({ type: "prompt", text })),
			`Offline collection resilience probe ${id}; use the local scripted response only`,
		);
		let entries, result;
		await until(async () => {
			entries = await transcript();
			result = entries.find(
				(entry) => entry.message?.role === "toolResult" && entry.message.toolCallId === id,
			)?.message;
			return (
				!!result &&
				entries.some(
					(entry) =>
						entry.message?.role === "assistant" &&
						entry.message.content?.some(
							(block) => block.type === "text" && block.text === `SCRIPTED_FIXTURE_DONE:${id}`,
						),
				)
			);
		});
		assert.equal(result.toolName, "agent_evaluation");
		assert.notEqual(result.isError, true);
		assert.deepEqual(JSON.parse(result.content[0].text), originalReport);
		assert.equal(
			entries.filter((entry) => entry.message?.role === "toolResult" && entry.message.toolCallId === id).length,
			1,
		);
		// Confirm the original host reader observes the SDK run terminal state.
		await until(async () => (await rpc("describe", bound)).isStreaming === false);
		observations.push({ id, toolResult: result, finalReplyPersisted: true, sdkIsStreaming: false });
	}
	let baseline, failed, recovered, faultStore;
	try {
		const first = await status();
		assert.equal(first.error, null);
		await task("collection-normal");
		await until(async () => {
			baseline = await status();
			return (
				!baseline.busy && !baseline.pending && baseline.latest?.checkpointRef.id !== first.latest?.checkpointRef.id
			);
		});
		assert.equal(baseline.error, null);
		const beforeFault = await nativeMatrixFiles(root);
		await writeFile(lock, JSON.stringify({ ...JSON.parse(lockBytes.toString("utf8")), nonce: crypto.randomUUID() }));
		await task("collection-lock-fault");
		await until(async () => {
			failed = await status();
			return !failed.busy && !failed.pending && failed.error?.code === "STORE_LOCKED";
		});
		assert.equal(failed.lastError?.code, "STORE_LOCKED");
		assert.deepEqual(failed.latest, baseline.latest, "Failed collection advanced its durable checkpoint");
		faultStore = await nativeMatrixFiles(root);
		assert.deepEqual(
			faultStore.filter((item) => item.path !== "writer.lock"),
			beforeFault.filter((item) => item.path !== "writer.lock"),
		);
		await page.locator('.aev [data-action="watch-status"]:not([disabled])').click();
		await until(async () =>
			(await page.locator(".aev [data-observation]").innerText()).includes("business run is unaffected"),
		);
		await page.screenshot({ path: join(output, "collection-lock-fault.png") });
		await writeFile(lock, lockBytes);
		assert.deepEqual(await nativeMatrixFiles(root), beforeFault);
		await task("collection-recovered");
		await until(async () => {
			recovered = await status();
			return (
				!recovered.busy &&
				!recovered.pending &&
				!recovered.error &&
				!recovered.lastError &&
				recovered.latest?.checkpointRef.id !== baseline.latest.checkpointRef.id
			);
		});
		await page.locator('.aev [data-action="watch-status"]:not([disabled])').click();
		await until(
			async () => !(await page.locator(".aev [data-observation]").innerText()).includes("business run is unaffected"),
		);
		await page.screenshot({ path: join(output, "collection-recovered.png") });
		assert.equal(await readFile(reportFile, "utf8"), originalReportBytes);
		const all = await transcript();
		for (const { id } of observations) assert.equal(all.filter((entry) => entry.message?.toolCallId === id).length, 1);
		assert.equal(scriptedTools.observations.slice(responseOffset).filter((entry) => entry.error).length, 0);
		assert.equal(scriptedTools.observations.length - responseOffset, 6);
	} finally {
		await writeFile(lock, lockBytes);
		await page.locator('.aev [data-action="watch-stop"]:not([disabled])').click();
		await page.locator('.aev [data-action="watch-dismiss"]:not([disabled])').waitFor();
	}
	const stopped = await status();
	assert.equal(stopped.state, "stopped");
	await writeFile(
		join(output, "collection-fault-probes.json"),
		JSON.stringify(
			{
				fault:
					"Exact owned active writer.lock nonce replaced and then restored byte-exact; real original store rejection, no plugin injection",
				bound,
				watchId,
				observations,
				baseline,
				failed,
				recovered,
				stopped,
				faultStore,
				originalReportUnchanged: true,
				scopedSource: "Frozen historical u1..u1 selection; new ordinary run is outside this selection",
			},
			null,
			2,
		),
	);
	return {
		collectionFault: true,
		ordinarySDKTasksCompleted: 3,
		actualSDKToolCalls: 3,
		localScriptedResponses: 6,
		actualModelCalls: 0,
		failedCheckpointNotAdvanced: true,
		failedCollectionStoreUnchanged: true,
		uiErrorVisible: true,
		recoveredOnNewRun: true,
		observerStopped: true,
		originalReportUnchanged: true,
	};
}
