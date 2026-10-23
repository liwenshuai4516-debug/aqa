/** Offline bridge check against a completed data-space-native-test fixture. No runner/model API. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { TestAssetReader } from "../server/test-asset-reader.ts";
import { EvaluationStore } from "../plugins/agent-evaluation/store.mjs";
import { EvidenceCollector, recordsOf, readEvidenceJson } from "../plugins/agent-evaluation/collect.mjs";
import { readEvaluationEvidence } from "../server/agent/evaluation-evidence.ts";
import { EvaluationEngine } from "../plugins/agent-evaluation/evaluate.mjs";
import { createInternalRegistry } from "../plugins/agent-evaluation/profiles/internal.mjs";
import { digest } from "../plugins/agent-evaluation/schema.mjs";

const input = process.argv[2];
assert.ok(input, "Pass a completed local data-space-native-test output directory");
const fixture = resolve(input);
const summaryBytes = readFileSync(join(fixture, "summary.json"));
const summary = JSON.parse(summaryBytes);
assert.equal(summary.status, "PASS");
assert.match(summary.scope, /local synthetic targets/);
const ledger = JSON.parse(readFileSync(join(fixture, "ledger.json"), "utf8"));
const reader = new TestAssetReader(join(fixture, "data"));
const output = mkdtempSync(join(tmpdir(), "agent-evaluation-native-"));
const ref = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
const results = [];
const tracePath = join(fixture, "evaluation-trace.json");
const trace = existsSync(tracePath) ? JSON.parse(readFileSync(tracePath, "utf8")) : null;
for (const item of ledger.store.cases) {
	const { engine, workspace } = item.automation;
	const context = { clientId: "offline-native-fixture" };
	const domain = { principalId: context.clientId, workspaceId: digest(workspace) };
	const sessionId = `fixture-${engine}`;
	const store = new EvaluationStore({
		dataDir: join(output, engine),
		authorize: (c) => (c === context ? { domain, sessionIds: [sessionId], allowWrite: true } : undefined),
	});
	const entries =
		engine === "api" && trace && realpathSync(trace.workspace) === realpathSync(workspace) ? trace.entries : [];
	if (engine === "api" && trace) assert.ok(entries.length, "Actual API call trace must be selected");
	const source = {
		...domain,
		workspace,
		conversationId: sessionId,
		sessionId,
		persisted: true,
		isStreaming: false,
		leafId: entries.at(-1)?.id,
		children: [],
		getEntry: (id) => entries.find((e) => e.id === id),
	};
	let reads = 0;
	const collector = new EvidenceCollector(store, {
		readEvaluationEvidence: (_client, query) =>
			entries.length
				? readEvaluationEvidence(source, query)
				: {
						...domain,
						sessionId,
						sourceId: `fixture:${sessionId}`,
						observedAt: new Date().toISOString(),
						items: [],
						children: [],
						gaps: ["offline-native-fixture; no historical agent trajectory"],
						nextCursor: null,
					},
		readEvaluationNative: (_client, request) => {
			reads++;
			return reader.read(request.engine, workspace, request.reference);
		},
	});
	try {
		const refs = await reader.list(engine, workspace);
		assert.ok(refs.length > 0);
		const expected = await Promise.all(refs.map((reference) => reader.read(engine, workspace, reference)));
		const contract = store.write(context, {
			kind: "contracts",
			requestId: "contract",
			data: {
				scope: {
					source: "pi",
					sessionId,
					startMessageId: entries[0]?.id ?? "fixture",
					endMessageId: entries.at(-1)?.id ?? "fixture",
					boundaryPrecision: "exact",
					childPolicy: "exclude",
					childSessionIds: [],
				},
				objective: "Read existing synthetic native runs without execution",
				conditions: expected.map((r, i) => ({
					id: `native-${i}`,
					statement: `Native ${r.runId} assertions`,
					sourceType: "user",
					sourceRef: "fixture:requirements",
					required: true,
					applicableWhen: "always",
					ruleRef: "F02@1",
				})),
				constraints: [],
				environmentRefs: [],
				provenance: "explicit offline integration fixture",
				evaluationSubject: "agent-task",
			},
		});
		const target = store.write(context, {
			kind: "targets",
			requestId: "target",
			data: {
				kind: "pi",
				clientVersion: "fixture",
				executableIdentity: "no-executable",
				adapterVersion: "1",
				configRef: "offline",
				capabilities: { history: "unsupported" },
				isolation: "fixture",
			},
		});
		const attempt = store.write(context, {
			kind: "attempts",
			requestId: "attempt",
			data: {
				contractRef: ref(contract),
				targetRef: ref(target),
				sourceSessionId: sessionId,
				configDigest: digest({}),
				state: "unknown",
			},
		});
		const args = {
			attemptRef: ref(attempt),
			conversationId: sessionId,
			requestId: "read-existing",
			nativeRefs: refs.map((reference) => ({ engine, reference })),
		};
		const collected = await collector.collect(context, args);
		assert.equal(collected.coverage, "partial");
		const sealed = collector.seal(context, collected.checkpointRef, "seal");
		const evidence = recordsOf(store, context, "evidence").filter((r) => r.data.kind === "native-test-run");
		assert.equal(evidence.length, expected.length);
		for (const original of expected) {
			const record = evidence.find((r) => r.data.sourceEventId === original.runId);
			assert.deepEqual(readEvidenceJson(store, context, ref(record)), original);
			assert.equal(record.data.occurredAt, original.at);
			assert.equal(record.data.sourceRevision, digest(original));
			assert.notEqual(record.data.observedAt, original.at);
			if (!original.complete) assert.ok(collected.gaps.includes(`native-run-incomplete:${original.runId}`));
		}
		const before = reads;
		assert.deepEqual((await collector.collect(context, args)).checkpointRef, collected.checkpointRef);
		assert.equal(reads, before, "Idempotent retry must not re-read native files");
		if (engine === "ui") {
			const changed = { ...refs[0], sha256: "0".repeat(64) };
			await assert.rejects(
				collector.collect(context, { ...args, requestId: "changed", nativeRefs: [{ engine, reference: changed }] }),
			);
			assert.deepEqual(store.get(context, ref(sealed)), sealed);
		}
		const beforeScore = reads;
		const scoring = new EvaluationEngine(
			store,
			createInternalRegistry({
				F02: { checks: expected.map((r, i) => ({ conditionId: `native-${i}`, runId: r.runId })) },
			}),
		);
		const scores = [];
		try {
			const scoreArgs = { snapshotRef: ref(sealed), profileId: "internal", profileVersion: "1", requestId: "score" };
			const report = await scoring.evaluate(context, scoreArgs);
			assert.equal(report.data.summary.counts.errors, 0);
			for (const [i, native] of expected.entries()) {
				const finding = report.data.findings.find((f) => f.conditionId === `native-${i}`);
				const verdict =
					entries.length &&
					native.complete &&
					native.rows.every((r) => r.evidenceComplete && ["passed", "failed"].includes(r.status))
						? native.rows.some((r) => r.status === "failed")
							? "fail"
							: "pass"
						: "inconclusive";
				assert.equal(finding.verdict, verdict, `${native.runId}: ${finding.reason}`);
				scores.push({ runId: native.runId, expected: verdict, actual: finding.verdict });
			}
			const again = await scoring.evaluate(context, { ...scoreArgs, requestId: "rescore" });
			assert.deepEqual(again.data.findings, report.data.findings);
			assert.equal(reads, beforeScore, "Re-evaluation must not read or execute native runs");
			assert.deepEqual(store.get(context, ref(report)), report);
		} finally {
			scoring.close();
		}

		results.push({
			engine,
			workspace,
			snapshotRef: ref(sealed),
			runs: expected.map((r) => ({
				runId: r.runId,
				at: r.at,
				complete: r.complete,
				statuses: r.rows.map((row) => row.status),
				digest: digest(r),
			})),
			nativeReads: reads,
			idempotentReplayReads: 0,
			reEvaluationReads: 0,
			scores,
		});
	} finally {
		collector.close();
		store.close();
	}
}
assert.ok(results.some((r) => r.engine === "api"));
assert.ok(results.some((r) => r.engine === "ui"));
const result = {
	status: "PASS",
	scope: "offline read and seal of this task's synthetic native runner outputs; no CLI/model/runner invocation",
	fixture,
	fixtureSummarySha256: createHash("sha256").update(summaryBytes).digest("hex"),
	output,
	results,
};
writeFileSync(join(output, "summary.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
