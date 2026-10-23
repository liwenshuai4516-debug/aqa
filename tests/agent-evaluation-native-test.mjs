/** Offline bridge check against a completed data-space-native-test fixture. No runner/model API. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { TestAssetReader } from "../server/test-asset-reader.ts";
import { EvaluationStore } from "../plugins/agent-evaluation/store.mjs";
import { EvidenceCollector, recordsOf, readEvidenceJson } from "../plugins/agent-evaluation/collect.mjs";
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
for (const item of ledger.store.cases) {
	const { engine, workspace } = item.automation;
	const context = { clientId: "offline-native-fixture" };
	const domain = { principalId: context.clientId, workspaceId: digest(workspace) };
	const sessionId = `fixture-${engine}`;
	const store = new EvaluationStore({
		dataDir: join(output, engine),
		authorize: (c) => (c === context ? { domain, sessionIds: [sessionId], allowWrite: true } : undefined),
	});
	let reads = 0;
	const collector = new EvidenceCollector(store, {
		readEvaluationEvidence: () => ({
			...domain,
			sessionId,
			sourceId: `fixture:${sessionId}`,
			observedAt: new Date().toISOString(),
			items: [],
			children: [],
			gaps: ["offline-native-fixture; no historical agent trajectory"],
			nextCursor: null,
		}),
		readEvaluationNative: (_client, request) => {
			reads++;
			return reader.read(request.engine, workspace, request.reference);
		},
	});
	try {
		const contract = store.write(context, {
			kind: "contracts",
			requestId: "contract",
			data: {
				scope: {
					source: "pi",
					sessionId,
					startMessageId: "fixture",
					endMessageId: "fixture",
					boundaryPrecision: "exact",
					childPolicy: "exclude",
					childSessionIds: [],
				},
				objective: "Read existing synthetic native runs without execution",
				conditions: [],
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
		const refs = await reader.list(engine, workspace);
		assert.ok(refs.length > 0);
		const expected = await Promise.all(refs.map((reference) => reader.read(engine, workspace, reference)));
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
