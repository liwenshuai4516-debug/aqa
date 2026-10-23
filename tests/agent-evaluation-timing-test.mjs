/** Measured parallel subprocess diagnostic. Controlled waits, no model, CLI client or business task. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineFixture } from "./fixtures/agent-evaluation/engine.mjs";
import { F08 } from "../plugins/agent-evaluation/evaluators/metrics.mjs";
const clockEpoch = randomUUID(),
	intervals = [];
const output = mkdtempSync(join(tmpdir(), "agent-evaluation-timing-"));
let starts = 0;
const execute = (id) =>
	new Promise((resolve, reject) => {
		const startMs = performance.now();
		starts++;
		const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 10000)"], {
			stdio: "ignore",
			timeout: 15000,
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code !== 0) {
				reject(new Error(`${id}: ${code}/${signal}`));
				return;
			}
			intervals.push({ id, phase: "agent", kind: "work", clockEpoch, startMs, endMs: performance.now() });
			resolve();
		});
	});
const startMs = performance.now();
await Promise.all([execute("first"), execute("second")]);
const endMs = performance.now();
intervals.push({ id: "parent-wait", phase: "agent", kind: "wait-child", clockEpoch, startMs, endMs });
intervals.push({ id: "whole-attempt", phase: "agent", kind: "span", clockEpoch, startMs, endMs });
const fixture = engineFixture({
	rules: [F08],
	configs: { F08: { prices: [], checks: [], childWaitToolNames: [] } },
	evidence: intervals.map((value) => ({ kind: "timing-interval", value, origin: "instrumented" })),
});
try {
	const report = await fixture.engine.evaluate(fixture.context, fixture.args);
	const timing = report.data.findings[0].metrics.timing;
	assert.ok(timing.wallMs >= 9800 && timing.wallMs < 15000, JSON.stringify(timing));
	assert.ok(timing.cumulativeWorkMs >= 19600 && timing.cumulativeWorkMs < 30000, JSON.stringify(timing));
	assert.ok(timing.cumulativeWorkMs / timing.wallMs > 1.8);
	assert.equal(timing.waitingChildMs, endMs - startMs);
	assert.equal(timing.wallMs, endMs - startMs);
	assert.equal(report.data.findings[0].metrics.modelThinkingMs, null);
	const rescored = await fixture.engine.evaluate(fixture.context, { ...fixture.args, requestId: "rescore" });
	assert.deepEqual(rescored.data.findings, report.data.findings);
	assert.equal(starts, 2);
	const result = {
		status: "PASS",
		scope:
			"two actual parallel subprocesses with controlled ten-second waits; measured host monotonic clock, no model or external client",
		output,
		subprocessStarts: starts,
		reEvaluationStarts: 0,
		intervals,
		expected: { wallApproxMs: 10000, cumulativeWorkApproxMs: 20000, parentWaitCountedAsWork: false },
		actual: timing,
		evaluationElapsedMs: report.data.job.elapsedMs,
	};
	writeFileSync(join(output, "summary.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
} finally {
	fixture.cleanup();
}
