import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvaluationService } from "../../plugins/agent-evaluation/service.mjs";
import plugin from "../../plugins/agent-evaluation/index.mjs";
import { readEvaluationEvidence } from "../../server/agent/evaluation-evidence.js";
import { readEvaluationArtifact } from "../../server/agent/evaluation-artifact.js";
import { ClientSession } from "../../server/agent/agent-service.js";
import { digest } from "../../plugins/agent-evaluation/schema.mjs";
const cleanup: Array<() => void> = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const fn of cleanup.splice(0).reverse()) fn();
});
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "evaluation-service-")),
		workspace = join(dir, "workspace");
	mkdirSync(workspace);
	cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
	const entries: any[] = [
		{
			id: "u1",
			parentId: null,
			type: "message",
			timestamp: "2026-10-24T00:00:00Z",
			message: { role: "user", content: "Produce result.json" },
		},
		{
			id: "a1",
			parentId: "u1",
			type: "message",
			timestamp: "2026-10-24T00:00:01Z",
			message: { role: "assistant", content: [{ type: "text", text: "fixture result" }] },
		},
	];
	const host: any = {
		dataDir: dir,
		getActiveConversation: ({ clientId }: any) => ({ clientId, conversationId: "conv1" }),
		readEvaluationEvidence: vi.fn((clientId: string, query: any) => {
			if (clientId !== "owner") throw Object.assign(new Error("Unknown owner"), { code: "PERMISSION_DENIED" });
			return readEvaluationEvidence(
				{
					principalId: clientId,
					workspaceId: digest(workspace),
					workspace,
					conversationId: "conv1",
					sessionId: "session1",
					clientVersion: "fixture-sdk",
					children: [],
					persisted: true,
					isStreaming: false,
					leafId: "a1",
					getEntry: (id) => entries.find((e) => e.id === id),
					locateMessage: (id) => (entries.some((e) => e.id === id) ? `rendered-${id}` : undefined),
				},
				query,
			);
		}),
		readEvaluationArtifact: vi.fn((_clientId: string, query: any) => readEvaluationArtifact(workspace, query.path)),
		readEvaluationNative: vi.fn(async () => {
			throw new Error("No native reference in fixture");
		}),
		onRunEvent: vi.fn(() => () => {}),
		onClientDisabled: vi.fn(() => () => {}),
	};
	const service = new EvaluationService(host);
	cleanup.push(() => service.close());
	const ui = { channel: "ui", clientId: "owner" },
		tool = { channel: "tool", clientId: "owner", conversationId: "conv1" };
	let sequence = 0;
	const request = (action: string, extra: any = {}, trusted: any = ui) =>
		service.dispatch(trusted, { requestId: `r-${++sequence}`, action, ...extra });
	const contract = {
		scope: {
			source: "pi",
			sessionId: "session1",
			startMessageId: "u1",
			endMessageId: "a1",
			boundaryPrecision: "exact",
			childPolicy: "exclude",
			childSessionIds: [],
		},
		objective: "Produce result.json",
		conditions: [
			{
				id: "artifact",
				statement: "Valid JSON result",
				sourceRef: "u1",
				sourceType: "user",
				required: true,
				applicableWhen: "always",
				ruleRef: "F01@1",
			},
		],
		constraints: [],
		environmentRefs: [],
		provenance: "human-confirmed synthetic fixture",
		evaluationSubject: "agent-task",
	};
	return { dir, workspace, entries, host, service, ui, tool, request, contract };
}
async function diagnose(f: ReturnType<typeof fixture>) {
	writeFileSync(join(f.workspace, "result.json"), '{"ok":true,"apiKey":"synthetic-secret"}');
	// Existence is observable even when sensitive bytes were redacted.
	const contractRef = await f.request("createContract", { data: f.contract });
	const attemptRef = await f.request("createAttempt", { ref: contractRef, requestId: "attach" });
	const collected = await f.request("collect", {
		ref: attemptRef,
		artifactPaths: ["result.json"],
		requestId: "collect",
	});
	const snapshotRef = await f.request("seal", { ref: collected.checkpointRef });
	const job = await f.request("evaluate", {
		ref: snapshotRef,
		configs: { F01: { checks: [{ conditionId: "artifact", path: "result.json" }] } },
	});
	let status: any;
	await vi.waitFor(async () => {
		status = await f.request("status", { jobId: job.jobId });
		expect(status.state).toBe("completed");
	});
	const report = await f.request("get", { ref: status.reportRef });
	return { contractRef, attemptRef, collected, snapshotRef, reportRef: status.reportRef, report };
}
describe("EC04 product service", () => {
	it("pages a 1000-evidence snapshot below the response budget without carrying unseen reference digests", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		const { context } = f.service.authorize(f.ui, { action: "get" });
		const store = f.service.store!;
		const items = store.writeEvidenceBatch(
			context,
			Array.from({ length: 1000 }, (_, index) => ({
				kind: "evidence",
				requestId: `scale-evidence-${index}`,
				data: {
					attemptRef: scored.attemptRef,
					sourceId: "synthetic-scale",
					sourceEventId: String(index),
					sourceLocator: `synthetic:${index}`,
					producer: "synthetic-scale-v1",
					availability: "available",
					origin: "harness-observed",
					kind: "fixture-evidence",
					observedAt: "2026-10-25T00:00:00Z",
					content: JSON.stringify({ index }),
					redaction: [],
					truncated: false,
				},
			})),
		);
		const refs = items.map((r: any) => ({ kind: r.kind, id: r.id, revision: r.revision }));
		const saved = store.write(context, {
			kind: "snapshots",
			requestId: "scale-snapshot",
			data: {
				...store.get(context, scored.snapshotRef).data,
				evidenceRefs: refs,
				coverage: "partial",
				gaps: ["synthetic-scale-fixture; not SDK collection"],
			},
		});
		const reference = { kind: saved.kind, id: saved.id, revision: saved.revision };
		const file = join(f.dir, "agent-evaluation/snapshots", `${saved.id}.${saved.revision}.json`),
			before = readFileSync(file);
		expect(Object.keys(saved.referenceDigests)).toHaveLength(1002);
		const returned: any[] = [];
		for (let offset = 0; offset < 1000; offset += 50) {
			const part = await f.request("get", { ref: reference, offset, limit: 50 });
			expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThan(48 * 1024);
			expect(part.sourceDigest).toBe(saved.digest);
			expect(part.projection).toBe(true);
			expect(part.digest).toBeUndefined();
			const visible = [part.data.contractRef, ...part.data.attemptRefs, ...part.data.evidenceRefs];
			expect(part.referenceDigests).toEqual(
				Object.fromEntries(
					visible.map((r: any) => {
						const key = `${r.kind}/${r.id}.${r.revision}`;
						return [key, saved.referenceDigests[key]];
					}),
				),
			);
			expect(part.pages.evidenceRefs.total).toBe(1000);
			returned.push(...part.data.evidenceRefs);
		}
		expect(returned).toEqual(refs);
		expect(readFileSync(file)).toEqual(before);
		await expect(f.request("get", { ref: reference }, { channel: "ui", clientId: "other" })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
	});

	it("locates an authorized SDK evidence record without recollection or report mutation", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		const snapshot = await f.request("get", { ref: scored.snapshotRef });
		const records = await Promise.all(snapshot.data.evidenceRefs.map((ref: any) => f.request("get", { ref })));
		const record = records.find((r: any) => r.data.kind === "message");
		const ref = { kind: record.kind, id: record.id, revision: record.revision };
		f.host.readEvaluationArtifact.mockClear();
		expect(await f.request("locateEvidence", { ref })).toEqual({
			conversationId: "conv1",
			sessionId: "session1",
			messageId: `rendered-${record.data.sourceEventId}`,
		});
		await expect(f.request("locateEvidence", { ref }, { channel: "ui", clientId: "other" })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		const artifact = records.find((r: any) => r.data.kind === "artifact-snapshot");
		await expect(
			f.request("locateEvidence", { ref: { kind: artifact.kind, id: artifact.id, revision: artifact.revision } }),
		).rejects.toMatchObject({ code: "EVIDENCE_GAP" });
		f.entries.splice(0);
		await expect(f.request("locateEvidence", { ref })).rejects.toMatchObject({ code: "EVIDENCE_GAP" });
		expect(f.host.readEvaluationArtifact).not.toHaveBeenCalled();
		expect(f.host.readEvaluationNative).not.toHaveBeenCalled();
		expect((await f.request("get", { ref: scored.reportRef })).sourceDigest).toBe(scored.report.sourceDigest);
	});

	it("pages only sealed redacted file text and never reopens a changed artifact", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		const snapshot = await f.request("get", { ref: scored.snapshotRef });
		const evidence = await Promise.all(snapshot.data.evidenceRefs.map((ref: any) => f.request("get", { ref })));
		const artifact = evidence.find((r: any) => r.data.kind === "artifact-snapshot");
		writeFileSync(join(f.workspace, "result.json"), "changed current file");
		f.host.readEvaluationArtifact.mockClear();
		const request = { ref: artifact, evidenceView: "artifact-text" };
		const first = await f.request("readEvidence", {
			...request,
			ref: { kind: artifact.kind, id: artifact.id, revision: artifact.revision },
		});
		expect(first).toMatchObject({ text: '{"ok":true,"apiKey":"[REDACTED]"}', view: "artifact-text", nextOffset: null });
		expect(first.text).not.toContain("synthetic-secret");
		await expect(
			f.request("readEvidence", { ref: scored.reportRef, evidenceView: "artifact-text" }),
		).rejects.toMatchObject({ code: "EVIDENCE_GAP" });
		const ref = snapshot.data.evidenceRefs.find((r: any) => r.id === artifact.id);
		await expect(f.request("readEvidence", { ref, evidenceView: "native-run" })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(
			f.request("readEvidence", { ref, evidenceView: "artifact-text" }, { channel: "ui", clientId: "other" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(f.request("readEvidence", { ref, evidenceView: "artifact-text", offset: 9999 })).rejects.toMatchObject(
			{ code: "INVALID_INPUT" },
		);
		expect(f.host.readEvaluationArtifact).not.toHaveBeenCalled();
		expect((await f.request("get", { ref: scored.reportRef })).sourceDigest).toBe(scored.report.sourceDigest);
	});
	it("paginates long sealed text, including empty files, and explains missing, binary and over-budget bodies", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		const paths = ["long.txt", "empty.txt", "missing.txt", "binary.bin", "large.txt"];
		const text = "中文\n".repeat(3000);
		writeFileSync(join(f.workspace, paths[0]), text);
		writeFileSync(join(f.workspace, paths[1]), "");
		writeFileSync(join(f.workspace, paths[3]), Buffer.from([255, 254, 0]));
		writeFileSync(join(f.workspace, paths[4]), "x".repeat(1024 * 1024 + 1));
		const collected = await f.request("collect", { ref: scored.attemptRef, artifactPaths: paths });
		const snapshotRef = await f.request("seal", { ref: collected.checkpointRef });
		const checkpoint = await f.request("get", { ref: snapshotRef });
		const records = await Promise.all(checkpoint.data.evidenceRefs.map((ref: any) => f.request("get", { ref })));
		for (const [index, path] of paths.entries()) {
			const record = records.find((r: any) => r.data.sourceLocator === path);
			const ref = { kind: record.kind, id: record.id, revision: record.revision };
			let offset = 0,
				actual = "",
				page: any;
			do {
				page = await f.request("readEvidence", { ref, evidenceView: "artifact-text", offset });
				expect(page.text.length).toBeLessThanOrEqual(4096);
				actual += page.text;
				offset = page.nextOffset;
			} while (offset !== null);
			expect(actual).toBe(index === 0 ? text : "");
			expect(page.unavailable).toBe([undefined, undefined, "file-missing", "file-nontext", "file-truncated"][index]);
		}
	});
	it("opens a sealed native run without fetching live results or changing evidence", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		const run = {
			engine: "api",
			runId: "offline-run",
			complete: false,
			at: "2026-10-24T00:00:00Z",
			rows: [{ caseId: "case", instanceId: "one", status: "failed", evidenceComplete: false }],
		};
		f.host.readEvaluationNative.mockResolvedValue(run);
		const collected = await f.request("collect", {
			ref: scored.attemptRef,
			nativeRefs: [{ engine: "api", reference: "offline-run" }],
		});
		const snapshotRef = await f.request("seal", { ref: collected.checkpointRef });
		const checkpoint = await f.request("get", { ref: snapshotRef });
		const records = await Promise.all(checkpoint.data.evidenceRefs.map((ref: any) => f.request("get", { ref })));
		const record = records.find((r: any) => r.data.kind === "native-test-run");
		f.host.readEvaluationNative.mockClear();
		const ref = { kind: record.kind, id: record.id, revision: record.revision };
		const page = await f.request("readEvidence", { ref, evidenceView: "native-run" });
		expect(JSON.parse(page.text)).toEqual(run);
		expect(page.view).toBe("native-run");
		expect(f.host.readEvaluationNative).not.toHaveBeenCalled();
		expect((await f.request("get", { ref })).sourceDigest).toBe(record.sourceDigest);
	});

	it.each(["api", "ui"])(
		"inspects authorized %s native originals with bounded pages and immutable reports",
		async (engine) => {
			const f = fixture(),
				scored = await diagnose(f);
			const run = {
				engine,
				runId: "offline-run",
				complete: false,
				review: "execution-evidence-only",
				at: "2026-10-24T00:00:00Z",
				evidence: [{ path: "qa/ui/runs/offline-run/manifest.json", sha256: "a".repeat(64) }],
				rows: Array.from({ length: 21 }, (_, i) => ({
					caseId: "\u0000".repeat(200),
					instanceId: `i-${i}`,
					status: i ? "SKIP" : "failed",
					evidenceComplete: i !== 0,
				})),
			};
			f.host.readEvaluationNative.mockResolvedValue(run);
			const collected = await f.request("collect", {
				ref: scored.attemptRef,
				nativeRefs: [{ engine, reference: engine === "api" ? run.runId : run.evidence[0] }],
			});
			const snap = await f.request("get", { ref: await f.request("seal", { ref: collected.checkpointRef }) });
			const records = await Promise.all(snap.data.evidenceRefs.map((ref: any) => f.request("get", { ref })));
			const record = records.find((r: any) => r.data.kind === "native-test-run"),
				ref = { kind: record.kind, id: record.id, revision: record.revision };
			const before = await f.request("export", { ref: scored.reportRef });
			f.host.readEvaluationNative.mockClear();
			const first = await f.request("inspectNativeRun", { ref });
			expect(first).toMatchObject({ engine, complete: false, total: 21, offset: 0, nextOffset: 20 });
			expect(first.rows).toHaveLength(20);
			expect(first.rows[0]).toMatchObject({ status: "failed", evidenceComplete: false });
			expect(first.rows[1].status).toBe("SKIP");
			expect(first.rows[0].caseId).toHaveLength(96);
			expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(48 * 1024);
			expect(f.host.readEvaluationNative).toHaveBeenLastCalledWith("owner", {
				conversationId: "conv1",
				sessionId: "session1",
				engine,
				reference: engine === "api" ? run.runId : run.evidence[0],
			});
			expect(await f.request("inspectNativeRun", { ref, offset: 20 })).toMatchObject({
				nextOffset: null,
				rows: [expect.objectContaining({ instanceId: "i-20" })],
			});
			await expect(f.request("inspectNativeRun", { ref, offset: 22 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
			await expect(f.request("inspectNativeRun", { ref }, { ...f.ui, clientId: "other" })).rejects.toMatchObject({
				code: "PERMISSION_DENIED",
			});
			f.host.readEvaluationNative.mockResolvedValue({ ...run, complete: true });
			await expect(f.request("inspectNativeRun", { ref })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
			f.host.readEvaluationNative.mockRejectedValue(new Error("missing original"));
			await expect(f.request("inspectNativeRun", { ref })).rejects.toMatchObject({ code: "EVIDENCE_GAP" });
			expect(await f.request("export", { ref: scored.reportRef })).toEqual(before);
			let release: any;
			f.host.readEvaluationNative.mockImplementation(
				() =>
					new Promise((r) => {
						release = r;
					}),
			);
			const stale = f.request("inspectNativeRun", { ref });
			const originalRead = f.host.readEvaluationEvidence.getMockImplementation();
			f.host.readEvaluationEvidence.mockImplementation((...args: any[]) => ({
				...originalRead(...args),
				sessionId: "changed-session",
			}));
			release(run);
			await expect(stale).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
			f.host.readEvaluationEvidence.mockImplementation(originalRead);
			const pending = f.request("inspectNativeRun", { ref });
			f.service.close();
			release(run);
			await expect(pending).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
		},
	);

	it("preflights installed configuration and bindings without collection, jobs or record changes", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		f.host.readEvaluationArtifact.mockClear();
		const before = await f.request("list", { kind: "evaluations" });
		const configs = {
			F01: {
				checks: [
					{
						conditionId: "artifact",
						path: "result.json",
						format: "json",
						jsonSchema: { type: "object", required: ["ok"] },
					},
				],
			},
		};
		expect(await f.request("validateConfiguration", { ref: scored.reportRef, configs })).toMatchObject({
			valid: true,
			versions: expect.arrayContaining([{ id: "F01", version: "1" }]),
		});
		await expect(f.request("validateConfiguration", { ref: scored.reportRef, configs }, f.tool)).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(
			f.request("validateConfiguration", { ref: scored.reportRef, configs }, { channel: "ui", clientId: "other" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		for (const bad of [
			{ Unknown: {} },
			{ F01: { checks: [{ conditionId: "unknown-condition", path: "result.json" }] } },
			{ F01: { checks: [configs.F01.checks[0], configs.F01.checks[0]] } },
			{ F01: { checks: [{ ...configs.F01.checks[0], jsonSchema: { $ref: "https://example.invalid/schema" } }] } },
			{
				F08: {
					checks: [],
					prices: [
						{
							model: "m",
							provider: "p",
							currency: "USD",
							version: "test",
							inputPerMillion: -1,
							outputPerMillion: 0,
							cacheReadPerMillion: 0,
							cacheWritePerMillion: 0,
						},
					],
					childWaitToolNames: [],
				},
			},
		])
			await expect(f.request("validateConfiguration", { ref: scored.reportRef, configs: bad })).rejects.toMatchObject({
				code: "INVALID_INPUT",
			});
		expect(await f.request("list", { kind: "evaluations" })).toEqual(before);
		expect(f.host.readEvaluationArtifact).not.toHaveBeenCalled();
		expect((await f.request("get", { ref: scored.reportRef })).sourceDigest).toBe(scored.report.sourceDigest);
	});
	it("requires F05 claim and basis references from the selected sealed snapshot", async () => {
		const f = fixture();
		f.contract.conditions.push({ ...f.contract.conditions[0], id: "claim", ruleRef: "F05@1" });
		const scored = await diagnose(f);
		const snapshot = await f.request("get", { ref: scored.snapshotRef });
		const check = {
			conditionId: "claim",
			claimEvidenceId: snapshot.data.evidenceRefs[0].id,
			claimPath: "/ok",
			basisEvidenceId: "foreign-evidence",
			basisPath: "/exists",
			expectedValue: true,
		};
		await expect(
			f.request("validateConfiguration", { ref: scored.reportRef, configs: { F05: { checks: [check] } } }),
		).rejects.toMatchObject({ code: "EVIDENCE_GAP" });
		check.basisEvidenceId = snapshot.data.evidenceRefs[1].id;
		expect(
			await f.request("validateConfiguration", { ref: scored.reportRef, configs: { F05: { checks: [check] } } }),
		).toMatchObject({ valid: true });
	});

	it("observes only the fixed selection, replays starts, stops idempotently and preserves reports", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		const listeners = new Set<(event: any) => void>();
		const off = vi.fn();
		f.host.onRunEvent.mockImplementation((fn: any) => {
			listeners.add(fn);
			return () => {
				listeners.delete(fn);
				off();
			};
		});
		const input = {
			ref: scored.attemptRef,
			watchId: "watch-1",
			requestId: "watch-start",
			artifactPaths: ["result.json"],
		};
		const started = await f.request("watchStart", input);
		expect(started).toMatchObject({
			state: "observing",
			watchId: "watch-1",
			latest: { checkpointRef: { kind: "evidence" } },
		});
		expect(listeners.size).toBe(1);
		expect(await f.request("watchStart", input)).toEqual(started);
		await expect(f.request("watchStart", { ...input, watchId: "changed" })).rejects.toMatchObject({
			code: "VERSION_CONFLICT",
		});
		await expect(f.request("watchStart", { ...input, requestId: "another" })).rejects.toMatchObject({
			code: "IN_PROGRESS",
		});
		await expect(f.request("watchStatus", { watchId: "wrong" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(f.request("watchStop", { watchId: "watch-1" }, f.tool)).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(
			f.request("watchStatus", { watchId: "watch-1" }, { channel: "ui", clientId: "other" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(f.request("watchStatus", { watchId: "watch-1", sessionId: "other" })).rejects.toMatchObject({
			code: "VERSION_CONFLICT",
		});
		const emit = [...listeners][0];
		f.host.readEvaluationArtifact.mockClear();
		emit({ conversationId: "unselected-child", type: "run_end" });
		expect(f.host.readEvaluationArtifact).not.toHaveBeenCalled();
		writeFileSync(join(f.workspace, "result.json"), "invalid JSON");
		f.entries.push({
			id: "new-task",
			parentId: "a1",
			type: "message",
			message: { role: "user", content: "Unselected task" },
		});
		emit({ conversationId: "conv1", type: "run_end" });
		let current: any;
		await vi.waitFor(async () => {
			current = await f.request("watchStatus", { watchId: "watch-1" });
			expect(current.latest.checkpointRef).not.toEqual(started.latest.checkpointRef);
		});
		const stopped = await f.request("watchStop", { watchId: "watch-1" });
		expect(stopped.state).toBe("stopped");
		expect(listeners.size).toBe(0);
		await f.request("watchStop", { watchId: "watch-1" });
		expect(off).toHaveBeenCalledTimes(1);
		f.host.readEvaluationArtifact.mockClear();
		emit({ conversationId: "conv1", type: "run_end" });
		expect(f.host.readEvaluationArtifact).not.toHaveBeenCalled();
		const sealed = await f.request("seal", { ref: stopped.latest.checkpointRef });
		const snapshot = await f.request("get", { ref: sealed });
		expect(snapshot.data.attemptRefs).toEqual([scored.attemptRef]);
		expect((await f.request("get", { ref: scored.reportRef })).sourceDigest).toBe(scored.report.sourceDigest);
		expect((await f.request("list", { kind: "attempts" })).items).toHaveLength(1);
		expect(f.host.readEvaluationNative).not.toHaveBeenCalled();
	});
	it("reports collection faults without inventing a checkpoint and can still stop", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		const off = vi.fn();
		f.host.onRunEvent.mockReturnValue(off);
		vi.spyOn(f.service.collector!, "collect").mockRejectedValue(
			Object.assign(new Error("synthetic disk error"), { code: "IO_ERROR" }),
		);
		const started = await f.request("watchStart", { ref: scored.attemptRef, watchId: "failed" });
		expect(started).toMatchObject({ state: "observing", latest: null, error: { code: "IO_ERROR" } });
		expect((await f.request("watchStop", { watchId: "failed" })).state).toBe("stopped");
		expect(off).toHaveBeenCalledTimes(1);
	});

	it("expires unrenewed listeners, renews status leases and releases all listeners on close", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		const off = vi.fn();
		f.host.onRunEvent.mockReturnValue(off);
		vi.useFakeTimers();
		try {
			await f.request("watchStart", { ref: scored.attemptRef, watchId: "lease" });
			await vi.advanceTimersByTimeAsync(45000);
			expect((await f.request("watchStatus", { watchId: "lease" })).state).toBe("observing");
			await vi.advanceTimersByTimeAsync(45000);
			expect(off).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(15000);
			expect(off).toHaveBeenCalledTimes(1);
			expect((await f.request("watchStatus", { watchId: "lease" })).state).toBe("stopped");
			await f.request("watchStart", { ref: scored.attemptRef, watchId: "replacement" });
			f.service.close();
			expect(off).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(60000);
			expect(off).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("lazily describes the authorized source, records actual SDK version, and never falls back to another owner", async () => {
		const f = fixture();
		const source = await f.request("describe");
		expect(source.clientVersion).toBe("fixture-sdk");
		expect(existsSync(join(f.dir, "agent-evaluation"))).toBe(false);
		await expect(f.request("describe", {}, { channel: "ui", clientId: "other" })).rejects.toThrow(/owner/);
		await expect(f.request("describe", { conversationId: "other" }, f.tool)).rejects.toThrow(/substituted/);
		await expect(f.request("describe", { sessionId: "changed" })).rejects.toThrow(/session changed/);
	});
	it("runs the product contract/collection/scoring flow, replays durable requests, and appends human reviews", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		expect(scored.report.data.findings.find((r: any) => r.ruleId === "F01").verdict).toBe("pass");
		expect(scored.report.data.summary.counts.errors).toBe(0);
		expect(await f.request("createAttempt", { ref: scored.contractRef, requestId: "attach" })).toEqual(
			scored.attemptRef,
		);
		const replay = await f.request("collect", {
			ref: scored.attemptRef,
			artifactPaths: ["result.json"],
			requestId: "collect",
		});
		expect(replay.checkpointRef).toEqual(scored.collected.checkpointRef);
		expect(f.host.readEvaluationArtifact).toHaveBeenCalledTimes(1);
		const data = {
			evaluationRef: scored.reportRef,
			findingId: scored.report.data.findings[0].findingId,
			decision: "inconclusive",
			reason: "Human requires semantic review",
		};
		const review = await f.request("review", { data });
		const revised = await f.request("review", {
			data: { ...data, previousReviewRef: review, decision: "pass", reason: "Human checked the content" },
		});
		expect(revised.id).not.toBe(review.id);
		expect(scored.report.projection).toBe(true);
		expect(scored.report.digest).toBeUndefined();
		const { context } = f.service.authorize(f.ui, { action: "export" });
		const bundle = f.service.store!.export(context, scored.reportRef);
		expect(
			bundle.records
				.filter((r: any) => r.kind === "reviews")
				.map((r: any) => r.id)
				.sort(),
		).toEqual([review.id, revised.id].sort());
		expect((await f.request("list", { kind: "reviews", ref: scored.reportRef })).items[0].review.evaluationRef).toEqual(
			scored.reportRef,
		);
		expect((await f.request("get", { ref: scored.reportRef })).sourceDigest).toBe(scored.report.sourceDigest);
		expect((await f.request("list", { kind: "reviews" })).items).toHaveLength(2);
		await expect(f.request("review", { data }, f.tool)).rejects.toThrow(/human reviews/);
		await expect(f.request("review", { data, human: true }, f.tool)).rejects.toThrow(/Invalid/);
	});
	it("re-scores frozen evidence without collection and diagnoses a separate contract revision", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		const attemptsBefore = await f.request("list", { kind: "attempts" });
		f.host.readEvaluationArtifact.mockClear();
		f.host.readEvaluationEvidence.mockClear();
		const configs = Object.fromEntries(scored.report.data.configuration.rules.map((r: any) => [r.id, r.config]));
		const wait = async (job: any) => {
			let status: any;
			await vi.waitFor(async () => {
				status = await f.request("status", { jobId: job.jobId });
				expect(status.state).toBe("completed");
			});
			return f.request("get", { ref: status.reportRef });
		};
		const rescored = await wait(await f.request("evaluate", { ref: scored.reportRef }));
		expect(rescored.data.configDigest).toBe(scored.report.data.configDigest);
		await expect(f.request("evaluate", { ref: scored.reportRef, configs })).rejects.toThrow(/cannot override/);
		expect(rescored.id).not.toBe(scored.report.id);
		expect(rescored.data.snapshotRef).toEqual(scored.snapshotRef);
		expect(rescored.data.configuration).toEqual(scored.report.data.configuration);
		expect((await f.request("list", { kind: "attempts" })).items).toEqual(attemptsBefore.items);
		expect(f.host.readEvaluationArtifact).not.toHaveBeenCalled();
		expect(f.host.readEvaluationNative).not.toHaveBeenCalled();
		expect(
			f.host.readEvaluationEvidence.mock.calls.filter(([, query]: any[]) => query.mode === "collect"),
		).toHaveLength(0);
		const data = {
			...f.contract,
			objective: "Revised objective",
			conditions: [
				...f.contract.conditions,
				{
					id: "manual",
					statement: "Human must review meaning",
					sourceType: "user",
					sourceRef: "human-ui",
					required: true,
					applicableWhen: "always",
				},
			],
		};
		const revised = await f.request("reviseContract", { previousRef: scored.contractRef, data });
		expect(revised).toEqual({ ...scored.contractRef, revision: 2 });
		await expect(f.request("reviseContract", { previousRef: scored.contractRef, data })).rejects.toThrow(/stale/);
		const attempt = await f.request("createAttempt", { ref: revised });
		expect(attempt.id).not.toBe(scored.attemptRef.id);
		const collected = await f.request("collect", { ref: attempt, artifactPaths: ["result.json"] });
		const snapshot = await f.request("seal", { ref: collected.checkpointRef });
		const newReport = await wait(await f.request("evaluate", { ref: snapshot, configs }));
		expect(newReport.data.contractRef).toEqual(revised);
		expect(newReport.data.snapshotRef).not.toEqual(scored.snapshotRef);
		expect(newReport.data.findings.some((r: any) => r.conditionId === "manual" && r.verdict === "inconclusive")).toBe(
			true,
		);
		expect((await f.request("get", { ref: scored.reportRef })).sourceDigest).toBe(scored.report.sourceDigest);
		expect((await f.request("get", { ref: scored.contractRef })).data.objective).toBe(f.contract.objective);
		expect(f.host.readEvaluationArtifact).toHaveBeenCalledTimes(1);
	});
	it("keeps newly bound conditions unknown until explicit checks are configured on the revised snapshot", async () => {
		const f = fixture();
		(f.contract.conditions as any[]).push({
			id: "new-bound",
			statement: "result.json exists at observation time",
			sourceRef: "u1",
			sourceType: "proposed",
			required: false,
			applicableWhen: "always",
		});
		const original = await diagnose(f);
		f.host.readEvaluationArtifact.mockClear();
		const data = {
			...f.contract,
			conditions: [
				f.contract.conditions[0],
				{
					...f.contract.conditions[1],
					ruleRef: "F01@1",
					sourceType: "user",
					sourceRef: "human-ui:proposal",
					required: true,
				},
				{
					id: "wall",
					statement: "Agent wall time within the confirmed limit",
					sourceType: "user",
					sourceRef: "human-ui:wall",
					required: true,
					applicableWhen: "always",
					ruleRef: "F08@1",
				},
			],
		};
		const contractRef = await f.request("reviseContract", { previousRef: original.contractRef, data });
		const attemptRef = await f.request("createAttempt", { ref: contractRef });
		const collected = await f.request("collect", { ref: attemptRef, artifactPaths: ["result.json"] });
		const snapshotRef = await f.request("seal", { ref: collected.checkpointRef });
		const wait = async (job: any) => {
			let status: any;
			await vi.waitFor(async () => {
				status = await f.request("status", { jobId: job.jobId });
				expect(status.state).toBe("completed");
			});
			return f.request("get", { ref: status.reportRef });
		};
		const configs = Object.fromEntries(
			original.report.data.configuration.rules.map((r: any) => [r.id, structuredClone(r.config)]),
		);
		const unconfigured = await wait(await f.request("evaluate", { ref: snapshotRef, configs }));
		for (const id of ["new-bound", "wall"])
			expect(unconfigured.data.findings.find((r: any) => r.conditionId === id).verdict).toBe("inconclusive");
		configs.F01.checks.push({ conditionId: "new-bound", path: "result.json" });
		configs.F08.checks.push({ conditionId: "wall", maxAgentWallMs: 0 });
		expect(
			await f.request("validateConfiguration", {
				ref: { kind: "evaluations", id: unconfigured.id, revision: unconfigured.revision },
				configs,
			}),
		).toMatchObject({ valid: true });
		const configured = await wait(await f.request("evaluate", { ref: snapshotRef, configs }));
		expect(configured.data.findings.find((r: any) => r.conditionId === "new-bound").verdict).toBe("pass");
		expect(configured.data.findings.find((r: any) => r.conditionId === "wall").verdict).toBe("inconclusive");
		expect(configured.data.snapshotRef).toEqual(unconfigured.data.snapshotRef);
		expect(configured.data.contractRef).toEqual(contractRef);
		expect((await f.request("list", { kind: "attempts" })).items).toHaveLength(2);
		expect(f.host.readEvaluationArtifact).toHaveBeenCalledTimes(1);
		expect(f.host.readEvaluationNative).not.toHaveBeenCalled();
		expect((await f.request("get", { ref: original.reportRef })).sourceDigest).toBe(original.report.sourceDigest);
		expect((await f.request("get", { ref: original.contractRef })).data.conditions[1].ruleRef).toBeUndefined();
	});

	it("restores the exact saved profile after restart and refuses missing or unavailable versions", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		const context = f.service.authorize(f.ui, {}).context;
		const persist = (data: any, requestId: string) => {
			const record = f.service.store!.write(context, { kind: "evaluations", data, requestId });
			return { kind: record.kind, id: record.id, revision: record.revision };
		};
		const { configuration: _configuration, ...legacyData } = scored.report.data;
		const legacy = persist(legacyData, "legacy-no-config");
		const configuration = {
			...scored.report.data.configuration,
			profileId: `internal-${"f".repeat(55)}`,
			rules: scored.report.data.configuration.rules.map((r: any) => (r.id === "F01" ? { ...r, version: "999" } : r)),
		};
		const unavailable = persist(
			{
				...scored.report.data,
				configuration,
				profileVersion: `${configuration.profileId}@${configuration.profileVersion}`,
				configDigest: digest(configuration),
				evaluatorVersions: { ...scored.report.data.evaluatorVersions, F01: "999" },
			},
			"missing-version",
		);
		const changed = persist({ ...scored.report.data, configuration }, "mismatched-config-digest");
		f.service.close();
		const restarted = new EvaluationService(f.host);
		cleanup.push(() => restarted.close());
		let sequence = 0;
		const request = (action: string, data: any) =>
			restarted.dispatch(f.ui, { action, requestId: `restart-${++sequence}`, ...data });
		await expect(request("evaluate", { ref: legacy })).rejects.toMatchObject({ code: "EVIDENCE_GAP" });
		await expect(request("evaluate", { ref: unavailable })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
		await expect(request("evaluate", { ref: changed })).rejects.toMatchObject({ code: "STORE_CORRUPT" });
		const job = await request("evaluate", { ref: scored.reportRef });
		let status: any;
		await vi.waitFor(async () => {
			status = await request("status", { jobId: job.jobId });
			expect(status.state).toBe("completed");
		});
		const report = await request("get", { ref: status.reportRef });
		expect(report.data.configuration).toEqual(scored.report.data.configuration);
		expect(report.data.configDigest).toBe(scored.report.data.configDigest);
		expect(report.data.snapshotRef).toEqual(scored.snapshotRef);
	});
	it("stops only the disabled client's scoring and observation, then permits explicit re-enable", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		const read = f.host.readEvaluationEvidence.getMockImplementation();
		const disabled = new Set<string>();
		f.host.readEvaluationEvidence.mockImplementation((clientId: string, query: any) => {
			if (disabled.has(clientId)) throw Object.assign(new Error("Disabled"), { code: "CAPABILITY_UNAVAILABLE" });
			return { ...read("owner", query), principalId: clientId };
		});
		const other = { channel: "ui", clientId: "second" };
		const secondContract = await f.request("createContract", { data: f.contract }, other);
		const secondAttempt = await f.request("createAttempt", { ref: secondContract }, other);
		const secondCollected = await f.request("collect", { ref: secondAttempt }, other);
		const secondSnapshot = await f.request("seal", { ref: secondCollected.checkpointRef }, other);
		await f.request("watchStart", { ref: scored.attemptRef, watchId: "first-watch" });
		await f.request("watchStart", { ref: secondAttempt, watchId: "second-watch" }, other);
		const evaluator = f.service.registry.evaluator.bind(f.service.registry),
			original = evaluator("F01", "1");
		const calls: Array<{ signal: AbortSignal; release: (v: any) => void }> = [];
		vi.spyOn(f.service.registry, "evaluator").mockImplementation((id: string, version: string) =>
			id === "F01"
				? {
						...original,
						evaluate: (_c: any, _v: any, _cfg: any, signal: AbortSignal) =>
							new Promise((resolve) => calls.push({ signal, release: resolve })),
					}
				: evaluator(id, version),
		);
		const first = await f.request("evaluate", { ref: scored.snapshotRef });
		const second = await f.request("evaluate", { ref: secondSnapshot }, other);
		await vi.waitFor(() => expect(calls).toHaveLength(2));
		disabled.add("owner");
		f.service.stopClient("owner");
		f.service.stopClient("owner");
		expect(calls[0].signal.aborted).toBe(true);
		expect(calls[1].signal.aborted).toBe(false);
		expect(f.service.watches.get("owner").stopped).toBe(true);
		expect(f.service.watches.get("second").stopped).toBe(false);
		await expect(f.request("evaluate", { ref: scored.snapshotRef })).rejects.toMatchObject({
			code: "CAPABILITY_UNAVAILABLE",
		});
		disabled.delete("owner");
		await vi.waitFor(async () => expect((await f.request("status", { jobId: first.jobId })).state).toBe("cancelled"));
		const cancelled = await f.request("status", { jobId: first.jobId });
		calls[0].release([]);
		calls[1].release([]);
		await vi.waitFor(async () =>
			expect((await f.request("status", { jobId: second.jobId }, other)).state).toBe("completed"),
		);
		expect(await f.request("status", { jobId: first.jobId })).toEqual(cancelled);
		expect((await f.request("watchStart", { ref: scored.attemptRef, watchId: "re-enabled" })).state).toBe("observing");
		expect(f.service.closed).toBe(false);
	});
	it.each(["queued", "running"])(
		"seals %s scoring cancellation before synchronous plugin shutdown releases the store",
		async (phase) => {
			const f = fixture(),
				scored = await diagnose(f);
			const evaluator = f.service.registry.evaluator.bind(f.service.registry),
				original = evaluator("F01", "1");
			let release: any, ruleSignal: AbortSignal | undefined;
			vi.spyOn(f.service.registry, "evaluator").mockImplementation((id: string, version: string) =>
				id === "F01"
					? {
							...original,
							evaluate: (_c: any, _v: any, _cfg: any, signal: AbortSignal) => {
								ruleSignal = signal;
								return new Promise((r) => {
									release = r;
								});
							},
						}
					: evaluator(id, version),
			);
			const old = await f.request("get", { ref: scored.reportRef });
			// Direct start holds queued work in this stack; service dispatch would yield to its microtask.
			const { context } = f.service.authorize(f.ui, { action: "evaluate" });
			const job = f.service.engine!.start(context, {
				snapshotRef: scored.snapshotRef,
				profileId: "internal",
				profileVersion: "1",
				requestId: `shutdown-${phase}`,
			});
			if (phase === "running") await vi.waitFor(() => expect(release).toBeTypeOf("function"));
			f.service.close();
			expect(f.service.store!.closed).toBe(true);
			const report = await job.done;
			expect(report.data).toMatchObject({
				state: "cancelled",
				assessmentStage: "provisional",
				job: { cancellationRequestedAt: expect.any(String), cancellationConfirmedAt: expect.any(String) },
			});
			if (phase === "running") expect(ruleSignal?.aborted).toBe(true);
			else expect(ruleSignal).toBeUndefined();
			const restarted = new EvaluationService(f.host);
			cleanup.push(() => restarted.close());
			const read = (action: string, extra: any) =>
				restarted.dispatch(f.ui, { action, requestId: `reopen-${action}`, ...extra });
			expect(await read("status", { jobId: job.jobId })).toMatchObject({
				state: "cancelled",
				reportRef: { id: report.id },
			});
			expect((await read("get", { ref: scored.reportRef })).sourceDigest).toBe(old.sourceDigest);
			const before = await read("list", { kind: "evaluations" });
			release?.([]);
			await new Promise((r) => setTimeout(r, 10));
			expect(await read("list", { kind: "evaluations" })).toEqual(before);
			await expect(f.request("evaluate", { ref: scored.snapshotRef })).rejects.toMatchObject({
				code: "CAPABILITY_UNAVAILABLE",
			});
		},
	);

	it("keeps Agent conditions proposed and rejects unverified message boundaries", async () => {
		const f = fixture();
		await expect(f.request("createContract", { data: f.contract }, f.tool)).rejects.toThrow(/proposals/);
		const proposed = {
			...f.contract,
			conditions: f.contract.conditions.map((c) => ({ ...c, sourceType: "proposed", required: false })),
		};
		expect((await f.request("createContract", { data: proposed }, f.tool)).kind).toBe("contracts");
		await expect(
			f.request("createContract", {
				data: { ...f.contract, scope: { ...f.contract.scope, startMessageId: "missing" } },
			}),
		).rejects.toThrow(/boundaries/);
	});
	it("exports bounded redacted chunks, rejects forged source events, and stops after unload", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		let text = "",
			offset: any = 0,
			manifestDigest: any;
		do {
			const page = await f.request("export", { ref: scored.reportRef, offset });
			manifestDigest ??= page.manifestDigest;
			expect(page.manifestDigest).toBe(manifestDigest);
			expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(48 * 1024);
			text += page.text;
			offset = page.nextOffset;
		} while (offset !== null);
		expect(text).not.toContain("synthetic-secret");
		expect(JSON.parse(text).manifestDigest).toBe(manifestDigest);
		await expect(f.request("collect", { ref: scored.attemptRef, liveEvents: [{ type: "tool_end" }] })).rejects.toThrow(
			/Invalid/,
		);
		f.service.close();
		await expect(f.request("list")).rejects.toThrow(/stopped/);
	});
	it("registers the real tool and enforces query/write gates on retained host definitions", async () => {
		const f = fixture();
		const registered: any[] = [];
		f.host.registerAgentTool = (tool: any) => {
			registered.push({ ...tool, pluginId: "agent-evaluation" });
			return () => registered.splice(0);
		};
		f.host.onMessage = () => () => {};
		f.host.sendTo = vi.fn();
		const stop = plugin.activate(f.host);
		cleanup.push(stop);
		const conv: any = {
			id: "conv1",
			cwd: f.workspace,
			session: {},
			agentPreset: "standard",
			planMode: false,
			delegateMode: false,
			permissionPreset: "read-only",
		};
		const owner: any = {
			clientId: "owner",
			convs: new Map([[conv.id, conv]]),
			settingsSvc: { current: { disabledPlugins: [], disabledPluginTools: [] } },
			pluginToolsProvider: () => registered,
			goalReviewTurnOf: () => false,
		};
		const tool = (ClientSession.prototype as any).enabledPluginToolDefs.call(owner, "standard", conv.id)[0];
		expect((await tool.execute("read", { action: "describe", requestId: "describe" })).isError).not.toBe(true);
		await expect(
			tool.execute("write", { action: "createContract", requestId: "write", data: f.contract }),
		).rejects.toThrow(/read-only/);
		conv.permissionPreset = "workspace-write-never";
		conv.planMode = true;
		await expect(
			tool.execute("write", { action: "createContract", requestId: "write", data: f.contract }),
		).rejects.toThrow(/blocked/);
		conv.planMode = false;
		conv.delegateMode = true;
		await expect(tool.execute("write", { action: "collect", requestId: "collect" })).rejects.toThrow(/blocked/);
		conv.delegateMode = false;
		owner.settingsSvc.current.disabledPlugins = ["agent-evaluation"];
		await expect(tool.execute("read", { action: "describe", requestId: "disabled" })).rejects.toThrow(/disabled/);
	});
});

async function uploadFixture(f: ReturnType<typeof fixture>, requestId = "upload-fixture") {
	const raw = JSON.stringify({
		schema_version: "ATIF-v1.8",
		session_id: "untrusted-external",
		agent: { name: "offline-fixture", version: "claimed" },
		steps: [
			{ step_id: 1, source: "user", message: "Check fixture" },
			{
				step_id: 2,
				source: "agent",
				message: "All pass",
				tool_calls: [
					{ tool_call_id: "t1", function_name: "never-run", arguments: { password: "unredacted-private-fixture" } },
				],
			},
		],
	});
	const upload = await f.request("uploadStart", {
		requestId,
		data: { byteLength: Buffer.byteLength(raw), sha256: createHash("sha256").update(raw).digest("hex") },
	});
	await f.request("uploadChunk", {
		data: { uploadId: upload.uploadId, offset: 0, base64: Buffer.from(raw).toString("base64") },
	});
	return { raw, uploadId: upload.uploadId };
}
describe("EC05 offline service", () => {
	it("requires human confirmation, freezes the host scope and reuses the existing report engine", async () => {
		const f = fixture(),
			uploaded = await uploadFixture(f);
		const { scope: _scope, ...contract } = f.contract;
		const data = { uploadId: uploaded.uploadId, contract, trajectoryPointers: ["#"], confirmed: true };
		await expect(f.request("createImportContract", { data: { ...data, confirmed: false } })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(f.request("createImportContract", { data: { ...data, contract: f.contract } })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(
			f.request("createImportContract", { data: { ...data, trajectoryPointers: ["#/missing"] } }),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		const contractRef = await f.request("createImportContract", { requestId: "confirmed-contract", data });
		expect(await f.request("createImportContract", { requestId: "confirmed-contract", data })).toEqual(contractRef);
		const frozen = await f.request("get", { ref: contractRef });
		expect(frozen.data.scope).toMatchObject({ source: "offline", sessionId: "session1", trajectoryPointers: ["#"] });
		await expect(f.request("createContract", { data: frozen.data })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(
			f.request("importAtif", { ref: contractRef, data: { uploadId: uploaded.uploadId } }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		const input = {
			ref: contractRef,
			data: {
				uploadId: uploaded.uploadId,
				confirmed: true,
				sourceDeclaration: "Human-uploaded synthetic fixture; unverified",
			},
		};
		const imported = await f.request("importAtif", input);
		expect(await f.request("importAtif", input)).toEqual(imported);
		expect((await f.request("get", { ref: imported.attemptRef })).data.state).toBe("unknown");
		const job = await f.request("evaluate", { ref: imported.snapshotRef });
		let status: any;
		await vi.waitFor(async () => {
			status = await f.request("status", { jobId: job.jobId });
			expect(status.state).toBe("completed");
		});
		expect((await f.request("get", { ref: status.reportRef })).data.assessmentStage).toBe("provisional");
		const reports = await f.request("list");
		expect(reports.items[0].taskRange.source).toBe("offline");
		expect(reports.items[0].sourceVersion).toBe("unknown");
		expect((await f.request("readOriginal", { ref: imported.sourceRef })).text).toBe(uploaded.raw);
		expect(JSON.stringify(await f.request("export", { ref: status.reportRef }))).not.toContain(
			"unredacted-private-fixture",
		);
		expect(f.host.readEvaluationEvidence.mock.calls.every((call: any[]) => call[1].mode === "describe")).toBe(true);
		expect(f.host.readEvaluationArtifact).not.toHaveBeenCalled();
		expect(f.host.readEvaluationNative).not.toHaveBeenCalled();
		for (const action of [
			"uploadStart",
			"uploadChunk",
			"uploadPreview",
			"uploadDiscard",
			"createImportContract",
			"importAtif",
			"readOriginal",
		])
			await expect(
				f.request(action, { ref: imported.sourceRef, data: { uploadId: uploaded.uploadId } }, f.tool),
			).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(
			f.request("readOriginal", { ref: imported.sourceRef }, { channel: "ui", clientId: "other" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		f.service.stopClient("owner");
		await expect(f.request("uploadPreview", { data: { uploadId: uploaded.uploadId } })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		f.service.close();
		const restarted = new EvaluationService(f.host);
		cleanup.push(() => restarted.close());
		const request = (action: string, extra: any = {}) =>
			restarted.dispatch(f.ui, { action, requestId: "restart", ...extra });
		expect((await request("readOriginal", { ref: imported.sourceRef })).text).toBe(uploaded.raw);
		expect((await request("get", { ref: status.reportRef })).data.assessmentStage).toBe("provisional");
		const reuploaded = await uploadFixture({ ...f, request }, "restart-upload");
		expect(
			await request("importAtif", {
				ref: contractRef,
				data: {
					uploadId: reuploaded.uploadId,
					confirmed: true,
					sourceDeclaration: "Human-uploaded synthetic fixture; unverified",
				},
			}),
		).toEqual(imported);
		expect((await request("list")).items).toHaveLength(1);
		expect(await request("uploadDiscard")).toEqual({ discarded: true });
		expect(await request("uploadDiscard")).toEqual({ discarded: true });
	});
	it("retains the normal request cap and isolates preview from persistent record creation", async () => {
		const f = fixture(),
			uploaded = await uploadFixture(f);
		const preview = await f.request("uploadPreview", { data: { uploadId: uploaded.uploadId } });
		expect(preview).toMatchObject({ origin: "target-reported", eventCount: 2 });
		expect((await f.request("list", { kind: "contracts" })).items).toEqual([]);
		expect(JSON.stringify(preview)).not.toContain("unredacted-private-fixture");
		await expect(
			f.request("uploadChunk", { data: { uploadId: uploaded.uploadId, base64: "x".repeat(128 * 1024) } }),
		).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
		expect(await f.request("uploadDiscard", { data: { uploadId: uploaded.uploadId } })).toEqual({ discarded: true });
		await expect(f.request("uploadPreview", { data: { uploadId: uploaded.uploadId } })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
	});
});
