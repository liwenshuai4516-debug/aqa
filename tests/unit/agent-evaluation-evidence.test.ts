import { describe, it, expect, afterEach, vi } from "vitest";
import { cpSync, existsSync, mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readEvaluationEvidence, type EvaluationSource } from "../../server/agent/evaluation-evidence.js";
import type { AgentEvaluationEvidenceQuery } from "../../server/protocol.js";
import { EvaluationStore } from "../../plugins/agent-evaluation/store.mjs";
import { EvidenceCollector, recordsOf, readEvidenceJson } from "../../plugins/agent-evaluation/collect.mjs";
import { digest } from "../../plugins/agent-evaluation/schema.mjs";

const dirs: string[] = [],
	cleanup: Array<() => void> = [];
function temp() {
	const dir = mkdtempSync(join(tmpdir(), "evaluation-evidence-"));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	for (const off of cleanup.splice(0).reverse()) off();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const entry = (id: string, parentId: string | null, message: any) => ({
	id,
	parentId,
	type: "message",
	timestamp: "2026-10-23T00:00:00.000Z",
	message,
});
function sourceFixture() {
	const entries = new Map([
		["u1", entry("u1", null, { role: "user", content: "first task" })],
		[
			"a1",
			entry("a1", "u1", {
				role: "assistant",
				content: [{ type: "toolCall", id: "tool1", name: "read", arguments: { path: "fixture.txt" } }],
			}),
		],
		[
			"t1",
			entry("t1", "a1", {
				role: "toolResult",
				toolCallId: "tool1",
				toolName: "read",
				content: [{ type: "text", text: "x".repeat(12000) }],
				isError: false,
			}),
		],
		["u2", entry("u2", "t1", { role: "user", content: "unselected second task" })],
	]);
	const source: EvaluationSource = {
		principalId: "client1",
		workspaceId: "workspace1",
		workspace: temp(),
		conversationId: "conv1",
		sessionId: "session1",
		persisted: true,
		isStreaming: false,
		leafId: "u2",
		getEntry: (id) => entries.get(id),
		children: [],
	};
	const query: AgentEvaluationEvidenceQuery = {
		conversationId: "conv1",
		mode: "collect",
		sessionId: "session1",
		startMessageId: "u1",
		endMessageId: "t1",
	};
	return { source, query, entries };
}
const ref = (r: any) => ({ kind: r.kind, id: r.id, revision: r.revision });
function collectorFixture(options: any = {}) {
	const fixture = sourceFixture();
	const context = { clientId: "client1" };
	const identity = {
		domain: { principalId: "client1", workspaceId: "workspace1" },
		sessionIds: ["session1", ...(options.children ?? [])],
		allowWrite: true,
	};
	const store = new EvaluationStore({
		dataDir: fixture.source.workspace,
		authorize: (c: unknown) => (c === context ? identity : undefined),
		...(options.store ?? {}),
	});
	cleanup.push(() => store.close());
	const contract = store.write(context, {
		kind: "contracts",
		requestId: "contract",
		data: {
			scope: {
				source: "pi",
				sessionId: "session1",
				startMessageId: "u1",
				endMessageId: "t1",
				boundaryPrecision: "exact",
				childPolicy: options.children ? "explicit" : "exclude",
				childSessionIds: options.children ?? [],
			},
			objective: "Inspect selected task",
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
	const attempt = store.write(context, {
		kind: "attempts",
		requestId: "attempt",
		data: {
			contractRef: ref(contract),
			targetRef: ref(target),
			sourceSessionId: "session1",
			configDigest: digest({}),
			state: "unknown",
		},
	});
	const listeners = new Set<(event: any) => void>();
	const read = vi.fn((_client: string, q: AgentEvaluationEvidenceQuery) => readEvaluationEvidence(fixture.source, q));
	const native = vi.fn(async () => ({
		engine: "api",
		runId: "native1",
		at: "2025-01-01T00:00:00Z",
		complete: true,
		rows: [{ caseId: "c1", status: "passed" }],
	}));
	const host = {
		readEvaluationEvidence: read,
		readEvaluationNative: native,
		onRunEvent: (h: (event: any) => void) => {
			listeners.add(h);
			return () => listeners.delete(h);
		},
	};
	const collector = new EvidenceCollector(store, host);
	cleanup.push(() => collector.close());
	const args = { attemptRef: ref(attempt), conversationId: "conv1", requestId: "collect1" };
	return { ...fixture, store, context, identity, contract, target, attempt, host, collector, args, listeners };
}

describe("EC02 authorized SDK sources", () => {
	it("packs a bounded 4.5MB selected tool chain without splitting at half the physical limit", async () => {
		const f = collectorFixture();
		const text = "x".repeat(750000);
		let parent = "a1";
		for (let i = 2; i <= 6; i++) {
			const call = `call${i}`,
				result = `result${i}`;
			f.entries.set(
				call,
				entry(call, parent, {
					role: "assistant",
					content: [{ type: "toolCall", id: `tool${i}`, name: "read", arguments: { path: `fixture${i}.txt` } }],
				}),
			);
			f.entries.set(
				result,
				entry(result, call, {
					role: "toolResult",
					toolCallId: `tool${i}`,
					toolName: "read",
					content: [{ type: "text", text }],
					isError: false,
				}),
			);
			parent = result;
		}
		f.entries.set(
			"t1",
			entry("t1", parent, {
				role: "toolResult",
				toolCallId: "tool1",
				toolName: "read",
				content: [{ type: "text", text }],
				isError: false,
			}),
		);
		const collected = await f.collector.collect(f.context, f.args);
		expect(collected.evidenceRefs).toHaveLength(13);
		expect(collected.gaps).toEqual([]);
		const directory = join(f.source.workspace, "agent-evaluation/evidence");
		const packs = readdirSync(directory).filter((file) => file.endsWith(".pack"));
		// One source commit and one final durable checkpoint, each within the frozen 8MiB cap.
		expect(packs).toHaveLength(2);
		for (const file of packs) expect(statSync(join(directory, file)).size).toBeLessThanOrEqual(8 * 1024 ** 2);
		const bodies = collected.evidenceRefs.map((reference: any) => readEvidenceJson(f.store, f.context, reference));
		expect(
			bodies.filter((body: any) => body.message.role === "toolResult").map((body: any) => body.message.content[0].text),
		).toEqual(Array(6).fill(text));
		expect(await f.collector.collect(f.context, f.args)).toEqual(collected);
		expect(readdirSync(directory).filter((file) => file.endsWith(".pack"))).toEqual(packs);
	});

	it("derives native execution links from selected calls and rejects forged or status-only references", () => {
		const { source, query, entries } = sourceFixture();
		const runId = "00000000-0000-4000-8000-000000000001";
		const output = {
			role: "toolResult",
			toolCallId: "tool1",
			isError: false,
			details: { runId },
			nativeExecution: { engine: "api", reference: "forged" },
			content: [],
		};
		const setCall = (action: string) =>
			entries.set(
				"a1",
				entry("a1", "u1", {
					role: "assistant",
					content: [{ type: "toolCall", id: "tool1", name: "api_test_execute", arguments: { action } }],
				}),
			);
		entries.set("t1", entry("t1", "a1", output));
		setCall("asset_run");
		const readLink = () => JSON.parse(readEvaluationEvidence(source, query).items[2].content!).message.nativeExecution;
		expect(readLink()).toEqual({ engine: "api", reference: runId });
		setCall("status");
		expect(readLink()).toBeUndefined();
		setCall("asset_run");
		entries.set("t1", entry("t1", "a1", { ...output, isError: true }));
		expect(readLink()).toBeUndefined();
	});

	it("reads full selected public tool output without taking the next task", () => {
		const { source, query } = sourceFixture();
		const page = readEvaluationEvidence(source, query);
		expect(page.items.map((i) => i.sourceEventId)).toEqual(["u1", "a1", "t1"]);
		expect(JSON.parse(page.items[2].content!).message.content[0].text).toHaveLength(12000);
		expect(JSON.stringify(page)).not.toContain("unselected second task");
		expect(page.coverage).toBe("complete");
	});
	it("denies another session/conversation and refuses a broadened missing start", () => {
		const { source, query } = sourceFixture();
		expect(() => readEvaluationEvidence(source, { ...query, sessionId: "other" })).toThrow(/boundaries/);
		expect(() => readEvaluationEvidence(source, { ...query, conversationId: "other" })).toThrow(/scope/);
		const page = readEvaluationEvidence(source, { ...query, startMessageId: "missing" });
		expect(page.items).toEqual([]);
		expect(page.gaps).toContain("selected-start-not-reached");
	});
	it("marks hidden content, credentials and oversized source without making up original bytes", () => {
		const { source, query, entries } = sourceFixture();
		entries.set(
			"t1",
			entry("t1", "a1", {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "private thought" },
					{ type: "text", text: "Bearer fixture-secret-value" },
					{ type: "toolCall", id: "c2", name: "request", arguments: { apiKey: "fixture-private" } },
				],
			}),
		);
		const page = readEvaluationEvidence(source, query);
		expect(JSON.stringify(page)).not.toContain("private thought");
		expect(JSON.stringify(page)).not.toContain("fixture-secret-value");
		expect(JSON.stringify(page)).not.toContain("fixture-private");
		expect(page.items[2].redaction).toContain("credentials-v1");
		expect(page.coverage).toBe("partial");
		entries.set("t1", entry("t1", "a1", { role: "toolResult", content: "中".repeat(400000) }));
		const oversized = readEvaluationEvidence(source, query).items[2];
		expect(oversized).toMatchObject({ availability: "unavailable", truncated: true });
		expect(oversized.content).toBeUndefined();
	});
	it("pages exact ranges and rejects cursor injection and broken chains", () => {
		const { source, query, entries } = sourceFixture();
		const first = readEvaluationEvidence(source, { ...query, limit: 2 });
		expect(first.nextCursor).toBe("a1");
		expect(
			readEvaluationEvidence(source, { ...query, cursor: first.nextCursor! }).items.map((i) => i.sourceEventId),
		).toEqual(["t1"]);
		expect(() => readEvaluationEvidence(source, { ...query, cursor: "u2" })).toThrow(/selected range/);
		entries.delete("a1");
		const broken = readEvaluationEvidence(source, query);
		expect(broken.gaps).toContain("missing-source-entry:a1");
		expect(broken.items).toHaveLength(0);
	});
	it("marks a limited description window rather than claiming full child history", () => {
		const { source } = sourceFixture();
		const page = readEvaluationEvidence(source, { conversationId: "conv1", mode: "describe", limit: 1 });
		expect(page.choices).toHaveLength(1);
		expect(page.gaps).toContain("description-window-limited; earlier entries are not included");
		expect(page.coverage).toBe("partial");
	});

	it("records middle-of-run, ephemeral and selected-child gaps", () => {
		const { source, query } = sourceFixture();
		source.persisted = false;
		source.isStreaming = true;
		const page = readEvaluationEvidence(source, { ...query, childSessionIds: ["gone-child"] });
		expect(page.gaps).toEqual(
			expect.arrayContaining([
				"source-is-ephemeral; restart recovery is unavailable",
				"source-run-is-active; selected evidence is provisional",
				"missing-selected-child:gone-child",
			]),
		);
	});
	it("uses persistent SDK IDs across a real isolated session reopen", () => {
		const directory = temp(),
			manager = SessionManager.create(directory, join(directory, "sessions"));
		const first = manager.appendMessage({ role: "user", content: "isolated task", timestamp: 1 });
		const last = manager.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "fixture result" }],
			api: "openai-completions",
			provider: "fixture",
			model: "fixture",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		} as any);
		const read = (sm: SessionManager) =>
			readEvaluationEvidence(
				{
					principalId: "client1",
					workspaceId: "workspace1",
					workspace: directory,
					conversationId: "conv1",
					sessionId: sm.getSessionId(),
					persisted: sm.isPersisted(),
					isStreaming: false,
					leafId: sm.getLeafId(),
					getEntry: (id) => sm.getEntry(id),
					children: [],
				},
				{
					conversationId: "conv1",
					mode: "collect",
					sessionId: sm.getSessionId(),
					startMessageId: first,
					endMessageId: last,
				},
			);
		const before = read(manager),
			reopened = SessionManager.open(manager.getSessionFile()!, join(directory, "sessions"));
		expect(read(reopened).items).toEqual(before.items);
	});
});

