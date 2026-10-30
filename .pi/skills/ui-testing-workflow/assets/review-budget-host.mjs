// Trusted extension code only. No tools, MCP, session-file readers or authority writers.
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const RECEIPT = "ui-review-budget-host-receipt";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sameRef = (a, b) => a?.path === b?.path && a?.sha256 === b?.sha256;
const modules = (asset) => JSON.stringify([...asset.data.module_ids].sort());
const requireThat = (condition, message) => {
	if (!condition) throw new Error(message);
};

// Fail closed: the entire user text must be this positive instruction, not an
// embedded quotation/example/conditional. Extra prose is deliberately not inferred.
function instruction(text) {
	const match =
		/^为原任务 ([a-zA-Z0-9][a-zA-Z0-9._-]{0,95}) 追加([1-3])轮独立设计评审[；，。\n]\s*(?:保留历史；先接通受信任宿主能力再|保留全部历史与预算记录，请先接通受信任宿主的预算续授能力，再)?对(r\d+)续评[。！]?$/.exec(
			text.trim(),
		);
	return match ? { taskId: match[1], rounds: Number(match[2]), revision: match[3] } : undefined;
}

function userText(entry) {
	const content = entry.message.content;
	return typeof content === "string"
		? content
		: Array.isArray(content) &&
			  content.length > 0 &&
			  content.every((block) => block.type === "text" && typeof block.text === "string")
			? content.map((block) => block.text).join("\n")
			: "";
}

function extensionSource(entry) {
	return [entry, entry.message].some(
		(item) =>
			[item.source, item.origin, item.provenance?.source].includes("extension") ||
			item.fromHook === true ||
			item.fromExtension === true,
	);
}

// Follow-up questions and peer hand-offs carry no new authority. Explicit
// revocation or an incomplete/ambiguous instruction changing the target/budget
// blocks fallback to an older grant. Only instruction() can authorize anew.
function interruptsAuthorization(text) {
	return /撤销|取消授权|取消续授|取消续评|(?:停止|终止|暂停)[^\n。！？]{0,16}(?:续评|评审|续授|追加)|(?:不要|不再|不得|禁止|别)[^\n。！？]{0,12}(?:追加|续评|续授|评审)|(?:改为|改成|改到|改用|更换|修改|变更|调整|切换)[^\n。！？]{0,48}(?:任务|task|r\d+|修订|revision|额度|轮数|[0-9一二三]+轮)|(?:任务|task|修订|revision|额度|轮数)[^\n。！？]{0,24}(?:改为|改成|改到|改用|更换|修改|变更|调整|切换)|(?:追加|增加|再评|再跑)\s*[0-9一二三]+\s*轮|对r\d+续评|\b(?:revoke|cancel|stop)\b[^\n.!?]{0,24}\b(?:authorization|review|renewal)\b/i.test(
		text,
	);
}

