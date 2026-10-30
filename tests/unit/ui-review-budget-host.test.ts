import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { join } from "node:path";

// No real manifests, native grants, models, sessions, browsers or network.
const io = vi.hoisted(() => ({ files: new Map<string, Buffer>(), read: vi.fn(), realpath: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: io.read, realpath: io.realpath }));
import { registerReviewBudgetHost } from "../../.pi/skills/ui-testing-workflow/assets/review-budget-host.mjs";

const ROOT = "/synthetic-workspace";
const SESSION = "/synthetic-sdk-session";
const TASK = "pms-operation-contract-new-20261029";
const ASSET = "pms-contract-query-reset";
const text = (rounds = 1, revision = "r6") => `为原任务 ${TASK} 追加${rounds}轮独立设计评审；对${revision}续评。`;
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
type Ref = { path: string; sha256: string };
type Entry = { id: string; type: string; message?: any; customType?: string; data?: any; [key: string]: any };
const userEntry = (content: any = text(), id = "user-authorization"): Entry => ({
	id,
	type: "message",
	message: { role: "user", content },
});

beforeEach(() => {
	vi.clearAllMocks();
	io.files.clear();
	io.realpath.mockImplementation(async (path: string) => path);
	io.read.mockImplementation(async (path: string) => {
		const bytes = io.files.get(path);
		if (!bytes) throw new Error("synthetic missing target");
		return bytes;
	});
});

function fixture(initial: Entry[] = [userEntry()]) {
	let branch = clone(initial);
	let sessionId = "original-session";
	let used = 3;
	let limit = 3;
	let beforeCallback: (() => void | Promise<void>) | undefined;
	const artifacts = new Map<string, any>();
	const grants = new Map<string, any>();
	const persist = (artifact: any, path: string): Ref => {
		const bytes = Buffer.from(JSON.stringify(artifact));
		const ref = { path, sha256: digest(bytes) };
		io.files.set(join(ROOT, path), bytes);
		artifacts.set(path, clone(artifact));
		return ref;
	};
	const scopeRef = persist(
		{ kind: "scope", id: TASK, data: { budget: { max_review_rounds: 3 } } },
		`qa/ui/scopes/${TASK}/manifest.json`,
	);
	const handed = {
		kind: "asset",
		id: ASSET,
		data: { revision: "r3", scope_ref: scopeRef, module_ids: ["operation-contract"] },
	};
	const handedRef = persist(handed, `qa/ui/assets/${ASSET}/revisions/r3/manifest.json`);
	const asset = { ...clone(handed), data: { ...clone(handed.data), revision: "r6" } };
	const assetRef = persist(asset, `qa/ui/assets/${ASSET}/revisions/r6/manifest.json`);
	const task = {
		kind: "task",
		id: TASK,
		data: {
			intent: "record",
			stage: "design-review",
			state: "blocked",
			input_sha256: "e".repeat(64),
			scope_ref: scopeRef,
			asset_refs: [],
			output_refs: [handedRef],
			run_ids: [],
			blockers: ["historical errors count 3/3"],
		},
	};
	let taskRef = persist(task, `qa/ui/tasks/${TASK}/manifest.json`);
	const saveTask = () => (taskRef = persist(task, taskRef.path));
	const load = vi.fn(async (ref: Ref) => {
		const bytes = io.files.get(join(ROOT, ref.path));
		if (!bytes || digest(bytes) !== ref.sha256) throw new Error("synthetic SHA mismatch");
		const artifact = artifacts.get(ref.path);
		if (!artifact) throw new Error("synthetic missing artifact");
		return clone(artifact);
	});
	// Stub models the native callback/duplicate-grant contract. It never calls
	// DesignReviewService, writes an authority file, or invokes assess.
	const renew = vi.fn(async (t: Ref, a: Ref, authorization: any, authorize: (request: any) => Promise<boolean>) => {
		const old = grants.get(authorization.authorization_id);
		if (old) return clone(old);
		await beforeCallback?.();
		const request = { ...authorization, task_ref: t, asset_ref: a, used_rounds: used, current_limit: limit };
		const allowed = await authorize(request);
		callbackResults.push(allowed);
		if (!allowed) throw new Error("synthetic native rejected");
		const grant = {
			...request,
			previous_limit: limit,
			total_limit: limit + authorization.additional_rounds,
			created_at: "synthetic",
		};
		grants.set(authorization.authorization_id, clone(grant));
		limit = grant.total_limit;
		return grant;
	});
	const callbackResults: boolean[] = [];
	const constructed: any[] = [];
	class ArtifactStore {
		constructor(cwd: string) {
			constructed.push(["store", cwd]);
		}
		load = load;
	}
	class DesignReviewService {
		constructor(cwd: string, authority: string) {
			constructed.push(["review", cwd, authority]);
		}
		renewBudget = renew;
	}
	const loadNative = vi.fn(async () => ({ ArtifactStore, DesignReviewService }));
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	const commands = new Map<string, any>();
	const ctx = {
		cwd: ROOT,
		sessionManager: {
			getSessionId: () => sessionId,
			getSessionDir: () => SESSION,
			getBranch: vi.fn(() => clone(branch)),
			getLeafId: vi.fn(() => "must-not-be-an-authority-input"),
			getSessionFile: vi.fn(() => {
				throw new Error("must not read personal JSONL");
			}),
		},
		ui: { notify: vi.fn() },
		executeTool: vi.fn(() => {
			throw new Error("not a ToolContext");
		}),
	};
	const pi = {
		on: vi.fn((event: string, handler: (event: any, ctx: any) => any) => handlers.set(event, handler)),
		registerCommand: vi.fn((name: string, command: any) => commands.set(name, command)),
		appendEntry: vi.fn((customType: string, data: any) =>
			branch.push({ type: "custom", id: `receipt-${branch.length}`, customType, data: clone(data) }),
		),
		sendMessage: vi.fn(),
		registerTool: vi.fn(),
		registerMcpServer: vi.fn(),
	};
	const register = () => registerReviewBudgetHost(pi, { loadNative });
	register();
	const emit = async (event = "session_start", data: any = {}) => handlers.get(event)!(data, ctx);
	return {
		pi,
		ctx,
		emit,
		commands,
		register,
		load,
		loadNative,
		renew,
		constructed,
		callbackResults,
		grants,
		task,
		asset,
		handed,
		taskRef,
		assetRef,
		handedRef,
		scopeRef,
		saveTask,
		persist,
		branch: () => branch,
		setBranch: (next: Entry[]) => {
			branch = clone(next);
		},
		setSession: (id: string) => {
			sessionId = id;
		},
		budget: (u: number, l: number) => {
			used = u;
			limit = l;
		},
		beforeCallback: (fn: () => void | Promise<void>) => {
			beforeCallback = fn;
		},
	};
}

