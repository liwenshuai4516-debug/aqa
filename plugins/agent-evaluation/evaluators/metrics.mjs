import { Type as T } from "typebox";
import { digest } from "../schema.mjs";
import { define, object, text, finding, trustworthy, callsIn } from "./common.mjs";
const phases = ["setup", "agent", "verification", "evaluation", "cleanup"];
const finite = (n) => Number.isFinite(n) && n >= 0;
export function unionMs(intervals) {
	const sorted = intervals.map((i) => [i.startMs, i.endMs]).sort((a, b) => a[0] - b[0]);
	let total = 0,
		end = -Infinity;
	for (const [start, stop] of sorted) {
		total += Math.max(0, stop - Math.max(start, end));
		end = Math.max(end, stop);
	}
	return total;
}
export function timingMetrics(intervals) {
	const result = {
		phases: {},
		wallMs: null,
		cumulativeWorkMs: null,
		waitingInputMs: null,
		waitingApprovalMs: null,
		waitingChildMs: null,
		clockEpochs: [],
		gaps: [],
	};
	const seen = new Map(),
		conflicts = new Set();
	for (const item of intervals) {
		const identity = `${item.attemptId}:${item.id}`;
		if (
			!phases.includes(item.phase) ||
			!item.clockEpoch ||
			!finite(item.startMs) ||
			!finite(item.endMs) ||
			item.endMs < item.startMs ||
			!["work", "span", "wait-input", "wait-approval", "wait-child"].includes(item.kind)
		) {
			result.gaps.push("invalid-or-non-monotonic-interval");
			continue;
		}
		if (seen.has(identity) && digest(seen.get(identity)) !== digest(item)) conflicts.add(identity);
		else seen.set(identity, item);
	}
	for (const identity of conflicts) {
		seen.delete(identity);
		result.gaps.push(`conflicting-timing:${identity}`);
	}
	const usable = [...seen.values()];
	const epochs = [...new Set(usable.map((i) => i.clockEpoch))];
	result.clockEpochs = epochs;
	if (!usable.length) result.gaps.push("timing-not-observed");
	if (epochs.length > 1)
		result.gaps.push("multiple-clock-epochs; wall-time cannot be joined across restarts or sources");
	for (const phase of phases) {
		const selected = usable.filter((i) => i.phase === phase),
			clocks = [...new Set(selected.map((i) => i.clockEpoch))];
		result.phases[phase] = {
			wallMs: selected.length && clocks.length === 1 ? unionMs(selected) : null,
			cumulativeWorkMs: selected.length
				? selected.filter((i) => i.kind === "work").reduce((s, i) => s + i.endMs - i.startMs, 0)
				: null,
			observedIntervals: selected.length,
			completeSpan: selected.some((i) => i.kind === "span") && clocks.length === 1,
		};
	}
	if (usable.length) {
		result.wallMs = epochs.length === 1 ? unionMs(usable) : null;
		result.cumulativeWorkMs = usable.filter((i) => i.kind === "work").reduce((s, i) => s + i.endMs - i.startMs, 0);
		for (const [kind, field] of [
			["wait-input", "waitingInputMs"],
			["wait-approval", "waitingApprovalMs"],
			["wait-child", "waitingChildMs"],
		]) {
			const matching = usable.filter((i) => i.kind === kind);
			result[field] =
				matching.length && new Set(matching.map((i) => i.clockEpoch)).size === 1 ? unionMs(matching) : null;
		}
	}
	return result;
}
export function costMetrics(observations) {
	const buckets = new Map(),
		gaps = [],
		unassigned = [];
	for (const observation of observations) {
		if (!observation.callId || !phases.includes(observation.phase) || observation.aggregate === true) continue;
		const id = observation.callId;
		const rows = buckets.get(id) ?? [];
		if (!rows.some((row) => digest(row) === digest(observation))) rows.push(observation);
		buckets.set(id, rows);
	}
	const phasesResult = Object.fromEntries(
		phases.map((phase) => [
			phase,
			{
				knownActualByCurrency: {},
				knownEstimatedByCurrency: {},
				calls: 0,
				unknownCalls: 0,
				unversionedEstimates: [],
				observed: false,
			},
		]),
	);
	for (const [id, rows] of buckets) {
		if (new Set(rows.map((r) => r.phase)).size !== 1) {
			gaps.push(`conflicting-cost-phase:${id}`);
			unassigned.push({ callId: id, phases: [...new Set(rows.map((r) => r.phase))] });
			continue;
		}
		const phase = phasesResult[rows[0].phase];
		phase.observed = true;
		phase.calls++;
		const actual = rows.filter((r) => r.source === "provider-measured" && finite(r.amount) && r.currency);
		const estimated = rows.filter((r) => r.source === "estimated" && finite(r.amount) && r.currency && r.priceVersion);
		const preferred = actual.length ? actual : estimated;
		const values = new Set(preferred.map((r) => digest([r.amount, r.currency, r.source, r.priceVersion ?? null])));
		if (values.size !== 1) {
			phase.unknownCalls++;
			gaps.push(`${values.size > 1 ? "conflicting-cost" : "usage-or-price-unavailable"}:${id}`);
		} else {
			const row = preferred[0],
				target = actual.length ? phase.knownActualByCurrency : phase.knownEstimatedByCurrency;
			target[row.currency] = (target[row.currency] ?? 0) + row.amount;
		}
		phase.unversionedEstimates.push(
			...rows
				.filter((r) => r.source === "estimated" && !r.priceVersion && finite(r.amount))
				.map((r) => ({ callId: r.callId, reportedAmount: r.amount, currency: r.currency ?? null, counted: false })),
		);
	}
	for (const phase of phases) if (!phasesResult[phase].observed) gaps.push(`usage-not-observed:${phase}`);
	return {
		phases: phasesResult,
		unassigned,
		gaps,
		note: "Known amounts are subtotals, not a complete bill; currencies and actual/estimated accounts remain separate",
	};
}
const price = object({
	model: text,
	provider: text,
	currency: text,
	version: text,
	inputPerMillion: T.Number({ minimum: 0 }),
	outputPerMillion: T.Number({ minimum: 0 }),
	cacheReadPerMillion: T.Number({ minimum: 0 }),
	cacheWritePerMillion: T.Number({ minimum: 0 }),
});
export const F08 = define(
	"F08",
	object({
		prices: T.Array(price, { maxItems: 100 }),
		childWaitToolNames: T.Array(text, { maxItems: 100 }),
		checks: T.Array(object({ conditionId: text, maxAgentWallMs: T.Number({ minimum: 0 }) }), { maxItems: 100 }),
	}),
	(_contract, view, config) => {
		const intervals = [],
			usage = [],
			items = [],
			gaps = [];
		const calls = callsIn(view).calls,
			live = new Map();
		for (const item of view.evidence) {
			if (!trustworthy(item, view)) continue;
			const value = item.value;
			if (item.data.kind === "timing-interval" && value) {
				intervals.push({ ...value, attemptId: item.data.attemptRef.id });
				items.push(item);
			}
			if (item.data.kind === "usage-record" && value) {
				usage.push(value);
				items.push(item);
			}
			if (item.data.producer === "pi-live-v1" && value?.toolCallId) {
				const id = `${item.data.attemptRef.id}:${value.toolCallId}`,
					phases = live.get(id) ?? {};
				if (phases[value.type] && digest(phases[value.type].value) !== digest(value)) phases.conflict = true;
				phases[value.type] = item;
				live.set(id, phases);
			}
			const message = item.data.producer === "pi-evidence-v1" ? value?.message : null;
			if (message?.role === "assistant") {
				const callId = `sdk:${item.data.sourceId}:${item.data.sourceEventId}`,
					raw = message.usage;
				const prices = config.prices.filter((p) => p.model === message.model && p.provider === message.provider);
				const pricing = prices.length === 1 ? prices[0] : undefined;
				if (prices.length > 1) gaps.push(`ambiguous-price:${callId}`);
				const tokens = raw ? [raw.input, raw.output, raw.cacheRead, raw.cacheWrite] : [];
				let row = { callId, phase: "agent", source: "unknown" };
				if (pricing && tokens.length === 4 && tokens.every(finite))
					row = {
						...row,
						source: "estimated",
						currency: pricing.currency,
						priceVersion: pricing.version,
						amount:
							(tokens[0] * pricing.inputPerMillion +
								tokens[1] * pricing.outputPerMillion +
								tokens[2] * pricing.cacheReadPerMillion +
								tokens[3] * pricing.cacheWritePerMillion) /
							1000000,
					};
				else if (finite(raw?.cost?.total))
					row = { ...row, source: "estimated", amount: raw.cost.total, currency: null };
				usage.push(row);
				items.push(item);
			}
		}
		for (const call of calls) {
			const observed = live.get(`${call.start.data.attemptRef.id}:${call.toolCallId}`),
				start = observed?.tool_start,
				end = observed?.tool_end;
			if (
				!observed?.conflict &&
				!call.conflict &&
				start &&
				end &&
				typeof start.value.clockEpoch === "string" &&
				start.value.clockEpoch === end.value.clockEpoch &&
				finite(start.value.monotonicAt) &&
				finite(end.value.monotonicAt)
			) {
				intervals.push({
					id: `tool:${call.toolCallId}`,
					attemptId: call.start.data.attemptRef.id,
					phase: "agent",
					kind: config.childWaitToolNames.includes(call.name) ? "wait-child" : "work",
					clockEpoch: start.value.clockEpoch,
					startMs: start.value.monotonicAt,
					endMs: end.value.monotonicAt,
				});
				items.push(start, end);
			} else gaps.push(`monotonic-tool-interval-unavailable:${call.id}`);
		}
		const timing = timingMetrics(intervals),
			costs = costMetrics(usage);
		const missing = [...gaps, ...timing.gaps, ...costs.gaps];
		const metrics = { timing, costs, unobservedTime: null, modelThinkingMs: null };
		const output = [
			finding(
				null,
				missing.length ? "inconclusive" : "pass",
				items,
				"Observed intervals and cost subtotals only; unobserved time is not model thinking, and missing usage is not zero",
				missing,
				metrics,
			),
		];
		for (const check of config.checks) {
			const elapsed = timing.phases.agent.wallMs;
			// Observed excess proves a violated upper bound even when additional intervals are missing.
			const exceeded = elapsed !== null && elapsed > check.maxAgentWallMs;
			const complete =
				view.snapshot.coverage === "complete" &&
				timing.phases.agent.completeSpan &&
				!gaps.length &&
				!timing.gaps.length &&
				elapsed !== null;
			output.push(
				finding(
					check.conditionId,
					exceeded ? "fail" : complete ? "pass" : "inconclusive",
					items,
					exceeded
						? "Observed monotonic agent time already exceeds the frozen upper bound"
						: complete
							? "Covered monotonic agent intervals satisfy the frozen upper bound"
							: "Timing coverage cannot establish the required upper bound",
					exceeded || complete ? [] : ["complete-monotonic-agent-coverage"],
					{ observedAgentWallMs: elapsed, limitMs: check.maxAgentWallMs },
				),
			);
		}
		return output;
	},
);
