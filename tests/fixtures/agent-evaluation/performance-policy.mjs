/** Versioned acceptance for the fixed historical batch fixture; not a live Agent overhead claim. */
export const PERFORMANCE_POLICY = Object.freeze({
	id: "ec04-batch-v2",
	serial: Object.freeze({ wallMs: 100, cpuMs: 100, evidenceCount: 40 }),
	parallel: Object.freeze({ wallMs: 250, cpuMs: 250, evidenceCount: 400 }),
	long: Object.freeze({ wallMs: 1000, cpuMs: 750, evidenceCount: 200 }),
});
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
export function comparePerformance(workload, off, on) {
	const budget = PERFORMANCE_POLICY[workload];
	if (!budget || workload === "id") throw new Error("Unknown performance workload");
	const wallDelta = median(on.map((r) => r.elapsedMs)) - median(off.map((r) => r.elapsedMs));
	const cpuDelta = median(on.map((r) => r.cpuMs)) - median(off.map((r) => r.cpuMs));
	const legacyWallLimit = Math.max(median(off.map((r) => r.elapsedMs)) * 0.2, 50);
	const legacyCpuLimit = Math.max(median(off.map((r) => r.cpuMs)) * 0.25, 50);
	const pairsComplete =
		off.length === 5 &&
		on.length === 5 &&
		off.every(
			(r, i) =>
				r.round === i &&
				on[i].round === i &&
				r.workload === workload &&
				on[i].workload === workload &&
				!r.enabled &&
				on[i].enabled,
		);
	const telemetryValid = [...off, ...on].every((r) =>
		["elapsedMs", "cpuMs", "peakRssBytes", "diskBytes", "inputBytes"].every(
			(key) => Number.isFinite(r[key]) && r[key] >= 0,
		),
	);
	const coverageComplete = on.every(
		(r, i) =>
			!r.failure &&
			r.evidenceCount === budget.evidenceCount &&
			Array.isArray(r.gaps) &&
			r.gaps.length === 0 &&
			r.inputBytes > 0 &&
			r.inputBytes === off[i]?.inputBytes,
	);
	const rssDeltas = on.map((r, i) => r.peakRssBytes - off[i]?.peakRssBytes);
	const resourcePass =
		rssDeltas.every((n) => n <= 64 * 1024 ** 2) && on.every((r) => r.diskBytes <= r.inputBytes * 2 + 1024 ** 2);
	const valid = pairsComplete && telemetryValid && coverageComplete && resourcePass;
	return {
		workload,
		policyId: PERFORMANCE_POLICY.id,
		wallDelta,
		wallLimit: budget.wallMs,
		cpuDelta,
		cpuLimit: budget.cpuMs,
		rssDeltas,
		pairsComplete,
		telemetryValid,
		coverageComplete,
		resourcePass,
		legacyWallLimit,
		legacyCpuLimit,
		legacyPass: valid && wallDelta <= legacyWallLimit && cpuDelta <= legacyCpuLimit,
		pass: valid && wallDelta <= budget.wallMs && cpuDelta <= budget.cpuMs,
	};
}
