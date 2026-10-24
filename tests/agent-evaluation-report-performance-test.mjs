/** Report/read latency at the frozen 1000-item boundary, after fixture construction. No business execution. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { engineFixture, ref } from "./fixtures/agent-evaluation/engine.mjs";
import { F06 } from "../plugins/agent-evaluation/evaluators/basic.mjs";
const output = mkdtempSync(join(tmpdir(), "agent-evaluation-report-performance-"));
const fixture = engineFixture({
	rules: [F06],
	evidence: Array.from({ length: 1000 }, (_, index) => ({
		kind: "fixture-evidence",
		value: { index, text: "offline evidence" },
	})),
});
const rounds = [];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
	for (let i = 0; i < 5; i++) {
		const row = { round: i, evidenceItems: 1000 };
		let start = performance.now();
		try {
			const report = await fixture.engine.evaluate(fixture.context, { ...fixture.args, requestId: `latency-${i}` });
			row.reportState = report.data.state;
			row.reportError = report.data.job.error;
		} catch (e) {
			row.reportError = { code: e.code, message: e.message };
		}
		row.reportMs = performance.now() - start;
		start = performance.now();
		try {
			row.listCount = fixture.store.list(fixture.context, { kind: "evidence", limit: 50 }).items.length;
		} catch (e) {
			row.listError = { code: e.code, message: e.message };
		}
		row.listMs = performance.now() - start;
		start = performance.now();
		try {
			row.evidenceChars = fixture.store.readEvidence(fixture.context, ref(fixture.items[0]), {
				offset: 0,
				maxChars: 4096,
			}).text.length;
		} catch (e) {
			row.evidenceError = { code: e.code, message: e.message };
		}
		row.evidenceMs = performance.now() - start;
		rounds.push(row);
	}
	const checks = {
		reportsCompleted: rounds.every((r) => r.reportState === "completed"),
		reportMedianMs: median(rounds.map((r) => r.reportMs)),
		listMedianMs: median(rounds.map((r) => r.listMs)),
		evidenceMedianMs: median(rounds.map((r) => r.evidenceMs)),
	};
	const passed =
		checks.reportsCompleted &&
		checks.reportMedianMs <= 2000 &&
		checks.listMedianMs <= 200 &&
		checks.evidenceMedianMs <= 200;
	const result = {
		status: passed ? "PASS" : "FAIL",
		output,
		scope: "1000 evidence snapshot; fixture construction excluded; five actual report/list/evidence reads",
		checks,
		rounds,
	};
	writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
	if (!passed) process.exitCode = 1;
} finally {
	fixture.cleanup();
}