function expectNoGrant(f: ReturnType<typeof fixture>) {
	expect(f.grants.size).toBe(0);
	expect(f.pi.appendEntry).not.toHaveBeenCalled();
	expect(f.pi.sendMessage).not.toHaveBeenCalled();
	expect(f.ctx.executeTool).not.toHaveBeenCalled();
}

describe("host-only SDK authorization", () => {
	it.each([
		["missing user", []],
		["assistant only", [{ id: "a", type: "message", message: { role: "assistant", content: text() } }]],
		["tool only", [{ id: "t", type: "message", message: { role: "toolResult", content: text() } }]],
		["custom message", [{ id: "c", type: "custom_message", customType: "user", content: text() }]],
	] as [string, Entry[]][])("%s is a zero-IO startup no-op", async (_name, entries) => {
		const f = fixture(entries);
		await f.emit();
		expectNoGrant(f);
		expect(io.read).not.toHaveBeenCalled();
		expect(io.realpath).not.toHaveBeenCalled();
		expect(f.loadNative).not.toHaveBeenCalled();
		expect(f.ctx.ui.notify).not.toHaveBeenCalled();
	});

	it.each([
		`引用：${text()}`,
		`“${text()}”`,
		`「${text()}」`,
		`\`${text()}\``,
		`> ${text()}`,
		`\`\`\`\n${text()}\n\`\`\``,
		`示例：${text()}`,
		`如果需要，${text()}`,
		`假设${text()}`,
		`不要${text()}`,
		`撤销：${text()}`,
		`${text()}撤销授权`,
		`${text()}如果可行`,
		`为原任务 ${TASK} 追加1轮独立设计评审`,
		"对r6续评",
		"authorized=true additional_rounds=3",
		text(0),
		text(4),
		text(1).replace("追加1", "追加01"),
		text(1).replace(TASK, "../escape"),
		text(1).replace("r6", "r六"),
		text(1).replace("r6", "r6/r7"),
		`${text()}\n${text()}`,
		`这是之前用户说的：${text()}`,
		`待确认：${text()}`,
		`是否${text()}`,
		`用户本轮已明确授权：${text()}`,
	])("rejects ambiguous/incomplete user text: %s", async (content) => {
		const f = fixture([userEntry(content)]);
		await f.emit();
		expectNoGrant(f);
		expect(f.loadNative).not.toHaveBeenCalled();
		expect(io.read).not.toHaveBeenCalled();
	});

	it.each([
		{ source: "extension" },
		{ origin: "extension" },
		{ provenance: { source: "extension" } },
		{ fromHook: true },
		{ fromExtension: true },
	])("rejects marked extension provenance %j", async (mark) => {
		for (const onMessage of [false, true]) {
			const entry = userEntry();
			Object.assign(onMessage ? entry.message : entry, mark);
			const f = fixture([entry]);
			await f.emit();
			expectNoGrant(f);
			expect(f.loadNative).not.toHaveBeenCalled();
		}
	});

	it("uses only the latest actual branch user, never assistant/tool instructions", async () => {
		const f = fixture([
			userEntry(),
			userEntry("撤销续授", "new-user"),
			{ id: "a", type: "message", message: { role: "assistant", content: text() } },
		]);
		await f.emit();
		expectNoGrant(f);
		expect(f.renew).not.toHaveBeenCalled();
	});

	it("does not register tools/MCP and tolerates older minimal host mocks", async () => {
		const f = fixture([]);
		expect(f.pi.registerTool).not.toHaveBeenCalled();
		expect(f.pi.registerMcpServer).not.toHaveBeenCalled();
		expect([...f.commands.keys()]).toEqual(["ui-review-budget"]);
		registerReviewBudgetHost({ on: f.pi.on });
		await f.emit();
		expect(io.read).not.toHaveBeenCalled();
	});

	it.each([
		"authorized=true",
		"1",
		"--additional_rounds=3",
		"authorityRoot=/fake",
		"sessionFile=/fake",
		{ authorized: true },
	])("command cannot supply authorization or paths: %j", async (args) => {
		const f = fixture();
		await f.commands.get("ui-review-budget").handler(args, f.ctx);
		expectNoGrant(f);
		expect(f.renew).not.toHaveBeenCalled();
		expect(f.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("blocked"), "warning");
	});

	it("explicit command without authorization reports local blocked only", async () => {
		const f = fixture([]);
		await f.commands.get("ui-review-budget").handler("", f.ctx);
		expectNoGrant(f);
		expect(f.ctx.ui.notify).toHaveBeenCalledOnce();
		expect(f.loadNative).not.toHaveBeenCalled();
	});
});

