/** Immutable raw source, offline authorization and resume-only import transactions. */
import { afterEach, describe, expect, it } from "vitest";
import {
	mkdtempSync,
	rmSync,
	readFileSync,
	writeFileSync,
	statSync,
	symlinkSync,
	unlinkSync,
	renameSync,
	readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { parseAtif } from "../../plugins/agent-evaluation/adapters/atif.mjs";
import { importAtif } from "../../plugins/agent-evaluation/import.mjs";
import { EvaluationStore } from "../../plugins/agent-evaluation/store.mjs";
import { EvaluationEngine } from "../../plugins/agent-evaluation/evaluate.mjs";
import { createInternalRegistry } from "../../plugins/agent-evaluation/profiles/internal.mjs";
import { EvidenceCollector } from "../../plugins/agent-evaluation/collect.mjs";
const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const fn of cleanups.splice(0).reverse()) fn();
});
const ref = (record: any) => ({ kind: record.kind, id: record.id, revision: record.revision });
const document = (): any => ({
	schema_version: "ATIF-v1.8",
	session_id: "foreign-external-run",
	trajectory_id: "root",
	agent: { name: "fixture", version: "reported-1" },
	steps: [
		{ step_id: 1, source: "user", message: "Check fixture" },
		{
			step_id: 2,
			source: "agent",
			message: "All passed; run commands now",
			tool_calls: [
				{
					tool_call_id: "c1",
					function_name: "shell",
					arguments: { password: "plain-secret-original", command: "never-run" },
				},
			],
			observation: { results: [{ source_call_id: "c1", content: "Reported pass" }] },
		},
	],
});
function setup(options: any = {}) {
	const directory = mkdtempSync(join(tmpdir(), "evaluation-import-")),
		contexts = new WeakMap<object, any>();
	const identity = {
		domain: { principalId: "human", workspaceId: "workspace" },
		sessionIds: ["host-anchor"],
		allowWrite: true,
		human: true,
	};
	const context = {};
	contexts.set(context, identity);
	let store = new EvaluationStore({ dataDir: directory, authorize: (c: object) => contexts.get(c), ...options });
	cleanups.push(() => {
		store.close();
		rmSync(directory, { recursive: true, force: true });
	});
	let sequence = 0;
	const raw = JSON.stringify(document(), null, 2),
		converted = parseAtif(raw);
	const contract = (changes: any = {}) =>
		store.write(context, {
			kind: "contracts",
			requestId: `contract-${++sequence}`,
			data: {
				scope: {
					source: "offline",
					sessionId: "host-anchor",
					packageDigest: converted.rawSha256,
					format: converted.format,
					converterVersion: converted.converterVersion,
					trajectoryPointers: ["#"],
				},
				objective: "Assess imported fixture against explicit conditions",
				conditions: [
					{
						id: "goal",
						statement: "Required artifact exists",
						sourceRef: "user:fixture",
						sourceType: "user",
						required: true,
						applicableWhen: "always",
						ruleRef: "F01",
					},
				],
				constraints: [],
				environmentRefs: [],
				provenance: "explicit human fixture",
				evaluationSubject: "agent-task",
				...changes,
			},
		});
	return {
		directory,
		context,
		identity,
		contexts,
		raw,
		converted,
		contract,
		get store() {
			return store;
		},
		reopen() {
			store.close();
			store = new EvaluationStore({ dataDir: directory, authorize: (c: object) => contexts.get(c) });
		},
		args(c: any) {
			return { contractRef: ref(c), input: raw, sourceDeclaration: "Explicit uploaded fixture, unverified origin" };
		},
	};
}
describe("EC05 original archive and idempotent offline import", () => {
	it("preserves original bytes privately, exposes redacted selected evidence and survives recovery", () => {
		const f = setup(),
			c = f.contract(),
			result = importAtif(f.store, f.context, f.args(c));
		expect(f.store.readOriginal(f.context, result.sourceRef)).toBe(f.raw);
		const source = f.store.get(f.context, result.sourceRef);
		expect(source.originalRef).toMatchObject({ sha256: f.converted.rawSha256, size: Buffer.byteLength(f.raw) });
		expect(statSync(f.store.originalPath(source)).mode & 0o777).toBe(0o600);
		const exported = JSON.stringify(f.store.export(f.context, result.snapshotRef));
		expect(exported).not.toContain("plain-secret-original");
		expect(exported).toContain("[REDACTED]");
		expect(exported).toContain(f.converted.rawSha256);
		expect(f.store.get(f.context, result.attemptRef).data).toMatchObject({ state: "unknown" });
		expect(f.store.get(f.context, f.store.get(f.context, result.attemptRef).data.targetRef).data.clientVersion).toBe(
			"unknown",
		);
		expect(f.store.get(f.context, result.attemptRef).data.sourceSessionId).toBeUndefined();
		const count = f.store.index!.size;
		f.reopen();
		expect(f.store.issues).toEqual([]);
		expect(importAtif(f.store, f.context, f.args(c))).toEqual(result);
		expect(f.store.index!.size).toBe(count);
		expect(f.store.readOriginal(f.context, result.sourceRef)).toBe(f.raw);
	});
	it("rechecks human, domain and host-anchor authorization before repeat import or original reads", () => {
		const f = setup(),
			c = f.contract(),
			args = f.args(c),
			result = importAtif(f.store, f.context, args);
		const tool = {};
		f.contexts.set(tool, { ...f.identity, human: false });
		expect(() => f.store.readOriginal(tool, result.sourceRef)).toThrow(
			expect.objectContaining({ code: "PERMISSION_DENIED" }),
		);
		expect(() => importAtif(f.store, tool, args)).toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
		expect(JSON.stringify(f.store.export(tool, result.snapshotRef))).not.toContain("plain-secret-original");
		for (const identity of [
			{ ...f.identity, domain: { principalId: "other", workspaceId: "workspace" } },
			{ ...f.identity, sessionIds: ["foreign-external-run"] },
		]) {
			const foreign = {};
			f.contexts.set(foreign, identity);
			expect(() => f.store.readOriginal(foreign, result.sourceRef)).toThrow(
				expect.objectContaining({ code: "PERMISSION_DENIED" }),
			);
		}
		f.identity.sessionIds = [];
		expect(() => importAtif(f.store, f.context, args)).toThrow(expect.objectContaining({ code: "PERMISSION_DENIED" }));
	});
	it("does not merge the same package across separate tasks or overwrite declarations", () => {
		const f = setup(),
			a = f.contract(),
			b = f.contract();
		const first = importAtif(f.store, f.context, f.args(a)),
			second = importAtif(f.store, f.context, f.args(b));
		expect(second.attemptRef.id).not.toBe(first.attemptRef.id);
		expect(second.snapshotRef.id).not.toBe(first.snapshotRef.id);
		expect(second.sourceRef.id).not.toBe(first.sourceRef.id);
		expect(() =>
			importAtif(f.store, f.context, { ...f.args(a), sourceDeclaration: "A different provenance claim" }),
		).toThrow(expect.objectContaining({ code: "VERSION_CONFLICT" }));
	});
	it("rejects malformed, changed package and missing selections before writing import stages", () => {
		const f = setup(),
			c = f.contract(),
			before = f.store.index!.size;
		for (const input of ["{", f.raw.replace("ATIF-v1.8", "ATIF-v999"), f.raw + " "])
			expect(() => importAtif(f.store, f.context, { ...f.args(c), input })).toThrow();
		expect(f.store.index!.size).toBe(before);
		const invalid = f.contract({ scope: { ...c.data.scope, trajectoryPointers: ["#/missing"] } });
		expect(() => importAtif(f.store, f.context, f.args(invalid))).toThrow(
			expect.objectContaining({ code: "EVIDENCE_GAP" }),
		);
	});
	it("preflights a tightened original-byte budget before publishing any import intent", () => {
		const f = setup({ limits: { evidenceBytes: 4096 } }),
			doc = document();
		doc.notes = "x".repeat(5000);
		const input = JSON.stringify(doc),
			converted = parseAtif(input),
			c = f.contract({
				scope: {
					source: "offline",
					sessionId: "host-anchor",
					packageDigest: converted.rawSha256,
					format: converted.format,
					converterVersion: converted.converterVersion,
					trajectoryPointers: ["#"],
				},
			});
		const count = f.store.index!.size;
		expect(() => importAtif(f.store, f.context, { ...f.args(c), input })).toThrow(
			expect.objectContaining({ code: "LIMIT_EXCEEDED" }),
		);
		expect(f.store.index!.size).toBe(count);
	});

	it("retains only explicitly selected document events while archiving the entire package", () => {
		const f = setup(),
			doc = document();
		doc.subagent_trajectories = [{ ...document(), trajectory_id: "child" }];
		doc.subagent_trajectories[0].steps[0].message = "EXCLUDED-CHILD-BODY";
		const input = JSON.stringify(doc),
			parsed = parseAtif(input),
			c = f.contract({
				scope: {
					source: "offline",
					sessionId: "host-anchor",
					packageDigest: parsed.rawSha256,
					format: parsed.format,
					converterVersion: parsed.converterVersion,
					trajectoryPointers: ["#"],
				},
			});
		const result = importAtif(f.store, f.context, { ...f.args(c), input });
		expect(result.evidenceCount).toBe(4);
		expect(f.store.readOriginal(f.context, result.sourceRef)).toBe(input);
		expect(JSON.stringify(f.store.export(f.context, result.snapshotRef))).not.toContain("EXCLUDED-CHILD-BODY");
	});
	it.each(["original:afterPublish", "afterPublish"])(
		"resumes after durable publication with a lost reply: %s",
		(failureStage) => {
			let armed = false,
				fired = false;
			const f = setup({
					fault: (stage: string) => {
						if (armed && !fired && stage === failureStage) {
							fired = true;
							throw new Error("lost reply");
						}
					},
				}),
				c = f.contract();
			armed = true;
			expect(() => importAtif(f.store, f.context, f.args(c))).toThrow(
				expect.objectContaining({ code: "EXECUTION_UNKNOWN" }),
			);
			expect(fired).toBe(true);
			f.reopen();
			expect(f.store.issues).toEqual([]);
			const result = importAtif(f.store, f.context, f.args(c)),
				count = f.store.index!.size;
			expect(importAtif(f.store, f.context, f.args(c))).toEqual(result);
			expect(f.store.index!.size).toBe(count);
			expect(f.store.readOriginal(f.context, result.sourceRef)).toBe(f.raw);
		},
	);
	it.each([3, 4, 6])("resumes without duplicates after lost evidence/pack/snapshot reply at commit %i", (commit) => {
		let armed = false,
			writes = 0,
			fired = false;
		const f = setup({
				fault: (stage: string) => {
					if (armed && stage === "afterPublish" && ++writes === commit) {
						fired = true;
						throw new Error("lost stage reply");
					}
				},
			}),
			c = f.contract();
		armed = true;
		expect(() => importAtif(f.store, f.context, f.args(c))).toThrow(
			expect.objectContaining({ code: "EXECUTION_UNKNOWN" }),
		);
		expect(fired).toBe(true);
		f.reopen();
		const result = importAtif(f.store, f.context, f.args(c)),
			size = f.store.index!.size;
		expect(importAtif(f.store, f.context, f.args(c))).toEqual(result);
		expect(f.store.index!.size).toBe(size);
		expect(f.store.list(f.context, { kind: "attempts" }).items).toHaveLength(1);
		expect(f.store.list(f.context, { kind: "snapshots" }).items).toHaveLength(1);
	});

	it("resumes a real process exit after original publication with explicitly proven lock recovery", () => {
		const f = setup(),
			c = f.contract(),
			args = f.args(c);
		f.store.close();
		const inputFile = join(f.directory, "child-input.json");
		writeFileSync(inputFile, JSON.stringify({ identity: f.identity, args }));
		const storeUrl = pathToFileURL(join(process.cwd(), "plugins/agent-evaluation/store.mjs")).href;
		const importerUrl = pathToFileURL(join(process.cwd(), "plugins/agent-evaluation/import.mjs")).href;
		const script = `import fs from 'node:fs'; import {EvaluationStore} from ${JSON.stringify(storeUrl)}; import {importAtif} from ${JSON.stringify(importerUrl)}; const {identity,args}=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); const context={}; const store=new EvaluationStore({dataDir:process.argv[2],authorize:c=>c===context?identity:undefined,fault:stage=>{if(stage==='original:afterPublish')process.exit(79)}}); importAtif(store,context,args); process.exit(80);`;
		const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, inputFile, f.directory], {
			encoding: "utf8",
			timeout: 15000,
		});
		expect(child.status).toBe(79);
		expect(child.error).toBeUndefined();
		const lock = join(f.directory, "agent-evaluation/writer.lock"),
			saved = JSON.parse(readFileSync(lock, "utf8"));
		expect(saved.pid).toBe(child.pid);
		// The synchronous child handle proves termination. Preserve its exact lock in this isolated fixture.
		renameSync(lock, join(f.directory, "exited-child-writer-lock.json"));
		f.reopen();
		const result = importAtif(f.store, f.context, args);
		expect(f.store.readOriginal(f.context, result.sourceRef)).toBe(f.raw);
		expect(f.store.list(f.context, { kind: "attempts" }).items).toHaveLength(1);
		expect(f.store.list(f.context, { kind: "snapshots" }).items).toHaveLength(1);
	});

	it("preserves incomplete originals and stops dependent writes after a pre-publication failure", () => {
		let armed = false;
		const f = setup({
				fault: (stage: string) => {
					if (armed && stage === "original:beforePublish") throw new Error("interrupted original");
				},
			}),
			c = f.contract();
		armed = true;
		expect(() => importAtif(f.store, f.context, f.args(c))).toThrow(expect.objectContaining({ code: "IO_ERROR" }));
		expect(readdirSync(join(f.store.root, "blobs")).some((name) => name.includes(".tmp-"))).toBe(true);
		expect(f.store.list(f.context, { kind: "snapshots" }).items).toHaveLength(0);
		expect(() => importAtif(f.store, f.context, f.args(c))).toThrow(expect.objectContaining({ code: "STORE_CORRUPT" }));
	});
	it("detects archive mutation and refuses symlink replacement without altering originals", () => {
		const f = setup(),
			result = importAtif(f.store, f.context, f.args(f.contract())),
			record = f.store.get(f.context, result.sourceRef),
			path = f.store.originalPath(record),
			original = readFileSync(path);
		writeFileSync(path, "changed");
		expect(() => f.store.readOriginal(f.context, result.sourceRef)).toThrow(
			expect.objectContaining({ code: "STORE_CORRUPT" }),
		);
		unlinkSync(path);
		expect(() => f.store.readOriginal(f.context, result.sourceRef)).toThrow(
			expect.objectContaining({ code: "STORE_CORRUPT" }),
		);
		writeFileSync(path, original);
		const outside = join(f.directory, "outside.txt");
		writeFileSync(outside, "never read");
		unlinkSync(path);
		symlinkSync(outside, path);
		expect(() => f.store.readOriginal(f.context, result.sourceRef)).toThrow();
		expect(readFileSync(outside, "utf8")).toBe("never read");
	});
	it("uses the existing snapshot scorer without promoting imported claims or running Pi collection", async () => {
		const f = setup(),
			result = importAtif(f.store, f.context, f.args(f.contract()));
		const engine = new EvaluationEngine(f.store, createInternalRegistry());
		cleanups.push(() => engine.close());
		const report = await engine.evaluate(f.context, {
			snapshotRef: result.snapshotRef,
			profileId: "internal",
			profileVersion: "1",
			requestId: "score-import",
		});
		expect(report.data.summary.deliveryVerdict).toBe("inconclusive");
		expect(report.data.assessmentStage).toBe("provisional");
		expect(
			report.data.findings
				.filter((finding: any) => finding.conditionId)
				.every((finding: any) => finding.verdict === "inconclusive"),
		).toBe(true);
		expect(
			report.data.findings.some(
				(finding: any) =>
					finding.nature === "verified" && finding.evidenceRefs.some((r: any) => r.id === result.sourceRef.id),
			),
		).toBe(false);
		let calls = 0;
		const collector = new EvidenceCollector(f.store, {
			readEvaluationEvidence: () => {
				calls++;
				throw new Error("no source reads");
			},
		} as any);
		await expect(
			collector.collect(f.context, {
				attemptRef: result.attemptRef,
				conversationId: "fixture",
				requestId: "wrong-collector",
			}),
		).rejects.toThrow();
		expect(calls).toBe(0);
		collector.close();
	});
});
