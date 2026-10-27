/** Isolated real SDK + PluginManager integration; no AgentSession prompt/model calls. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ClientSession } from "../../server/agent/agent-service.js";
import { AgentService } from "../../server/agent/agent-service-daemon.js";
import { PluginManager, type PluginHost } from "../../server/plugins.js";
import { TestAssetReader } from "../../server/test-asset-reader.js";
import { digest } from "../../plugins/agent-evaluation/schema.mjs";
import type { AgentEvaluationEvidenceQuery } from "../../server/protocol.js";

const cleanup: Array<() => void> = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const fn of cleanup.splice(0).reverse()) fn();
	delete (globalThis as any).__evaluationFixture;
	delete (globalThis as any).__dataSpaceFixture;
});
async function harness(dataSpace = false, grantIndex = true) {
	const dir = mkdtempSync(join(tmpdir(), "evaluation-host-"));
	cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
	const workspace = join(dir, "workspace");
	mkdirSync(workspace);
	const manager = SessionManager.inMemory(workspace);
	const first = manager.appendMessage({ role: "user", content: "fixture task", timestamp: 1 });
	const last = manager.appendMessage({ role: "user", content: "x".repeat(6000), timestamp: 2 });
	const client = Object.create(ClientSession.prototype) as any;
	client.clientId = "client1";
	client.convs = new Map([
		["conv1", { id: "conv1", cwd: workspace, session: { sessionManager: manager, isStreaming: false } }],
	]);
	const service = Object.create(AgentService.prototype) as any;
	service.clients = new Map([["client1", client]]);
	const mgr = new PluginManager(dir, workspace);
	cleanup.push(() => mgr.dispose());
	mgr.evaluationEvidenceProvider = (clientId, query) => service.readEvaluationEvidenceForPlugins(clientId, query);
	const plugin = join(dir, "plugins/agent-evaluation");
	cpSync(resolve("plugins/agent-evaluation"), plugin, { recursive: true });
	symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
	const manifest = JSON.parse(readFileSync(join(plugin, "manifest.json"), "utf8"));
	manifest.permissions = ["tools", ...(dataSpace && grantIndex ? ["tools:evaluation-index-write"] : [])];
	// This host-reader probe deliberately has no UI; remove product contributions copied with the source.
	manifest.view = false;
	delete manifest.ui;
	writeFileSync(join(plugin, "manifest.json"), JSON.stringify(manifest));
	writeFileSync(
		join(plugin, "index.mjs"),
		`import { EvaluationStore } from './store.mjs';
import { EvidenceCollector } from './collect.mjs';
import { EvaluationRegistry } from './registry.mjs';
import { EvaluationEngine } from './evaluate.mjs';
import { createInternalRegistry } from './profiles/internal.mjs';
export default { activate(host) {
 const state=globalThis.__evaluationFixture={host,EvaluationStore,EvidenceCollector,EvaluationRegistry,EvaluationEngine,createInternalRegistry};
 return host.onMessage((payload,from)=>{try{state.last=host.readEvaluationEvidence(from,payload.query);}catch(error){state.error=error.code;}});
}};`,
	);
	if (dataSpace) {
		client.goalReviewTurnOf = () => undefined;
		client.settingsSvc = { current: { defaultPermissionPreset: "default", disabledPlugins: [] } };
		mgr.evaluationDataSpaceGuard = (b) => service.verifyEvaluationDataSpaceForPlugins(b.clientId, b.conversationId);
		mgr.evaluationExecutionGuard = (b) => service.verifyEvaluationExecutionForPlugins(b.clientId, b.conversationId);
		const ds = join(dir, "plugins/data-space");
		mkdirSync(ds, { recursive: true });
		writeFileSync(
			join(ds, "manifest.json"),
			JSON.stringify({ id: "data-space", name: "fixture", version: "1.0.0", apiVersion: 2, permissions: ["tools"] }),
		);
		writeFileSync(
			join(ds, "index.mjs"),
			`export default {activate(host){const state=globalThis.__dataSpaceFixture={calls:0}; return host.registerEvaluationDataSpace(async(q,b,verify)=>{state.calls++;state.binding=b; if(state.wait)await state.wait;verify();return {action:q.action};});}};`,
		);
	}
	await mgr.ensureLoaded();
	const fixture = (globalThis as any).__evaluationFixture;
	expect(fixture?.host).toBeTruthy();
	expect(readFileSync(join(plugin, "collect.mjs"), "utf8")).toBe(
		readFileSync(resolve("plugins/agent-evaluation/collect.mjs"), "utf8"),
	);
	const query: AgentEvaluationEvidenceQuery = {
		conversationId: "conv1",
		mode: "collect",
		sessionId: manager.getSessionId(),
		startMessageId: first,
		endMessageId: last,
	};
	return { dir, workspace, manager, mgr, client, service, query, fixture, host: fixture.host as PluginHost };
}
describe("EC02 host integration", () => {
	it("maps an actual SDK entry to the rendered id through the owner-bound host and refuses hidden/foreign sources", async () => {
		const h = await harness();
		const conv = h.client.convs.get("conv1");
		Object.assign(conv, {
			msgIds: new Map(),
			nextMsgId: 1,
			uiMessageCache: new Map(),
			userSeqByTs: new Map(),
			lastMessagesSig: "",
			lastMessagesArray: [],
		});
		conv.session.agent = {
			state: {
				messages: h.manager
					.getBranch()
					.filter((e) => e.type === "message")
					.map((e: any) => e.message),
			},
		};
		const query: AgentEvaluationEvidenceQuery = {
			conversationId: "conv1",
			sessionId: h.query.sessionId,
			mode: "locate",
			locateEventId: h.query.endMessageId,
		};
		const target = h.host.readEvaluationEvidence("client1", query);
		expect(target.messageId).toBe(h.client.messagesOf(conv).at(-1).id);
		expect(target.items).toEqual([]);
		expect(() => h.host.readEvaluationEvidence("foreign", query)).toThrow();
		expect(() => h.host.readEvaluationEvidence("client1", { ...query, sessionId: "different" })).toThrow();
		conv.session.agent.state.messages = [];
		expect(() => h.host.readEvaluationEvidence("client1", query)).toThrow(/not uniquely visible/);
	});

	it("emits host monotonic clock values independently of wall-clock rollback", async () => {
		const h = await harness(),
			events: any[] = [];
		h.client.onRunEvent = (event: any) => events.push(event);
		vi.spyOn(Date, "now").mockReturnValueOnce(100000).mockReturnValueOnce(1);
		h.client.emitRun({ id: "conv1" }, { type: "tool_start", toolCallId: "t" });
		h.client.emitRun({ id: "conv1" }, { type: "tool_end", toolCallId: "t" });
		expect(events[0].at).toBeGreaterThan(events[1].at);
		expect(events[0].clockEpoch).toBe(events[1].clockEpoch);
		expect(events[1].monotonicAt).toBeGreaterThanOrEqual(events[0].monotonicAt);
	});
	it("binds file reads to the owned source workspace and rejects another session", async () => {
		const h = await harness();
		writeFileSync(join(h.workspace, "report"), "fixture");
		const query = { conversationId: "conv1", sessionId: h.query.sessionId!, path: "report" };
		expect(h.host.readEvaluationArtifact("client1", query).text).toBe("fixture");
		expect(() => h.host.readEvaluationArtifact("unknown", query)).toThrow(/owned|client/);
		expect(() => h.host.readEvaluationArtifact("client1", { ...query, sessionId: "changed" })).toThrow(
			/session changed/,
		);
	});

	it("uses the trusted sender and selected owner without fallback to another client", async () => {
		const h = await harness();
		h.mgr.handleMessage("agent-evaluation", { owner: "another-client", query: h.query }, "client1");
		expect(h.fixture.last.principalId).toBe("client1");
		expect(h.fixture.last.items).toHaveLength(2);
		expect(JSON.parse(h.fixture.last.items[1].content).message.content).toHaveLength(6000);
		h.mgr.handleMessage("agent-evaluation", { owner: "client1", query: h.query }, "unknown-client");
		expect(h.fixture.error).toBe("PERMISSION_DENIED");
		expect(() =>
			h.host.readEvaluationEvidence("client1", { ...h.query, conversationId: "someone-elses-conversation" }),
		).toThrow(/owned/);
	});
	it("discovers nested subagents without admitting an unrelated or ordinary derived conversation", async () => {
		const h = await harness();
		for (const [id, parentId, isSubagent] of [
			["child", "conv1", true],
			["grandchild", "child", true],
			["unrelated", "someone", true],
			["derived", "conv1", false],
		] as const) {
			h.client.convs.set(id, {
				id,
				parentId,
				isSubagent,
				cwd: h.workspace,
				session: { sessionManager: SessionManager.inMemory(h.workspace), isStreaming: false },
			});
		}
		const page = h.host.readEvaluationEvidence("client1", { ...h.query, mode: "describe" });
		expect(page.children.map((c) => c.conversationId).sort()).toEqual(["child", "grandchild"]);
	});

	it("copies collector and evaluator code into an isolated plugin, then seals and scores a real SDK selection", async () => {
		const h = await harness(),
			source = h.host.readEvaluationEvidence("client1", h.query);
		const context = { clientId: "client1" };
		const store = new h.fixture.EvaluationStore({
			dataDir: h.dir,
			authorize: (candidate: unknown) =>
				candidate === context
					? {
							domain: { principalId: source.principalId, workspaceId: source.workspaceId },
							sessionIds: [source.sessionId],
							allowWrite: true,
						}
					: undefined,
		});
		cleanup.push(() => store.close());
		const task = store.write(context, {
			kind: "contracts",
			requestId: "contract",
			data: {
				scope: {
					source: "pi",
					sessionId: source.sessionId,
					startMessageId: h.query.startMessageId,
					endMessageId: h.query.endMessageId,
					boundaryPrecision: "exact",
					childPolicy: "exclude",
					childSessionIds: [],
				},
				objective: "Read isolated SDK evidence",
				conditions: [
					{
						id: "artifact",
						statement: "Required JSON artifact",
						sourceRef: "fixture:user",
						sourceType: "user",
						required: true,
						applicableWhen: "always",
						ruleRef: "F01@1",
					},
				],
				constraints: [],
				environmentRefs: [],
				provenance: "fixture",
				evaluationSubject: "agent-task",
			},
		});
		const target = store.write(context, {
			kind: "targets",
			requestId: "target",
			data: {
				kind: "pi",
				clientVersion: "fixture",
				executableIdentity: "fixture",
				adapterVersion: "1",
				configRef: "fixture",
				capabilities: { history: "partial" },
				isolation: "fixture",
			},
		});
		const ref = (r: any) => ({ kind: r.kind, id: r.id, revision: r.revision });
		const attempt = store.write(context, {
			kind: "attempts",
			requestId: "attempt",
			data: {
				contractRef: ref(task),
				targetRef: ref(target),
				sourceSessionId: source.sessionId,
				configDigest: digest({}),
				state: "unknown",
			},
		});
		writeFileSync(join(h.workspace, "result.json"), '{"ok":true}');
		const artifactRead = vi.spyOn(h.host, "readEvaluationArtifact");
		const collector = new h.fixture.EvidenceCollector(store, h.host);
		cleanup.push(() => collector.close());
		const result = await collector.collect(context, {
			attemptRef: ref(attempt),
			conversationId: "conv1",
			requestId: "collect",
			artifactPaths: ["result.json"],
		});
		expect(result.evidenceRefs).toHaveLength(3);
		const snapshot = collector.seal(context, result.checkpointRef, "seal");
		expect(snapshot.data.gaps).toContain("source-is-ephemeral; restart recovery is unavailable");
		expect(snapshot.data.coverage).toBe("partial");
		const registry = new h.fixture.EvaluationRegistry();
		registry.registerEvaluators([
			{
				manifest: {
					id: "Probe",
					version: "1",
					method: "deterministic",
					supportedTaskTypes: ["agent-task"],
					requiredEvidence: ["message"],
					configSchema: { type: "object", additionalProperties: false },
					outputSchemaVersion: 1,
					timeoutMs: 1000,
					budget: { maxFindings: 1 },
					dependencies: [],
				},
				evaluate: (_contract: any, view: any) => [
					{
						verdict: "pass",
						evidenceState: "sufficient",
						evidenceRefs: [view.evidence[0].ref],
						missingEvidence: [],
						reason: "Selected real SDK entry is available",
					},
				],
			},
		]);
		registry.registerProfile({
			id: "probe",
			version: "1",
			taskTypes: ["agent-task"],
			rules: [{ id: "Probe", version: "1", config: {} }],
			required: [],
			aggregation: "contract-v1",
		});
		const engine = new h.fixture.EvaluationEngine(store, registry);
		cleanup.push(() => engine.close());
		const report = await engine.evaluate(context, {
			snapshotRef: ref(snapshot),
			profileId: "probe",
			profileVersion: "1",
			requestId: "score",
		});
		expect(report.data.state).toBe("completed");
		expect(report.data.findings[0].verdict).toBe("pass");
		expect(report.data.summary.goal).toBe("undetermined");
		expect(report.data.assessmentStage).toBe("provisional");
		const internal = new h.fixture.EvaluationEngine(
			store,
			h.fixture.createInternalRegistry({
				F01: { checks: [{ conditionId: "artifact", path: "result.json", format: "json" }] },
			}),
		);
		cleanup.push(() => internal.close());
		const scoreArgs = {
			snapshotRef: ref(snapshot),
			profileId: "internal",
			profileVersion: "1",
			requestId: "internal-score",
		};
		const firstScore = await internal.evaluate(context, scoreArgs);
		expect(firstScore.data.findings.find((f: any) => f.ruleId === "F01").verdict).toBe("pass");
		expect(firstScore.data.summary.counts.errors).toBe(0);
		expect(firstScore.data.findings).toHaveLength(7);
		rmSync(join(h.workspace, "result.json"));
		const rescore = await internal.evaluate(context, { ...scoreArgs, requestId: "explicit-rescore" });
		expect(rescore.id).not.toBe(firstScore.id);
		expect(rescore.data.findings).toEqual(firstScore.data.findings);
		expect(store.get(context, ref(firstScore))).toEqual(firstScore);
		expect(artifactRead).toHaveBeenCalledTimes(1);
	});
	it("binds native reads to the actual workspace and rejects a changed source session", async () => {
		const h = await harness();
		const read = vi.spyOn(TestAssetReader.prototype, "read").mockResolvedValue({ runId: "fixture-run" } as any);
		await h.host.readEvaluationNative("client1", {
			conversationId: "conv1",
			sessionId: h.query.sessionId!,
			engine: "api",
			reference: "fixture-ref",
			workspace: "/unauthorized",
		} as any);
		expect(read).toHaveBeenCalledWith(
			"api",
			h.host.readEvaluationEvidence("client1", h.query).workspace,
			"fixture-ref",
		);
		await expect(
			h.host.readEvaluationNative("client1", {
				conversationId: "conv1",
				sessionId: "wrong-session",
				engine: "api",
				reference: "fixture-ref",
			}),
		).rejects.toThrow(/session changed/);
		expect(read).toHaveBeenCalledTimes(1);
	});
	it("rejects unsupported engines and reads after plugin unload", async () => {
		const h = await harness();
		h.mgr.evaluationEvidenceProvider = undefined;
		expect(() => h.host.readEvaluationEvidence("client1", h.query)).toThrow(/no evaluation/);
		h.mgr.dispose();
		expect(() => h.host.readEvaluationEvidence("client1", h.query)).toThrow(/permission/);
	});
});

describe("EC09 owner-bound Data Space bridge", () => {
	it("binds the workspace and principal, enforces separate index permission and denies read-only/plan/disabled clients", async () => {
		const h = await harness(true),
			binding = { clientId: "client1", conversationId: "conv1", sessionId: h.query.sessionId! },
			ds = (globalThis as any).__dataSpaceFixture;
		expect(await h.host.evaluationDataSpace(binding, { action: "describe" })).toEqual({ action: "describe" });
		expect(ds.binding).toMatchObject({ principalId: "client1", workspace: realpathSync(h.workspace) });
		expect(await h.host.evaluationDataSpace(binding, { action: "authorizeIndex" })).toEqual({ authorized: true });
		expect(ds.calls).toBe(1);
		await expect(
			h.host.evaluationDataSpace({ ...binding, clientId: "foreign" }, { action: "describe" }),
		).rejects.toThrow();
		await expect(
			h.host.evaluationDataSpace({ ...binding, sessionId: "changed" }, { action: "describe" }),
		).rejects.toThrow();
		await expect(h.host.evaluationDataSpace(binding, { action: "import" })).rejects.toThrow(/Unsupported/);
		const conv = h.client.convs.get("conv1");
		for (const attrs of [{ planMode: true }, { delegateMode: true }, { permissionPreset: "read-only" }]) {
			Object.assign(conv, attrs);
			await expect(h.host.evaluationDataSpace(binding, { action: "authorizeIndex" })).rejects.toThrow(/disabled/);
			Object.keys(attrs).forEach((k) => delete conv[k]);
		}
		h.client.settingsSvc.current.disabledPlugins = ["data-space"];
		await expect(h.host.evaluationDataSpace(binding, { action: "describe" })).rejects.toThrow(/disabled/);
		h.client.settingsSvc.current.disabledPlugins = [];
		const reads = ds.calls;
		await expect(
			h.host.evaluationDataSpace(
				{
					...binding,
					invocation: {
						clientId: "client1",
						conversationId: "conv1",
						cwd: h.workspace,
						toolName: "agent_evaluation",
						pluginId: "agent-evaluation",
					} as any,
				},
				{ action: "syncIndex" },
			),
		).rejects.toThrow();
		expect(ds.calls).toBe(reads);
	});
	it("rejects undeclared writes and revokes in-flight reads on unload", async () => {
		const h = await harness(true, false),
			binding = { clientId: "client1", conversationId: "conv1", sessionId: h.query.sessionId! },
			ds = (globalThis as any).__dataSpaceFixture;
		await expect(h.host.evaluationDataSpace(binding, { action: "syncIndex" })).rejects.toThrow(/Separate/);
		let release!: () => void;
		ds.wait = new Promise<void>((r) => (release = r));
		const pending = h.host.evaluationDataSpace(binding, { action: "describe" });
		h.mgr.dispose();
		release();
		await expect(pending).rejects.toThrow(/unavailable/);
	});
});
