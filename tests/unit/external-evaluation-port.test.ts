import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EvaluationService } from "../../plugins/agent-evaluation/service.mjs";
import plugin from "../../plugins/agent-evaluation/index.mjs";
import { EvaluationStore } from "../../plugins/agent-evaluation/store.mjs";
import { OfflineEvaluationPort, type OfflineExecutionRequest } from "../../server/external-evaluation-port.js";
import { createPluginInvocation } from "../../server/mcp/plugin-mcp.js";

const fake = vi.hoisted(() => ({
	rows: new Map<string, any>(),
	starts: 0,
	cancels: 0,
	reads: 0,
	enrolled: true,
	onStart: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("../../server/external-evaluation-enrollment.js", () => ({
	readOfflineEnrollment: () => {
		fake.reads++;
		if (!fake.enrolled) throw Object.assign(new Error("missing"), { code: "ENOENT" });
		return {
			backend: {
				version: "vz-offline-1",
				binary: { sha256: "b".repeat(64) },
				kernel: { sha256: "c".repeat(64) },
				initrd: { sha256: "d".repeat(64) },
			},
			guest: {
				version: "ae-offline-fake-cli-1",
				target: { sha256: "a".repeat(64) },
				runner: { sha256: "e".repeat(64) },
				argv: [],
				stdinBase64: "",
			},
		};
	},
}));
vi.mock("../../server/external-evaluation-runtime.js", () => {
	const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
	return {
		OFFLINE_EXECUTION_POLICY: { network: false, modelAccess: false },
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
				if (!fake.rows.has(id))
					fake.rows.set(id, { fingerprint, owner: this.owner, state: "prepared", stopConfirmed: true, guest });
			}
			configurationFingerprint(id: string) {
				const row = fake.rows.get(id);
				if (row.owner !== this.owner) throw Object.assign(new Error("owner"), { code: "PERMISSION_DENIED" });
				return row.fingerprint;
			}
			async start(id: string) {
				const row = fake.rows.get(id);
				if (!row.launched) {
					fake.starts++;
					row.launched = true;
					row.state = "running";
					row.stopConfirmed = false;
				}
				await fake.onStart?.();
			}
			async status(id: string) {
				return { ...fake.rows.get(id) };
			}
			async cancel(id: string) {
				fake.cancels++;
				const row = fake.rows.get(id);
				Object.assign(row, { state: "cancelled", stopConfirmed: true, noEnvironmentStarted: !row.launched });
				return this.status(id);
			}
			async terminalEvidence(id: string) {
				const row = fake.rows.get(id);
				return { ...row, observedAt: "2026-10-26T10:00:00Z", logs: [], reportedExit: 0 };
			}
			async cleanup() {
				return { released: true, evidenceRetained: true };
			}
		},
	};
});
const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const fn of cleanups.splice(0).reverse()) fn();
	fake.rows.clear();
	fake.starts = 0;
	fake.cancels = 0;
	fake.reads = 0;
	fake.enrolled = true;
	fake.onStart = undefined;
});
const refOf = (r: any) => ({ kind: r.kind, id: r.id, revision: r.revision });
function fixture(human = true) {
	const dir = mkdtempSync(join(tmpdir(), "offline-port-"));
	const baseContext = {},
		identity: any = {
			domain: { principalId: "owner", workspaceId: "workspace" },
			sessionIds: ["s1"],
			allowWrite: true,
			human,
		};
	const source = {
		principalId: "owner",
		workspaceId: "workspace",
		workspace: dir,
		conversationId: "c1",
		sessionId: "s1",
		children: [],
	};
	let allowed = true,
		port: OfflineEvaluationPort | undefined;
	const store = new EvaluationStore({
		dataDir: dir,
		authorize: (context: object) => (context === baseContext ? identity : port?.identity(context)),
	});
	const contract = store.write(baseContext, {
		kind: "contracts",
		requestId: "anchor",
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
			objective: "offline diagnostics",
			conditions: [],
			constraints: [],
			environmentRefs: [],
			provenance: "user:m1",
			evaluationSubject: "agent-task",
		},
	});
	const authority = {
		verify: vi.fn(() => {
			if (!allowed) throw Object.assign(new Error("revoked"), { code: "PERMISSION_DENIED" });
		}),
		readSource: vi.fn(() => ({ ...source })),
		log: vi.fn(),
	};
	port = new OfflineEvaluationPort(store, dir, authority);
	cleanups.push(() => {
		port!.close();
		store.close();
		rmSync(dir, { recursive: true, force: true });
	});
	const binding: any = { clientId: "owner", conversationId: "c1", sessionId: "s1" };
	let sequence = 0;
	const run = (action: OfflineExecutionRequest["action"], extra: any = {}, context = baseContext) =>
		port!.dispatch(context, binding, { action, requestId: `r${++sequence}`, ...extra });
	const input = { argv: ["echo", "$(touch outside); 中文🙂"], stdin: "text中文🙂", timeoutMs: 10000, graceMs: 100 };
	const prepare = () => run("offlinePrepare", { ref: refOf(contract), data: input }) as Promise<any>;
	return {
		dir,
		port,
		store,
		identity,
		source,
		authority,
		binding,
		baseContext,
		contract,
		input,
		run,
		prepare,
		revoke: () => {
			allowed = false;
		},
	};
}
describe("EC06 guarded offline host port", () => {
	it("authorizes experiment checkpoints without loading a backend and freezes runtime identity for datasets", async () => {
		const f = fixture();
		fake.enrolled = false;
		await expect(f.run("offlineAuthorize")).resolves.toEqual({ authorized: true });
		expect(fake.reads).toBe(0);
		fake.enrolled = true;
		const first: any = await f.run("offlineDescribe");
		const second: any = await f.run("offlineDescribe");
		expect(first.runtimeDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(first.runtimeDigest).toBe(second.runtimeDigest);
		expect(JSON.stringify(first)).not.toContain(f.dir);
		f.revoke();
		await expect(f.run("offlineAuthorize")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(fake.starts).toBe(0);
	});
	it("links experiment repetitions through the original attempt bridge", async () => {
		const f = fixture();
		const first = await f.prepare();
		const second: any = await f.run("offlinePrepare", {
			ref: refOf(f.contract),
			data: { ...f.input, previousAttemptRef: first },
		});
		expect(second.id).not.toBe(first.id);
		expect(f.store.get(f.baseContext, second).data.previousAttemptRef).toEqual(first);
		expect(fake.starts).toBe(0);
	});
	it("rejects missing authorization and missing enrollment without creating attempts or launching", async () => {
		const f = fixture();
		f.revoke();
		await expect(f.prepare()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(fake.reads).toBe(0);
		expect(fake.rows.size).toBe(0);
		const g = fixture();
		fake.enrolled = false;
		await expect(g.prepare()).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
		expect(g.store.list(g.baseContext, { kind: "attempts", cursor: "", limit: 10 }).items).toEqual([]);
	});
	it.each([
		{ argv: ["/bin/sh"] },
		{ argv: ["echo", "\0"] },
		{ argv: ["echo", "x".repeat(1025)] },
		{ stdin: "x".repeat(65537) },
		{ stdin: "\ud800" },
		{ timeoutMs: 999 },
		{ timeoutMs: 30001 },
		{ graceMs: 49 },
		{ graceMs: 2001 },
		{ backend: {} },
		{ env: { HOME: "/" } },
	])("rejects invalid input before touching enrollment/store: %j", async (patch) => {
		const f = fixture();
		await expect(
			f.run("offlinePrepare", { ref: refOf(f.contract), data: { ...f.input, ...patch } }),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		expect(fake.reads).toBe(0);
		expect(fake.rows.size).toBe(0);
		expect(f.store.list(f.baseContext, { kind: "attempts", cursor: "", limit: 10 }).items).toEqual([]);
	});
	it("prepares once without starting and keeps shell text as literal argv/stdin", async () => {
		const f = fixture();
		const request: any = { action: "offlinePrepare", requestId: "same", ref: refOf(f.contract), data: f.input };
		const first: any = await f.port.dispatch(f.baseContext, f.binding, request);
		expect(await f.port.dispatch(f.baseContext, f.binding, request)).toEqual(first);
		expect(fake.starts).toBe(0);
		expect(fake.rows.size).toBe(1);
		expect(fake.rows.get(first.id).guest.argv).toEqual(f.input.argv);
		expect(Buffer.from(fake.rows.get(first.id).guest.stdinBase64, "base64").toString()).toBe(f.input.stdin);
		expect(f.store.get(f.baseContext, first).data.state).toBe("preparing");
		expect(f.identity.allowExecution).toBeUndefined();
	});
	it.each(["principalId", "workspaceId", "sessionId", "conversationId"])("rejects changed source %s", async (key) => {
		const f = fixture();
		(f.source as any)[key] = "other";
		await expect(f.prepare()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(fake.rows.size).toBe(0);
	});
	it("rejects forged store identity and request-level execution/reconciliation flags", async () => {
		const f = fixture();
		await expect(f.run("offlineDescribe", {}, {})).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(f.run("offlineDescribe", { allowExecution: true, reconciled: true })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		expect(fake.reads).toBe(0);
	});
	it("requires a live original tool invocation and never lets a tool become a UI request", async () => {
		const f = fixture(false),
			plain: any = {
				clientId: "owner",
				conversationId: "c1",
				cwd: f.dir,
				pluginId: "agent-evaluation",
				toolName: "agent_evaluation",
			};
		await expect(f.prepare()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		f.binding.invocation = plain;
		await expect(f.prepare()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		let valid = true;
		const scope = createPluginInvocation(plain, () => {
			if (!valid) throw new Error("mode changed");
		});
		f.binding.invocation = scope.context;
		const ref = await f.prepare();
		expect(ref.kind).toBe("attempts");
		valid = false;
		await expect(f.run("offlineStart", { ref })).rejects.toThrow("mode changed");
		valid = true;
		scope.dispose();
		await expect(f.run("offlineStart", { ref })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(fake.starts).toBe(0);
		const ui = fixture();
		ui.binding.invocation = plain;
		await expect(ui.prepare()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
	});
	it("keeps waiting distinct from completion, seals partial evidence and cleans up only after stop", async () => {
		const f = fixture(),
			ref = await f.prepare();
		expect(await f.run("offlineStart", { ref })).toMatchObject({ state: "running", stopConfirmed: false });
		Object.assign(fake.rows.get(ref.id), { state: "waiting-input" });
		expect(await f.run("offlineStatus", { ref })).toMatchObject({ state: "waiting-input", stopConfirmed: false });
		await expect(f.run("offlineSeal", { ref })).rejects.toMatchObject({ code: "EXECUTION_UNKNOWN" });
		expect(await f.run("offlineCancel", { ref })).toMatchObject({ state: "cancelled", stopConfirmed: true });
		const cleaned: any = await f.run("offlineCleanup", { ref });
		const snapshot = f.store.get(f.baseContext, cleaned.snapshotRef);
		expect(snapshot.data.coverage).toBe("partial");
		expect(snapshot.data.gaps).toContain("independent-verifier-unavailable");
		const evidence = f.store.get(f.baseContext, snapshot.data.evidenceRefs[0]);
		expect(JSON.parse(f.store.readBlob(evidence)).businessSuccess).toBe("unverified");
		const cancels = fake.cancels;
		f.port.close();
		expect(fake.cancels).toBe(cancels);
	});
	it("never replays unknown and only explicit reconciliation grants the original store transition", async () => {
		const f = fixture(),
			ref = await f.prepare();
		await f.run("offlineStart", { ref });
		Object.assign(fake.rows.get(ref.id), { state: "unknown" });
		expect(await f.run("offlineStatus", { ref })).toMatchObject({ state: "unknown" });
		await expect(f.run("offlineStart", { ref })).rejects.toMatchObject({ code: "EXECUTION_UNKNOWN" });
		Object.assign(fake.rows.get(ref.id), { state: "running" });
		await expect(f.run("offlineStatus", { ref })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(await f.run("offlineReconcile", { ref })).toMatchObject({ state: "running" });
		expect(fake.starts).toBe(1);
	});
	it("persists cancellation on client disable and after store close, without reprobeing enrollment", async () => {
		const f = fixture(),
			ref = await f.prepare();
		await f.run("offlineStart", { ref });
		const reads = fake.reads;
		f.port.stopClient("other");
		expect(fake.cancels).toBe(0);
		fake.enrolled = false;
		f.revoke();
		f.store.close();
		f.port.stopClient("owner");
		expect(fake.cancels).toBe(1);
		expect(fake.rows.get(ref.id).state).toBe("cancelled");
		f.port.close();
		expect(fake.cancels).toBe(2);
		f.port.close();
		expect(fake.cancels).toBe(2);
		expect(fake.reads).toBe(reads);
		await expect(f.run("offlineStatus", { ref })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
	});
	it("cancels a pending start if the host source/permissions are revoked", async () => {
		const f = fixture(),
			ref = await f.prepare();
		fake.onStart = async () => {
			f.revoke();
		};
		await expect(f.run("offlineStart", { ref })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(fake.cancels).toBe(1);
		expect(fake.rows.get(ref.id).state).toBe("cancelled");
	});
	it("persists cancellation when the original tool signal aborts during start", async () => {
		const f = fixture(false),
			abort = new AbortController();
		const scope = createPluginInvocation(
			{
				clientId: "owner",
				conversationId: "c1",
				cwd: f.dir,
				pluginId: "agent-evaluation",
				toolName: "agent_evaluation",
			},
			() => {},
			abort.signal,
		);
		f.binding.invocation = scope.context;
		const ref = await f.prepare();
		fake.onStart = async () => {
			abort.abort(new Error("stopped"));
			expect(fake.cancels).toBe(1);
		};
		await expect(f.run("offlineStart", { ref })).rejects.toThrow("stopped");
		expect(fake.rows.get(ref.id).state).toBe("cancelled");
		scope.dispose();
	});
});

function productFixture() {
	const f = fixture();
	let registered: any;
	const source = {
		...f.source,
		sourceId: "pi:s1",
		children: [],
		choices: [],
		clientVersion: "fixture",
		rangeStart: "m1",
		rangeEnd: "m1",
	};
	let productPort: OfflineEvaluationPort;
	const host: any = {
		dataDir: f.dir + "/product",
		getActiveConversation: ({ clientId }: any) => ({ clientId, conversationId: "c1" }),
		readEvaluationEvidence: (clientId: string, query: any) => {
			if (clientId !== "owner" || query.conversationId !== "c1")
				throw Object.assign(new Error("source"), { code: "PERMISSION_DENIED" });
			return source;
		},
		createOfflineEvaluationExecution: (store: any) =>
			(productPort = new OfflineEvaluationPort(store, f.dir, f.authority)),
		onRunEvent: () => () => {},
		onClientDisabled: () => () => {},
		onMessage: () => () => {},
		sendTo: () => {},
		registerAgentTool: (tool: any) => {
			registered = tool;
			return () => {};
		},
	};
	const service = new EvaluationService(host);
	cleanups.push(() => service.close());
	const trusted = { channel: "ui", clientId: "owner" };
	let sequence = 0;
	const run = (action: string, extra: any = {}, identity = trusted) =>
		service.dispatch(identity, { action, requestId: `p${++sequence}`, ...extra });
	const contract = { ...f.store.get(f.baseContext, refOf(f.contract)).data };
	return { ...f, host, service, run, trusted, contract, productPort: () => productPort, registered: () => registered };
}
describe("EC06 original plugin service and tool wiring", () => {
	it("prepares/starts/cancels through the original service and discovers authorized attempt revisions", async () => {
		const f = productFixture(),
			anchor: any = await f.run("createContract", { data: f.contract });
		const attempt: any = await f.run("offlinePrepare", { ref: anchor, data: f.input });
		expect(fake.starts).toBe(0);
		expect(await f.run("offlineStart", { ref: attempt })).toMatchObject({ state: "running" });
		expect(await f.run("offlineCancel", { ref: attempt })).toMatchObject({ state: "cancelled" });
		const page: any = await f.run("list", { kind: "offlineAttempts", limit: 2 });
		expect(page.items).toHaveLength(2);
		expect(page.nextCursor).toBeTruthy();
		expect(page.items.every((row: any) => row.id === attempt.id && row.sourceVersion === "ae-offline-fake-cli-1")).toBe(
			true,
		);
		const final: any = await f.run("offlineCleanup", { ref: attempt });
		expect((await f.run("get", { ref: final.snapshotRef })).data.gaps).toContain("independent-verifier-unavailable");
	});
	it("keeps Pi attachment out of offline discovery and rejects unexpected action fields", async () => {
		const f = productFixture(),
			anchor = await f.run("createContract", { data: f.contract });
		await f.run("createAttempt", { ref: anchor });
		expect((await f.run("list", { kind: "offlineAttempts" })).items).toEqual([]);
		await expect(f.run("offlinePrepare", { ref: anchor, data: f.input, configs: {} })).rejects.toMatchObject({
			code: "INVALID_INPUT",
		});
		await expect(
			f.run("offlinePrepare", { ref: anchor, data: { ...f.input, reconciled: true } }),
		).rejects.toMatchObject({ code: "INVALID_INPUT" });
		expect(fake.rows.size).toBe(0);
	});
	it("old hosts keep ordinary diagnosis and reject execution explicitly", async () => {
		const f = productFixture();
		delete f.host.createOfflineEvaluationExecution;
		expect(await f.run("describe")).toMatchObject({ sourceId: "pi:s1" });
		await expect(f.run("offlineDescribe")).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
		expect(fake.reads).toBe(0);
	});
	it("product close persists cancellation before invalidating store authorization", async () => {
		const f = productFixture(),
			anchor = await f.run("createContract", { data: f.contract });
		const attempt: any = await f.run("offlinePrepare", { ref: anchor, data: f.input });
		await f.run("offlineStart", { ref: attempt });
		f.service.close();
		expect(fake.rows.get(attempt.id).state).toBe("cancelled");
		expect(fake.cancels).toBe(1);
		await expect(f.run("offlineStatus", { ref: attempt })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
	});
	it("real registered tool preserves the original invocation rather than copying model identity fields", async () => {
		const f = productFixture(),
			stop = plugin.activate(f.host);
		cleanups.push(stop);
		const anchor = await f.run("createContract", { data: f.contract });
		// The product plugin owns a distinct store writer; close the direct service first.
		f.service.close();
		const request = { action: "offlinePrepare", requestId: "toolprepare", ref: anchor, data: f.input };
		const identity = {
			clientId: "owner",
			conversationId: "c1",
			cwd: f.dir,
			pluginId: "agent-evaluation",
			toolName: "agent_evaluation",
		};
		const forged = await f.registered().execute("forged", request, undefined, undefined, identity);
		expect(forged.isError).toBe(true);
		expect(forged.details.code).toBe("PERMISSION_DENIED");
		expect(fake.rows.size).toBe(0);
		const invocation = createPluginInvocation(identity, () => {});
		const prepared = await f.registered().execute("bound", request, undefined, undefined, invocation.context);
		expect(prepared.isError).not.toBe(true);
		expect(prepared.details.kind).toBe("attempts");
		expect(fake.starts).toBe(0);
		invocation.dispose();
		const expired = await f
			.registered()
			.execute(
				"expired",
				{ action: "offlineStart", requestId: "start", ref: prepared.details },
				undefined,
				undefined,
				invocation.context,
			);
		expect(expired.isError).toBe(true);
		expect(expired.details.code).toBe("PERMISSION_DENIED");
		expect(fake.starts).toBe(0);
	});
});
