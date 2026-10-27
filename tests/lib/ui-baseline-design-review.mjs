/** Explicitly authorized U00 independent design review; no generated approval or credential copies. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerDesignTools } from "../../node_modules/pi-ui-testing/dist/design-extension.js";

export async function reviewBaseline({ root, sessionDir, taskRef, assetRef, output, measurement }) {
	const path = resolve("tests/scratch/ui-u00-completion/authorized-review-budget.json");
	let ledger;
	try {
		ledger = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		throw new Error("Explicit U00 authorization ledger required");
	}
	assert.equal(ledger.authorization, "call_30b1ef1f5a9e48b2957656a335890924");
	assert.equal(ledger.reply, "授权新增额度并继续");
	assert.ok(ledger.attempts.length < 3 && !ledger.attempts.some((a) => a.status === "started"));
	const runtime = await ModelRuntime.create({
		authPath: join(homedir(), ".pi/agent/auth.json"),
		modelsPath: join(homedir(), ".pi/agent/models.json"),
		modelsStorePath: join(sessionDir, "u00-model-cache.json"),
		refreshOnCreate: false,
	});
	const model = (await runtime.getAvailable()).find((m) => m.provider === "gpt" && m.id === "gpt-6.1-sol");
	assert.ok(model);
	assert.equal(new URL(model.baseUrl).origin, "https://api.sudorelay.com");
	const registered = new Map();
	registerDesignTools({ registerTool: (t) => registered.set(t.name, t) });
	const requestId = "u00-first-design-" + (ledger.attempts.length + 1);
	const waits = [];
	const ctx = {
		cwd: root,
		model,
		sessionManager: { getSessionDir: () => sessionDir },
		modelRegistry: {
			streamSimple(m, context, options) {
				assert.equal(m.provider, "gpt");
				assert.equal(m.id, "gpt-6.1-sol");
				assert.deepEqual(context.tools ?? [], []);
				const bytes = Buffer.byteLength(JSON.stringify(context));
				assert.ok(bytes <= 1048576);
				const reserved = (bytes + 8192) / 3e6;
				assert.ok(ledger.attempts.length < 3 && ledger.attempts.reduce((n, a) => n + a.reservedUsd, 0) + reserved <= 1);
				const attempt = {
					requestId,
					assetRef,
					inputBytes: bytes,
					maxOutputTokens: 8192,
					reservedUsd: reserved,
					status: "started",
					startedAt: new Date().toISOString(),
				};
				ledger.attempts.push(attempt);
				writeFileSync(path, JSON.stringify(ledger, null, 2));
				const stream = runtime.streamSimple(m, context, { ...options, maxTokens: 8192 });
				const began = performance.now();
				waits.push(
					stream.result().then(async (message) => {
						Object.assign(attempt, {
							status: message.stopReason,
							elapsedMs: performance.now() - began,
							usage: message.usage,
							finishedAt: new Date().toISOString(),
						});
						await writeFile(path, JSON.stringify(ledger, null, 2));
					}),
				);
				return stream;
			},
		},
	};
	await mkdir(sessionDir, { recursive: true });
	const invoke = async () => {
		const tool = await registered
			.get("ui_design_review")
			.execute(
				requestId,
				{ task_ref: taskRef, asset_ref: assetRef, request_id: requestId },
				new AbortController().signal,
				undefined,
				ctx,
			);
		await Promise.all(waits);
		return JSON.parse(tool.content[0].text);
	};
	const response = measurement
		? await measurement.invoke("ui_design_review", "independent-baseline-review", invoke)
		: await invoke();
	await writeFile(join(output, "independent-design-review.json"), JSON.stringify(response, null, 2));
	console.log(
		JSON.stringify({ requestId, decision: response.output?.decision, reviewRef: response.artifact_refs?.[0], output }),
	);
	assert.equal(response.status, "completed", JSON.stringify(response.errors));
	assert.equal(
		response.output.decision,
		"approved",
		"Independent design review did not approve; preserve this attempt",
	);
	measurement?.mark("independently-approved-design-endpoint");
	return { response, calls: ledger.attempts.length, providerElapsedMs: ledger.attempts.at(-1).elapsedMs };
}
