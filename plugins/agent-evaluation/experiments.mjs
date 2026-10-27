/** Serial fixed-offline experiments over the original execution port and scoring engine.
 * Revisions are durable checkpoints. Restart never starts work; explicit resume reconciles only.
 */
import { readFileSync, readdirSync } from "node:fs";
import { Check } from "typebox/value";
import { schemas, digest, requireValue } from "./schema.mjs";
import { internalProfile } from "./profiles/internal.mjs";
const ref = ({ kind, id, revision }) => ({ kind, id, revision });
const sleep = () => new Promise((resolve) => setTimeout(resolve, 250));
const now = () => new Date().toISOString();
export class Experiments {
	constructor(service) {
		this.service = service;
		this.jobs = new Map();
		const sources = [".", "profiles", "evaluators", "adapters"].flatMap((dir) =>
			readdirSync(new URL(`${dir}/`, import.meta.url))
				.filter((name) => name.endsWith(".mjs"))
				.sort()
				.map((name) => [dir, name, readFileSync(new URL(`${dir}/${name}`, import.meta.url), "utf8")]),
		);
		this.rulesDigest = digest(sources);
	}
	latest(context, reference) {
		const original = this.service.store.get(context, reference);
		requireValue(original.kind === "experiments", "INVALID_INPUT", "Select an experiment");
		return this.service.store.latest(context, reference);
	}
	async dispatch(context, binding, request) {
		const s = this.service,
			store = s.store;
		if (request.action === "experimentStatus") return this.view(context, request.ref);
		s.execution ??= s.host.createOfflineEvaluationExecution?.(store);
		requireValue(s.execution, "CAPABILITY_UNAVAILABLE", "Fixed offline execution port unavailable");
		const call = (action, extra = {}) =>
			s.execution.dispatch(context, binding, { action, requestId: request.requestId, ...extra });
		await call("offlineAuthorize");
		if (request.action === "createDataset") {
			const runtime = await call("offlineDescribe"),
				data = {
					...request.data,
					runtimeDigest: runtime.runtimeDigest,
					initialState: "fresh-pinned-ram",
					rulesDigest: this.rulesDigest,
				};
			requireValue(
				Check(schemas.datasets, data),
				"INVALID_INPUT",
				"Confirm dataset inputs, expectations and fixed initial state",
			);
			requireValue(
				new Set(data.cases.map((c) => c.id)).size === data.cases.length,
				"INVALID_INPUT",
				"Case IDs must be unique",
			);
			for (const c of data.cases) {
				requireValue(runtime.modes.includes(c.argv[0]), "CAPABILITY_UNAVAILABLE", "Unsupported fixed diagnostic mode");
				requireValue(
					Buffer.byteLength(c.stdin) <= runtime.policy.stdinBytes &&
						c.argv.every((v) => Buffer.byteLength(v) <= 1024) &&
						Buffer.byteLength(c.argv.join("")) <= 8192,
					"LIMIT_EXCEEDED",
					"Case input exceeds fixed limits",
				);
				const contract = store.get(context, c.contractRef);
				requireValue(
					contract.kind === "contracts" && contract.data.scope.source === "pi",
					"INVALID_INPUT",
					"A selected Pi contract is the authorization anchor",
				);
				this.profile(c.configs); // Freeze/validate exact installed rule versions before any attempt.
			}
			return ref(store.write(context, { kind: "datasets", data, requestId: request.requestId }));
		}
		if (request.action === "createExperiment") {
			requireValue(
				request.data && Object.keys(request.data).every((k) => ["datasetRef", "policy"].includes(k)),
				"INVALID_INPUT",
				"Experiment checkpoints and deadlines are server-owned",
			);
			const data = { ...request.data, state: "queued", cursor: 0, entries: [] };
			requireValue(
				Check(schemas.experiments, data),
				"INVALID_INPUT",
				"Invalid experiment policy; hard monetary/output caps are unsupported",
			);
			const dataset = store.get(context, data.datasetRef);
			requireValue(dataset.kind === "datasets", "INVALID_INPUT", "A frozen dataset is required");
			const runtime = await call("offlineDescribe");
			requireValue(
				runtime.runtimeDigest === dataset.data.runtimeDigest && dataset.data.rulesDigest === this.rulesDigest,
				"VERSION_CONFLICT",
				"Installed runtime/verifier changed; freeze a new dataset",
			);
			return ref(store.write(context, { kind: "experiments", data, requestId: request.requestId }));
		}
		const row = this.latest(context, request.ref),
			job = this.jobs.get(row.id);
		if (request.action === "cancelExperiment") {
			if (["completed", "stopped"].includes(row.data.state)) return this.view(context, ref(row));
			if (job) job.stop = "user-cancelled";
			await this.save(context, binding, row, { reason: "user-cancelled" });
			const entry = row.data.entries.at(-1);
			if (entry?.attemptRef && entry.phase !== "finished") await call("offlineCancel", { ref: entry.attemptRef });
			if (!job) return this.launch(context, binding, this.latest(context, ref(row)), true);
			return this.view(context, ref(row));
		}
		requireValue(request.action === "runExperiment", "INVALID_INPUT", "Unsupported experiment operation");
		if (job) return this.view(context, ref(row));
		requireValue(
			!["completed", "stopped"].includes(row.data.state),
			"VERSION_CONFLICT",
			"Create a new experiment to rerun a finished batch",
		);
		return this.launch(context, binding, row, row.data.reason === "user-cancelled");
	}
	profile(configs) {
		const s = this.service,
			profile = internalProfile(configs);
		requireValue(
			Object.keys(configs).every((k) => profile.rules.some((r) => r.id === k)),
			"INVALID_INPUT",
			"Unknown rule configuration",
		);
		for (const r of profile.rules) s.registry.validateConfig(s.registry.evaluator(r.id, r.version), r.config);
		profile.id = `internal-${digest(profile.rules).slice(0, 55)}`;
		try {
			s.registry.profile(profile.id, profile.version);
		} catch {
			s.registry.registerProfile(profile);
		}
		return profile;
	}
	async authorize(context, binding) {
		return this.service.execution.dispatch(context, binding, {
			action: "offlineAuthorize",
			requestId: "experiment-guard",
		});
	}
	async save(context, binding, row, patch) {
		await this.authorize(context, binding);
		const latest = this.latest(context, ref(row));

		return this.service.store.write(context, {
			kind: "experiments",
			previousRef: ref(latest),
			requestId: `experiment-checkpoint-${row.id}-${latest.revision + 1}`,
			data: { ...latest.data, ...patch },
		});
	}
	launch(context, binding, row, stopping) {
		const identity = this.service.store.identity(context),
			owner = digest(identity.domain);
		requireValue(
			![...this.jobs.values()].some((j) => j.owner === owner),
			"IN_PROGRESS",
			"Another serial experiment is active in this workspace",
		);
		const job = { owner, clientId: binding.clientId, stop: stopping ? "user-cancelled" : null };
		this.jobs.set(row.id, job);
		job.done = this.run(context, binding, row, job)
			.catch(async (error) => {
				if (this.service.closed) return;
				this.service.execution.stopClient(binding.clientId);
				try {
					const latest = this.latest(context, ref(row));
					await this.save(context, binding, latest, { state: "blocked", reason: error.code ?? "EXECUTION_UNKNOWN" });
				} catch {
					/* Revoked authority/store failure retains the last checkpoint. No next attempt. */
				}
			})
			.finally(() => {
				this.jobs.delete(row.id);
			});
		return this.view(context, ref(row));
	}
	view(context, reference) {
		const row = this.latest(context, reference),
			d = row.data,
			dataset = this.service.store.get(context, d.datasetRef);
		const counts = { pass: 0, fail: 0, inconclusive: 0 };
		for (const e of d.entries) if (e.outcome) counts[e.outcome]++;
		return {
			...ref(row),
			data: d,
			active: this.jobs.has(row.id),
			statistics: {
				planned: dataset.data.cases.length * d.policy.repetitions,
				completed: d.cursor,
				preparedAttempts: d.entries.filter((e) => e.attemptRef).length,
				executedAttempts: d.entries.filter((e) => e.launched === true).length,
				allAttemptOutcomes: counts,
				modelCalls: 0,
				costs: {
					targetUsd: 0,
					verifierUsd: 0,
					scorerUsd: 0,
					basis: "fixed offline executable and deterministic checks; no model or paid transport",
				},
			},
		};
	}
	async run(context, binding, initial, job) {
		const s = this.service,
			store = s.store,
			dataset = store.get(context, initial.data.datasetRef),
			policy = initial.data.policy;
		const call = (action, id, extra = {}) =>
			s.execution.dispatch(context, binding, { action, requestId: id, ...extra });
		const runtime = await call("offlineDescribe", "experiment-probe");
		requireValue(
			runtime.runtimeDigest === dataset.data.runtimeDigest && dataset.data.rulesDigest === this.rulesDigest,
			"VERSION_CONFLICT",
			"Dataset runtime changed",
		);
		let row = this.latest(context, ref(initial));
		const update = async (patch) => {
			row = await this.save(context, binding, this.latest(context, ref(row)), patch);
		};
		const entryUpdate = async (patch) => {
			const entries = [...row.data.entries];
			entries[entries.length - 1] = { ...entries.at(-1), ...patch };
			await update({ entries });
		};
		if (!row.data.startedAt) {
			const startedAt = now();
			await update({ startedAt, deadlineAt: new Date(Date.now() + policy.totalMs).toISOString(), state: "running" });
		} else await update({ state: "running" });
		requireValue(
			Date.now() >= Date.parse(row.data.startedAt),
			"EXECUTION_UNKNOWN",
			"Clock moved behind experiment start",
		);
		const steadyDeadline = performance.now() + Math.max(0, Date.parse(row.data.deadlineAt) - Date.now());
		const remaining = () => Math.min(Date.parse(row.data.deadlineAt) - Date.now(), steadyDeadline - performance.now());
		const slots = dataset.data.cases.length * policy.repetitions;
		while (!s.closed && row.data.cursor < slots) {
			await this.authorize(context, binding);
			if (remaining() <= 0) job.stop ??= "total-budget-exhausted";
			let entry = row.data.entries.at(-1);
			if (entry?.phase === "finished" && entry.slot === row.data.cursor) {
				if (job.stop) {
					await update({ state: "stopped", reason: job.stop });
					return;
				}
				if (entry.outcome === "inconclusive") {
					await update({ state: "blocked", reason: "necessary-evidence-unconfirmed" });
					return;
				}
				if (!(entry.outcome === "fail" && entry.retry < policy.retries)) {
					await update({ cursor: row.data.cursor + 1 });
					if (entry.outcome === "fail" && policy.failurePolicy === "stop") {
						await update({ state: "stopped", reason: "failure-policy" });
						return;
					}
					continue;
				}
			}

			if (!entry || entry.phase === "finished") {
				if (job.stop || row.data.entries.length >= policy.maxAttempts) {
					await update({ state: "stopped", reason: job.stop ?? "attempt-budget-exhausted" });
					return;
				}
				const slot = row.data.cursor,
					c = dataset.data.cases[slot % dataset.data.cases.length];
				const retry = entry?.slot === slot ? entry.retry + 1 : 0;
				await update({
					entries: [
						...row.data.entries,
						{
							slot,
							caseId: c.id,
							retry,
							phase: "preparing",
							timeoutMs: Math.min(policy.timeoutMs, Math.max(1000, Math.floor(remaining()))),
							startedAt: now(),
						},
					],
				});
				entry = row.data.entries.at(-1);
			}
			const c = dataset.data.cases.find((c) => c.id === entry.caseId),
				id = `experiment-${row.id}-${row.data.entries.length}`;
			if (entry.phase === "preparing" && !entry.attemptRef) {
				if (job.stop || remaining() < 1000) {
					await update({ state: "stopped", reason: job.stop ?? "total-budget-exhausted" });
					return;
				}

				const previous = row.data.entries
					.slice(0, -1)
					.filter((e) => e.caseId === c.id && e.attemptRef)
					.at(-1)?.attemptRef;
				const attempt = await call("offlinePrepare", id, {
					ref: c.contractRef,
					data: {
						argv: c.argv,
						stdin: c.stdin,
						timeoutMs: entry.timeoutMs,
						graceMs: 500,
						...(previous ? { previousAttemptRef: previous } : {}),
					},
				});
				await entryUpdate({ attemptRef: attempt, phase: "starting" });
				// Only this uninterrupted path may issue start; a recovered starting checkpoint only queries.
				if (remaining() <= 0) job.stop ??= "total-budget-exhausted";
				if (!job.stop && !s.closed) await call("offlineStart", `${id}-start`, { ref: attempt });
			}
			entry = row.data.entries.at(-1);
			let state;
			do {
				if (s.closed) return;
				if (remaining() <= 0) job.stop ??= "total-budget-exhausted";
				state = await call(job.stop ? "offlineCancel" : "offlineStatus", `${id}-status`, { ref: entry.attemptRef });
				if (state.state === "unknown" || state.environmentState === "unknown") {
					await update({ state: "blocked", reason: "EXECUTION_UNKNOWN" });
					return;
				}
				if (!state.stopConfirmed && state.environmentState === "prepared") {
					await update({ state: "blocked", reason: "prepared-start-not-replayed; cancel explicitly" });
					return;
				}
				if (!state.stopConfirmed) await sleep();
			} while (!state.stopConfirmed);
			await entryUpdate({
				phase: "collecting",
				executionState: state.state,
				launched: state.noEnvironmentStarted !== true && !["blocked", "start-failed"].includes(state.state),
			});
			const cleaned = await call("offlineCleanup", `${id}-cleanup`, { ref: entry.attemptRef });
			requireValue(
				cleaned.released === true && cleaned.snapshotRef,
				"EXECUTION_UNKNOWN",
				"Cleanup was not confirmed; next attempt blocked",
			);
			await entryUpdate({ snapshotRef: cleaned.snapshotRef });
			const profile = this.profile(c.configs);
			await this.authorize(context, binding);
			const report = await s.engine.evaluate(context, {
				snapshotRef: cleaned.snapshotRef,
				profileId: profile.id,
				profileVersion: profile.version,
				requestId: `${id}-score`,
			});
			const outcome = report.data.summary.deliveryVerdict;
			await entryUpdate({ evaluationRef: ref(report), outcome, phase: "finished", endedAt: now() });
		}
		if (!s.closed) await update({ state: "completed", reason: "serial-plan-finished" });
	}
	stopClient(clientId) {
		for (const job of this.jobs.values()) if (job.clientId === clientId) job.stop = "client-disabled";
	}
	close() {
		for (const job of this.jobs.values()) job.stop = "plugin-stopped";
	}
}
