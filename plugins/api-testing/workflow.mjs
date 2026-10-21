/** P1-3 in-memory workflow ownership + immutable file evidence; no asset index or restart replay. */
import { realpathSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { importContract, designCandidates, compileSuite, saveDraft, hash } from "./suite.mjs";
import { inspectDraft, reviewDraft } from "./review.mjs";
import { buildReport } from "./report.mjs";

const json = (value) => JSON.stringify(value, null, 2) + "\n";
const fail = (message) => {
	throw new Error(message);
};
const sameOwner = (a, b) =>
	["clientId", "conversationId", "pluginId", "toolName"].every((key) => a[key] === b[key]) &&
	realpathSync(a.cwd) === realpathSync(b.cwd);
const allowed = {
	prepare: ["action", "sourcePath", "operationIds", "cases", "rules", "baseUrl", "outputPath", "requiredKeywords"],
	revise: ["action", "cases", "outputPath"],
	review: ["action", "model"],
	run: ["action"],
	retest: ["action", "priorRunId"],
	report: ["action", "runId"],
};

export function createWorkflow({ approve, execute, assets }) {
	const workflows = new Map();
	const inspect = async (state) => {
		if (hash(readFileSync(join(state.bundlePath, "manifest.json"))) !== state.manifestHash)
			fail("Workflow package changed outside a controlled revision");
		const result = await inspectDraft(state.identity.cwd, state.bundlePath);
		if (hash(readFileSync(join(state.bundlePath, "manifest.json"))) !== state.manifestHash)
			fail("Workflow package changed during validation");
		return result;
	};
	const save = (state) =>
		writeFileSync(
			join(state.evidenceRoot, "workflow.json"),
			json({
				schemaVersion: 1,
				id: state.id,
				identity: state.identity,
				suitePath: state.bundlePath,
				phase: state.phase,
				reviewCalls: state.reviewCalls,
				reviewHistory: state.reviewHistory,
				runIds: state.runs.map((r) => r.runId),
				deadline: state.deadline,
			}),
			{ mode: 0o600 },
		);
	return {
		attachScheduler: (host) => assets.attachScheduler(host),
		dispose() {
			if ([...workflows.values()].some((state) => state.busy)) fail("API workflow is still active");
			assets.close();
		},
		async call(identity, request, signal, complete) {
			signal.throwIfAborted();
			const input = structuredClone(request.input ?? {}),
				action = input.action;
			if (typeof action === "string" && (action.startsWith("asset_") || action.startsWith("schedule_")))
				return assets.call(identity, input, signal);
			if (!allowed[action] || Object.keys(input).some((key) => !allowed[action].includes(key)))
				fail("Unknown workflow action or argument");
			if (action === "prepare") {
				if (!Array.isArray(input.cases) || input.cases.length > 3) fail("Select one to three small cases per workflow");
				const base = new URL(input.baseUrl);
				if (
					base.protocol !== "http:" ||
					base.hostname !== "127.0.0.1" ||
					Number(base.port) < 8900 ||
					base.origin !== input.baseUrl
				)
					fail("Real targets remain blocked; use an explicit loopback fixture origin");
				const imported = await importContract({
					projectRoot: identity.cwd,
					sourcePath: input.sourcePath,
					operationIds: input.operationIds,
				});
				signal.throwIfAborted();
				const suite = compileSuite({
					imported,
					cases: input.cases,
					rules: input.rules ?? [],
					baseUrl: input.baseUrl,
					requiredKeywords: input.requiredKeywords ?? [],
				});
				const draft = saveDraft(identity.cwd, input.outputPath, suite);
				const id = randomUUID(),
					evidenceRoot = join(dirname(draft.path), basename(draft.path) + "-evidence-" + id);
				mkdirSync(evidenceRoot, { mode: 0o700 });
				const state = {
					id,
					identity: { ...identity, cwd: realpathSync(identity.cwd) },
					bundlePath: draft.path,
					manifestHash: hash(json(suite.manifest)),
					evidenceRoot,
					phase: "draft",
					baseUrl: input.baseUrl,
					reviewCalls: 0,
					reviewHistory: [],
					revisions: 0,
					hashHistory: [],
					runs: [],
					findings: [],
					busy: false,
					unknownWrites: false,
					deadline: Date.now() + 180000,
				};
				workflows.set(id, state);
				save(state);
				return {
					workflowRef: id,
					phase: state.phase,
					suitePath: draft.path,
					evidencePath: evidenceRoot,
					unsupported: imported.unsupported,
					candidateOutlineCount: designCandidates(imported).length,
				};
			}
			const state = workflows.get(request.runRef);
			if (!state || !sameOwner(state.identity, identity)) fail("Workflow is unknown or belongs to another caller");
			if (action === "report") {
				const run = state.runs.find((r) => r.runId === input.runId) ?? fail("Unknown run");
				return { runId: run.runId, ...run.summary, scope: "historical-only; no requests or model calls" };
			}
			if (state.busy) fail("Workflow already has a pending operation");
			if (Date.now() >= state.deadline) fail("Workflow overall time budget expired");
			state.busy = true;
			try {
				if (action === "revise") {
					if (
						(state.phase !== "revise" &&
							!(state.phase === "approved" && state.runs.some((r) => ["failed", "error"].includes(r.status)))) ||
						state.revisions >= 2
					)
						fail("Correction is not allowed or revision limit reached");
					const inspected = await inspect(state);
					const suite = compileSuite({
						imported: inspected.imported,
						cases: input.cases,
						rules: inspected.rules,
						baseUrl: state.baseUrl,
					});
					signal.throwIfAborted();
					state.bundlePath = saveDraft(identity.cwd, input.outputPath, suite).path;
					state.manifestHash = hash(json(suite.manifest));
					state.revisions++;
					state.phase = "draft";
					save(state);
					return { workflowRef: state.id, phase: state.phase, suitePath: state.bundlePath };
				}
				if (action === "review") {
					if (!["draft", "revise"].includes(state.phase) || state.reviewCalls >= 3)
						fail("Review is unavailable or call budget exhausted");
					const inspected = await inspect(state);
					state.hashHistory.push(inspected.suiteHash);
					if (state.hashHistory.length >= 3 && new Set(state.hashHistory.slice(-3)).size === 1) {
						state.phase = "blocked";
						save(state);
						return { workflowRef: state.id, phase: "blocked", reason: "two-rounds-without-improvement" };
					}
					const result = await reviewDraft({
						projectRoot: identity.cwd,
						bundlePath: state.bundlePath,
						complete,
						model: input.model,
						signal,
						maxRounds: 1,
						maxCalls: 3 - state.reviewCalls,
						timeoutMs: Math.min(90000, state.deadline - Date.now()),
					});
					state.reviewCalls += result.budget.calls;
					state.reviewHistory.push(result);
					state.phase = result.verdict === "pass" ? "approved" : result.verdict;
					save(state);
					if (result.verdict !== "pass")
						return {
							workflowRef: state.id,
							phase: state.phase,
							reason: result.reason,
							reviewPath: join(state.evidenceRoot, "workflow.json"),
						};
					signal.throwIfAborted();
					const fresh = await inspect(state);
					if (fresh.suiteHash !== result.suiteHash) fail("Suite changed while under review");
					const files = Object.fromEntries(
						Object.entries(fresh.files).map(([name, data]) => [name, data.toString("utf8")]),
					);
					files["review.json"] = json(result);
					const manifest = {
						...fresh.manifest,
						state: "approved",
						files: { ...fresh.manifest.files, "review.json": hash(files["review.json"]) },
					};
					state.bundlePath = saveDraft(
						identity.cwd,
						join(dirname(state.bundlePath), basename(state.bundlePath) + "-approved-" + randomUUID()),
						{ files, manifest },
					).path;
					state.manifestHash = hash(json(manifest));
					const published = await assets.publish(identity, state.bundlePath);
					state.assetRef = published.assetRef;
					state.approvedHash = result.suiteHash;
					state.artifactHash = result.artifactHash;
					save(state);
					return {
						workflowRef: state.id,
						phase: "approved",
						suitePath: state.bundlePath,
						reviewCalls: state.reviewCalls,
						assetRef: state.assetRef,
					};
				}
				if (action !== "run" && action !== "retest") fail("Unsupported workflow transition");
				if (state.phase !== "approved" || state.unknownWrites)
					fail("Suite is not approved or unknown writes need reconciliation");
				if (assets.isArchived(identity, state.assetRef)) fail("Archived asset cannot execute");
				const inspected = await inspect(state);
				if (inspected.suiteHash !== state.approvedHash || inspected.artifactHash !== state.artifactHash)
					fail("Approved suite changed");
				if (action === "retest" && !state.runs.some((r) => r.runId === input.priorRunId))
					fail("Retest requires a known prior run");
				if (state.deadline - Date.now() < 100) fail("Workflow overall time budget expired");
				const runId = approve({
					identity,
					bundleRoot: state.bundlePath,
					fixtureOrigin: state.baseUrl,
					timeoutMs: Math.min(20000, state.deadline - Date.now()),
				});
				const root = join(state.evidenceRoot, runId);
				mkdirSync(root, { mode: 0o700 });
				const record = {
					runId,
					startedAt: new Date().toISOString(),
					priorRunId: input.priorRunId ?? null,
					status: "running",
				};
				state.runs.push(record);
				save(state);
				writeFileSync(join(root, "run.json"), json(record), { mode: 0o600 });
				let evidence,
					interrupted = false;
				try {
					const result = await execute(
						identity,
						{ serverId: "api-testing", toolName: "runApprovedSuite", runRef: runId },
						signal,
					);
					evidence = JSON.parse(readFileSync(result.evidencePath, "utf8"));
				} catch {
					interrupted = true;
					evidence = { runId, executionVerdict: "unknown", executions: [] };
				}
				const cases = inspected.cases.map((candidate, i) => ({
					id: candidate.id,
					method: inspected.collection.item[i].request.method,
					phase: candidate.phase ?? "main",
				}));
				if (interrupted && cases.some((c) => !["GET", "HEAD", "OPTIONS"].includes(c.method)))
					state.unknownWrites = true;
				const report = buildReport({
					runId,
					suiteHash: inspected.suiteHash,
					evidence,
					interrupted,
					previous: state.findings,
					priorRunId: record.priorRunId,
					cases,
				});
				state.findings = report.findings;
				writeFileSync(join(root, "results.json"), json(evidence), { mode: 0o600 });
				writeFileSync(join(root, "findings.json"), json(report.findings), { mode: 0o600 });
				writeFileSync(join(root, "report.json"), json(report), { mode: 0o600 });
				writeFileSync(join(root, "report.md"), report.markdown, { mode: 0o600 });
				record.status = report.executionVerdict;
				record.summary = {
					executionVerdict: report.executionVerdict,
					reportPath: join(root, "report.md"),
					findingsPath: join(root, "findings.json"),
					cleanup: report.cleanup,
					openFindings: report.findings.filter((f) => f.status === "open").length,
				};
				writeFileSync(join(root, "run.json"), json(record), { mode: 0o600 });
				save(state);
				assets.copyRun(identity, state.assetRef, root);
				return { workflowRef: state.id, runId, ...record.summary };
			} finally {
				state.busy = false;
			}
		},
	};
}
