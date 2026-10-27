import { afterEach, expect, it, vi } from "vitest";
import { engineFixture, evaluator, passFinding, ref } from "../fixtures/agent-evaluation/engine.mjs";
import { createInternalRegistry } from "../../plugins/agent-evaluation/profiles/internal.mjs";
import { Experiments } from "../../plugins/agent-evaluation/experiments.mjs";
import { digest } from "../../plugins/agent-evaluation/schema.mjs";
const cleanup: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanup.splice(0).reverse()) fn();
	vi.useRealTimers();
});
async function fixture(outcomes = ["pass"], options: any = {}) {
	const f = engineFixture({ rules: [evaluator("Fixture", (_c, view) => [passFinding(view)])] });
	cleanup.push(f.cleanup);
	const template = await f.engine.evaluate(f.context, f.args);
	let sequence = 0,
		active = false,
		stopped = false,
		authorized = true,
		unknown = false,
		cleanupFail = false;
	const starts: string[] = [],
		requests: any[] = [],
		prepared = new Map<string, any>();
	const service: any = { store: f.store, registry: createInternalRegistry(), closed: false };
	const execution: any = {
		stopClient: () => {
			stopped = true;
			active = false;
		},
		dispatch: async (_context: any, _binding: any, q: any) => {
			requests.push(q);
			if (!authorized) throw Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" });
			if (q.action === "offlineAuthorize") return { authorized: true };
			if (q.action === "offlineDescribe")
				return { runtimeDigest: "a".repeat(64), modes: ["echo", "failure", "waiting"], policy: { stdinBytes: 65536 } };
			if (q.action === "offlinePrepare") {
				await options.beforePrepare?.();
				if (prepared.has(q.requestId)) return prepared.get(q.requestId);
				const a = f.store.write(f.context, {
					kind: "attempts",
					requestId: q.requestId,
					data: {
						contractRef: ref(f.contract),
						targetRef: ref(f.store.get(f.context, f.attempt.data.targetRef)),
						configDigest: digest(q.data),
						state: "preparing",
						...(q.data.previousAttemptRef ? { previousAttemptRef: q.data.previousAttemptRef } : {}),
					},
				});
				prepared.set(q.requestId, ref(a));
				return ref(a);
			}
			if (q.action === "offlineStart") {
				expect(active).toBe(false);
				active = true;
				starts.push(q.ref.id);
				return {};
			}
			if (q.action === "offlineCancel") {
				stopped = true;
				active = false;
			}
			if (q.action === "offlineStatus" || q.action === "offlineCancel")
				return {
					state: unknown ? "unknown" : stopped ? "cancelled" : options.wait ? "running" : "ended",
					environmentState: unknown ? "unknown" : "running",
					stopConfirmed: !unknown && (!options.wait || stopped),
					noEnvironmentStarted: false,
				};
			if (q.action === "offlineCleanup") {
				if (cleanupFail) throw Object.assign(new Error("unconfirmed"), { code: "EXECUTION_UNKNOWN" });
				active = false;
				const snapshot = f.store.write(f.context, {
					kind: "snapshots",
					requestId: q.requestId,
					data: {
						contractRef: ref(f.contract),
						attemptRefs: [q.ref],
						sourceWatermarks: {},
						evidenceRefs: [],
						coverage: "partial",
						gaps: [],
						sealedAt: "2026-10-27T00:00:00Z",
					},
				});
				return { released: true, snapshotRef: ref(snapshot) };
			}
			throw new Error(q.action);
		},
	};
	service.execution = execution;
	service.engine = {
		evaluate: async (_context: any, args: any) =>
			f.store.write(f.context, {
				kind: "evaluations",
				requestId: args.requestId,
				data: {
					...template.data,
					findings: [],
					snapshotRef: args.snapshotRef,
					summary: { ...template.data.summary, deliveryVerdict: outcomes[Math.min(sequence++, outcomes.length - 1)] },
				},
			}),
	};
	const api = new Experiments(service);
	const binding = { clientId: "fixture", conversationId: "conv", sessionId: "session" };
	let req = 0;
	const call = (action: string, extra: any = {}) =>
		api.dispatch(f.context, binding, { action, requestId: `request-${++req}`, ...extra });
	const dataset = await call("createDataset", {
		data: {
			name: "Human-confirmed fixture",
			confirmed: true,
			cases: [{ id: "one", title: "One", contractRef: ref(f.contract), argv: ["echo"], stdin: "seed", configs: {} }],
		},
	});
	const policy = {
		repetitions: 2,
		retries: 0,
		maxAttempts: 10,
		timeoutMs: 1000,
		totalMs: 30000,
		maxModelCalls: 0,
		necessaryEvidence: "stop-on-unknown",
		failurePolicy: "continue",
	};
	const create = (patch: any = {}) =>
		call("createExperiment", { data: { datasetRef: dataset, policy: { ...policy, ...patch } } });
	const wait = async (r: any) => {
		await vi.waitFor(() => expect(api.jobs.size).toBe(0));
		return api.view(f.context, r);
	};
	return {
		...f,
		api,
		service,
		execution,
		call,
		create,
		wait,
		dataset,
		starts,
		requests,
		prepared,
		deny: () => (authorized = false),
		setUnknown: (v: boolean) => (unknown = v),
		setCleanupFail: () => (cleanupFail = true),
	};
}
it("AC34 serial repetitions allocate distinct attempts with predecessor links and immutable frozen datasets", async () => {
	const f = await fixture();
	const experiment = await f.create();
	await f.call("runExperiment", { ref: experiment });
	await f.call("runExperiment", { ref: experiment });
	const result = await f.wait(experiment);
	expect(result.data.state, JSON.stringify(result.data)).toBe("completed");
	expect(f.starts).toHaveLength(2);
	expect(new Set(f.starts).size).toBe(2);
	expect(result.statistics).toMatchObject({ planned: 2, completed: 2, executedAttempts: 2, modelCalls: 0 });
	const entries = result.data.entries;
	expect(f.store.get(f.context, entries[1].attemptRef).data.previousAttemptRef.id).toBe(entries[0].attemptRef.id);
	expect(f.store.get(f.context, f.dataset).data.initialState).toBe("fresh-pinned-ram");
	expect(() =>
		f.store.write(f.context, {
			kind: "datasets",
			previousRef: f.dataset,
			requestId: "mutate",
			data: f.store.get(f.context, f.dataset).data,
		}),
	).toThrow(/immutable/);
});
it("AC34 retries retain failed reports; max attempts and stop policy do not silently skip failures", async () => {
	const f = await fixture(["fail", "pass"]);
	const e = await f.create({ repetitions: 1, retries: 1 });
	await f.call("runExperiment", { ref: e });
	const r = await f.wait(e);
	expect(r.data.entries.map((x: any) => x.outcome)).toEqual(["fail", "pass"]);
	expect(r.statistics.allAttemptOutcomes).toEqual({ pass: 1, fail: 1, inconclusive: 0 });
	const budget = await f.create({ retries: 1, maxAttempts: 1 });
	await f.call("runExperiment", { ref: budget });
	expect((await f.wait(budget)).data.reason).toBe("attempt-budget-exhausted");
	const stop = await fixture(["fail"]);
	const e2 = await stop.create({ failurePolicy: "stop" });
	await stop.call("runExperiment", { ref: e2 });
	expect((await stop.wait(e2)).data.reason).toBe("failure-policy");
	expect(stop.starts).toHaveLength(1);
});
it("AC34 restart recovery only queries saved starting intent, never calls start again", async () => {
	const f = await fixture();
	const e = await f.create();
	const prepared = await f.execution.dispatch(
		{},
		{},
		{ action: "offlinePrepare", requestId: "persisted", data: {}, ref: ref(f.contract) },
	);
	f.store.write(f.context, {
		kind: "experiments",
		previousRef: e,
		requestId: "starting-intent",
		data: {
			...f.store.get(f.context, e).data,
			state: "running",
			startedAt: new Date().toISOString(),
			deadlineAt: new Date(Date.now() + 30000).toISOString(),
			entries: [
				{
					slot: 0,
					caseId: "one",
					retry: 0,
					timeoutMs: 1000,
					phase: "starting",
					attemptRef: prepared,
					startedAt: new Date().toISOString(),
				},
			],
		},
	});
	const next = new Experiments(f.service);
	expect(next.jobs.size).toBe(0);
	await next.dispatch(f.context, { clientId: "fixture" }, { action: "runExperiment", requestId: "resume", ref: e });
	await vi.waitFor(() => expect(next.jobs.size).toBe(0));
	expect(f.starts).toHaveLength(1); // only the next planned repetition; original was reconciled, not started.
	expect(f.requests.filter((q) => q.action === "offlineStart").every((q) => q.ref.id !== prepared.id)).toBe(true);
});
it("AC35 unknown stop, cleanup failure and missing required evidence block the next attempt", async () => {
	const f = await fixture();
	f.setUnknown(true);
	const e = await f.create();
	await f.call("runExperiment", { ref: e });
	expect((await f.wait(e)).data.state).toBe("blocked");
	expect(f.starts).toHaveLength(1);
	f.setUnknown(false);
	f.setCleanupFail();
	await f.call("runExperiment", { ref: e });
	expect((await f.wait(e)).data.state).toBe("blocked");
	expect(f.starts).toHaveLength(1);
	const missing = await fixture(["inconclusive"]);
	const m = await missing.create({ retries: 2 });
	await missing.call("runExperiment", { ref: m });
	await missing.wait(m);
	await missing.call("runExperiment", { ref: m });
	expect((await missing.wait(m)).data.reason).toBe("necessary-evidence-unconfirmed");
	expect(missing.starts).toHaveLength(1);
});
it("AC35 manual cancellation and elapsed total budget stop without launching another case", async () => {
	const f = await fixture(["pass"], { wait: true });
	const e = await f.create();
	await f.call("runExperiment", { ref: e });
	await vi.waitFor(() => expect(f.starts).toHaveLength(1));
	await f.call("cancelExperiment", { ref: e });
	expect((await f.wait(e)).data.reason).toBe("user-cancelled");
	expect(f.starts).toHaveLength(1);
	const expired = await f.create();
	f.store.write(f.context, {
		kind: "experiments",
		previousRef: expired,
		requestId: "past-deadline",
		data: {
			...f.store.get(f.context, expired).data,
			startedAt: new Date(Date.now() - 10000).toISOString(),
			deadlineAt: new Date(Date.now() - 1).toISOString(),
		},
	});
	await f.call("runExperiment", { ref: expired });
	expect((await f.wait(expired)).data.reason).toBe("total-budget-exhausted");
	expect(f.starts).toHaveLength(1);
});
it("rejects hard money/output budgets, unconfirmed samples, unknown fields and permission revocation", async () => {
	const f = await fixture();
	await expect(f.create({ hardCostLimitUsd: 1 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
	await expect(f.create({ maxOutputBytes: 10 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
	await expect(
		f.call("createDataset", { data: { ...f.store.get(f.context, f.dataset).data, confirmed: false } }),
	).rejects.toMatchObject({ code: "INVALID_INPUT" });
	f.deny();
	await expect(f.create()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
	expect(f.starts).toHaveLength(0);
});

it("does not start when preparation consumed the total budget", async () => {
	const f = await fixture(["pass"], { beforePrepare: () => new Promise((resolve) => setTimeout(resolve, 1100)) });
	const e = await f.create({ totalMs: 1000 });
	await f.call("runExperiment", { ref: e });
	await vi.waitFor(() => expect(f.api.jobs.size).toBe(0), { timeout: 4000 });
	expect(f.api.view(f.context, e).data.reason).toBe("total-budget-exhausted");
	expect(f.starts).toHaveLength(0);
});
it("refuses changed rules and concurrent workspace experiments", async () => {
	const f = await fixture(["pass"], { wait: true });
	const first = await f.create();
	const second = await f.create();
	await f.call("runExperiment", { ref: first });
	await vi.waitFor(() => expect(f.starts).toHaveLength(1));
	await expect(f.call("runExperiment", { ref: second })).rejects.toMatchObject({ code: "IN_PROGRESS" });
	await f.call("cancelExperiment", { ref: first });
	await f.wait(first);
	f.api.rulesDigest = "b".repeat(64);
	await expect(f.create()).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
	expect(f.starts).toHaveLength(1);
});

it("freezes multiple cases and links only matching-case predecessors", async () => {
	const f = await fixture();
	const base = f.store.get(f.context, f.dataset).data;
	const d = await f.call("createDataset", {
		data: {
			...base,
			name: "Two cases",
			previousDatasetRef: f.dataset,
			cases: [base.cases[0], { ...base.cases[0], id: "two", title: "Two" }],
		},
	});
	const e = await f.call("createExperiment", {
		data: { datasetRef: d, policy: { ...f.store.get(f.context, await f.create()).data.policy } },
	});
	await f.call("runExperiment", { ref: e });
	const r = await f.wait(e);
	expect(r.data.state).toBe("completed");
	expect(r.data.entries.map((x: any) => x.caseId)).toEqual(["one", "two", "one", "two"]);
	for (let i = 2; i < 4; i++)
		expect(f.store.get(f.context, r.data.entries[i].attemptRef).data.previousAttemptRef.id).toBe(
			r.data.entries[i - 2].attemptRef.id,
		);
	await expect(
		f.call("createExperiment", { data: { datasetRef: d, policy: r.data.policy, deadlineAt: "2099-01-01T00:00:00Z" } }),
	).rejects.toMatchObject({ code: "INVALID_INPUT" });
});
