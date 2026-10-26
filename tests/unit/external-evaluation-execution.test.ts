import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EvaluationStore } from "../../plugins/agent-evaluation/store.mjs";
import { EvidenceCollector } from "../../plugins/agent-evaluation/collect.mjs";
import { ExternalEvaluationExecution } from "../../server/external-evaluation-execution.js";

const fake = vi.hoisted(() => ({ records: new Map<string, any>(), starts: 0, cleanups: 0 }));
vi.mock("../../server/external-evaluation-runtime.js", () => {
	const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
	return {
		offlineExecutionConfiguration: (backend: any, timeoutMs: number, graceMs: number, guest: any) => ({
			backend,
			timeoutMs,
			graceMs,
			guest,
			fingerprint: sha({ backend, timeoutMs, graceMs, guest }),
		}),
		ExternalEvaluationRuntime: class {
			constructor(
				_root: string,
				private owner: string,
			) {}
			prepare(id: string, backend: any, timeoutMs: number, graceMs: number, guest: any) {
				const fingerprint = sha({ backend, timeoutMs, graceMs, guest });
				if (!fake.records.has(id))
					fake.records.set(id, { fingerprint, owner: this.owner, state: "prepared", stopConfirmed: true });
			}
			configurationFingerprint(id: string) {
				const row = fake.records.get(id);
				if (row.owner !== this.owner) throw Object.assign(new Error("Owner"), { code: "PERMISSION_DENIED" });
				return row.fingerprint;
			}
			async start(id: string) {
				const row = fake.records.get(id);
				if (!row.launched) {
					row.launched = true;
					fake.starts++;
					row.state = "running";
					row.stopConfirmed = false;
				}
			}
			async status(id: string) {
				return { ...fake.records.get(id) };
			}
			async cancel(id: string) {
				const row = fake.records.get(id);
				Object.assign(row, { state: "cancelled", stopConfirmed: true, noEnvironmentStarted: !row.launched });
			}
			async terminalEvidence(id: string) {
				const row = fake.records.get(id);
				if (!row.stopConfirmed) throw Object.assign(new Error("Unconfirmed"), { code: "EXECUTION_UNKNOWN" });
				return {
					fingerprint: row.fingerprint,
					state: row.state,
					stopConfirmed: true,
					noEnvironmentStarted: row.noEnvironmentStarted === true,
					observedAt: "2026-10-26T10:00:00Z",
					reportedExit: 0,
					logs: row.noEnvironmentStarted
						? []
						: [
								{
									channel: "stdout",
									sha256: "a".repeat(64),
									storedBytes: 3,
									observedBytes: 3,
									droppedBytes: 0,
									streamEnded: true,
									gaps: [],
									redaction: [],
									text: "{}\n",
								},
							],
				};
			}
			async cleanup() {
				fake.cleanups++;
				return { released: true, evidenceRetained: true };
			}
		},
	};
});
const dirs: string[] = [],
	stores: EvaluationStore[] = [];