function currentUser(ctx) {
	const manager = ctx.sessionManager;
	const branch = manager.getBranch();
	requireThat(Array.isArray(branch), "缺少活动 SDK branch");
	const users = branch.filter((item) => item.type === "message" && item.message?.role === "user");
	const latest = users.at(-1);
	requireThat(latest?.id && manager.getSessionId(), "缺少活动 SDK user entry/session");
	// This snapshot is solely a concurrency/pending-prompt guard. It must never
	// replace the original authorization entry in the stable grant identity.
	const latestUser = { entryId: latest.id, text: userText(latest), content: JSON.stringify(latest.message.content) };
	for (const entry of users.reverse()) {
		const text = userText(entry);
		// Peer hand-offs can quote historical instructions, test cases and
		// budgets. They carry neither fresh authorization nor revocation.
		if (
			/^Peer Hand-off(?:\s|[(:：]|$)/u.test(text.trimStart()) ||
			/^\[Peer Hand-off from [A-Za-z0-9][A-Za-z0-9 _.-]{0,95}(?: \(sa-[A-Za-z0-9-]+\))?\]:\r?\n/u.test(text.trimStart())
		)
			continue;
		const authorization = instruction(text);
		if (authorization) {
			requireThat(entry.id && !extensionSource(entry), "extension 来源不能授权");
			return { branch, sessionId: manager.getSessionId(), entryId: entry.id, text, latestUser, ...authorization };
		}
		requireThat(!interruptsAuthorization(text), "后续 user 已撤销或变更续评授权");
	}
	throw new Error("活动 branch 缺少精确、完整的正向续授指令");
}

// Resolve from the workspace's physical package entry, not this extension's
// import map (which may point at a host shim). No fallback to global installs.
async function importmapHelper(cwd) {
	const entry = await realpath(createRequire(join(cwd, "package.json")).resolve("pi-ui-testing"));
	const [{ ArtifactStore }, { DesignReviewService }] = await Promise.all([
		import(pathToFileURL(join(dirname(entry), "store.js")).href),
		import(pathToFileURL(join(dirname(entry), "review.js")).href),
	]);
	return { ArtifactStore, DesignReviewService };
}

async function snapshot(cwd, path) {
	const target = await realpath(join(cwd, path));
	const local = relative(await realpath(cwd), target);
	requireThat(local && !local.startsWith("..") && !isAbsolute(local), "产物必须在工作区内");
	const bytes = await readFile(target);
	return { path, sha256: hash(bytes) };
}

async function binding(ctx, user, store) {
	const taskRef = await snapshot(ctx.cwd, `qa/ui/tasks/${user.taskId}/manifest.json`);
	const task = await store.load(taskRef);
	requireThat(task.kind === "task" && task.id === user.taskId, "原 task 身份不匹配");
	requireThat(!["completed", "cancelled"].includes(task.data.state), "原 task 已终结");
	const handedRefs = [...task.data.asset_refs, ...task.data.output_refs].filter((ref) =>
		/^qa\/ui\/assets\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\/revisions\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}\/manifest\.json$/.test(
			ref.path,
		),
	);
	requireThat(handedRefs.length, "原 task 未交接 asset ref");
	const handed = await Promise.all(handedRefs.map((ref) => store.load(ref)));
	const anchor = handed[0];
	requireThat(anchor.kind === "asset", "交接对象不是 asset");
	requireThat(
		handed.every(
			(asset) =>
				asset.kind === "asset" &&
				asset.id === anchor.id &&
				sameRef(asset.data.scope_ref, task.data.scope_ref) &&
				modules(asset) === modules(anchor),
		),
		"交接资产 ID/module/scope 不唯一或不匹配",
	);
	const assetRef = await snapshot(ctx.cwd, `qa/ui/assets/${anchor.id}/revisions/${user.revision}/manifest.json`);
	const asset = await store.load(assetRef);
	requireThat(
		asset.kind === "asset" &&
			asset.id === anchor.id &&
			asset.data.revision === user.revision &&
			sameRef(asset.data.scope_ref, task.data.scope_ref) &&
			modules(asset) === modules(anchor),
		"指定 revision 的 asset/module/scope 不匹配",
	);
	const scope = await store.load(task.data.scope_ref);
	requireThat(scope.kind === "scope", "缺少原 scope");
	const executeBeforeRun =
		task.data.intent === "execute" &&
		task.data.stage === "execute" &&
		task.data.run_ids.length === 0 &&
		task.data.asset_refs.length === 1 &&
		sameRef(task.data.asset_refs[0], assetRef);
	requireThat(task.data.stage === "design-review" || executeBeforeRun, "原 task 不在可续授阶段");
	const identity = {
		sessionId: user.sessionId,
		entryId: user.entryId,
		taskId: task.id,
		scopeRef: { path: task.data.scope_ref.path, sha256: task.data.scope_ref.sha256 },
		inputSha256: task.data.input_sha256,
		assetRef: { path: assetRef.path, sha256: assetRef.sha256 },
		rounds: user.rounds,
	};
	return { taskRef, assetRef, scopeRef: task.data.scope_ref, authorizationId: hash(JSON.stringify(identity)) };
}

/** Only the trusted loader calls this factory. The optional dependency is for
 * isolated unit tests; it is never registered as model input or command args.
 * A loaded extension is the SDK trust boundary, not a human-signature verifier.
 */
