/** Deterministic reporting and evidence-based finding association. No HTTP/model calls. */
import { hash } from "./suite.mjs";
export function buildReport({
	runId,
	suiteHash,
	evidence,
	interrupted = false,
	previous = [],
	priorRunId = null,
	cases = [],
}) {
	const findings = [];
	const add = (caseId, kind, code) => {
		const id = hash(suiteHash + ":" + caseId + ":" + kind + ":" + code).slice(0, 24);
		const old = previous.find((f) => f.id === id);
		findings.push({
			id,
			suiteHash,
			caseId,
			kind,
			code,
			status: "open",
			firstSeen: old?.firstSeen ?? runId,
			occurrences: [...new Set([...(old?.occurrences ?? []), runId])],
			evidenceRun: runId,
			rootCause: "unconfirmed",
		});
	};
	if (interrupted || !evidence || evidence.executionVerdict === "unknown")
		add("suite", "execution_unknown", "INTERRUPTED");
	for (const execution of evidence?.executions ?? []) {
		if (execution.response?.jsonValid === false) add(execution.caseId, "suspected_api_defect", "NON_JSON_RESPONSE");
		if (execution.requestError)
			add(execution.caseId, "environment_fault", execution.requestError.code ?? "REQUEST_ERROR");
		for (const assertion of execution.assertions ?? [])
			if (!assertion.passed && !assertion.skipped)
				add(
					execution.caseId,
					cases.find((c) => c.id === execution.caseId)?.phase === "cleanup"
						? "cleanup_failure"
						: "suspected_api_defect",
					assertion.name,
				);
		if ((execution.assertions ?? []).some((a) => a.skipped))
			add(execution.caseId, "evidence_insufficient", "SKIPPED_ASSERTION");
	}
	if (evidence?.failures && !findings.length) add("suite", "testcase_error", "SCRIPT_OR_ASSERTION_FAILURE");
	const executed = new Set((evidence?.executions ?? []).map((e) => e.caseId));
	for (const candidate of cases)
		if (!executed.has(candidate.id) && !interrupted) add(candidate.id, "evidence_insufficient", "NOT_EXECUTED");
	const successfulCases = new Set(
		(evidence?.executions ?? [])
			.filter((e) => !e.requestError && e.assertions?.length && e.assertions.every((a) => a.passed && !a.skipped))
			.map((e) => e.caseId),
	);
	const resolved = [];
	for (const old of previous)
		if (
			!findings.some((f) => f.id === old.id) &&
			old.suiteHash === suiteHash &&
			successfulCases.has(old.caseId) &&
			priorRunId &&
			old.occurrences.includes(priorRunId)
		)
			resolved.push({ ...old, status: "closed", closedBy: runId, retestOf: priorRunId });
	const retained = previous.filter(
		(old) => !findings.some((f) => f.id === old.id) && !resolved.some((f) => f.id === old.id),
	);
	const writeRequests = cases.some((c) => !["GET", "HEAD", "OPTIONS"].includes(c.method));
	const cleanupCases = cases.filter((c) => c.phase === "cleanup");
	const cleanup =
		interrupted && writeRequests
			? "residuals-unknown"
			: cleanupCases.length
				? cleanupCases.every((c) => successfulCases.has(c.id))
					? "passed"
					: "failed"
				: writeRequests
					? "not-defined"
					: "not-required";
	const result = {
		schemaVersion: 1,
		runId,
		suiteHash,
		priorRunId,
		executionVerdict: interrupted ? "unknown" : (evidence?.executionVerdict ?? "unknown"),
		counts: { requests: evidence?.requests ?? null, assertions: evidence?.assertions ?? null },
		findings: [...findings, ...resolved, ...retained],
		cleanup,
		analysis: { kind: "deterministic-classification", modelCalls: 0, rootCause: "unconfirmed" },
	};
	result.markdown = [
		`# API test run ${runId}`,
		``,
		`- Verdict: ${result.executionVerdict}`,
		`- Suite hash: ${suiteHash}`,
		`- Retest of: ${priorRunId ?? "none"}`,
		`- Cleanup: ${cleanup}`,
		`- Analysis: deterministic evidence classification; root cause unconfirmed`,
		"",
		"| Finding | Case | Category | Status | Evidence |",
		"| --- | --- | --- | --- | --- |",
		...result.findings.map(
			(f) => `| ${f.id} | ${f.caseId.replaceAll("|", "/")} | ${f.kind} | ${f.status} | ${f.evidenceRun} |`,
		),
		"",
	].join("\n");
	return result;
}
