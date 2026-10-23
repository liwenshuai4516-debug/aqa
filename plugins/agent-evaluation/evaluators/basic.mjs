/** Pure deterministic rules. All source reads happen before snapshot sealing. */
import { Type as T } from "typebox";
import { Check } from "typebox/value";
import { digest } from "../schema.mjs";
import { validateConfigSchema } from "../registry.mjs";
import {
	text,
	object,
	checks,
	define,
	finding,
	noChecks,
	trustworthy,
	callsIn,
	callState,
	jsonPointer,
	key,
} from "./common.mjs";

export const F01 = define(
	"F01",
	checks({
		path: text,
		format: T.Optional(T.Union([T.Literal("json"), T.Literal("text")])),
		sha256: T.Optional(T.String({ pattern: "^[a-f0-9]{64}$" })),
		jsonSchema: T.Optional(T.Record(T.String(), T.Unknown())),
	}),
	(_contract, view, config) => {
		if (!config.checks.length) return noChecks("F01");
		return config.checks.map((check) => {
			const items = view.evidence.filter((e) => e.data.kind === "artifact-snapshot" && e.value?.path === check.path);
			const usable = items.filter((e) => trustworthy(e, view));
			if (
				!usable.length ||
				new Set(
					usable.map((e) =>
						digest([e.value.exists, e.value.sha256, e.value.text, e.value.truncated, e.value.redaction]),
					),
				).size !== 1
			)
				return finding(check.conditionId, "inconclusive", items, "Artifact snapshot is unavailable or conflicting", [
					"consistent-authorized-artifact-snapshot",
				]);
			const artifact = usable[0].value;
			if (artifact.exists === false)
				return finding(
					check.conditionId,
					"fail",
					items,
					"The explicitly required artifact did not exist at observation time",
				);
			if (
				artifact.exists !== true ||
				((check.format || check.jsonSchema || check.sha256) && (artifact.truncated || artifact.redaction?.length))
			)
				return finding(check.conditionId, "inconclusive", items, "Artifact bytes are incomplete or transformed", [
					"complete-artifact-bytes",
				]);
			if (check.sha256 && typeof artifact.sha256 !== "string")
				return finding(check.conditionId, "inconclusive", items, "Artifact digest was not observed", [
					"artifact-digest",
				]);
			if (check.sha256 && artifact.sha256 !== check.sha256)
				return finding(check.conditionId, "fail", items, "Artifact digest differs from the frozen requirement");
			if (check.format || check.jsonSchema) {
				if (typeof artifact.text !== "string")
					return finding(check.conditionId, "inconclusive", items, "No text snapshot is available", [
						"text-artifact-snapshot",
					]);
				if (check.format === "json" || check.jsonSchema) {
					let parsed;
					try {
						parsed = JSON.parse(artifact.text);
					} catch {
						return finding(check.conditionId, "fail", items, "Artifact is not valid JSON");
					}
					if (check.jsonSchema) {
						validateConfigSchema(check.jsonSchema);
						if (!Check(check.jsonSchema, parsed))
							return finding(check.conditionId, "fail", items, "Artifact JSON violates the frozen schema");
					}
				}
			}
			return finding(
				check.conditionId,
				"pass",
				items,
				"Artifact satisfies the selected existence/format/digest checks; semantic correctness is not implied",
				[],
				{ observedAt: items[0].data.observedAt },
			);
		});
	},
);
function matchesRun(reference, run) {
	if (run.engine === "api") return reference === run.runId;
	return (
		reference?.path === `qa/ui/runs/${run.runId}/manifest.json` &&
		run.evidence?.some((e) => e.path === reference.path && e.sha256 === reference.sha256)
	);
}
export function currentNativeRun(view, runId) {
	const native = view.evidence.filter((e) => e.data.producer === "native-reader-v1" && e.value?.runId === runId);
	if (native.length !== 1 || !trustworthy(native[0], view)) return { items: native, gap: "unique-verified-native-run" };
	const item = native[0],
		run = item.value;
	const binding = callsIn(view).calls.find(
		(call) =>
			callState(call) === "succeeded" &&
			call.result &&
			call.start.data.attemptRef.id === item.data.attemptRef.id &&
			call.result.value.message.nativeExecution?.engine === run.engine &&
			matchesRun(call.result.value.message.nativeExecution.reference, run),
	);
	if (!binding) return { items: native, gap: "current-attempt-native-execution-link" };
	const items = [item, binding.start, binding.result];
	const start = Date.parse(binding.start.data.occurredAt),
		end = Date.parse(binding.result.data.occurredAt),
		at = Date.parse(run.at);
	if (![start, end, at].every(Number.isFinite) || at < start || at > end)
		return { items, gap: "native-run-time-outside-selected-call; historical run or clock uncertainty" };
	if (
		!run.complete ||
		!Array.isArray(run.rows) ||
		!run.rows.length ||
		run.rows.some((r) => !r.evidenceComplete || !["passed", "failed"].includes(r.status))
	)
		return { items, gap: "complete-native-case-results" };
	return { items, run };
}
export const F02 = define(
	"F02",
	checks({ runId: text, caseIds: T.Optional(T.Array(text, { maxItems: 1000, uniqueItems: true })) }),
	(_contract, view, config) => {
		if (!config.checks.length) return noChecks("F02");
		return config.checks.map((check) => {
			const current = currentNativeRun(view, check.runId);
			if (current.gap)
				return finding(
					check.conditionId,
					"inconclusive",
					current.items,
					"Native evidence cannot prove this attempt passed",
					[current.gap],
				);
			const rows = check.caseIds
				? current.run.rows.filter((row) => check.caseIds.includes(row.caseId))
				: current.run.rows;
			if (!rows.length || check.caseIds?.some((id) => !rows.some((row) => row.caseId === id)))
				return finding(check.conditionId, "inconclusive", current.items, "Selected native cases are missing", [
					"all-selected-native-cases",
				]);
			const failed = rows.filter((row) => row.status === "failed").length;
			return finding(
				check.conditionId,
				failed ? "fail" : "pass",
				current.items,
				failed ? "Native execution contains failed assertions" : "All selected current native case instances passed",
				[],
				{ instances: rows.length, passed: rows.length - failed, failed, runId: check.runId },
			);
		});
	},
);
export const F04 = define(
	"F04",
	checks({ prerequisiteToolCallId: text, dependentToolCallId: text }),
	(_contract, view, config) => {
		if (!config.checks.length) return noChecks("F04");
		const observedCalls = callsIn(view),
			calls = observedCalls.calls;
		return config.checks.map((check) => {
			const prerequisites = calls.filter((c) => c.toolCallId === check.prerequisiteToolCallId),
				dependents = calls.filter((c) => c.toolCallId === check.dependentToolCallId);
			if (prerequisites.length !== 1 || dependents.length > 1)
				return finding(check.conditionId, "inconclusive", [], "Dependency identity is missing or ambiguous", [
					"unique-dependency-calls",
				]);
			const prerequisite = prerequisites[0],
				dependent = dependents[0],
				state = callState(prerequisite);
			const items = [prerequisite.start, prerequisite.result, dependent?.start].filter(Boolean);
			if (state === "unknown")
				return finding(check.conditionId, "inconclusive", items, "Prerequisite outcome is unknown", [
					"prerequisite-result",
				]);
			if (["failed", "denied", "cancelled"].includes(state)) {
				if (dependent)
					return finding(
						check.conditionId,
						"fail",
						items,
						"A necessary dependent step ran without successful prerequisite completion",
					);
				if (view.snapshot.coverage !== "complete" || observedCalls.ignored.length)
					return finding(
						check.conditionId,
						"inconclusive",
						items,
						"Partial coverage cannot prove the dependent step was stopped",
						["complete-dependency-coverage"],
					);
				return finding(
					check.conditionId,
					"pass",
					items,
					"The failed prerequisite did not lead to the specified dependent step; independent evidence gathering is allowed",
				);
			}
			if (dependent) {
				// Source parent links, not wall-clock ordering, establish a single-session causal chain.
				const byEntry = new Map(
					view.evidence
						.filter((e) => e.data.sourceId === prerequisite.result.data.sourceId)
						.map((e) => [e.data.sourceEventId, e]),
				);
				let cursor = dependent.start.value?.parentEventId,
					seen = new Set();
				while (cursor && !seen.has(cursor) && cursor !== prerequisite.result.data.sourceEventId) {
					seen.add(cursor);
					cursor = byEntry.get(cursor)?.value?.parentEventId;
				}
				if (cursor !== prerequisite.result.data.sourceEventId)
					return finding(
						check.conditionId,
						"inconclusive",
						items,
						"The source chain does not establish prerequisite completion before the dependent step",
						["causal-dependency-link"],
					);
			}
			return finding(
				check.conditionId,
				"pass",
				items,
				"The observed prerequisite succeeded; no specified dependency violation is established",
			);
		});
	},
);
export const F05 = define(
	"F05",
	checks({
		claimEvidenceId: text,
		claimPath: text,
		basisEvidenceId: text,
		basisPath: text,
		expectedValue: T.Unknown(),
	}),
	(_contract, view, config) => {
		if (!config.checks.length) return noChecks("F05");
		return config.checks.map((check) => {
			const claim = view.evidence.find((e) => e.ref.id === check.claimEvidenceId),
				basis = view.evidence.find((e) => e.ref.id === check.basisEvidenceId);
			const items = [claim, basis].filter(Boolean);
			if (
				!trustworthy(claim, view) ||
				!trustworthy(basis, view) ||
				claim === basis ||
				claim.data.attemptRef.id !== basis.data.attemptRef.id
			)
				return finding(
					check.conditionId,
					"inconclusive",
					items,
					"An observed structured claim and separate verified basis are required",
					["independent-claim-and-basis"],
				);
			let structured = claim.value;
			if (claim.data.producer === "pi-evidence-v1") {
				try {
					structured = JSON.parse(
						claim.value.message.content
							.filter((p) => p.type === "text")
							.map((p) => p.text)
							.join("\n"),
					);
				} catch {
					structured = null;
				}
			}
			const stated = jsonPointer(structured, check.claimPath),
				observed = jsonPointer(basis.value, check.basisPath);
			if (!stated.found || typeof stated.value !== "boolean" || !observed.found)
				return finding(
					check.conditionId,
					"inconclusive",
					items,
					"Free text or missing structured fields require human review",
					["structured-boolean-claim-and-result"],
				);
			if (basis.data.producer === "native-reader-v1") {
				const current = currentNativeRun(view, basis.value?.runId);
				if (current.gap)
					return finding(
						check.conditionId,
						"inconclusive",
						[...items, ...current.items],
						"Native basis is not current complete execution evidence",
						[current.gap],
					);
				items.push(...current.items);
			} else if (basis.data.kind !== "artifact-snapshot" && basis.data.kind !== "verification-result")
				return finding(
					check.conditionId,
					"inconclusive",
					items,
					"The basis is not an independent artifact or verification result",
					["independent-result-kind"],
				);
			const actual = digest(observed.value) === digest(check.expectedValue);
			return finding(
				check.conditionId,
				stated.value === actual ? "pass" : "fail",
				items,
				stated.value === actual
					? "Structured completion claim matches the selected verified fact"
					: "Structured completion claim contradicts the selected verified fact",
			);
		});
	},
);
export const F06 = define("F06", object({}), (_contract, view) => {
	const observed = callsIn(view),
		counts = { succeeded: 0, failed: 0, denied: 0, cancelled: 0, unknown: observed.unmatched.length };
	for (const call of observed.calls) counts[callState(call)]++;
	const items = [...observed.calls.flatMap((c) => [c.start, c.result].filter(Boolean)), ...observed.unmatched];
	const missing =
		counts.unknown || observed.ignored.length || view.snapshot.coverage !== "complete"
			? ["complete-tool-lifecycle-coverage"]
			: [];
	return [
		finding(
			null,
			missing.length ? "inconclusive" : "pass",
			items,
			"Tool outcome distribution describes observed execution; failures do not automatically attribute fault to the Agent",
			missing,
			{
				calls: observed.calls.length,
				unmatchedResults: observed.unmatched.length,
				ignoredObservations: observed.ignored.length,
				duplicateObservations: observed.duplicates.length,
				counts,
			},
		),
	];
});
export const F07 = define(
	"F07",
	object({
		pollingToolNames: T.Array(text, { maxItems: 100, uniqueItems: true }),
		repairToolNames: T.Array(text, { maxItems: 100, uniqueItems: true }),
	}),
	(_contract, view, config) => {
		const observed = callsIn(view),
			byStart = new Map(),
			byResult = new Map(),
			epochs = new Map(),
			groups = new Map();
		for (const call of observed.calls) {
			const at = key(call.start.ref);
			byStart.set(at, [...(byStart.get(at) ?? []), call]);
			if (call.result) byResult.set(key(call.result.ref), call);
		}
		let excludedPolling = 0;
		for (const item of view.evidence) {
			const attempt = item.data.attemptRef.id,
				result = byResult.get(key(item.ref));
			if (result && config.repairToolNames.includes(result.name) && callState(result) === "succeeded")
				epochs.set(attempt, (epochs.get(attempt) ?? 0) + 1);
			for (const call of byStart.get(key(item.ref)) ?? []) {
				if (config.pollingToolNames.includes(call.name)) {
					excludedPolling++;
					continue;
				}
				const id = digest([attempt, epochs.get(attempt) ?? 0, call.name, call.args ?? null]);
				groups.set(id, [...(groups.get(id) ?? []), call]);
			}
		}
		const candidates = [...groups.values()]
			.filter((group) => group.length > 1)
			.map((group) => ({
				toolName: group[0].name,
				callIds: group.map((c) => c.toolCallId),
				repeatedFailures: group.filter((c) => callState(c) === "failed").length,
				prerequisiteIdentity: "only observed repair boundaries; other changes unknown",
				nature: "unconfirmed",
			}));
		return [
			finding(
				null,
				"pass",
				observed.calls.flatMap((c) => [c.start, c.result].filter(Boolean)),
				"Repeated-call candidates only; polling and successful repair boundaries are excluded; no score or penalty is inferred",
				["candidate-intent-and-unobserved-preconditions-require-review"],
				{ candidates, excludedPolling },
			),
		];
	},
);
export const basicEvaluators = [F01, F02, F04, F05, F06, F07];