describe("native renewal and normal model continuation", () => {
	it.each([1, 2, 3])("grants precisely %i rounds with the original scope and exact refs", async (rounds) => {
		const f = fixture([userEntry([{ type: "text", text: text(rounds) }])]);
		await f.emit();
		expect(f.callbackResults).toEqual([true]);
		expect(f.grants.size).toBe(1);
		expect(f.renew).toHaveBeenCalledWith(
			f.taskRef,
			f.assetRef,
			expect.objectContaining({
				authorization_id: expect.stringMatching(/^[a-f0-9]{64}$/),
				additional_rounds: rounds,
			}),
			expect.any(Function),
		);
		expect(f.constructed).toContainEqual(["review", ROOT, join(SESSION, "ui-review-authority")]);
		const [type, receipt] = f.pi.appendEntry.mock.calls[0];
		expect(type).toBe("ui-review-budget-host-receipt");
		expect(receipt).toMatchObject({
			previous_limit: 3,
			total_limit: 3 + rounds,
			used_rounds: 3,
			session_id: "original-session",
			user_entry_id: "user-authorization",
			scope_ref: f.scopeRef,
			revision: "r6",
			next_request_id: expect.stringMatching(/-04$/),
		});
		const [message, options] = f.pi.sendMessage.mock.calls[0] as any[];
		expect(options).toEqual({ triggerTurn: true });
		expect(message).toMatchObject({ customType: "ui-review-budget-renewed", display: true });
		expect(message.content).toContain(`${TASK}/r6`);
		expect(message.content).toContain(`total_limit=${3 + rounds}`);
		expect(message.content).toContain(`不得超出 ${rounds} 轮`);
		expect(message.content).toContain(
			JSON.stringify({ task_ref: f.taskRef, asset_ref: f.assetRef, request_id: receipt.next_request_id }),
		);
		expect(message.content).toContain("不得再次 renew");
		expect(f.ctx.executeTool).not.toHaveBeenCalled();
		expect(f.ctx.sessionManager.getSessionFile).not.toHaveBeenCalled();
		expect(f.ctx.sessionManager.getLeafId).not.toHaveBeenCalled();
		expect(f.task.data.scope_ref).toEqual(f.scopeRef);
	});

	it("accepts the explicitly scoped preserve-history/connect-host positive sentence", async () => {
		const f = fixture([userEntry(`为原任务 ${TASK} 追加1轮独立设计评审；保留历史；先接通受信任宿主能力再对r6续评。`)]);
		await f.emit();
		expect(f.grants.size).toBe(1);
	});

	it("accepts exactly the renderer authorization, then renews on SDK reload", async () => {
		const content = `为原任务 ${TASK} 追加1轮独立设计评审；保留全部历史与预算记录，请先接通受信任宿主的预算续授能力，再对r6续评。`;
		const f = fixture([userEntry("previous user")]);
		await f.emit("before_agent_start", { messageType: "user", prompt: content });
		expectNoGrant(f);
		expect(f.loadNative).not.toHaveBeenCalled();
		f.setBranch([userEntry(content)]); // SDK persistence, not an event.prompt authorization.
		f.register(); // Original SDK reload rebuilds extension runtime.
		await f.emit();
		expect(f.grants.size).toBe(1);
		expect(f.pi.sendMessage).toHaveBeenCalledWith(expect.any(Object), { triggerTurn: true });
		expect(f.pi.sendMessage.mock.calls[0][0].content).toContain("total_limit=4");
	});

	it.each(["撤销：", "引用：", "如果可行，", "示例：", "> "])(
		"rejects a prefixed renderer authorization: %s",
		async (prefix) => {
			const f = fixture([
				userEntry(
					`${prefix}为原任务 ${TASK} 追加1轮独立设计评审；保留全部历史与预算记录，请先接通受信任宿主的预算续授能力，再对r6续评。`,
				),
			]);
			await f.emit();
			expectNoGrant(f);
			expect(f.loadNative).not.toHaveBeenCalled();
		},
	);

	it("command invokes the same verifier with triggerTurn:true", async () => {
		const f = fixture();
		await f.commands.get("ui-review-budget").handler("", f.ctx);
		expect(f.callbackResults).toEqual([true]);
		expect(f.pi.sendMessage).toHaveBeenCalledWith(expect.any(Object), { triggerTurn: true });
	});

	it("before_agent_start uses an already persisted matching user, without an extra turn", async () => {
		const f = fixture();
		await f.emit("before_agent_start", { messageType: "user", prompt: text() });
		expect(f.pi.sendMessage).toHaveBeenCalledWith(expect.any(Object), { triggerTurn: false });
		await f.emit("before_agent_start", { messageType: "custom", message: { customType: "ui-review-budget-renewed" } });
		await f.emit("before_agent_start", { messageType: "user", prompt: text() });
		expect(f.renew).toHaveBeenCalledOnce();
		expect(f.pi.sendMessage).toHaveBeenCalledOnce();
	});

	it("before_agent_start never substitutes event.prompt for a missing persisted entry", async () => {
		const f = fixture([userEntry("ordinary old user")]);
		await f.emit("before_agent_start", { messageType: "user", prompt: text() });
		expectNoGrant(f);
		expect(f.loadNative).not.toHaveBeenCalled();
	});

	it("before_agent_start cannot spend an older authorization during a new pending revocation", async () => {
		const f = fixture();
		await f.emit("before_agent_start", { messageType: "user", prompt: "撤销授权" });
		expectNoGrant(f);
		expect(f.loadNative).not.toHaveBeenCalled();
	});

	it("receipt survives reload and does not regrant or trigger a second turn", async () => {
		const f = fixture();
		await f.emit();
		f.register();
		await f.emit();
		await f.commands.get("ui-review-budget").handler("", f.ctx);
		expect(f.renew).toHaveBeenCalledOnce();
		expect(f.pi.appendEntry).toHaveBeenCalledOnce();
		expect(f.pi.sendMessage).toHaveBeenCalledOnce();
	});

	it("a repeated entry has the same grant ID despite leaf/task state updates, even if receipt was lost", async () => {
		const f = fixture();
		await f.emit();
		const first = clone(f.renew.mock.calls[0][2]);
		f.setBranch([userEntry(), { id: "new-leaf", type: "message", message: { role: "assistant", content: "status" } }]);
		f.task.data.state = "active";
		f.task.data.blockers = ["new status only"];
		f.saveTask();
		f.register();
		await f.emit();
		expect(f.renew.mock.calls[1][2]).toEqual(first);
		expect(f.grants.size).toBe(1);
		expect(f.callbackResults).toEqual([true]); // native duplicate path does not call authorize again
	});

	it.each(["session", "entry", "input", "scope", "asset", "rounds"])(
		"independent authorization identity binds %s",
		async (change) => {
			const baseline = fixture();
			await baseline.emit();
			const first = baseline.renew.mock.calls[0][2].authorization_id;
			// Independent SDK history, not permission to mutate an already consumed
			// user entry's tuple. The entry consumption locks are tested separately.
			const f = fixture();
			if (change === "session") f.setSession("other-session");
			if (change === "entry") f.setBranch([userEntry(text(), "another-user-entry")]);
			if (change === "rounds") f.setBranch([userEntry(text(2))]);
			if (change === "input") {
				f.task.data.input_sha256 = "f".repeat(64);
				f.saveTask();
			}
			if (change === "asset") {
				(f.asset.data as any).extra = "different target bytes";
				f.persist(f.asset, f.assetRef.path);
			}
			if (change === "scope") {
				const scope = f.persist({ kind: "scope", id: "other", data: {} }, "qa/ui/scopes/other/manifest.json");
				f.task.data.scope_ref = scope;
				f.handed.data.scope_ref = scope;
				f.asset.data.scope_ref = scope;
				f.task.data.output_refs = [f.persist(f.handed, f.handedRef.path)];
				f.persist(f.asset, f.assetRef.path);
				f.saveTask();
			}
			f.budget(4, 4);
			f.register();
			await f.emit();
			expect(f.renew.mock.calls[0][2].authorization_id).not.toBe(first);
		},
	);

	it.each([
		[2, 3],
		[4, 3],
		[-1, -1],
		[3.5, 3.5],
	])("rejects used=%s/current_limit=%s, without top-up", async (used, limit) => {
		const f = fixture();
		f.budget(used, limit);
		await f.emit();
		expectNoGrant(f);
		expect(f.callbackResults).toEqual([false]);
		expect(f.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("blocked"), "warning");
	});

	it.each([
		"branch removed",
		"new revocation",
		"new positive user",
		"session changed",
		"scope changed",
		"asset changed",
		"input changed",
		"cwd changed",
	])("native callback revalidates: %s", async (change) => {
		const f = fixture();
		f.beforeCallback(() => {
			if (change === "branch removed") f.setBranch([]);
			if (change === "new revocation") f.setBranch([userEntry(), userEntry("撤销", "new-user")]);
			if (change === "new positive user") f.setBranch([userEntry(), userEntry(text(), "new-user")]);
			if (change === "session changed") f.setSession("new-session");
			if (change === "scope changed") {
				f.task.data.scope_ref.sha256 = "a".repeat(64);
				f.saveTask();
			}
			if (change === "asset changed") {
				f.asset.data.module_ids = ["other"];
				f.persist(f.asset, f.assetRef.path);
			}
			if (change === "input changed") {
				f.task.data.input_sha256 = "f".repeat(64);
				f.saveTask();
			}
			if (change === "cwd changed") f.ctx.cwd = "/other-workspace";
		});
		await f.emit();
		expectNoGrant(f);
		expect(f.callbackResults).toEqual([false]);
	});

	it.each(["authorization_id", "additional_rounds", "reason", "task_ref", "asset_ref", "used_rounds", "current_limit"])(
		"rejects altered native callback field %s",
		async (field) => {
			const f = fixture();
			f.renew.mockImplementationOnce(async (t, a, auth, authorize) => {
				const request = { ...auth, task_ref: t, asset_ref: a, used_rounds: 3, current_limit: 3 };
				(request as any)[field] = ["task_ref", "asset_ref"].includes(field)
					? { path: "wrong", sha256: "b".repeat(64) }
					: "wrong";
				expect(await authorize(request)).toBe(false);
				throw new Error("rejected");
			});
			await f.emit();
			expectNoGrant(f);
		},
	);
});

