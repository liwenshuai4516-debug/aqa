/** Explicitly authorized native U05 review/diagnosis continuation; no surrogate approval. */
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { UiWorkflowService, capabilities } from "pi-ui-testing";

const [directory, operation] = process.argv.slice(2);
assert.ok(
	directory && ["review", "diagnose"].includes(operation),
	"Usage: <prepared evidence directory> review|diagnose",
);
const output = resolve(directory),
	root = join(output, "project");
const prepared = JSON.parse(await readFile(join(output, "result.json"), "utf8"));
assert.equal(prepared.status, "PASS");
const installed = dirname(fileURLToPath(import.meta.resolve("pi-ui-testing")));
const { registerDesignTools } = await import(pathToFileURL(join(installed, "design-extension.js")).href);
const definitions = new Map();
registerDesignTools({ registerTool: (tool) => definitions.set(tool.name, tool) });
const authority = join(output, "private-authority");
const workflow = new UiWorkflowService(root, authority, {
	tools: ["read", ...capabilities.map((c) => c.tool)],
	skills: await readdir(join(installed, "../skills")),
});
const ledgerPath = fileURLToPath(
	new URL("./scratch/ui-optimization-u00/u05-authorized-review-budget.json", import.meta.url),
);
// One authorization ledger is shared across U05 revision directories. Never initialize/reset here.
const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
const number = ledger.native_attempts.length + 1;
const resultFile = join(output, operation === "review" ? `native-review-${number}.json` : "native-diagnose.json");
assert.ok(!existsSync(resultFile), "Saved request exists; inspect status before continuation");
const saveLedger = () => writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
const ctx = { cwd: root, sessionManager: { getSessionDir: () => output } };
// Native extension owns its authority in <sessionDir>/ui-review-authority.
// Keep workflow gates pointed at the same private authority, never copy or forge receipts.
const nativeWorkflow = new UiWorkflowService(root, join(output, "ui-review-authority"), workflow.runtime);
const result = { operation, started_at: new Date().toISOString(), formalRunnerCalls: 0 };
let running;
try {
	if (operation === "review") {
		assert.ok(ledger.native_attempts.length < ledger.max_calls, "Shared three-review authorization exhausted");
		const settings = JSON.parse(await readFile(join(homedir(), ".pi/agent/settings.json"), "utf8"));
		assert.ok(!ledger.attempts.some((a) => a.status === "started"), "Unknown provider outcome; inspect before retry");
		const runtime = await ModelRuntime.create({
			modelsStorePath: join(output, "model-cache.json"),
			refreshOnCreate: false,
		});
		const model = (await runtime.getAvailable()).find(
			(m) => m.provider === settings.defaultProvider && m.id === settings.defaultModel,
		);
		assert.ok(model, "Current native model unavailable");
		// Prices are the registry USD / million token rates; zero/unknown prices cannot authorize calls.
		assert.ok(model.cost.input > 0 && model.cost.output > 0, "A priced current model is required");
		ctx.model = model;
		const pending = [];
		ctx.modelRegistry = {
			streamSimple(m, context, options) {
				assert.equal(m.id, model.id);
				assert.deepEqual(context.tools ?? [], [], "Independent reviewer must have no tools");
				assert.ok(ledger.attempts.length < ledger.max_calls, "Shared call authorization exhausted");
				const inputBytes = Buffer.byteLength(JSON.stringify(context));
				assert.ok(inputBytes <= ledger.max_input_bytes, "Review input exceeds bounded request size");
				// Reserving one input token per UTF-8 byte is deliberately conservative for this source text.
				const reserved = (inputBytes * model.cost.input + ledger.max_output_tokens * model.cost.output) / 1e6;
				assert.ok(
					ledger.attempts.reduce((n, a) => n + a.reserved_usd, 0) + reserved <= ledger.max_cost_usd,
					"Review cost ceiling reached",
				);
				const attempt = {
					number: ledger.attempts.length + 1,
					provider: model.provider,
					model: model.id,
					input_bytes: inputBytes,
					max_output_tokens: ledger.max_output_tokens,
					reserved_usd: reserved,
					status: "started",
					started_at: new Date().toISOString(),
				};
				ledger.attempts.push(attempt);
				saveLedger();
				const stream = runtime.streamSimple(m, context, { ...options, maxTokens: ledger.max_output_tokens });
				pending.push(
					stream.result().then((message) => {
						attempt.status = message.stopReason;
						attempt.usage = message.usage;
						attempt.duration_ms = message.durationMs;
						if (message.errorMessage) {
							const error = message.errorMessage;
							attempt.error_status = error.match(/\b[45]\d\d\b/)?.[0] ?? null;
							attempt.error_category = /api.key|authentication|unauthori|credential/i.test(error)
								? "authentication"
								: /quota|balance|credit|insufficient/i.test(error)
									? "quota"
									: /model.*not|not.*model|unsupported|unknown model/i.test(error)
										? "model-unsupported"
										: /context|token.*limit|maximum.*token/i.test(error)
											? "token-limit"
											: /429|rate.limit/i.test(error)
												? "rate-limit"
												: /abort|timeout/i.test(error)
													? "timeout"
													: "provider-or-runtime-error";
						}
						attempt.finished_at = new Date().toISOString();
						saveLedger();
					}),
				);
				return stream;
			},
		};
		const current = await nativeWorkflow.find("u05-diagnostic-prepared");
		const resumed = await nativeWorkflow.resumeTask(current.task_ref);
		result.taskRef = resumed.task_ref;
		const requestId = `u05-native-review-${number}`;
		ledger.native_attempts.push({ request_id: requestId, status: "started" });
		saveLedger();
		result.request_id = requestId;
		// The installed tool creates its own new Agent and validates the real model response.
		result.tool = await definitions
			.get("ui_design_review")
			.execute(
				requestId,
				{ task_ref: resumed.task_ref, asset_ref: prepared.assetRef, request_id: requestId },
				new AbortController().signal,
				undefined,
				ctx,
			);
		await Promise.all(pending);
		if (result.tool.details.status !== "completed") process.exitCode = 1;
		ledger.native_attempts.at(-1).status = result.tool.details.status;
		saveLedger();
		result.budget = ledger;
	} else {
		const prior = JSON.parse(
			await readFile(join(output, `native-review-${ledger.native_attempts.length}.json`), "utf8"),
		);
		const response = JSON.parse(prior.tool.content.find((c) => c.type === "text").text);
		assert.equal(response.output?.decision, "approved", "Trusted native design approval required");
		const base = dirname(join(root, prepared.assetRef.path));
		const { startProbeServers } = await import(pathToFileURL(join(base, "ui-probe-replay.mjs")).href);
		running = await startProbeServers(prepared.deployments);
		const requestId = "u05-native-diagnostic-1";
		result.request_id = requestId;
		result.tool = await definitions.get("ui_design_diagnose").execute(
			requestId,
			{
				request: {
					operation: "diagnose",
					asset_ref: prepared.assetRef,
					review_ref: response.output.review_ref,
					spec_ref: prepared.diagnosticSpecRef,
					request_id: requestId,
				},
			},
			new AbortController().signal,
			undefined,
			ctx,
		);
	}
} catch (error) {
	result.error = { message: error.message, artifact_refs: error.artifact_refs ?? [] };
	process.exitCode = 1;
} finally {
	await running?.close();
	result.finished_at = new Date().toISOString();
	const file = resultFile;
	// Unknown native requests must be inspected via status, never silently repeated with a new ID.
	await writeFile(file, JSON.stringify(result, null, 2), { flag: "wx" });
	console.log(JSON.stringify(result, null, 2));
}