describe("EC02 durable collector", () => {
	it("accepts the exact configured snapshot boundary and rejects the next source event", async () => {
		const f = collectorFixture({ store: { limits: { snapshotItems: 4 } } });
		const collected = await f.collector.collect(f.context, f.args);
		expect(collected.evidenceRefs).toHaveLength(3);
		const sealed = f.collector.seal(f.context, collected.checkpointRef, "boundary-seal");
		expect(sealed.data.evidenceRefs).toHaveLength(4);
		f.entries.set("a2", entry("a2", "a1", { role: "user", content: "one extra selected entry" }));
		f.entries.set("t1", { ...f.entries.get("t1")!, parentId: "a2" });
		await expect(f.collector.collect(f.context, { ...f.args, requestId: "overflow" })).rejects.toThrow(
			/Snapshot evidence budget/,
		);
	});

	it.each([false, true])("publishes the final checkpoint durably with a tightened budget=%s", async (tightened) => {
		const f = collectorFixture(tightened ? { store: { limits: { readBytes: 4 * 1024 ** 2 } } } : {});
		const result = await f.collector.collect(f.context, f.args);
		const checkpoint = f.store.get(f.context, result.checkpointRef);
		const path = f.store.index!.get(`evidence/${checkpoint.id}.1`).file;
		expect(path.endsWith(".pack")).toBe(!tightened);
		expect(readEvidenceJson(f.store, f.context, result.checkpointRef).evidenceRefs).toEqual(result.evidenceRefs);
		f.store.close();
		const reopened = new EvaluationStore({ dataDir: f.source.workspace, authorize: () => f.identity });
		cleanup.push(() => reopened.close());
		const collector = new EvidenceCollector(reopened, f.host);
		cleanup.push(() => collector.close());
		expect(await collector.collect(f.context, f.args)).toEqual(result);
	});
	it("deduplicates replay and out-of-order delivery; seals an immutable checkpoint", async () => {
		const f = collectorFixture();
		const first = await f.collector.collect(f.context, f.args);
		expect(first.evidenceRefs).toHaveLength(3);
		expect((await f.collector.collect(f.context, f.args)).checkpointRef).toEqual(first.checkpointRef);
		expect(f.host.readEvaluationEvidence).toHaveBeenCalledTimes(1);
		const normal = f.host.readEvaluationEvidence.getMockImplementation()!;
		f.host.readEvaluationEvidence.mockImplementation((c, q) => {
			const page = normal(c, q);
			page.items.reverse();
			return page;
		});
		const replay = await f.collector.collect(f.context, { ...f.args, requestId: "replay" });
		expect(new Set(replay.evidenceRefs.map((r: any) => r.id))).toEqual(
			new Set(first.evidenceRefs.map((r: any) => r.id)),
		);
		expect(
			recordsOf(f.store, f.context, "evidence").filter((r: any) => r.data.producer === "pi-evidence-v1"),
		).toHaveLength(3);
		expect(f.collector.seal(f.context, first.checkpointRef, "seal1").data.evidenceRefs).toHaveLength(4);
		expect(f.host.readEvaluationNative).not.toHaveBeenCalled();
	});
	it("keeps conflicting source versions and diagnoses missing tool endings", async () => {
		const f = collectorFixture();
		await f.collector.collect(f.context, f.args);
		f.entries.set(
			"t1",
			entry("t1", "a1", { role: "assistant", content: [{ type: "text", text: "source was corrected" }] }),
		);
		const changed = await f.collector.collect(f.context, { ...f.args, requestId: "changed" });
		expect(changed.gaps.some((g: string) => g.startsWith("conflicting-source:"))).toBe(true);
		expect(changed.evidenceRefs).toHaveLength(4);
		const separate = collectorFixture();
		separate.entries.set("t1", entry("t1", "a1", { role: "assistant", content: [] }));
		const missing = await separate.collector.collect(separate.context, separate.args);
		expect(missing.gaps.some((g: string) => g.startsWith("missing-tool-end:"))).toBe(true);
	});
	it("does not publish a checkpoint on a failed write and recovers without repeated source records", async () => {
		const f = collectorFixture();
		let count = 0;
		f.store.fault = (stage: string) => {
			if (stage === "beforeWrite" && ++count === 2) throw new Error("disk offline");
		};
		await expect(f.collector.collect(f.context, f.args)).rejects.toMatchObject({ code: "IO_ERROR" });
		// The first physical commit now contains the entire page, never its checkpoint.
		const persisted = recordsOf(f.store, f.context, "evidence");
		expect(persisted.map((r) => r.data.sourceEventId).sort()).toEqual(["a1", "t1", "u1"]);
		expect(persisted.every((r) => r.data.producer === "pi-evidence-v1")).toBe(true);
		f.store.fault = () => {};
		const done = await f.collector.collect(f.context, f.args);
		expect(done.evidenceRefs).toHaveLength(3);
		expect(recordsOf(f.store, f.context, "evidence")).toHaveLength(4);
	});
	it("recovers a real process exit after durable evidence publication without publishing an early checkpoint", async () => {
		const f = collectorFixture();
		const page = readEvaluationEvidence(f.source, f.query);
		f.collector.close();
		f.store.close();
		const storeUrl = pathToFileURL(resolve("plugins/agent-evaluation/store.mjs")).href;
		const collectorUrl = pathToFileURL(resolve("plugins/agent-evaluation/collect.mjs")).href;
		const child = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`
import { EvaluationStore } from ${JSON.stringify(storeUrl)};
import { EvidenceCollector } from ${JSON.stringify(collectorUrl)};
const store = new EvaluationStore({dataDir:${JSON.stringify(f.source.workspace)}, authorize:()=>(${JSON.stringify(f.identity)}), fault(stage){if(stage==='afterPublish')process.exit(73);}});
await new EvidenceCollector(store,{readEvaluationEvidence:()=>(${JSON.stringify(page)})}).collect({},${JSON.stringify(f.args)});
`,
			],
			{ encoding: "utf8", timeout: 10000 },
		);
		expect(child.status, child.stderr).toBe(73);
		const originalLock = join(f.source.workspace, "agent-evaluation/writer.lock");
		expect(existsSync(originalLock)).toBe(true);
		// Child has exited. Recover into a new audited copy; preserve original lock/evidence.
		const recovery = temp();
		cpSync(join(f.source.workspace, "agent-evaluation"), join(recovery, "agent-evaluation"), {
			recursive: true,
			filter: (path) => !path.endsWith("writer.lock"),
		});
		const store = new EvaluationStore({ dataDir: recovery, authorize: () => f.identity });
		cleanup.push(() => store.close());
		const persisted = recordsOf(store, f.context, "evidence");
		expect(persisted.map((r) => r.data.sourceEventId).sort()).toEqual(["a1", "t1", "u1"]);
		expect(persisted.every((r) => r.data.producer === "pi-evidence-v1")).toBe(true);
		const collector = new EvidenceCollector(store, f.host);
		cleanup.push(() => collector.close());
		const result = await collector.collect(f.context, f.args);
		expect(result.evidenceRefs).toHaveLength(3);
		expect(recordsOf(store, f.context, "evidence")).toHaveLength(4);
		expect(existsSync(originalLock)).toBe(true);
	});

	it("persists sources across reopening and returns the same checkpoint without replay", async () => {
		const f = collectorFixture();
		const first = await f.collector.collect(f.context, f.args);
		f.collector.close();
		f.store.close();
		const store = new EvaluationStore({
			dataDir: f.source.workspace,
			authorize: (c: unknown) => (c === f.context ? f.identity : undefined),
		});
		cleanup.push(() => store.close());
		const collector = new EvidenceCollector(store, f.host);
		cleanup.push(() => collector.close());
		f.host.readEvaluationEvidence.mockClear();
		expect((await collector.collect(f.context, f.args)).checkpointRef).toEqual(first.checkpointRef);
		expect(f.host.readEvaluationEvidence).not.toHaveBeenCalled();
	});
	it("marks missing selected children and rejects a source domain substitution", async () => {
		const f = collectorFixture({ children: ["gone-child"] });
		expect((await f.collector.collect(f.context, f.args)).gaps).toContain("missing-selected-child:gone-child");
		f.source.principalId = "other";
		await expect(f.collector.collect(f.context, { ...f.args, requestId: "other" })).rejects.toThrow(/domain/);
	});
	it("collects an explicitly selected child into a distinct linked attempt", async () => {
		const f = collectorFixture({ children: ["child-session"] });
		f.source.children = [{ sessionId: "child-session", conversationId: "child-conv", persisted: false }];
		const childEntry = entry("child-entry", null, {
			role: "assistant",
			content: [{ type: "text", text: "child result" }],
		});
		const child = {
			...f.source,
			conversationId: "child-conv",
			sessionId: "child-session",
			persisted: false,
			leafId: "child-entry",
			getEntry: (id: string) => (id === "child-entry" ? childEntry : undefined),
			children: [],
		};
		f.host.readEvaluationEvidence.mockImplementation((_c, q) =>
			readEvaluationEvidence(q.conversationId === "child-conv" ? child : f.source, q),
		);
		const result = await f.collector.collect(f.context, f.args);
		expect(result.attemptRefs).toHaveLength(2);
		const attempt = f.store.get(f.context, result.attemptRefs[1]);
		expect(attempt.data.parentAttemptRef.id).toBe(f.attempt.id);
		expect(attempt.data.sourceSessionId).toBe("child-session");
		expect(result.gaps.some((g: string) => g.startsWith("source-is-ephemeral"))).toBe(true);
	});
	it("keeps native observations dated, and repeat requests do not re-read or execute", async () => {
		const f = collectorFixture();
		const args = { ...f.args, nativeRefs: [{ engine: "api", reference: "fixture-run-ref" }] };
		const result = await f.collector.collect(f.context, args);
		await f.collector.collect(f.context, args);
		expect(f.host.readEvaluationNative).toHaveBeenCalledTimes(1);
		const native = recordsOf(f.store, f.context, "evidence").find((r: any) => r.data.kind === "native-test-run");
		expect(native.data.occurredAt).toBe("2025-01-01T00:00:00Z");
		expect(native.data.observedAt).not.toBe(native.data.occurredAt);
		expect(result.gaps).toContain("additional-read-at-observation-time:native1");
	});
	it("ignores unselected events, isolates failure, and removes listeners on close", async () => {
		const f = collectorFixture();
		const changes: any[] = [];
		const watch = f.collector.watch(f.context, f.args, (change: any) => changes.push(change));
		for (const listener of f.listeners) listener({ conversationId: "other", type: "run_end" });
		expect(f.host.readEvaluationEvidence).not.toHaveBeenCalled();
		f.host.readEvaluationEvidence.mockImplementation(() => {
			throw new Error("source unavailable");
		});
		await watch.refresh();
		expect(watch.status().lastError).toMatchObject({ code: "EVIDENCE_GAP" });
		expect(changes).toHaveLength(1);
		expect(changes[0].error.message).toContain("unaffected");
		f.collector.close();
		expect(f.listeners.size).toBe(0);
	});
	it("deduplicates out-of-order live observations, retains restart gaps and excludes another tool", async () => {
		const f = collectorFixture();
		const event = { conversationId: "conv1", type: "tool_end", toolCallId: "tool1", at: 10, durationMs: 12 };
		const first = await f.collector.collect(f.context, {
			...f.args,
			liveEvents: [event, event, { ...event, toolCallId: "unselected", resultText: "private preview" }],
		});
		expect(first.gaps).toContain("live-start-not-observed:pi-live:session1:tool1");
		const live = recordsOf(f.store, f.context, "evidence").filter((r: any) => r.data.producer === "pi-live-v1");
		expect(live).toHaveLength(1);
		expect(readEvidenceJson(f.store, f.context, ref(live[0]))).toMatchObject({
			durationMs: 12,
			clock: expect.stringContaining("wall-clock"),
		});
		expect(JSON.stringify(live)).not.toContain("private preview");
		const reordered = await f.collector.collect(f.context, {
			...f.args,
			requestId: "start-later",
			liveEvents: [{ ...event, type: "tool_start", at: 100, durationMs: undefined }],
		});
		expect(reordered.gaps).not.toContain("live-start-not-observed:pi-live:session1:tool1");
		expect(reordered.evidenceRefs).toHaveLength(5);
		const restarted = new EvidenceCollector(f.store, f.host);
		cleanup.push(() => restarted.close());
		expect((await restarted.collect(f.context, { ...f.args, requestId: "restart" })).evidenceRefs).toHaveLength(5);
	});
	it("keeps conflicting timing revisions and does not turn a wall-clock rollback into negative duration", async () => {
		const f = collectorFixture();
		const event = { conversationId: "conv1", type: "tool_end", toolCallId: "tool1", at: 100, durationMs: 12 };
		await f.collector.collect(f.context, { ...f.args, liveEvents: [event] });
		const changed = await f.collector.collect(f.context, {
			...f.args,
			requestId: "rollback",
			liveEvents: [{ ...event, durationMs: -50, at: 50 }],
		});
		expect(changed.gaps).toContain("conflicting-source:pi-live:session1:tool1:tool_end");
		const live = recordsOf(f.store, f.context, "evidence").filter((r: any) => r.data.producer === "pi-live-v1");
		expect(live).toHaveLength(2);
		expect(live.map((r: any) => readEvidenceJson(f.store, f.context, ref(r)).durationMs)).toEqual(
			expect.arrayContaining([12, null]),
		);
	});
	it("persists selected host metadata through watch and isolates late callbacks", async () => {
		const f = collectorFixture();
		const watch = f.collector.watch(f.context, f.args);
		const listener = [...f.listeners][0];
		listener({
			conversationId: "conv1",
			type: "tool_end",
			toolCallId: "tool1",
			at: 100,
			durationMs: 5,
			resultText: "untrusted-preview",
		});
		await vi.waitFor(() => expect(watch.status().busy).toBe(false));
		const records = recordsOf(f.store, f.context, "evidence");
		expect(records.filter((r: any) => r.data.producer === "pi-live-v1")).toHaveLength(1);
		watch.stop();
		listener({ conversationId: "conv1", type: "tool_start", toolCallId: "tool1", at: 95 });
		expect(recordsOf(f.store, f.context, "evidence")).toHaveLength(records.length);
	});

	it("reports and seals an explicit gap after the bounded live queue overflows", async () => {
		const f = collectorFixture();
		const changes: any[] = [];
		const watch = f.collector.watch(f.context, f.args, (change: any) => changes.push(change));
		const listener = [...f.listeners][0];
		for (let i = 0; i <= 1000; i++)
			listener({ conversationId: "conv1", type: "tool_end", toolCallId: "tool1", at: 100, durationMs: 5 });
		await vi.waitFor(() => expect(watch.status().busy).toBe(false));
		expect(changes.some((c) => c.error?.code === "LIMIT_EXCEEDED")).toBe(true);
		expect(changes.filter((c) => c.result).at(-1).result.gaps).toContain("live-queue-overflow; events missing");
	});

	it("rejects a late native callback after cancellation without publishing a checkpoint", async () => {
		const f = collectorFixture();
		let resolve!: (value: any) => void;
		f.host.readEvaluationNative.mockImplementation(
			() =>
				new Promise((r) => {
					resolve = r;
				}),
		);
		const abort = new AbortController();
		const promise = f.collector.collect(f.context, {
			...f.args,
			signal: abort.signal,
			nativeRefs: [{ engine: "api", reference: "ref" }],
		});
		await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
		abort.abort();
		resolve({ runId: "late", at: "now", complete: true });
		await expect(promise).rejects.toThrow();
		expect(recordsOf(f.store, f.context, "evidence").some((r: any) => r.data.kind === "collection-checkpoint")).toBe(
			false,
		);
	});
});

describe("source message navigation", () => {
	it("requires exact session and event, returns no evidence bodies and refuses unavailable targets", () => {
		const f = sourceFixture();
		f.source.locateMessage = vi.fn((id) => (id === "u1" ? "u-1-1" : undefined));
		const query: AgentEvaluationEvidenceQuery = {
			conversationId: "conv1",
			sessionId: "session1",
			mode: "locate",
			locateEventId: "u1",
		};
		const result = readEvaluationEvidence(f.source, query);
		expect(result.messageId).toBe("u-1-1");
		expect(result.items).toEqual([]);
		expect(result.choices).toEqual([]);
		for (const invalid of [
			{ ...query, sessionId: "other" },
			{ ...query, locateEventId: "../private" },
			{ ...query, sessionId: undefined },
		])
			expect(() => readEvaluationEvidence(f.source, invalid)).toThrow(/Exact source/);
		expect(() => readEvaluationEvidence(f.source, { ...query, locateEventId: "hidden" })).toThrow(
			/not uniquely visible/,
		);
	});
});
