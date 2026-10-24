/** Snapshot-only scoring. No host, source adapters, runner, shell or model service is passed to rules. */
import { Check } from "typebox/value";
import { Finding, LIMITS, digest, requireValue, EvaluationError } from "./schema.mjs";
import { recordsOf, readEvidenceJson } from "./collect.mjs";
import { deepFreeze } from "./registry.mjs";
import { aggregate } from "./aggregate.mjs";
const refOf = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
const refKey = (r) => `${r.kind}:${r.id}:${r.revision}`;
const ruleKey = (r) => `${r.id}@${r.version}`;
const matches = (condition, rule) => [rule.id, ruleKey(rule)].includes(condition.ruleRef);
const errorFinding = (rule, condition, code) => ({
	findingId: `${ruleKey(rule)}:${condition?.id ?? "diagnostic"}`,
	...(condition ? { conditionId: condition.id } : {}),
	ruleId: rule.id,
	ruleVersion: rule.version,
	verdict: "inconclusive",
	evidenceState: "unavailable",
	method: "deterministic",
	nature: "unconfirmed",
	evidenceRefs: [],
	missingEvidence: [code],
	reason: code,
	attributions: [
		{ category: code === "EVIDENCE_GAP" ? "unknown" : "evaluator", evidenceRefs: [], status: "unconfirmed" },
	],
	error: code,
});
function failures(contract, rule, code) {
	const conditions = [...contract.conditions, ...contract.constraints].filter((c) => matches(c, rule));
	return (conditions.length ? conditions : [null]).map((condition) => errorFinding(rule, condition, code));
}
async function boundedCall(evaluator, contract, view, config, signal, timeoutMs, onInvoke) {
	const controller = new AbortController();
	let timer, abort;
	const start = performance.now();
	try {
		const boundary = new Promise((_, reject) => {
			abort = () => {
				controller.abort();
				reject(new EvaluationError("CANCELLED", "Evaluation cancelled"));
			};
			if (signal.aborted) abort();
			else signal.addEventListener("abort", abort, { once: true });
			timer = setTimeout(() => {
				controller.abort();
				reject(new EvaluationError("RULE_TIMEOUT", "Evaluator deadline exceeded"));
			}, timeoutMs);
		});
		const work = Promise.resolve().then(() => {
			controller.signal.throwIfAborted();
			onInvoke();
			return evaluator.evaluate(contract, view, config, controller.signal);
		});
		const result = await Promise.race([work, boundary]);
		// Trusted synchronous JS cannot be preempted by a timer; never accept a late return as on time.
		requireValue(performance.now() - start <= timeoutMs, "RULE_TIMEOUT", "Evaluator deadline exceeded");
		return result;
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", abort);
		controller.abort();
	}
}
function snapshotView(store, context, snapshot) {
	const started = performance.now(),
		evidence = [],
		sources = new Map();
	let bytes = 0;
	for (const ref of snapshot.data.evidenceRefs) {
		requireValue(performance.now() - started <= LIMITS.readMs, "LIMIT_EXCEEDED", "Snapshot read deadline exceeded");
		const record = store.get(context, ref);
		bytes += (record.contentRef?.size ?? 0) + Buffer.byteLength(JSON.stringify(record));
		requireValue(
			bytes <= LIMITS.readBytes && evidence.length < LIMITS.readItems,
			"LIMIT_EXCEEDED",
			"Snapshot read budget exceeded",
		);
		// get() above already validates this record and its authorization graph.
		// The internal view is byte-bounded; do not re-read/hash a whole blob for every UI page.
		const text = record.contentRef ? store.readBlob(record) : "";
		let value = null;
		try {
			if (text) value = JSON.parse(text);
		} catch {
			/* Plain text remains available as text, never inferred JSON. */
		}
		evidence.push({ ref, digest: record.digest, data: record.data, text, value });
		if (record.data.sourceEventId) {
			const key = `${record.data.attemptRef.id}:${record.data.sourceId}:${record.data.sourceEventId}`;
			const revisions = sources.get(key) ?? new Map();
			revisions.set(record.data.sourceRevision ?? record.digest, [
				...(revisions.get(record.data.sourceRevision ?? record.digest) ?? []),
				refKey(ref),
			]);
			sources.set(key, revisions);
		}
	}
	const conflicting = [...sources.values()]
		.filter((revisions) => revisions.size > 1)
		.flatMap((revisions) => [...revisions.values()].flat());
	requireValue(performance.now() - started <= LIMITS.readMs, "LIMIT_EXCEEDED", "Snapshot read deadline exceeded");
	return deepFreeze({
		snapshot: snapshot.data,
		evidence,
		attempts: snapshot.data.attemptRefs.map((ref) => ({ ref, data: store.get(context, ref).data })),
		conflicting,
	});
}
function checkedFindings(output, evaluator, contract, view) {
	const manifest = evaluator.manifest,
		rule = { id: manifest.id, version: manifest.version };
	requireValue(
		Array.isArray(output) && output.length > 0 && output.length <= manifest.budget.maxFindings,
		"INVALID_RULE_OUTPUT",
		"Invalid finding count",
	);
	requireValue(
		Buffer.byteLength(JSON.stringify(output)) <= LIMITS.recordBytes,
		"INVALID_RULE_OUTPUT",
		"Findings exceed byte budget",
	);
	const allowed = new Map(view.evidence.map((e) => [refKey(e.ref), e]));
	const emittedConditions = new Set();
	return output.map((raw, index) => {
		requireValue(raw && typeof raw === "object" && !Array.isArray(raw), "INVALID_RULE_OUTPUT", "Invalid finding");
		const refs = raw.evidenceRefs ?? [],
			attributions = raw.attributions ?? [];
		requireValue(
			Array.isArray(refs) && Array.isArray(attributions),
			"INVALID_RULE_OUTPUT",
			"Invalid evidence references",
		);
		for (const ref of [...refs, ...attributions.flatMap((a) => a.evidenceRefs ?? [])])
			requireValue(allowed.has(refKey(ref)), "INVALID_RULE_OUTPUT", "Finding cites evidence outside snapshot");
		if (raw.conditionId) {
			requireValue(!emittedConditions.has(raw.conditionId), "INVALID_RULE_OUTPUT", "Duplicate finding condition");
			emittedConditions.add(raw.conditionId);
			requireValue(
				[...contract.conditions, ...contract.constraints].some((c) => c.id === raw.conditionId && matches(c, rule)),
				"INVALID_RULE_OUTPUT",
				"Finding does not match its frozen condition",
			);
		}
		const trusted = (ref) => {
			const item = allowed.get(refKey(ref));
			return (
				item &&
				["harness-observed", "externally-verified", "instrumented"].includes(item.data.origin) &&
				item.data.availability !== "unavailable" &&
				!item.data.truncated &&
				!view.conflicting.includes(refKey(ref))
			);
		};
		const sufficient = raw.evidenceState === "sufficient" && refs.length > 0 && refs.every(trusted);
		const finding = {
			...raw,
			evidenceRefs: refs,
			attributions: attributions.map((a) => ({
				...a,
				status: a.evidenceRefs?.length && a.evidenceRefs.every(trusted) ? a.status : "unconfirmed",
			})),
			findingId: `${ruleKey(rule)}:${index + 1}`,
			ruleId: rule.id,
			ruleVersion: rule.version,
			method: "deterministic",
			nature: sufficient ? "verified" : "unconfirmed",
		};
		if (finding.conditionId && ["pass", "fail"].includes(finding.verdict) && !sufficient) {
			finding.verdict = "inconclusive";
			finding.missingEvidence = [...(finding.missingEvidence ?? []), "evidence-not-sufficient"];
		}
		if (refs.some((ref) => view.conflicting.includes(refKey(ref)))) {
			finding.verdict = "inconclusive";
			finding.evidenceState = "invalid";
			finding.missingEvidence = [...(finding.missingEvidence ?? []), "conflicting-source-revisions"];
		}
		if (
			finding.verdict === "not-applicable" &&
			(!sufficient ||
				[...contract.conditions, ...contract.constraints].some(
					(c) => c.id === finding.conditionId && c.applicableWhen === "always",
				))
		) {
			finding.verdict = "inconclusive";
			finding.missingEvidence = [...(finding.missingEvidence ?? []), "applicability-not-proven"];
		}
		requireValue(Check(Finding, finding), "INVALID_RULE_OUTPUT", "Finding schema is invalid");
		return finding;
	});
}