afterEach(() => {
	for (const store of stores.splice(0)) store.close();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	fake.records.clear();
	fake.starts = 0;
	fake.cleanups = 0;
});
const refOf = (r: any) => ({ kind: r.kind, id: r.id, revision: r.revision });
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "execution-store-unit-"));
	dirs.push(dir);
	const ctx: any = {},
		identity: any = {
			domain: { principalId: "user", workspaceId: "project" },
			sessionIds: ["s1"],
			allowWrite: true,
			allowExecution: true,
		};
	const identities = new WeakMap<object, any>([[ctx, identity]]);
	const store = new EvaluationStore({ dataDir: dir, authorize: (context: object) => identities.get(context) });
	stores.push(store);
	const contract = store.write(ctx, {
		kind: "contracts",
		requestId: "contract",
		data: {
			scope: {
				source: "pi",
				sessionId: "s1",
				startMessageId: "m1",
				endMessageId: "m1",
				boundaryPrecision: "exact",
				childPolicy: "exclude",
				childSessionIds: [],
			},
			objective: "Check fixture",
			conditions: [],
			constraints: [],
			environmentRefs: [],
			provenance: "user:m1",
			evaluationSubject: "agent-task",
		},
	});
	const bridge = new ExternalEvaluationExecution(store, dir);
	const input: any = {
		requestId: "prepare",
		contractRef: refOf(contract),
		backend: { version: "vz-offline-1" },
		guest: {
			version: "ae-offline-fake-cli-1",
			target: { sha256: "a".repeat(64) },
			runner: {},
			argv: ["echo"],
			stdinBase64: "",
		},
		timeoutMs: 5000,
		graceMs: 100,
	};
	return { dir, ctx, identity, identities, store, bridge, input };
}
describe("offline execution unified-store bridge", () => {
	it("requires a trusted execution grant separately from local writes and ignores spoofed context flags", () => {
		const f = fixture();
		delete f.identity.allowExecution;
		f.ctx.allowExecution = true;
		expect(() => f.bridge.prepare(f.ctx, f.input)).toThrow("Separate trusted execution");
		expect(fake.records.size).toBe(0);
		expect(f.store.list(f.ctx, { kind: "attempts" }).items).toHaveLength(0);
	});
	it("freezes one target and attempt per request, rejects changed input, and never claims an SDK execution session", () => {
		const f = fixture(),
			a = f.bridge.prepare(f.ctx, f.input);
		expect(f.bridge.prepare(f.ctx, f.input)).toEqual(a);
		const record = f.store.get(f.ctx, a);
		expect(record.data).not.toHaveProperty("sourceSessionId");
		expect(f.store.get(f.ctx, record.data.targetRef).data.kind).toBe("cli");
		expect(fake.starts).toBe(0);
		expect(() => f.bridge.prepare(f.ctx, { ...f.input, timeoutMs: 9000 })).toThrow("different input");
	});
	it("recovers latest revisions from a stale handle after store reopen and does not launch again", async () => {
		const f = fixture(),
			a = f.bridge.prepare(f.ctx, f.input);
		await f.bridge.start(f.ctx, a);
		f.store.close();
		const reopened = new EvaluationStore({ dataDir: f.dir, authorize: (context: object) => f.identities.get(context) });
		stores.push(reopened);
		const bridge = new ExternalEvaluationExecution(reopened, f.dir);
		expect((await bridge.start(f.ctx, a)).state).toBe("running");
		expect(fake.starts).toBe(1);
		Object.assign(fake.records.get(a.id), { state: "ended", stopConfirmed: true });
		const done = await bridge.status(f.ctx, a);
		expect(done.state).toBe("ended");
		expect(done.attemptRef.revision).toBeGreaterThan(a.revision);
		await bridge.start(f.ctx, a);
		expect(fake.starts).toBe(1);
	});
	it("denies a different identity, session selection and revoked execution grant before control effects", async () => {
		const f = fixture(),
			a = f.bridge.prepare(f.ctx, f.input),
			foreign = {};
		f.identities.set(foreign, { ...f.identity, domain: { ...f.identity.domain, principalId: "other" } });
		await expect(f.bridge.start(foreign, a)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		f.identity.sessionIds = ["other-session"];
		await expect(f.bridge.cancel(f.ctx, a)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		f.identity.sessionIds = ["s1"];
		f.identity.allowExecution = false;
		await expect(f.bridge.start(f.ctx, a)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(fake.starts).toBe(0);
		expect(fake.records.get(a.id).state).toBe("prepared");
	});
	it("keeps natural VM shutdown running until ended, without manufacturing a cancellation or reconciliation requirement", async () => {
		const f = fixture(),
			a = f.bridge.prepare(f.ctx, f.input);
		await f.bridge.start(f.ctx, a);
		Object.assign(fake.records.get(a.id), { state: "cancelling", stopReason: "ended", stopConfirmed: false });
		expect((await f.bridge.status(f.ctx, a)).state).toBe("running");
		Object.assign(fake.records.get(a.id), { state: "ended", stopConfirmed: true });
		expect((await f.bridge.status(f.ctx, a)).state).toBe("ended");
		expect(f.identity.reconciled).toBeUndefined();
	});

	it("persists unknown, denies replay and requires trusted reconciliation rather than a context flag", async () => {
		const f = fixture(),
			a = f.bridge.prepare(f.ctx, f.input);
		await f.bridge.start(f.ctx, a);
		Object.assign(fake.records.get(a.id), { state: "unknown" });
		expect((await f.bridge.status(f.ctx, a)).state).toBe("unknown");
		await expect(f.bridge.start(f.ctx, a)).rejects.toMatchObject({ code: "EXECUTION_UNKNOWN" });
		Object.assign(fake.records.get(a.id), { state: "ended", stopConfirmed: true });
		f.ctx.reconciled = true;
		await expect(f.bridge.status(f.ctx, a)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		f.identity.reconciled = true;
		expect((await f.bridge.status(f.ctx, a)).state).toBe("ended");
		expect(fake.starts).toBe(1);
	});
	it.each(["blocked", "start-failed"])(
		"reconciles an unknown no-start result to %s only under the trusted grant",
		async (state) => {
			const f = fixture(),
				a = f.bridge.prepare(f.ctx, f.input);
			Object.assign(fake.records.get(a.id), { state: "unknown", stopConfirmed: false });
			await f.bridge.status(f.ctx, a);
			Object.assign(fake.records.get(a.id), { state, stopConfirmed: true, noEnvironmentStarted: true });
			await expect(f.bridge.status(f.ctx, a)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
			f.identity.reconciled = true;
			expect((await f.bridge.status(f.ctx, a)).state).toBe(state);
		},
	);
	it("cancels before start without an invented running revision and releases only after sealing", async () => {
		const f = fixture(),
			a = f.bridge.prepare(f.ctx, f.input);
		expect((await f.bridge.cancel(f.ctx, a)).state).toBe("cancelled");
		const cleanup = await f.bridge.cleanup(f.ctx, a);
		expect(cleanup.released).toBe(true);
		expect(fake.starts).toBe(0);
		const snapshot = f.store.get(f.ctx, cleanup.snapshotRef);
		expect(snapshot.data.coverage).toBe("partial");
		expect(snapshot.data.evidenceRefs).toHaveLength(1);
		expect(f.store.list(f.ctx, { kind: "attempts" }).items).toHaveLength(3);
	});
	it.each(["cancelled", "timed-out"])("links confirmed %s through the existing transition graph", async (state) => {
		const f = fixture(),
			a = f.bridge.prepare(f.ctx, f.input);
		await f.bridge.start(f.ctx, a);
		Object.assign(fake.records.get(a.id), { state, stopConfirmed: true });
		expect((await f.bridge.status(f.ctx, a)).state).toBe(state);
	});
	it("keeps raw-log claims separate from business success, seals idempotently and retains missing verifier gaps", async () => {
		const f = fixture(),
			a = f.bridge.prepare(f.ctx, f.input);
		await f.bridge.start(f.ctx, a);
		await expect(f.bridge.cleanup(f.ctx, a)).rejects.toMatchObject({ code: "EXECUTION_UNKNOWN" });
		expect(fake.cleanups).toBe(0);
		Object.assign(fake.records.get(a.id), { state: "ended", stopConfirmed: true });
		const snapshot = await f.bridge.seal(f.ctx, a),
			saved = f.store.get(f.ctx, snapshot);
		expect(await f.bridge.seal(f.ctx, a)).toEqual(snapshot);
		expect(saved.data.gaps).toContain("independent-verifier-unavailable");
		const evidence = saved.data.evidenceRefs.map((ref: any) => f.store.get(f.ctx, ref));
		expect(evidence.map((r: any) => r.data.origin)).toEqual(["harness-observed", "target-reported"]);
		expect(f.store.readBlob(evidence[0])).toContain('"businessSuccess":"unverified"');
		expect(f.store.list(f.ctx, { kind: "evaluations" }).items).toHaveLength(0);
	});
	it("retains admission if unified evidence publication fails and resumes without duplicating earlier evidence", async () => {
		const f = fixture(),
			a = f.bridge.prepare(f.ctx, f.input);
		await f.bridge.start(f.ctx, a);
		Object.assign(fake.records.get(a.id), { state: "ended", stopConfirmed: true });
		const write = f.store.write.bind(f.store);
		let once = true;
		vi.spyOn(f.store, "write").mockImplementation((context: any, input: any) => {
			if (input.kind === "snapshots" && once) {
				once = false;
				throw Object.assign(new Error("disk"), { code: "IO_ERROR" });
			}
			return write(context, input);
		});
		await expect(f.bridge.cleanup(f.ctx, a)).rejects.toMatchObject({ code: "IO_ERROR" });
		expect(fake.cleanups).toBe(0);
		expect(f.store.list(f.ctx, { kind: "evidence" }).items).toHaveLength(2);
		await f.bridge.cleanup(f.ctx, a);
		expect(fake.cleanups).toBe(1);
		expect(f.store.list(f.ctx, { kind: "evidence" }).items).toHaveLength(2);
	});
	it("rejects SDK history collection on an external attempt before reading a source or writing evidence", async () => {
		const f = fixture(),
			a = f.bridge.prepare(f.ctx, f.input),
			read = vi.fn();
		const collector = new EvidenceCollector(f.store, { readEvaluationEvidence: read });
		await expect(
			collector.collect(f.ctx, { attemptRef: a, conversationId: "owned", requestId: "collect" }),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		expect(read).not.toHaveBeenCalled();
		expect(f.store.list(f.ctx, { kind: "evidence" }).items).toHaveLength(0);
	});
});