describe("one frozen tuple per original SDK authorization entry", () => {
	it.each(["branch receipt", "reloaded receipt", "runtime without receipt"])(
		"%s prevents a second tuple after frozen artifacts change",
		async (mode) => {
			for (const change of ["asset", "input", "scope", "source scope", "rounds", "revision"]) {
				const f = fixture();
				await f.emit();
				const originalId = f.renew.mock.calls[0][2].authorization_id;
				const receiptEntry = clone(f.branch().find((entry) => entry.type === "custom")!);
				let authorization = userEntry();
				if (change === "asset") {
					(f.asset.data as any).extra = "rewritten r6 bytes";
					f.persist(f.asset, f.assetRef.path);
				}
				if (change === "input") {
					f.task.data.input_sha256 = "f".repeat(64);
					f.saveTask();
				}
				if (change === "scope" || change === "source scope") {
					const scopePath = change === "scope" ? "qa/ui/scopes/changed/manifest.json" : f.scopeRef.path;
					const scope = f.persist(
						{ kind: "scope", id: "changed", data: { budget: { max_review_rounds: 3 } } },
						scopePath,
					);
					f.task.data.scope_ref = scope;
					f.handed.data.scope_ref = scope;
					f.asset.data.scope_ref = scope;
					f.task.data.output_refs = [f.persist(f.handed, f.handedRef.path)];
					f.persist(f.asset, f.assetRef.path);
					f.saveTask();
				}
				if (change === "rounds") authorization = userEntry(text(2));
				if (change === "revision") {
					authorization = userEntry(text(1, "r7"));
					f.persist(
						{ ...f.asset, data: { ...f.asset.data, revision: "r7" } },
						`qa/ui/assets/${ASSET}/revisions/r7/manifest.json`,
					);
				}
				f.setBranch(mode === "runtime without receipt" ? [authorization] : [authorization, receiptEntry]);
				if (mode === "reloaded receipt") f.register();
				f.budget(4, 4); // Exhaustion cannot bypass the original entry lock.
				await f.emit();
				expect(f.renew, `${mode}/${change}`).toHaveBeenCalledOnce();
				expect(f.grants.size).toBe(1);
				expect([...f.grants.keys()]).toEqual([originalId]);
				expect(f.pi.appendEntry).toHaveBeenCalledOnce();
				expect(f.pi.sendMessage).toHaveBeenCalledOnce();
				expect(f.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("blocked"), "warning");
			}
		},
	);

	it.each(["additional_rounds", "revision", "asset_ref", "scope_ref", "authorization_id"])(
		"a conflicting receipt field %s fails closed even if ID otherwise matches",
		async (field) => {
			const f = fixture();
			await f.emit();
			const branch = clone(f.branch());
			const receipt = branch.find((entry) => entry.type === "custom")!.data;
			receipt[field] = ["asset_ref", "scope_ref"].includes(field) ? { path: "wrong", sha256: "f".repeat(64) } : "wrong";
			f.setBranch(branch);
			f.register();
			await f.emit();
			expect(f.renew).toHaveBeenCalledOnce();
			expect(f.pi.sendMessage).toHaveBeenCalledOnce();
			expect(f.ctx.ui.notify).toHaveBeenCalledOnce();
		},
	);

	it("receipt hydration also locks the same runtime after the branch omits that receipt", async () => {
		const f = fixture();
		await f.emit();
		f.register();
		await f.emit(); // Hydrate from receipt, no native renewal.
		f.setBranch([userEntry()]);
		f.task.data.input_sha256 = "f".repeat(64);
		f.saveTask();
		f.budget(4, 4);
		await f.emit();
		expect(f.renew).toHaveBeenCalledOnce();
		expect(f.grants.size).toBe(1);
		expect(f.pi.sendMessage).toHaveBeenCalledOnce();
		expect(f.ctx.ui.notify).toHaveBeenCalledOnce();
	});
});

