import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, symlinkSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvaluationStore } from "../../plugins/agent-evaluation/store.mjs";
import { canonical, digest, validate } from "../../plugins/agent-evaluation/schema.mjs";

const dirs: string[] = [],
	stores: EvaluationStore[] = [];
const contexts = new WeakMap<object, any>();
function context(overrides: any = {}) {
	const ctx = {};
	contexts.set(ctx, {
		domain: { principalId: "fixture-user", workspaceId: "fixture-workspace" },
		sessionIds: ["s1", "s2"],
		allowWrite: true,
		human: false,
		...overrides,
	});
	return ctx;
}
const authorize = (ctx: object) => contexts.get(ctx);
function open(options: any = {}) {
	const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "agent-evaluation-"));
	if (!dirs.includes(dataDir)) dirs.push(dataDir);
	const store = new EvaluationStore({ dataDir, authorize, ...options });
	stores.push(store);
	return store;
}
const contract = (changes: any = {}) => ({
	scope: {
		source: "pi",
		sessionId: "s1",
		startMessageId: "m1",
		endMessageId: "m2",
		boundaryPrecision: "exact",
		childPolicy: "exclude",
		childSessionIds: [],
	},
	objective: "Check the fixture artifact",
	conditions: [],
	constraints: [],
	environmentRefs: [],
	provenance: "user-message:m1",
	evaluationSubject: "agent-task",
	...changes,
});
const target = () => ({
	kind: "pi",
	clientVersion: "fixture-v1",
	executableIdentity: "fixture",
	adapterVersion: "1",
	configRef: "fixture-config",
	capabilities: { history: "partial" },
	isolation: "synthetic-test",
});
const ref = (r: any) => ({ kind: r.kind, id: r.id, revision: r.revision });
let sequence = 0;
function write(store: EvaluationStore, ctx: object, kind: string, data: any, extras: any = {}) {
	return store.write(ctx, { kind, data, requestId: `request-${++sequence}`, ...extras });
}
function fixture(store: EvaluationStore, ctx: object) {
	const task = write(store, ctx, "contracts", contract()),
		profile = write(store, ctx, "targets", target());
	const attempt = write(store, ctx, "attempts", {
		contractRef: ref(task),
		targetRef: ref(profile),
		sourceSessionId: "s1",
		configDigest: digest({}),
		state: "queued",
	});
	const evidence = write(store, ctx, "evidence", {
		attemptRef: ref(attempt),
		sourceId: "fixture",
		sourceEventId: "e1",
		sourceLocator: "fixture:e1",
		producer: "fixture-v1",
		availability: "available",
		origin: "harness-observed",
		kind: "artifact",
		observedAt: "2026-10-23T00:00:00Z",
		content: "fixture bytes",
		redaction: [],
		truncated: false,
	});
	const snapshot = write(store, ctx, "snapshots", {
		contractRef: ref(task),
		attemptRefs: [ref(attempt)],
		sourceWatermarks: { fixture: "e1" },
		evidenceRefs: [ref(evidence)],
		coverage: "partial",
		gaps: ["No tool trajectory"],
		sealedAt: "2026-10-23T00:00:01Z",
	});
	return { task, profile, attempt, evidence, snapshot };
}
afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("EC01 contracts and immutable store", () => {
	it("separates two task selections and preserves immutable revisions", () => {
		const store = open(),
			ctx = context();
		const a = write(store, ctx, "contracts", contract());
		const b = write(
			store,
			ctx,
			"contracts",
			contract({ scope: { ...a.data.scope, startMessageId: "m3", endMessageId: "m4" } }),
		);
		const revised = write(store, ctx, "contracts", contract({ objective: "New requirement" }), { previousRef: ref(a) });
		expect(a.id).not.toBe(b.id);
		expect(revised.id).toBe(a.id);
		expect(revised.revision).toBe(2);
		expect(store.get(ctx, ref(a)).data.objective).toBe("Check the fixture artifact");
		expect(() => write(store, ctx, "contracts", contract(), { previousRef: ref(a) })).toThrow(/stale/);
	});
	it("atomically deduplicates requests across restarts and rejects changed input", () => {
		const store = open(),
			ctx = context();
		const args = { requestId: "same-request" };
		const first = write(store, ctx, "contracts", contract(), args);
		expect(write(store, ctx, "contracts", contract(), args)).toEqual(first);
		store.close();
		const recovered = open({ dataDir: store.dataDir });
		expect(write(recovered, ctx, "contracts", contract(), args)).toEqual(first);
		expect(() => write(recovered, ctx, "contracts", contract({ objective: "changed" }), args)).toThrow(
			/different input/,
		);
		expect(recovered.list(ctx, { kind: "contracts" }).items).toHaveLength(1);
		expect(recovered.lookupRequest(ctx, "same-request")?.id).toBe(first.id);
		expect(
			recovered.lookupRequest(
				context({ domain: { principalId: "other", workspaceId: "fixture-workspace" } }),
				"same-request",
			),
		).toBeUndefined();
		expect(() => recovered.lookupRequest(context({ sessionIds: ["s2"] }), "same-request")).toThrow(/Session selection/);
	});
	it("rejects unknown versions, invalid fields, and required inferred conditions", () => {
		expect(() => validate("contracts", contract(), 2)).toThrow(/Unsupported/);
		expect(() => validate("contracts", contract({ owner: "forged" }))).toThrow(/Invalid/);
		expect(() =>
			validate(
				"contracts",
				contract({
					conditions: [
						{
							id: "c",
							statement: "guess",
							sourceRef: "inference",
							sourceType: "proposed",
							required: true,
							applicableWhen: "always",
						},
					],
				}),
			),
		).toThrow(/Proposed/);
		expect(() =>
			validate("contracts", contract({ scope: { ...contract().scope, boundaryPrecision: "selection-snapshot" } })),
		).toThrow(/digest/);
	});
	it("denies forged identities, cross domains and unauthorized session selections", () => {
		const store = open(),
			ctx = context(),
			r = write(store, ctx, "contracts", contract());
		expect(() => store.get({ domain: contexts.get(ctx).domain }, ref(r))).toThrow(/identity/);
		for (const other of [
			context({ domain: { principalId: "other", workspaceId: "fixture-workspace" } }),
			context({ domain: { principalId: "fixture-user", workspaceId: "other" } }),
			context({ sessionIds: ["s2"] }),
		]) {
			expect(() => store.get(other, ref(r))).toThrow();
			expect(store.list(other, { kind: "contracts" }).items).toEqual([]);
		}
		expect(() => write(store, context({ sessionIds: [] }), "contracts", contract())).toThrow(/authorized/);
		expect(() => write(store, context({ allowWrite: false }), "contracts", contract())).toThrow(/denied/);
	});
	it("does not broaden permission through deduplication or transitive references", () => {
		const store = open(),
			ctx = context(),
			f = fixture(store, ctx);
		const other = context({ domain: { principalId: "other", workspaceId: "fixture-workspace" } });
		expect(() => write(store, other, "evidence", f.evidence.data)).toThrow(/domain/);
		expect(() => store.export(context({ sessionIds: [] }), ref(f.snapshot))).toThrow(/authorized/);
	});
	it("refuses a second writer but permits a read-only view", () => {
		const store = open(),
			ctx = context(),
			task = write(store, ctx, "contracts", contract());
		expect(() => open({ dataDir: store.dataDir })).toThrow(/lock/);
		const reader = open({ dataDir: store.dataDir, readOnly: true });
		expect(reader.get(ctx, ref(task))).toEqual(task);
		expect(() => write(reader, ctx, "contracts", contract())).toThrow(/read only/);
		reader.close();
		expect(() => open({ dataDir: store.dataDir })).toThrow(/lock/);
	});
	it("does not publish a half record and preserves failed bytes for recovery", () => {
		const store = open({
				fault: (stage: string) => {
					if (stage === "beforePublish") throw new Error("disk failure");
				},
			}),
			ctx = context();
		expect(() => write(store, ctx, "contracts", contract())).toThrow(/Write failed/);
		expect(store.list(ctx, { kind: "contracts" }).items).toHaveLength(0);
		const files = readdirSync(join(store.root, "contracts"));
		expect(files).toHaveLength(1);
		expect(files[0]).toContain(".tmp-");
		store.close();
		const recovered = open({ dataDir: store.dataDir });
		expect(recovered.issues).toHaveLength(1);
		expect(() => write(recovered, ctx, "contracts", contract())).toThrow(/repair/);
	});
	it("recovers a committed write after its acknowledgement was lost without duplication", () => {
		const store = open({
				fault: (stage: string) => {
					if (stage === "afterPublish") throw new Error("lost reply");
				},
			}),
			ctx = context();
		expect(() => write(store, ctx, "contracts", contract(), { requestId: "lost-reply" })).toThrow(/durable/);
		store.close();
		const recovered = open({ dataDir: store.dataDir });
		const r = write(recovered, ctx, "contracts", contract(), { requestId: "lost-reply" });
		expect(r.revision).toBe(1);
		expect(recovered.list(ctx, { kind: "contracts" }).items).toHaveLength(1);
		expect(recovered.lookupRequest(ctx, "lost-reply")?.id).toBe(r.id);
	});
	it("retains damaged and future-schema originals and blocks new writes", () => {
		const store = open(),
			ctx = context(),
			task = write(store, ctx, "contracts", contract());
		store.close();
		const file = join(store.root, "contracts", `${task.id}.1.json`);
		for (const bytes of ['{"schemaVersion":', JSON.stringify({ ...task, schemaVersion: 99 })]) {
			writeFileSync(file, bytes);
			const recovered = open({ dataDir: store.dataDir });
			expect(recovered.issues).toHaveLength(1);
			expect(() => write(recovered, ctx, "contracts", contract())).toThrow(/repair/);
			expect(readFileSync(file, "utf8")).toBe(bytes);
			recovered.close();
		}
	});
	it("checks digest again on read and detects changed sealed evidence", () => {
		const store = open(),
			ctx = context(),
			f = fixture(store, ctx);
		const path = join(store.root, "evidence", `${f.evidence.id}.1.json`);
		writeFileSync(path, JSON.stringify({ ...f.evidence, data: { ...f.evidence.data, content: "changed" } }));
		expect(() => store.get(ctx, ref(f.snapshot))).toThrow(/digest/);
	});
	it("revalidates referenced bytes and authorization on every write", () => {
		const store = open(),
			ctx = context(),
			f = fixture(store, ctx);
		const data = { ...f.evidence.data, sourceEventId: "e2", content: "next observation" };
		write(store, ctx, "evidence", data);
		expect(() => write(store, context({ sessionIds: ["s2"] }), "evidence", data)).toThrow(/Session selection/);
		const path = join(store.root, "attempts", `${f.attempt.id}.1.json`);
		writeFileSync(
			path,
			JSON.stringify({ ...f.attempt, data: { ...f.attempt.data, configDigest: digest({ tampered: true }) } }),
		);
		expect(() => write(store, ctx, "evidence", { ...data, sourceEventId: "e3" })).toThrow(/digest/);
	});
	it("rejects traversal, file symlinks and directory symlinks", () => {
		const store = open(),
			ctx = context(),
			task = write(store, ctx, "contracts", contract());
		expect(() => store.get(ctx, { kind: "contracts", id: "../private", revision: 1 })).toThrow(/reference/);
		const file = join(store.root, "contracts", `${task.id}.1.json`),
			secret = join(store.dataDir, "fixture-private.json");
		writeFileSync(secret, "do not read");
		rmSync(file);
		symlinkSync(secret, file);
		expect(() => store.get(ctx, ref(task))).toThrow();
		store.close();
		rmSync(join(store.root, "contracts"), { recursive: true });
		const external = join(store.dataDir, "external");
		mkdirSync(external);
		symlinkSync(external, join(store.root, "contracts"));
		expect(() => open({ dataDir: store.dataDir })).toThrow(/symlink/);
	});
	it("enforces byte, record count and page limits without deleting previous evidence", () => {
		const store = open({ limits: { records: 1 } }),
			ctx = context(),
			a = write(store, ctx, "contracts", contract());
		expect(() => write(store, ctx, "contracts", contract())).toThrow(/capacity/);
		expect(store.get(ctx, ref(a))).toEqual(a);
		expect(() => store.list(ctx, { kind: "contracts", limit: 101 })).toThrow(/page/);
		expect(() => write(store, ctx, "contracts", contract({ objective: "x".repeat(3 * 1024 ** 2) }))).toThrow(/budget/);
		expect(() => open({ limits: { capacityBytes: -1 } })).toThrow(/Limits/);
	});
	it("keeps immutable snapshots and rejects evidence from a different task", () => {
		const store = open(),
			ctx = context(),
			a = fixture(store, ctx),
			b = fixture(store, ctx);
		expect(() => write(store, ctx, "snapshots", a.snapshot.data, { previousRef: ref(a.snapshot) })).toThrow(
			/immutable/,
		);
		expect(() => write(store, ctx, "snapshots", { ...a.snapshot.data, evidenceRefs: [ref(b.evidence)] })).toThrow(
			/another attempt/,
		);
		expect(() => write(store, ctx, "snapshots", { ...a.snapshot.data, attemptRefs: [ref(b.attempt)] })).toThrow(
			/revision differs/,
		);
	});
	it("distinguishes attachment, reexecution and reconciled attempt transitions", () => {
		const store = open(),
			ctx = context(),
			f = fixture(store, ctx);
		const retry = write(store, ctx, "attempts", { ...f.attempt.data, previousAttemptRef: ref(f.attempt) });
		expect(retry.id).not.toBe(f.attempt.id);
		expect(store.get(ctx, ref(f.attempt)).id).toBe(f.attempt.id);
		let attempt = write(
			store,
			ctx,
			"attempts",
			{ ...f.attempt.data, state: "preparing" },
			{ previousRef: ref(f.attempt) },
		);
		attempt = write(store, ctx, "attempts", { ...attempt.data, state: "unknown" }, { previousRef: ref(attempt) });
		expect(() =>
			write(store, ctx, "attempts", { ...attempt.data, state: "running" }, { previousRef: ref(attempt) }),
		).toThrow(/reconciliation/);
		const confirmed = write(
			store,
			context({ reconciled: true }),
			"attempts",
			{ ...attempt.data, state: "ended" },
			{ previousRef: ref(attempt) },
		);
		expect(confirmed.data.state).toBe("ended");
		expect(() =>
			write(store, ctx, "attempts", { ...confirmed.data, state: "running" }, { previousRef: ref(confirmed) }),
		).toThrow(/transition/);
	});
	it("exports a verifiable derivative without credentials or request metadata", () => {
		const store = open(),
			ctx = context(),
			f = fixture(store, ctx);
		const evidence = write(store, ctx, "evidence", {
			...f.evidence.data,
			content: "Bearer fixture-secret-value sk-12345678901234567890",
		});
		const exported = store.export(ctx, ref(evidence)),
			{ manifestDigest, ...body } = exported;
		expect(manifestDigest).toBe(digest(body));
		expect(canonical(exported)).not.toContain("fixture-secret-value");
		expect(canonical(exported)).not.toContain("sk-12345678901234567890");
		for (const r of exported.records) {
			const { digest: hash, ...data } = r;
			expect(hash).toBe(digest(data));
			expect(r).not.toHaveProperty("request");
			expect(r).not.toHaveProperty("domain");
		}
		expect(store.get(ctx, ref(evidence)).data.redaction).toContain("credentials-v1");
	});
	it("keeps redacted evidence receipts stable across blob extraction, retries and restart", () => {
		const store = open(),
			ctx = context(),
			f = fixture(store, ctx),
			data = { ...f.evidence.data, content: "Bearer fixture-secret-value", redaction: [] },
			before = structuredClone(data),
			requestId = "redacted-blob-receipt";
		const evidence = store.write(ctx, { kind: "evidence", data, requestId });
		expect(data).toEqual(before);
		expect(evidence.request.digest).toBe(
			digest({
				kind: "evidence",
				data: { ...data, content: "Bearer [REDACTED]" },
				schemaVersion: 1,
				previousRef: null,
			}),
		);
		expect(evidence.redacted).toBe(true);
		expect(evidence.data.redaction).toEqual(["credentials-v1"]);
		expect(evidence.data).not.toHaveProperty("content");
		expect(store.readBlob(evidence)).toBe("Bearer [REDACTED]");
		expect(store.write(ctx, { kind: "evidence", data, requestId })).toEqual(evidence);
		store.close();
		const restored = open({ dataDir: store.dataDir });
		expect(restored.write(ctx, { kind: "evidence", data, requestId })).toEqual(evidence);
		expect(restored.lookupRequest(ctx, requestId)).toEqual(evidence);
		expect(restored.readBlob(evidence)).toBe("Bearer [REDACTED]");
	});
	it("rebuilds an index from backup with no business callback or execution", () => {
		const store = open(),
			ctx = context(),
			f = fixture(store, ctx);
		store.close();
		const restoredDir = mkdtempSync(join(tmpdir(), "agent-evaluation-restore-"));
		dirs.push(restoredDir);
		cpSync(store.root, join(restoredDir, "agent-evaluation"), { recursive: true });
		const restored = open({ dataDir: restoredDir });
		expect(restored.get(ctx, ref(f.snapshot))).toEqual(f.snapshot);
		expect(restored.issues).toEqual([]);
	});
	it("binds a sealed reference to its original digest even if the source is rehashed", () => {
		const store = open(),
			ctx = context(),
			f = fixture(store, ctx);
		const { digest: oldDigest, ...changed } = f.evidence;
		changed.data = { ...changed.data, content: "replacement bytes" };
		writeFileSync(
			join(store.root, "evidence", `${f.evidence.id}.1.json`),
			JSON.stringify({ ...changed, digest: digest(changed) }),
		);
		expect(() => store.get(ctx, ref(f.snapshot))).toThrow(/after sealing/);
	});
	it("deduplicates blob bytes only within a domain and checks content before returning it", () => {
		const store = open(),
			ctx = context(),
			a = fixture(store, ctx);
		write(store, ctx, "evidence", { ...a.evidence.data, sourceEventId: "e2", content: "fixture bytes" });
		expect(readdirSync(join(store.root, "blobs"))).toHaveLength(1);
		expect(store.readEvidence(ctx, ref(a.evidence)).text).toBe("fixture bytes");
		expect(store.readEvidence(ctx, ref(a.evidence), { offset: 0, maxChars: 7 })).toMatchObject({
			text: "fixture",
			nextOffset: 7,
		});
		const other = context({ domain: { principalId: "other", workspaceId: "fixture-workspace" } });
		fixture(store, other);
		expect(readdirSync(join(store.root, "blobs"))).toHaveLength(2);
		expect(() => store.readEvidence(other, ref(a.evidence))).toThrow(/domain/);
		writeFileSync(store.blobPath(a.evidence), "replacement bytes");
		expect(() => store.readEvidence(ctx, ref(a.evidence))).toThrow(/digest/);
		expect(() => store.export(ctx, ref(a.snapshot))).toThrow(/digest/);
	});
	it("bounds transitive reads and UTF-8 evidence by bytes", () => {
		const store = open(),
			ctx = context(),
			f = fixture(store, ctx);
		expect(() => write(store, ctx, "evidence", { ...f.evidence.data, content: "中".repeat(400000) })).toThrow(
			/byte limit/,
		);
		store.close();
		const reader = open({ dataDir: store.dataDir, readOnly: true, limits: { readItems: 2 } });
		expect(() => reader.get(ctx, ref(f.snapshot))).toThrow(/read budget/);
	});
	it("budgets evidence separately from bounded authorization metadata without dropping reference checks", () => {
		const store = open(),
			ctx = context(),
			f = fixture(store, ctx);
		const evidence = [
			f.evidence,
			...Array.from({ length: 3 }, (_, i) =>
				write(store, ctx, "evidence", { ...f.evidence.data, sourceEventId: `extra-${i}` }),
			),
		];
		const snapshot = write(store, ctx, "snapshots", { ...f.snapshot.data, evidenceRefs: evidence.map(ref) });
		const overflowEvidence = write(store, ctx, "evidence", { ...f.evidence.data, sourceEventId: "overflow" });
		const overflow = write(store, ctx, "snapshots", {
			...f.snapshot.data,
			evidenceRefs: [...evidence, overflowEvidence].map(ref),
		});
		store.close();
		const reader = open({ dataDir: store.dataDir, readOnly: true, limits: { readItems: 4 } });
		expect(reader.get(ctx, ref(snapshot)).data.evidenceRefs).toHaveLength(4);
		expect(() => reader.get(ctx, ref(overflow))).toThrow(/read budget/);
		expect(() => reader.get(context({ sessionIds: ["s2"] }), ref(snapshot))).toThrow(/Session selection/);
		const path = join(store.root, "evidence", `${evidence[3].id}.1.json`);
		const changed = JSON.parse(readFileSync(path, "utf8"));
		changed.data.sourceLocator = "changed";
		const { digest: _digest, ...unsigned } = changed;
		changed.digest = digest(unsigned);
		writeFileSync(path, JSON.stringify(changed));
		expect(() => reader.get(ctx, ref(snapshot))).toThrow(/changed after sealing/);
		changed.id = f.task.id;
		const { digest: _changedDigest, ...changedUnsigned } = changed;
		changed.digest = digest(changedUnsigned);
		writeFileSync(path, JSON.stringify(changed));
		expect(() => reader.get(ctx, ref(evidence[3]))).toThrow(/Record identity changed/);
	});

	it("preserves rule reports and only appends reviews from trusted humans", () => {
		const store = open(),
			ctx = context(),
			f = fixture(store, ctx);
		const data = {
			snapshotRef: ref(f.snapshot),
			contractRef: ref(f.task),
			profileVersion: "m1-v1",
			evaluatorVersions: { F01: "1" },
			configDigest: digest({}),
			state: "completed",
			findings: [
				{
					findingId: "finding1",
					ruleId: "F01",
					ruleVersion: "1",
					verdict: "inconclusive",
					evidenceState: "partial",
					method: "deterministic",
					nature: "unconfirmed",
					evidenceRefs: [ref(f.evidence)],
					missingEvidence: ["schema"],
					reason: "Missing validation",
					attributions: [],
				},
			],
			summary: { deliveryVerdict: "inconclusive", goal: "undetermined" },
			assessmentStage: "provisional",
		};
		const report = write(store, ctx, "evaluations", data);
		expect(() => write(store, ctx, "evaluations", data, { previousRef: ref(report) })).toThrow(/immutable/);
		const reviewData = {
			evaluationRef: ref(report),
			findingId: "finding1",
			decision: "pass",
			reason: "Manually inspected fixture",
		};
		expect(() => write(store, ctx, "reviews", reviewData)).toThrow(/trusted UI/);
		const human = context({ human: true }),
			review = write(store, human, "reviews", reviewData);
		const correction = write(store, human, "reviews", {
			...reviewData,
			previousReviewRef: ref(review),
			decision: "inconclusive",
			reason: "Insufficient provenance",
		});
		expect(correction.id).not.toBe(review.id);
		expect(store.get(human, ref(review)).data.decision).toBe("pass");
		expect(store.get(human, ref(report)).data.findings[0].verdict).toBe("inconclusive");
		expect(store.get(human, ref(review)).reviewer).toBe("fixture-user");
		const outsider = fixture(store, ctx);
		expect(() =>
			write(store, ctx, "evaluations", {
				...data,
				findings: [{ ...data.findings[0], evidenceRefs: [ref(outsider.evidence)] }],
			}),
		).toThrow(/outside the snapshot/);
	});
});
