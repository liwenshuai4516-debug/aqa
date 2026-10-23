import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type as T } from "typebox";
import { EvaluationStore } from "../../../plugins/agent-evaluation/store.mjs";
import { EvaluationRegistry } from "../../../plugins/agent-evaluation/registry.mjs";
import { EvaluationEngine } from "../../../plugins/agent-evaluation/evaluate.mjs";
import { digest } from "../../../plugins/agent-evaluation/schema.mjs";
export const ref = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
/** @param {string} id
 * @param {(contract: any, view: any, config: any, signal: AbortSignal) => any} evaluate
 * @param {any} manifest */
export function evaluator(id, evaluate, manifest = {}) {
	return {
		manifest: {
			id,
			version: "1",
			method: "deterministic",
			supportedTaskTypes: ["agent-task"],
			requiredEvidence: [],
			configSchema: T.Object({}, { additionalProperties: false }),
			outputSchemaVersion: 1,
			timeoutMs: 1000,
			budget: { maxFindings: 100 },
			dependencies: [],
			...manifest,
		},
		evaluate,
	};
}
/** @param {{ rules: any[], conditions?: any[], evidence?: any[], budget?: any, configs?: any }} options */
export function engineFixture({
	rules,
	conditions = [],
	evidence = [{ kind: "artifact", value: { exists: true } }],
	budget = {},
	configs = {},
}) {
	const directory = mkdtempSync(join(tmpdir(), "evaluation-engine-")),
		context = {};
	const identity = {
		domain: { principalId: "fixture", workspaceId: "workspace" },
		sessionIds: ["session"],
		allowWrite: true,
	};
	const store = new EvaluationStore({ dataDir: directory, authorize: (c) => (c === context ? identity : undefined) });
	let sequence = 0;
	const write = (kind, data) => store.write(context, { kind, data, requestId: `fixture-${++sequence}` });
	const contract = write("contracts", {
		scope: {
			source: "pi",
			sessionId: "session",
			startMessageId: "first",
			endMessageId: "last",
			boundaryPrecision: "exact",
			childPolicy: "exclude",
			childSessionIds: [],
		},
		objective: "Fixture contract",
		conditions: conditions.map((c) => ({
			statement: c.id,
			sourceRef: "fixture:first",
			sourceType: "user",
			required: true,
			applicableWhen: "always",
			...c,
		})),
		constraints: [],
		environmentRefs: [],
		provenance: "synthetic",
		evaluationSubject: "agent-task",
	});
	const target = write("targets", {
		kind: "pi",
		clientVersion: "fixture",
		executableIdentity: "no-executable",
		adapterVersion: "1",
		configRef: "fixture",
		capabilities: { history: "supported" },
		isolation: "fixture",
	});
	const attempt = write("attempts", {
		contractRef: ref(contract),
		targetRef: ref(target),
		sourceSessionId: "session",
		configDigest: digest({}),
		state: "unknown",
	});
	const items = evidence.map((e, i) =>
		write("evidence", {
			attemptRef: ref(attempt),
			sourceId: "fixture",
			sourceEventId: String(i),
			sourceRevision: digest(e.value),
			sourceLocator: `fixture:${i}`,
			producer: "fixture-v1",
			availability: "available",
			origin: e.origin ?? "harness-observed",
			kind: e.kind,
			observedAt: new Date().toISOString(),
			content: JSON.stringify(e.value),
			redaction: [],
			truncated: false,
			...e.data,
		}),
	);
	const snapshot = write("snapshots", {
		contractRef: ref(contract),
		attemptRefs: [ref(attempt)],
		sourceWatermarks: {},
		evidenceRefs: items.map(ref),
		coverage: "complete",
		gaps: [],
		sealedAt: new Date().toISOString(),
	});
	const registry = new EvaluationRegistry();
	registry.registerEvaluators(rules);
	registry.registerProfile({
		id: "fixture",
		version: "1",
		taskTypes: ["agent-task"],
		rules: rules.map((r) => ({ id: r.manifest.id, version: r.manifest.version, config: configs[r.manifest.id] ?? {} })),
		required: rules.map((r) => ({ id: r.manifest.id, version: r.manifest.version })),
		aggregation: "contract-v1",
	});
	const engine = new EvaluationEngine(store, registry, budget);
	return {
		directory,
		context,
		identity,
		store,
		snapshot,
		contract,
		attempt,
		items,
		registry,
		engine,
		args: { snapshotRef: ref(snapshot), profileId: "fixture", profileVersion: "1", requestId: "score" },
		cleanup: () => {
			engine.close();
			store.close();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}
export const passFinding = (view, conditionId) => ({
	...(conditionId ? { conditionId } : {}),
	verdict: "pass",
	evidenceState: "sufficient",
	evidenceRefs: [view.evidence[0].ref],
	missingEvidence: [],
	reason: "Fixture evidence matches",
});
