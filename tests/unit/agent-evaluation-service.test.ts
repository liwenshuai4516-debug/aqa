import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
				},
				query,
			);
		}),
		readEvaluationArtifact: vi.fn((_clientId: string, query: any) => readEvaluationArtifact(workspace, query.path)),
		readEvaluationNative: vi.fn(async () => {
			throw new Error("No native reference in fixture");
		}),
		onRunEvent: vi.fn(() => () => {}),
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