describe("persistent branch authorization and latest-user concurrency", () => {
	it.each([
		"目前进展怎么样？",
		"还有几轮可用额度？",
		"请说明源码与测试结果。",
		"Peer Hand-off (sa-7dde8): 请继续原任务，保留此前结果。",
	])("ordinary follow-up keeps the original authorization entry, once: %s", async (followup) => {
		const f = fixture([userEntry(), userEntry(followup, "clarification-entry")]);
		await f.emit();
		expect(f.callbackResults).toEqual([true]);
		expect(f.pi.appendEntry.mock.calls[0][1]).toMatchObject({ user_entry_id: "user-authorization", total_limit: 4 });
		expect(f.renew.mock.calls[0][2].reason).toContain("original-session/user-authorization");
		expect(f.renew.mock.calls[0][2].reason).not.toContain("clarification-entry");
		f.setBranch([...f.branch(), userEntry("请继续说明状态。", "later-clarification")]);
		f.register();
		await f.emit();
		expect(f.renew).toHaveBeenCalledOnce();
		expect(f.pi.appendEntry).toHaveBeenCalledOnce();
		expect(f.pi.sendMessage).toHaveBeenCalledOnce();
	});

	it("a peer hand-off entry never changes the original grant identity even without a receipt", async () => {
		const f = fixture();
		await f.emit();
		const original = clone(f.renew.mock.calls[0][2]);
		f.setBranch([userEntry(), userEntry("Peer Hand-off (sa-7dde8): 实现完成，请继续核验。", "handoff")]);
		f.register();
		await f.emit();
		expect(f.renew.mock.calls[1][2]).toEqual(original);
		expect(f.grants.size).toBe(1);
		expect(f.callbackResults).toEqual([true]);
	});

	it("recognizes the real bracketed peer hand-off with historical budget and r6 references", async () => {
		const handoff = `[Peer Hand-off from implement subagent (sa-7dde8)]:\n原授权追加1轮，候选对r6续评；历史引用：${text()}\n检查拒绝用例：不要追加、改为r7。`;
		const f = fixture([userEntry(), userEntry(handoff, "handoff")]);
		await f.emit();
		expect(f.callbackResults).toEqual([true]);
		expect(f.renew.mock.calls[0][2]).toMatchObject({
			additional_rounds: 1,
			reason: expect.stringContaining("/user-authorization:"),
		});
		expect(f.pi.appendEntry.mock.calls[0][1]).toMatchObject({
			user_entry_id: "user-authorization",
			revision: "r6",
			total_limit: 4,
		});
		f.register();
		await f.emit();
		expect(f.renew).toHaveBeenCalledOnce();
		expect(f.pi.sendMessage).toHaveBeenCalledOnce();
	});

	it("the real bracketed hand-off cannot authorize without the original branch entry", async () => {
		const f = fixture([userEntry(`[Peer Hand-off from implement subagent (sa-7dde8)]:\n${text()}`, "handoff")]);
		await f.emit();
		expectNoGrant(f);
		expect(f.loadNative).not.toHaveBeenCalled();
	});

	it.each([
		"[普通备注]:\n",
		"[Peer Hand-off]:\n",
		"[Peer Hand-off from ]:\n",
		"[Peer Hand-off from implement subagent (sa-7dde8)]\n",
		"[Peer Hand-off from implement subagent (sa-7dde8)]: 改为r7；",
		"[Peer Hand-off from implement subagent\n(sa-7dde8)]:\n",
	])("arbitrary/malformed bracket wrappers never exempt changed instructions: %s", async (prefix) => {
		const f = fixture([userEntry(), userEntry(`${prefix}追加2轮；对r7续评。`, "followup")]);
		await f.emit();
		expectNoGrant(f);
		expect(f.loadNative).not.toHaveBeenCalled();
	});

	it("switching away from and back to the authorization only reuses the same one-round native grant", async () => {
		const f = fixture();
		await f.emit();
		const original = clone(f.renew.mock.calls[0][2]);
		f.setBranch([userEntry("普通分支，无授权。", "other-branch")]);
		f.register();
		await f.emit();
		expect(f.renew).toHaveBeenCalledOnce();
		f.setBranch([
			userEntry(),
			userEntry(`[Peer Hand-off from implement subagent (sa-7dde8)]:\n历史追加1轮，引用r6。`, "handoff"),
		]);
		f.register();
		await f.emit();
		expect(f.renew).toHaveBeenCalledTimes(2);
		expect(f.renew.mock.calls[1][2]).toEqual(original);
		expect(f.grants.size).toBe(1);
		expect(f.callbackResults).toEqual([true]);
		const grant = [...f.grants.values()][0];
		expect(grant).toMatchObject({ additional_rounds: 1, previous_limit: 3, total_limit: 4, asset_ref: f.assetRef });
		expect(f.pi.appendEntry.mock.calls[1][1]).toMatchObject({
			authorization_id: original.authorization_id,
			total_limit: 4,
			revision: "r6",
		});
	});

	it("peer hand-off historical quotations neither replace nor revoke the original authorization", async () => {
		const handoff = `Peer Hand-off (sa-7dde8)\n历史输入：${text(3, "r7")}\n安全用例：撤销授权；不要追加。\n普通交接：等待主会话验收。`;
		const f = fixture([userEntry(), userEntry(handoff, "handoff")]);
		await f.emit();
		expect(f.grants.size).toBe(1);
		expect(f.renew.mock.calls[0][2]).toMatchObject({
			additional_rounds: 1,
			reason: expect.stringContaining("/user-authorization:"),
		});
		expect(f.pi.appendEntry.mock.calls[0][1]).toMatchObject({
			user_entry_id: "user-authorization",
			revision: "r6",
			total_limit: 4,
		});
	});

	it("a hand-off cannot override an explicit revocation earlier in the branch", async () => {
		const f = fixture([
			userEntry(),
			userEntry("停止续评", "revocation"),
			userEntry("Peer Hand-off (sa-7dde8): 请继续。", "handoff"),
		]);
		await f.emit();
		expectNoGrant(f);
		expect(f.loadNative).not.toHaveBeenCalled();
	});

	it("a marked extension follow-up cannot create authority but ordinary text does not revoke existing authority", async () => {
		const followup = userEntry("Peer Hand-off: 测试结果已就绪。", "handoff");
		followup.message.source = "extension";
		const f = fixture([userEntry(), followup]);
		await f.emit();
		expect(f.grants.size).toBe(1);
		expect(f.pi.appendEntry.mock.calls[0][1].user_entry_id).toBe("user-authorization");
	});

	it.each([
		"撤销授权",
		"取消授权",
		"停止续评",
		"暂停独立设计评审",
		"不要追加",
		"不再续评",
		"改为r7",
		"修订改为r7",
		"任务改为another-task",
		"调整额度为2轮",
		"改成2轮",
		"追加2轮",
		"对r7续评",
	])("revocation or changed target/budget blocks fallback to an older authorization: %s", async (followup) => {
		const f = fixture([userEntry(), userEntry(followup, "change"), userEntry("进展怎么样？", "question")]);
		await f.emit();
		expectNoGrant(f);
		expect(f.renew).not.toHaveBeenCalled();
		expect(f.loadNative).not.toHaveBeenCalled();
	});

	it.each([text(1, "r7"), text().replace(TASK, "another-task")])(
		"a newer complete authorization with a missing target never falls back: %s",
		async (content) => {
			const f = fixture([userEntry(), userEntry(content, "new-authorization"), userEntry("请说明进展。", "question")]);
			await f.emit();
			expectNoGrant(f);
			expect(f.renew).not.toHaveBeenCalled();
		},
	);

	it("a newer complete budget authorization binds its own entry and exact rounds, never the older entry", async () => {
		const f = fixture([userEntry(), userEntry(text(2), "new-authorization"), userEntry("还有哪些检查？", "question")]);
		await f.emit();
		expect(f.grants.size).toBe(1);
		expect(f.renew.mock.calls[0][2]).toMatchObject({
			additional_rounds: 2,
			reason: expect.stringContaining("/new-authorization:"),
		});
		expect(f.pi.appendEntry.mock.calls[0][1]).toMatchObject({ user_entry_id: "new-authorization", total_limit: 5 });
	});

	it("before_agent_start compares expectedPrompt with the latest clarification, not the original authorization", async () => {
		const clarification = "Peer Hand-off (sa-7dde8): 继续检查结果。";
		const f = fixture([userEntry(), userEntry(clarification, "handoff")]);
		await f.emit("before_agent_start", { messageType: "user", prompt: text() });
		expectNoGrant(f);
		expect(f.loadNative).not.toHaveBeenCalled();
		await f.emit("before_agent_start", { messageType: "user", prompt: clarification });
		expect(f.grants.size).toBe(1);
		expect(f.pi.sendMessage).toHaveBeenCalledWith(expect.any(Object), { triggerTurn: false });
		expect(f.pi.appendEntry.mock.calls[0][1].user_entry_id).toBe("user-authorization");
	});

	it.each([
		"new ordinary user",
		"same latest ID with changed text",
		"original authorization removed",
		"original authorization text changed",
	])("callback rejects a changed branch snapshot: %s", async (change) => {
		const original = userEntry();
		const clarification = userEntry("进展怎么样？", "question");
		const f = fixture([original, clarification]);
		f.beforeCallback(() => {
			if (change === "new ordinary user")
				f.setBranch([original, clarification, userEntry("Peer Hand-off: 继续。", "handoff")]);
			if (change === "same latest ID with changed text")
				f.setBranch([original, userEntry("请报告测试结果。", "question")]);
			if (change === "original authorization removed") f.setBranch([clarification]);
			if (change === "original authorization text changed") f.setBranch([userEntry(text(2)), clarification]);
		});
		await f.emit();
		expectNoGrant(f);
		expect(f.callbackResults).toEqual([false]);
	});

	it("without an original authorization, a peer hand-off grants nothing and reads no files", async () => {
		const f = fixture([userEntry("Peer Hand-off (sa-7dde8): 实现完成，请继续。", "handoff")]);
		await f.emit();
		expectNoGrant(f);
		expect(f.loadNative).not.toHaveBeenCalled();
		expect(io.read).not.toHaveBeenCalled();
	});
});