export class EvaluationEngine {
	#jobs = new Map();
	#closed = false;
	constructor(store, registry, { timeoutMs = 10000 } = {}) {
		requireValue(
			Number.isInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 10000,
			"INVALID_INPUT",
			"Invalid scoring budget",
		);
		this.store = store;
		this.registry = registry;
		this.timeoutMs = timeoutMs;
	}
	start(context, { snapshotRef, profileId, profileVersion, requestId }) {
		requireValue(!this.#closed, "CAPABILITY_UNAVAILABLE", "Evaluation engine is stopped");
		requireValue(
			typeof requestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(requestId),
			"INVALID_INPUT",
			"Invalid scoring request ID",
		);
		this.store.identity(context, true);
		const snapshot = this.store.get(context, snapshotRef),
			contract = this.store.get(context, snapshot.data.contractRef);
		requireValue(snapshot.kind === "snapshots", "INVALID_INPUT", "A sealed snapshot is required");
		const profile = this.registry.profile(profileId, profileVersion);
		requireValue(
			profile.taskTypes.includes(contract.data.evaluationSubject),
			"INVALID_INPUT",
			"Profile does not support this task",
		);
		const configuration = { profileId, profileVersion, rules: profile.rules },
			configDigest = digest(configuration);
		const requestDigest = digest({ snapshotRef, configuration, timeoutMs: this.timeoutMs });
		// Durable request receipts already index this exact operation. Do not load every
		// evidence record just to discover that a new scoring request has not run.
		const previous = this.store.lookupRequest(context, `eval-job-${digest(requestId)}`);
		if (previous) {
			requireValue(
				readEvidenceJson(this.store, context, refOf(previous)).requestDigest === requestDigest,
				"VERSION_CONFLICT",
				"Scoring request changed",
			);
			const running = this.#jobs.get(previous.id);
			if (running && running.state !== "failed") return { jobId: running.id, state: running.state, done: running.done };
			const saved = recordsOf(this.store, context, "evaluations").find((r) => r.data.job?.jobId === previous.id);
			if (!saved && running) return { jobId: running.id, state: running.state, done: running.done };
			requireValue(
				saved,
				"EXECUTION_UNKNOWN",
				"Previous scoring was interrupted; inspect it or explicitly re-evaluate with a new request ID",
			);
			if (running) {
				running.state = saved.data.state;
				running.reportRef = refOf(saved);
				running.done = Promise.resolve(saved);
			}
			return { jobId: previous.id, state: saved.data.state, done: Promise.resolve(saved) };
		}
		const queuedAt = new Date().toISOString();
		const queued = this.store.write(context, {
			kind: "evidence",
			requestId: `eval-job-${digest(requestId)}`,
			data: {
				attemptRef: snapshot.data.attemptRefs[0],
				sourceId: "evaluation-requests",
				sourceEventId: requestId,
				sourceLocator: `snapshot:${snapshot.id}`,
				sourceRevision: requestDigest,
				producer: "evaluation-engine-v1",
				availability: "available",
				origin: "harness-observed",
				kind: "evaluation-job",
				observedAt: queuedAt,
				content: JSON.stringify({ requestDigest, snapshotRef, configuration, queuedAt, state: "queued" }),
				redaction: [],
				truncated: false,
			},
		});
		let resolve, reject;
		const done = new Promise((yes, no) => {
			resolve = yes;
			reject = no;
		});
		done.catch(() => {}); // start/status consumers need not retain a rejected Promise.
		const job = {
			id: queued.id,
			queuedRef: refOf(queued),
			state: "queued",
			generation: 1,
			queuedAt,
			done,
			controller: new AbortController(),
			snapshot,
			contract,
			profile,
			configuration,
			configDigest,
			context,
			cancellationRequestedAt: undefined,
		};
		this.#jobs.set(job.id, job);
		queueMicrotask(() => {
			void this.#run(job).then(resolve, reject);
		});
		return { jobId: job.id, state: job.state, done };
	}
	evaluate(context, options) {
		return this.start(context, options).done;
	}
	status(context, jobId) {
		const receipt = this.store.get(context, { kind: "evidence", id: jobId, revision: 1 });
		requireValue(
			receipt.data.kind === "evaluation-job" && receipt.data.producer === "evaluation-engine-v1",
			"INVALID_INPUT",
			"Expected scoring job receipt",
		);
		const job = this.#jobs.get(jobId);
		if (job)
			return {
				jobId,
				state: job.state,
				generation: job.generation,
				cancellationRequestedAt: job.cancellationRequestedAt,
				error: job.error,
				reportRef: job.reportRef,
			};
		const saved = recordsOf(this.store, context, "evaluations").find((r) => r.data.job?.jobId === jobId);
		return saved
			? { jobId, state: saved.data.state, reportRef: refOf(saved) }
			: { jobId, state: "unknown", error: "Interrupted scoring is not automatically replayed" };
	}
	cancel(context, jobId) {
		this.store.identity(context, true);
		this.store.get(context, { kind: "evidence", id: jobId, revision: 1 });
		const job = this.#jobs.get(jobId);
		requireValue(job, "EXECUTION_UNKNOWN", "No controllable scoring job in this process");
		if (["completed", "failed", "cancelled"].includes(job.state)) return this.status(context, jobId);
		if (!job.controller.signal.aborted) {
			job.generation++;
			job.cancellationRequestedAt = new Date().toISOString();
			job.controller.abort();
			job.state = "cancelling";
			this.#event(job, "cancellation-requested", { at: job.cancellationRequestedAt, generation: job.generation });
		}
		return this.status(context, jobId);
	}
	#event(job, state, detail) {
		const body = { jobId: job.id, state, ...detail };
		this.store.write(job.context, {
			kind: "evidence",
			requestId: `eval-state-${digest([job.id, state])}`,
			data: {
				attemptRef: job.snapshot.data.attemptRefs[0],
				sourceId: `evaluation-job:${job.id}`,
				sourceEventId: state,
				sourceLocator: `evaluation-job:${job.id}`,
				sourceRevision: digest(body),
				producer: "evaluation-engine-v1",
				availability: "available",
				origin: "harness-observed",
				kind: "evaluation-job-state",
				observedAt: detail.at,
				content: JSON.stringify(body),
				redaction: [],
				truncated: false,
			},
		});
	}
	async #run(job) {
		const { context, contract, snapshot, profile } = job;
		const findings = [],
			requiredRuleGaps = [],
			completed = new Set(),
			invoked = new Set();
		const startedAt = new Date().toISOString(),
			startedMono = performance.now();
		let globalError;
		job.state = job.controller.signal.aborted ? "cancelling" : "running";
		try {
			if (!job.controller.signal.aborted) this.#event(job, "running", { at: startedAt, generation: job.generation });
			const view = snapshotView(this.store, context, snapshot);
			const frozenContract = deepFreeze(structuredClone(contract.data));
			for (const rule of this.registry.orderedRules(profile)) {
				if (job.controller.signal.aborted) break;
				const remaining = this.timeoutMs - (performance.now() - startedMono);
				if (remaining <= 0) {
					findings.push(...failures(contract.data, rule, "JOB_BUDGET_EXCEEDED"));
					completed.add(ruleKey(rule));
					continue;
				}
				const evaluator = this.registry.evaluator(rule.id, rule.version),
					generation = job.generation;
				try {
					requireValue(
						evaluator.manifest.requiredEvidence.every((kind) =>
							view.evidence.some(
								(e) => e.data.kind === kind && e.data.availability !== "unavailable" && !e.data.truncated,
							),
						),
						"EVIDENCE_GAP",
						"Required evidence is unavailable",
					);
					const output = await boundedCall(
						evaluator,
						frozenContract,
						view,
						rule.config,
						job.controller.signal,
						Math.min(remaining, evaluator.manifest.timeoutMs),
						() => invoked.add(ruleKey(rule)),
					);
					if (generation !== job.generation || job.controller.signal.aborted) break;
					findings.push(...checkedFindings(output, evaluator, contract.data, view));
				} catch (error) {
					if (job.controller.signal.aborted) break;
					findings.push(
						...failures(
							contract.data,
							rule,
							["RULE_TIMEOUT", "INVALID_RULE_OUTPUT", "EVIDENCE_GAP"].includes(error.code)
								? error.code
								: "EVALUATOR_ERROR",
						),
					);
				}
				completed.add(ruleKey(rule));
				requireValue(findings.length <= 1000, "LIMIT_EXCEEDED", "Finding budget exceeded");
			}
		} catch (error) {
			globalError = error.code ?? "EVALUATION_FAILED";
		}
		for (const rule of profile.rules)
			if (!completed.has(ruleKey(rule)))
				findings.push(
					...failures(contract.data, rule, globalError ?? (invoked.has(ruleKey(rule)) ? "CANCELLED" : "NOT_EXECUTED")),
				);
		for (const condition of [...contract.data.conditions, ...contract.data.constraints])
			if (!findings.some((f) => f.conditionId === condition.id))
				findings.push(errorFinding({ id: "contract", version: "1" }, condition, "NOT_EXECUTED"));
		for (const required of profile.required)
			if (
				!completed.has(ruleKey(required)) ||
				findings.some((f) => f.ruleId === required.id && f.ruleVersion === required.version && f.error)
			)
				requiredRuleGaps.push(`${ruleKey(required)} did not complete successfully`);
		const state = job.controller.signal.aborted ? "cancelled" : globalError ? "failed" : "completed";
		const endedAt = new Date().toISOString();
		const data = {
			snapshotRef: refOf(snapshot),
			contractRef: refOf(contract),
			profileVersion: `${profile.id}@${profile.version}`,
			evaluatorVersions: Object.fromEntries(profile.rules.map((r) => [r.id, r.version])),
			configDigest: job.configDigest,
			state,
			findings,
			summary: aggregate(contract.data, findings, {
				planned: findings.length,
				executed: findings.filter((f) => invoked.has(`${f.ruleId}@${f.ruleVersion}`)).length,
				requiredRuleGaps,
			}),
			assessmentStage:
				state === "completed" &&
				snapshot.data.coverage === "complete" &&
				!findings.some((f) => f.verdict === "inconclusive")
					? "final"
					: "provisional",
			configuration: job.configuration,
			job: {
				jobId: job.id,
				generation: job.generation,
				queuedAt: job.queuedAt,
				startedAt,
				endedAt,
				elapsedMs: performance.now() - startedMono,
				clockSource: "process-monotonic",
				...(job.cancellationRequestedAt
					? { cancellationRequestedAt: job.cancellationRequestedAt, cancellationConfirmedAt: endedAt }
					: {}),
				...(globalError ? { error: globalError } : {}),
			},
		};
		try {
			const report = this.store.write(context, { kind: "evaluations", requestId: `eval-report-${job.id}`, data });
			job.state = state;
			job.reportRef = refOf(report);
			return report;
		} catch (error) {
			job.state = "failed";
			job.error = error.code ?? "REPORT_SAVE_FAILED";
			throw error;
		}
	}
	close() {
		this.#closed = true;
		for (const job of this.#jobs.values())
			if (!["completed", "failed", "cancelled"].includes(job.state)) {
				try {
					this.cancel(job.context, job.id);
				} catch (error) {
					job.error = error.code ?? "CANCELLATION_RECORD_FAILED";
				}
			}
	}
}
