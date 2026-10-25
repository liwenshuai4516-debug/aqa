/** Explicitly authorized native U05 review/diagnosis continuation; no surrogate approval. */
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ArtifactStore, DesignReviewService, UiWorkflowService, capabilities } from "pi-ui-testing";

const [directory, operation, revisionFile] = process.argv.slice(2);
assert.ok(
	directory && ["review", "diagnose", "result-review"].includes(operation),
	"Usage: <prepared evidence directory> review|diagnose|result-review [saved revision/report JSON]",
);
const output = resolve(directory);
const prepared = JSON.parse(await readFile(join(output, "result.json"), "utf8"));
const root = prepared.mode === "complete-browser-candidate" ? output : join(output, "project");
assert.equal(prepared.status, "PASS");
const revision = revisionFile ? JSON.parse(await readFile(resolve(revisionFile), "utf8")) : prepared;
assert.equal(revision.status, operation === "result-review" ? "DRAFT_NOT_RESULT_REVIEWED" : "PASS");
const selectedAssetRef = revision.assetRef;
const installed = dirname(fileURLToPath(import.meta.resolve("pi-ui-testing")));
const { registerDesignTools } = await import(pathToFileURL(join(installed, "design-extension.js")).href);
const definitions = new Map();
registerDesignTools({ registerTool: (tool) => definitions.set(tool.name, tool) });
const { registerResultTools } = await import(pathToFileURL(join(installed, "result-extension.js")).href);
registerResultTools({ registerTool: (tool) => definitions.set(tool.name, tool) });
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
const resultFile = join(
	output,
	operation !== "diagnose" ? `native-${operation}-${number}${ledger.result_suffix ?? ""}.json` : "native-diagnose.json",
);
assert.ok(!existsSync(resultFile), "Saved request exists; inspect status before continuation");
const saveLedger = () => writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
const ctx = { cwd: root, sessionManager: { getSessionDir: () => output } };
// Native extension owns its authority in <sessionDir>/ui-review-authority.
// Keep workflow gates pointed at the same private authority, never copy or forge receipts.
const nativeWorkflow = new UiWorkflowService(root, join(output, "ui-review-authority"), workflow.runtime);
const result = { operation, started_at: new Date().toISOString(), formalRunnerCalls: 0 };
let running;
try {
	if (operation !== "diagnose") {
		assert.ok(ledger.native_attempts.length < ledger.max_calls, "Shared authorized review rounds exhausted");
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
		assert.equal(model.provider, ledger.authorized_provider ?? "deepseek", "Authorized provider only");
		assert.equal(model.id, ledger.authorized_model ?? "deepseek-v4-pro", "Authorized model only");
		// Use the explicitly authorized conservative price bound, or a positive registry rate.
		const inputRate = ledger.price_upper_bound_usd_per_million ?? model.cost.input;
		const outputRate = ledger.price_upper_bound_usd_per_million ?? model.cost.output;
		assert.ok(inputRate > 0 && outputRate > 0, "A positive authorized price bound is required");
		ctx.model = model;
		const pending = [];
		ctx.modelRegistry = {
			streamSimple(m, context, options) {
				assert.equal(m.id, model.id);
				assert.deepEqual(context.tools ?? [], [], "Independent reviewer must have no tools");
				assert.ok(ledger.attempts.length < ledger.max_calls, "Shared call authorization exhausted");
				const inputBytes = Buffer.byteLength(JSON.stringify(context));
				result.input_bytes = inputBytes;
				assert.ok(inputBytes <= ledger.max_input_bytes, "Review input exceeds bounded request size");
				// Reserving one input token per UTF-8 byte is deliberately conservative for this source text.
				const reserved = (inputBytes * inputRate + ledger.max_output_tokens * outputRate) / 1e6;
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
		if (operation === "review") {
			const { artifact: originalTask } = await new ArtifactStore(root).snapshot(prepared.taskRef.path);
			const current = await nativeWorkflow.find(originalTask.id);
			const resumed = await nativeWorkflow.resumeTask(current.task_ref);
			result.taskRef = resumed.task_ref;
			if (revisionFile) {
				const extension = ledger.authorization_extensions.at(-1);
				assert.equal(ledger.authorized_provider, "gpt");
				assert.equal(ledger.authorized_model, "gpt-6.1-sol");
				assert.equal(extension.additional_native_limit, 3);
				assert.equal(extension.additional_cost_usd, 1);
				const remaining = ledger.max_calls - ledger.native_attempts.length;
				assert.ok(remaining >= 1 && remaining <= extension.additional_native_limit);
				// Renew once for this human authorization; subsequent candidate revisions use that same loop.
				if (ledger.native_attempts.length === extension.prior_native_attempts) {
					const grant = extension.native_grant;
					assert.ok(grant, "Explicit host renewal authorization required");
					const { expected_used_rounds, ...authorization } = grant;
					const service = new DesignReviewService(root, join(output, "ui-review-authority"));
					result.budgetGrant = await service.renewBudget(
						resumed.task_ref,
						selectedAssetRef,
						authorization,
						async (request) => request.additional_rounds === remaining && request.used_rounds === expected_used_rounds,
					);
				}
			}
		} else {
			const authorization = ledger.result_review_authorization;
			assert.ok(authorization, "Explicit report review reallocation required");
			assert.deepEqual(revision.report.report_ref, authorization.report_ref);
			assert.ok(
				ledger.native_attempts.filter(
					(a) => a.purpose === "result-review" && a.authorization_id === authorization.authorization_id,
				).length < authorization.max_calls,
				"Authorized report review already consumed",
			);
		}

		const requestId = `u05-native-${operation}-${number}`;
		ledger.native_attempts.push({
			request_id: requestId,
			status: "started",
			purpose: operation,
			...(operation === "result-review"
				? { authorization_id: ledger.result_review_authorization.authorization_id }
				: {}),
		});
		saveLedger();
		result.request_id = requestId;
		// The installed tool creates its own new Agent and validates the real model response.
		result.tool = await definitions
			.get(operation === "review" ? "ui_design_review" : "ui_result_review")
			.execute(
				requestId,
				operation === "review"
					? { task_ref: result.taskRef, asset_ref: selectedAssetRef, request_id: requestId }
					: { request: { operation: "review", report_ref: revision.report.report_ref, request_id: requestId } },
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
			await readFile(
				join(output, `native-review-${ledger.native_attempts.length}${ledger.result_suffix ?? ""}.json`),
				"utf8",
			),
		);
		const response = JSON.parse(prior.tool.content.find((c) => c.type === "text").text);
		assert.equal(response.output?.decision, "approved", "Trusted native design approval required");
		const base = dirname(join(root, selectedAssetRef.path));
		const { startProbeServers } = await import(pathToFileURL(join(base, "ui-probe-replay.mjs")).href);
		assert.ok(
			revision.diagnosticSpecRef ?? prepared.diagnosticSpecRef,
			"Reviewed revision must include a diagnostic plan",
		);
		running = await startProbeServers(revision.deployments ?? prepared.deployments);
		const requestId = "u05-native-diagnostic-1";
		result.request_id = requestId;
		result.tool = await definitions.get("ui_design_diagnose").execute(
			requestId,
			{
				request: {
					operation: "diagnose",
					asset_ref: selectedAssetRef,
					review_ref: response.output.review_ref,
					spec_ref: revision.diagnosticSpecRef ?? prepared.diagnosticSpecRef,
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