describe("asset handoff, blocked paths and failure isolation", () => {
	it.each([
		"missing target",
		"no handoff",
		"wrong target module",
		"wrong target scope",
		"wrong target ID",
		"wrong target revision",
		"multiple asset IDs",
		"stale handed SHA",
		"completed",
		"wrong stage",
	])("rejects %s without native renewal", async (change) => {
		const f = fixture();
		if (change === "missing target") io.files.delete(join(ROOT, f.assetRef.path));
		if (change === "no handoff") f.task.data.output_refs = [];
		if (change === "wrong target module") f.asset.data.module_ids = ["other"];
		if (change === "wrong target scope") f.asset.data.scope_ref.sha256 = "b".repeat(64);
		if (change === "wrong target ID") f.asset.id = "different-id";
		if (change === "wrong target revision") f.asset.data.revision = "r7";
		if (change.startsWith("wrong target")) f.persist(f.asset, f.assetRef.path);
		if (change === "multiple asset IDs") {
			f.task.data.output_refs.push(
				f.persist({ ...f.handed, id: "other" }, "qa/ui/assets/other/revisions/r3/manifest.json"),
			);
		}
		if (change === "stale handed SHA") f.task.data.output_refs[0].sha256 = "a".repeat(64);
		if (change === "completed") f.task.data.state = "completed";
		if (change === "wrong stage") f.task.data.stage = "execute";
		f.saveTask();
		await f.emit();
		expectNoGrant(f);
		expect(f.renew).not.toHaveBeenCalled();
	});

	it("finds the exact requested revision from asset_refs as well as output_refs", async () => {
		const f = fixture();
		(f.task.data.asset_refs as Ref[]) = [f.handedRef];
		f.task.data.output_refs = [];
		f.saveTask();
		await f.emit();
		expect(f.grants.size).toBe(1);
	});

	it("never falls back to a globally newer unrelated revision", async () => {
		const f = fixture();
		io.files.delete(join(ROOT, f.assetRef.path));
		f.persist({ ...f.asset, id: "unrelated" }, "qa/ui/assets/unrelated/revisions/r6/manifest.json");
		await f.emit();
		expectNoGrant(f);
		expect(io.read.mock.calls.map(([path]) => path)).not.toContain(
			join(ROOT, "qa/ui/assets/unrelated/revisions/r6/manifest.json"),
		);
	});

	it("rejects a target realpath escaping the workspace", async () => {
		const f = fixture();
		io.realpath.mockImplementation(async (path: string) =>
			path.endsWith("/r6/manifest.json") ? "/outside/manifest.json" : path,
		);
		await f.emit();
		expectNoGrant(f);
		expect(f.renew).not.toHaveBeenCalled();
	});

	it("requires SDK sessionDir, ignores caller authorityRoot/sessionFile", async () => {
		const f = fixture();
		Object.assign(f.ctx, {
			authorityRoot: "/caller-authority",
			sessionFile: "/caller-session.jsonl",
			authorized: true,
		});
		f.ctx.sessionManager.getSessionDir = () => "";
		await f.emit();
		expectNoGrant(f);
		expect(f.loadNative).not.toHaveBeenCalled();
	});

	it("reports native failure locally with no retry, fallback, or sensitive error leak", async () => {
		const f = fixture();
		f.renew.mockRejectedValueOnce(new Error("secret-private-path /private/fake-secret"));
		await f.emit();
		expectNoGrant(f);
		expect(f.renew).toHaveBeenCalledOnce();
		expect(f.ctx.ui.notify).toHaveBeenCalledOnce();
		expect(JSON.stringify(f.ctx.ui.notify.mock.calls)).not.toContain("secret-private-path");
	});

	it("rejects a malformed native return without persisting a receipt or triggering a turn", async () => {
		const f = fixture();
		f.renew.mockResolvedValueOnce({ authorization_id: "forged", total_limit: 999 } as any);
		await f.emit();
		expectNoGrant(f);
	});

	it("does not trigger when the latest user changes after native returns", async () => {
		const f = fixture();
		const native = f.renew.getMockImplementation()!;
		f.renew.mockImplementationOnce(async (...args) => {
			const grant = await native(...args);
			f.setBranch([userEntry(), userEntry("撤销", "new-user")]);
			return grant;
		});
		await f.emit();
		expect(f.grants.size).toBe(1); // The stub grant already exists; never invent rollback.
		expect(f.pi.appendEntry).not.toHaveBeenCalled();
		expect(f.pi.sendMessage).not.toHaveBeenCalled();
		expect(f.ctx.ui.notify).toHaveBeenCalledOnce();
	});

	it("overlapping lifecycle/command calls cannot duplicate a grant or continuation", async () => {
		const f = fixture();
		let release!: () => void;
		f.beforeCallback(
			() =>
				new Promise<void>((done) => {
					release = done;
				}),
		);
		const first = f.emit();
		await vi.waitFor(() => expect(release).toBeTypeOf("function"));
		await f.commands.get("ui-review-budget").handler("", f.ctx);
		release();
		await first;
		expect(f.renew).toHaveBeenCalledOnce();
		expect(f.pi.sendMessage).toHaveBeenCalledOnce();
	});

	it("persists an at-most-once receipt before scheduling, including send failure/reload", async () => {
		const f = fixture();
		f.pi.sendMessage.mockImplementationOnce(() => {
			throw new Error("synthetic scheduling failure");
		});
		await f.emit();
		expect(f.pi.appendEntry.mock.invocationCallOrder[0]).toBeLessThan(f.pi.sendMessage.mock.invocationCallOrder[0]);
		f.register();
		await f.emit();
		expect(f.renew).toHaveBeenCalledOnce();
		expect(f.pi.sendMessage).toHaveBeenCalledOnce();
		expect(f.ctx.ui.notify).toHaveBeenCalledOnce();
	});
});
