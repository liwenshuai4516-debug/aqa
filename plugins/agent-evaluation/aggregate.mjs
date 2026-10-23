/** Contract v1 aggregation. Advisory diagnostics never become required goal conditions. */
const verdictOf = (condition, findings) => {
	const results = findings.filter((f) => f.conditionId === condition.id);
	if (!results.length) return "inconclusive";
	// Conflicting rule conclusions remain unknown, but retain a known failure for the delivery gate.
	const determinate = new Set(results.map((f) => f.verdict));
	return determinate.size === 1 ? results[0].verdict : "inconclusive";
};
/** @param {any} contract
 * @param {any[]} findings
 * @param {{planned?: number, executed?: number, requiredRuleGaps?: string[]}} options */
export function aggregate(
	contract,
	findings,
	{ planned = findings.length, executed = findings.length, requiredRuleGaps = [] } = {},
) {
	const conditions = new Map([...contract.conditions, ...contract.constraints].map((c) => [c.id, c]));
	findings = findings.map((f) => {
		const condition = conditions.get(f.conditionId);
		if (f.verdict !== "not-applicable" || !condition) return f;
		return condition.applicableWhen !== "always" &&
			f.evidenceState === "sufficient" &&
			f.nature === "verified" &&
			f.evidenceRefs?.length
			? f
			: { ...f, verdict: "inconclusive" };
	});
	const requiredGoals = contract.conditions.filter((c) => c.required && c.sourceType !== "proposed");
	const requiredConstraints = contract.constraints.filter((c) => c.required && c.sourceType !== "proposed");
	const goalResults = requiredGoals.map((c) => verdictOf(c, findings)).filter((v) => v !== "not-applicable");
	const behaviorResults = requiredConstraints.map((c) => verdictOf(c, findings)).filter((v) => v !== "not-applicable");
	const goal =
		!goalResults.length || goalResults.includes("inconclusive")
			? "undetermined"
			: goalResults.every((v) => v === "pass")
				? "achieved"
				: goalResults.every((v) => v === "fail")
					? "not-achieved"
					: "partially-achieved";
	const behavior = behaviorResults.includes("fail")
		? "fail"
		: behaviorResults.includes("inconclusive")
			? "inconclusive"
			: "pass";
	const requiredIds = new Set([...requiredGoals, ...requiredConstraints].map((c) => c.id));
	const knownFailure = findings.some((f) => requiredIds.has(f.conditionId) && f.verdict === "fail");
	const deliveryVerdict = knownFailure
		? "fail"
		: goal === "achieved" && behavior === "pass" && !requiredRuleGaps.length
			? "pass"
			: "inconclusive";
	const count = (verdict) => findings.filter((f) => f.verdict === verdict).length;
	const pass = count("pass"),
		fail = count("fail"),
		excluded = count("not-applicable");
	const applicable = Math.max(0, planned - excluded);
	return {
		deliveryVerdict,
		goal,
		behavior,
		counts: {
			object: "findings",
			planned,
			executed,
			determinate: pass + fail,
			pass,
			fail,
			inconclusive: count("inconclusive"),
			notExecuted: Math.max(0, planned - executed),
			errors: findings.filter((f) => f.error && !["NOT_EXECUTED", "CANCELLED", "EVIDENCE_GAP"].includes(f.error))
				.length,
			excluded,
			passRate: pass + fail ? pass / (pass + fail) : null,
			coverage: applicable ? (pass + fail) / applicable : null,
		},
		exclusions: findings
			.filter((f) => f.verdict === "not-applicable")
			.map((f) => ({ findingId: f.findingId, reason: f.reason })),
		requiredRuleGaps,
	};
}