export function registerReviewBudgetHost(pi, { loadNative = importmapHelper } = {}) {
	let running = false;
	// One SDK user entry consumes one frozen authorization tuple. Across reloads
	// the branch receipt supplies this lock; outside that branch the native
	// idempotent grant relies on ArtifactStore's immutable frozen artifacts.
	// Never rewrite a frozen asset/source, task input or scope to obtain budget.
	const consumed = new Map();
	async function check(ctx, triggerTurn, expectedPrompt, explicit = false) {
		if (running) return;
		running = true;
		try {
			let user;
			try {
				user = currentUser(ctx);
			} catch (error) {
				if (explicit) throw error;
				return; // Ordinary startup: no imports, file reads, or UI side effects.
			}
			// In this SDK before_agent_start precedes user persistence. Never use
			// event.prompt as authority, nor renew an older user during a new turn.
			requireThat(
				expectedPrompt === undefined || expectedPrompt === user.latestUser.text,
				"当前回合 user 尚未写入 SDK branch",
			);
			const cwd = ctx.cwd,
				sessionDir = ctx.sessionManager.getSessionDir();
			requireThat(isAbsolute(cwd) && isAbsolute(sessionDir), "缺少 SDK cwd/sessionDir");
			const { ArtifactStore, DesignReviewService } = await loadNative(cwd);
			const store = new ArtifactStore(cwd);
			const bound = await binding(ctx, user, store);
			const id = bound.authorizationId;
			const entryKey = JSON.stringify([user.sessionId, user.entryId]);
			const receipts = user.branch.filter(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === RECEIPT &&
					entry.data?.session_id === user.sessionId &&
					entry.data?.user_entry_id === user.entryId,
			);
			if (consumed.has(entryKey) || receipts.length) {
				requireThat(
					(!consumed.has(entryKey) || consumed.get(entryKey) === id) &&
						receipts.every(
							({ data }) =>
								data.authorization_id === id &&
								data.additional_rounds === user.rounds &&
								data.revision === user.revision &&
								data.task_ref?.path === bound.taskRef.path &&
								sameRef(data.asset_ref, bound.assetRef) &&
								sameRef(data.scope_ref, bound.scopeRef),
						),
					"原 user entry 已消费另一冻结授权 tuple，拒绝再次续授",
				);
				consumed.set(entryKey, id);
				return;
			}
			const authorization = {
				authorization_id: id,
				additional_rounds: user.rounds,
				reason: `SDK user ${user.sessionId}/${user.entryId}: ${user.taskId}/${user.revision} +${user.rounds}`,
			};
			const revalidate = async () => {
				const latest = currentUser(ctx);
				requireThat(
					latest.sessionId === user.sessionId &&
						latest.entryId === user.entryId &&
						latest.text === user.text &&
						latest.latestUser.entryId === user.latestUser.entryId &&
						latest.latestUser.text === user.latestUser.text &&
						latest.latestUser.content === user.latestUser.content &&
						ctx.cwd === cwd &&
						ctx.sessionManager.getSessionDir() === sessionDir,
					"活动分支授权已变化或撤销",
				);
				const fresh = await binding(ctx, latest, store);
				requireThat(fresh.authorizationId === id && sameRef(fresh.taskRef, bound.taskRef), "授权范围或 task 已变化");
			};
			await revalidate();
			const service = new DesignReviewService(cwd, join(sessionDir, "ui-review-authority"));
			const grant = await service.renewBudget(bound.taskRef, bound.assetRef, authorization, async (request) => {
				try {
					await revalidate();
					return (
						request.authorization_id === id &&
						request.additional_rounds === user.rounds &&
						request.reason === authorization.reason &&
						sameRef(request.task_ref, bound.taskRef) &&
						sameRef(request.asset_ref, bound.assetRef) &&
						Number.isSafeInteger(request.current_limit) &&
						request.current_limit >= 1 &&
						request.used_rounds === request.current_limit
					);
				} catch {
					return false;
				}
			});
			// Native may already have saved the grant even if post-call validation
			// fails. Keep the entry consumed for this runtime, without writing authority.
			consumed.set(entryKey, id);
			await revalidate();
			requireThat(
				grant.authorization_id === id &&
					grant.additional_rounds === user.rounds &&
					grant.reason === authorization.reason &&
					grant.task_ref.path === bound.taskRef.path &&
					sameRef(grant.asset_ref, bound.assetRef) &&
					Number.isSafeInteger(grant.previous_limit) &&
					grant.previous_limit >= 1 &&
					grant.used_rounds === grant.previous_limit &&
					grant.total_limit === grant.previous_limit + user.rounds,
				"native grant 不符合本次授权",
			);
			const requestId = `ui-design-review-${id.slice(0, 24)}-${String(grant.used_rounds + 1).padStart(2, "0")}`;
			// Persist before scheduling: reload is at-most-once. A crash/send failure
			// after append is blocked for manual inspection, never auto-replayed.
			consumed.set(entryKey, id);
			pi.appendEntry(RECEIPT, {
				...grant,
				session_id: user.sessionId,
				user_entry_id: user.entryId,
				revision: user.revision,
				scope_ref: bound.scopeRef,
				next_request_id: requestId,
			});
			pi.sendMessage(
				{
					customType: "ui-review-budget-renewed",
					display: true,
					content:
						`原任务 ${user.taskId}/${user.revision} 的 native 续授已保存；保留历史和原 scope，未产生设计批准。\n` +
						`原 scope 额度 +${user.rounds}：previous_limit=${grant.previous_limit}，total_limit=${grant.total_limit}。` +
						`本次最多追加 ${user.rounds} 轮独立设计评审，不得超出 ${user.rounds} 轮，不得再次 renew 或重置 task/scope。\n` +
						`在当前正常模型回合使用原生 ui_design_review，下一次精确请求：${JSON.stringify({ task_ref: bound.taskRef, asset_ref: bound.assetRef, request_id: requestId })}\n` +
						`原 scope_ref=${JSON.stringify(bound.scopeRef)}；不要重放旧 request_id，不得自行构造 review。`,
				},
				{ triggerTurn },
			);
		} catch {
			// Local-only, no tool approval fallback and no private path/error leak.
			ctx.ui?.notify(
				"blocked：UI 评审续授未完成；请核对活动 branch 原明确授权、后续撤销/变更、task/asset/scope 与 native 额度。不自动重试。",
				"warning",
			);
		} finally {
			running = false;
		}
	}
	pi.on("session_start", async (_event, ctx) => check(ctx, true));
	pi.on("before_agent_start", async (event, ctx) => {
		if (event.messageType !== "user") return;
		return check(ctx, false, event.prompt);
	});
	if (typeof pi.registerCommand === "function")
		pi.registerCommand("ui-review-budget", {
			description: "Verify the active SDK branch authorization and renew native UI review budget",
			handler: async (args, ctx) => {
				if (typeof args !== "string" || args.trim()) {
					ctx.ui?.notify("blocked：/ui-review-budget 不接受参数或授权字段。", "warning");
					return;
				}
				await check(ctx, true, undefined, true);
			},
		});
}

export default registerReviewBudgetHost;
