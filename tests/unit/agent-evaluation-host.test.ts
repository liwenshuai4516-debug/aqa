/** Isolated real SDK + PluginManager integration; no AgentSession prompt/model calls. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
});
async function harness() {
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
	manifest.permissions = ["tools"];
	writeFileSync(join(plugin, "manifest.json"), JSON.stringify(manifest));
	writeFileSync(
		join(plugin, "index.mjs"),
		`import { EvaluationStore } from './store.mjs';
import { EvidenceCollector } from './collect.mjs';
export default { activate(host) {
 const state=globalThis.__evaluationFixture={host,EvaluationStore,EvidenceCollector};
 return host.onMessage((payload,from)=>{try{state.last=host.readEvaluationEvidence(from,payload.query);}catch(error){state.error=error.code;}});
}};`,
	);
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

	it("copies new collector code into an isolated plugin and persists a real SDK selection", async () => {
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
				conditions: [],
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
		const collector = new h.fixture.EvidenceCollector(store, h.host);
		cleanup.push(() => collector.close());
		const result = await collector.collect(context, {
			attemptRef: ref(attempt),
			conversationId: "conv1",
			requestId: "collect",
		});
		expect(result.evidenceRefs).toHaveLength(2);
		const snapshot = collector.seal(context, result.checkpointRef, "seal");
		expect(snapshot.data.gaps).toContain("source-is-ephemeral; restart recovery is unavailable");
		expect(snapshot.data.coverage).toBe("partial");
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
