import { maskSecrets } from "./client/brief.mjs";
import { dynamicFresh, dynamicSummary, redactEnvSecrets, scriptReady } from "./env-script.mjs";
/**
 * 数据空间的 AI 工具（v2/v3）：查询用例 & 回写执行结果。
 *
 * 定位：**对话里按需取数**。面板里的「引入对话」把内容内联进 prompt，适合少量用例一眼看全；
 * 一旦是整功能 / 整模块，内联就是几万字。所以批量场景走「轻引用（引用档）+ 工具按需拉明细」：
 * 模型拿着编号或锚点调 `data_space_cases` 取步骤与预期，执行完用 `data_space_record_result` 回写。
 *
 * 约束：
 *   - 只读工具不写盘；回写工具只追加执行记录（runs.json），不改用例内容。
 *   - 环境只给名称 / 地址 / 参数名与非敏感值；标了 secret 的参数一律 `***`，
 *     不进模型上下文（要真实口令就让用户自己用，别让它猜）。
 *   - 脚本敏感动态值同样不出服务端；未接入私密参数执行链时明确阻塞，不经模型转交。
 *   - 文本给模型看，不追求好看；一条用例一行，字段用 · 分隔，超量时明确说「只给了前 N 条」。
 */
import { isStale, latestByCase, normalizeVerdict, parseAnchor, summarize } from "./runs.mjs";

const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const oneline = (v) => maskSecrets(str(v, 400)).replace(/\s*\n+\s*/g, "；");

/** 功能 → 「项目 / 模块 / 功能」；未归类返回空串。 */
export function featurePath(store, featureId) {
	const f = (store.features ?? []).find((x) => x.id === featureId);
	if (!f) return "";
	const m = (store.modules ?? []).find((x) => x.id === f.moduleId);
	const s = m ? (store.systems ?? []).find((x) => x.id === m.systemId) : null;
	return [s?.name, m?.name, f.name].filter(Boolean).join(" / ");
}

/** 名称或 id 的宽松匹配：给了值就要求命中（大小写不敏感的子串）。 */
function nameHit(names, target) {
	const t = str(target, 80).toLowerCase();
	if (!t) return true;
	return names.some((n) =>
		String(n ?? "")
			.toLowerCase()
			.includes(t),
	);
}

function casesInScope(store, opts) {
	const featureById = new Map((store.features ?? []).map((f) => [f.id, f]));
	const moduleById = new Map((store.modules ?? []).map((m) => [m.id, m]));
	const systemById = new Map((store.systems ?? []).map((s) => [s.id, s]));
	return (store.cases ?? []).filter((c) => {
		const f = featureById.get(c.featureId);
		const m = f ? moduleById.get(f.moduleId) : null;
		const s = m ? systemById.get(m.systemId) : null;
		if (opts.project && !nameHit([s?.id, s?.name, s?.code], opts.project)) return false;
		if (opts.module && !nameHit([m?.id, m?.name], opts.module)) return false;
		if (opts.feature && !nameHit([f?.id, f?.name], opts.feature)) return false;
		if (opts.type) {
			const want = str(opts.type, 20);
			if (want && String(c.type ?? "") !== want) return false;
		}
		if (opts.status && String(c.status ?? "") !== str(opts.status, 20)) return false;
		if (opts.priority && String(c.priority ?? "") !== str(opts.priority, 10)) return false;
		if (opts.owner && !nameHit([c.owner], opts.owner)) return false;
		if (opts.query) {
			const q = str(opts.query, 120).toLowerCase();
			const hay = [
				c.code,
				c.title,
				c.type,
				c.status,
				c.owner,
				c.note,
				...(c.tags ?? []),
				featurePath(store, c.featureId),
			]
				.join(" ")
				.toLowerCase();
			if (!hay.includes(q)) return false;
		}
		return true;
	});
}

/** 按 ids / 编号定位（编号大小写不敏感）；找不到的编号原样返回在 missing 里。 */
function pick(store, keys) {
	const wanted = (Array.isArray(keys) ? keys : [keys]).map((k) => str(k, 64)).filter(Boolean);
	const out = [];
	const missing = [];
	for (const key of wanted) {
		const low = key.toLowerCase();
		const hit =
			(store.cases ?? []).find((c) => c.id === key) ??
			(store.cases ?? []).find((c) => str(c.code, 24).toLowerCase() === low);
		if (hit) out.push(hit);
		else missing.push(key);
	}
	return { cases: out, missing };
}

/** 把查询参数收成一份可复述的「查了什么」——模型回话时能对准用户的问题。 */
function describeScope(opts) {
	const parts = [];
	if (opts.project) parts.push(`项目「${str(opts.project, 40)}」`);
	if (opts.module) parts.push(`模块「${str(opts.module, 40)}」`);
	if (opts.feature) parts.push(`功能「${str(opts.feature, 40)}」`);
	if (opts.type) parts.push(`类型 ${str(opts.type, 20)}`);
	if (opts.status) parts.push(`状态 ${str(opts.status, 20)}`);
	if (opts.priority) parts.push(`${str(opts.priority, 10)}`);
	if (opts.result) parts.push(`最近结果 ${str(opts.result, 10)}`);
	if (opts.query) parts.push(`关键词「${str(opts.query, 60)}」`);
	return parts.join(" · ") || "全部用例";
}

function defaultEnvFor(store, featureId) {
	const f = (store.features ?? []).find((x) => x.id === featureId);
	const m = f ? (store.modules ?? []).find((x) => x.id === f.moduleId) : null;
	if (!m) return null;
	const list = (store.envs ?? []).filter((e) => e.systemId === m.systemId);
	return list.find((e) => e.isDefault) ?? list[0] ?? null;
}

/** 环境的一行写法：名称 + 地址（地址可能为空）。 */
const envText = (env) => (env ? [env.name, env.baseUrl].filter(Boolean).join(" · ") : "");

/**
 * 一个环境的完整块：名称 / 默认 / 地址 / 参数 / 敏感参数名 / 内置脚本 / 动态值 / 备注。
 * 敏感值连键值对都不给（只列名字），避免 `口令=***` 被下游脱敏规则二次改写后看不出原意。
 * 动态值（脚本取回的 token…）同样只给名字，refresh 也不返回敏感明文。
 */
function envBlock(env, nowMs = Date.now()) {
	const plain = [];
	const secret = [];
	for (const p of env.params ?? []) {
		const key = str(p?.key, 60);
		if (!key) continue;
		if (p.secret) secret.push(key);
		else plain.push(`${key}=${oneline(p?.value ?? "") || "—"}`);
	}
	const lines = [
		`- ${str(env.name, 60) || "未命名环境"}${env.isDefault ? "（默认）" : ""}${env.baseUrl ? ` · ${env.baseUrl}` : ""} · projectId=${env.systemId} · envId=${env.id}`,
	];
	lines.push(`  参数：${plain.length ? plain.join(" · ") : "（未配置）"}`);
	if (secret.length) lines.push(`  敏感：${secret.join("、")}（值不提供，需要时由用户本人填写或执行）`);
	const script = env.script ?? {};
	if (scriptReady(script)) {
		const run = env.scriptRun;
		const runText = run
			? ` · 上次运行 ${String(run.at).slice(5, 16).replace("T", " ")} ${run.ok ? "成功" : `失败：${oneline(run.error || "未知错误")}`}`
			: "";
		lines.push(`  内置脚本：${script.steps.length} 步 · 有效期 ${script.ttlMinutes} 分钟${runText}`);
	} else if (script.enabled) {
		lines.push("  内置脚本：已启用但没有可执行的步骤（至少一步要填地址）");
	}
	const dyn = Array.isArray(env.dynamic) ? env.dynamic : [];
	if (dyn.length) {
		const items = dyn.map((v) => {
			const note = dynamicSummary(v, nowMs);
			const state = note ? `（${note}）` : "";
			return v.secret ? `${v.key} 已取到${state}` : `${v.key}=${oneline(v.value) || "—"}${state}`;
		});
		lines.push(`  动态值：${items.join(" · ")}${dynamicFresh(env, nowMs) ? "" : "（已过期，需要显式 refresh）"}`);
	}
	if (str(env.note, 200)) lines.push(`  备注：${oneline(env.note)}`);
	return lines.join("\n");
}

function resultTag(runsByCase, c) {
	const run = runsByCase.get(c.id);
	if (!run) return "未执行";
	const stale = isStale(run, c) ? "（用例已更新，结果可能过期）" : "";
	return `${run.verdict} ${String(run.at).slice(5, 16).replace("T", " ")}${stale}`;
}

/** 一行一条（list 档）：编号 · 标题 / 路径 / 类型 · 优先级 · 状态 · 最近结果。 */
export function formatCaseLines(store, cases, runsByCase) {
	return cases
		.map((c, i) => {
			const path = featurePath(store, c.featureId) || "未归类";
			const env = envText(defaultEnvFor(store, c.featureId));
			const meta = [c.type || "未分类", c.priority, c.status, `最近 ${resultTag(runsByCase, c)}`]
				.concat(env ? [`环境 ${env}`] : [])
				.join(" · ");
			return `${i + 1}. ${str(c.code, 24) || "（无编号）"} · ${oneline(c.title) || "未命名"}\n   路径：${path}\n   ${meta} · 步骤 ${(c.steps ?? []).length} 条`;
		})
		.join("\n");
}

/** 卡片档（detail=card）：带上步骤、预期与关联数据名称，够模型直接执行或评审。 */
export function formatCaseCards(store, cases, runsByCase) {
	return cases
		.map((c, i) => {
			const lines = [`${i + 1}. ${str(c.code, 24) || "（无编号）"} · ${oneline(c.title) || "未命名"}`];
			lines.push(`   路径：${featurePath(store, c.featureId) || "未归类"}`);
			lines.push(
				`   类型：${c.type || "未分类"} · ${c.priority} · ${c.status}${str(c.owner) ? ` · 负责人 ${str(c.owner, 40)}` : ""} · 最近 ${resultTag(runsByCase, c)}`,
			);
			if (str(c.preconditions)) lines.push(`   前置条件：${oneline(c.preconditions)}`);
			const steps = (c.steps ?? []).filter((s) => str(s.action) || str(s.expect));
			if (!steps.length) lines.push("   步骤：（未填写）");
			else {
				lines.push("   步骤：");
				steps.forEach((s, j) => {
					lines.push(
						`     ${j + 1}) ${oneline(s.action) || "—"}${str(s.expect) ? ` → 预期：${oneline(s.expect)}` : ""}`,
					);
				});
			}
			const data = envText(defaultEnvFor(store, c.featureId));
			if (data) lines.push(`   环境：${data}`);
			if (str(c.note)) lines.push(`   备注：${oneline(c.note)}`);
			return lines.join("\n");
		})
		.join("\n\n");
}

export function formatStats(store, runs) {
	const list = Array.isArray(runs) ? runs : (runs?.runs ?? []);
	const s = summarize(list, store.cases ?? []);
	const api = (store.cases ?? []).filter((c) => c.type === "接口").length;
	const ui = (store.cases ?? []).filter((c) => c.type === "UI").length;
	const features = store.features ?? [];
	const covered = features.filter((f) => (store.cases ?? []).some((c) => c.featureId === f.id)).length;
	const latest = latestByCase(list);
	const failed = (store.cases ?? [])
		.filter((c) => latest.get(c.id)?.verdict === "失败")
		.slice(0, 8)
		.map((c) => `${str(c.code, 24) || c.id} · ${oneline(c.title)}（${resultTag(latest, c)}）`);
	return [
		`数据空间概览（数据 revision ${store.revision ?? 0} · 结果 revision ${runs?.revision ?? 0}）`,
		`- 项目 ${(store.systems ?? []).length} · 模块 ${(store.modules ?? []).length} · 功能 ${features.length} · 用例 ${(store.cases ?? []).length} · 环境 ${(store.envs ?? []).length}`,
		`- 环境分布：${(store.systems ?? []).filter((s) => (store.envs ?? []).some((e) => e.systemId === s.id)).length}/${(store.systems ?? []).length} 个项目已设地址`,
		`- 环境参数：${(store.envs ?? []).filter((e) => (e.params ?? []).length).length}/${(store.envs ?? []).length} 个环境已配参数`,
		`- 类型：接口 ${api} / UI ${ui}${(store.cases ?? []).length - api - ui > 0 ? ` / 其他 ${(store.cases ?? []).length - api - ui}` : ""}`,
		`- 覆盖：${covered}/${features.length} 个功能有用例${features.length ? `（${Math.round((covered / features.length) * 100)}%）` : ""}`,
		`- 执行：已执行 ${s.executed} · 通过 ${s["通过"]} / 失败 ${s["失败"]} / 阻塞 ${s["阻塞"]} · 未执行 ${s.untested} · 通过率 ${s.passRate}%${s.stale ? ` · 其中 ${s.stale} 条结果已过期` : ""}`,
		...(failed.length ? [`- 最近失败：\n${failed.map((x) => `   - ${x}`).join("\n")}`] : []),
	].join("\n");
}

/**
 * 组装两个工具。ctx:
 *   store()    → 当前 store 快照
 *   runs()     → 当前 runs 文件（{revision, runs}）
 *   record(entries, source) → {ok, recorded, unknown, runsRevision}
 */
export function createDataSpaceTools(ctx) {
	const lookupRuns = () => ctx.runs()?.runs ?? [];
	return [
		{
			name: "data_space_cases",
			label: "查用例",
			description:
				"Read test cases from the local Data Space store: filter by project / module / feature / type / status / priority / last result, look up specific case ids or codes, or get coverage and pass-rate stats. Use this instead of asking the user to paste cases when a case was referenced by code.",
			promptSnippet: "the user's test cases in Data Space (steps, expectations, results)",
			promptGuidelines: [
				"Use data_space_cases when the user names a case code (e.g. PMS-004), a feature/module, or asks which cases fail / are untested — fetch the real steps instead of inventing them.",
				"Use detail=card before executing or reviewing a case: it returns numbered steps with expectations.",
			],
			parameters: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: ["list", "get", "stats"],
						description:
							"list = filter and return matching cases; get = only the given ids/codes; stats = coverage and execution summary.",
					},
					project: { type: "string", description: "Project name, code or id (substring, case-insensitive)." },
					module: { type: "string", description: "Module name or id (substring)." },
					feature: { type: "string", description: "Feature name or id (substring)." },
					query: { type: "string", description: "Free-text filter over code / title / tags / owner / path." },
					ids: {
						type: "array",
						items: { type: "string" },
						description: "Case codes (PMS-004) or ids to fetch (action=get ignores other filters).",
					},
					type: { type: "string", description: "Case type, e.g. 接口 / UI." },
					status: { type: "string", description: "草稿 / 待评审 / 已评审 / 已废弃." },
					priority: { type: "string", description: "P0 / P1 / P2 / P3." },
					result: {
						type: "string",
						enum: ["通过", "失败", "阻塞", "未执行"],
						description: "Filter by the latest recorded execution result.",
					},
					detail: {
						type: "string",
						enum: ["list", "card"],
						description: "list = one block per case; card = with steps and expectations (default list).",
					},
					limit: { type: "number", description: "Max cases returned (default 20, max 100)." },
				},
			},
			async execute(_id, params) {
				const p = params && typeof params === "object" ? params : {};
				const store = ctx.store();
				const runs = lookupRuns();
				const runsByCase = latestByCase(runs);
				const action = str(p.action, 12) || (Array.isArray(p.ids) && p.ids.length ? "get" : "list");
				if (action === "stats") return formatStats(store, ctx.runs());

				const limit = Math.max(1, Math.min(100, Number.isFinite(Number(p.limit)) ? Math.floor(Number(p.limit)) : 20));
				let cases;
				let missing = [];
				if (action === "get") {
					const got = pick(store, p.ids ?? []);
					cases = got.cases;
					missing = got.missing;
					if (!cases.length)
						return `没有找到这些用例：${missing.join("、") || "（未给 ids）"}。可先用 data_space_cases 的 list 查编号。`;
				} else {
					cases = casesInScope(store, p);
					const want = str(p.result, 10);
					if (want) {
						cases = cases.filter((c) => {
							const run = runsByCase.get(c.id);
							return want === "未执行" ? !run : run?.verdict === want;
						});
					}
					// 优先级高的、最近改过的排前面（模型通常先看这些）
					cases = cases.slice().sort((a, b) => {
						const pr = String(a.priority ?? "P9").localeCompare(String(b.priority ?? "P9"));
						return pr !== 0 ? pr : String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
					});
				}
				const total = cases.length;
				const shown = cases.slice(0, limit);
				const head = [
					`数据空间 · ${describeScope(p)} · 命中 ${total} 条${total > shown.length ? `（只返回前 ${shown.length} 条，需要更多请加 limit 或缩小范围）` : ""}`,
					`数据 revision ${store.revision ?? 0}`,
				].join(" · ");
				const body =
					str(p.detail, 8) === "card"
						? formatCaseCards(store, shown, runsByCase)
						: formatCaseLines(store, shown, runsByCase);
				const tail = missing.length ? `\n\n未找到：${missing.join("、")}` : "";
				return maskSecrets(`${head}\n\n${body || "（没有匹配的用例）"}${tail}`);
			},
		},
		{
			name: "data_space_env",
			label: "查环境参数",
			description:
				"Read project environments without side effects. Explicit refresh prepares one environment through its HTTP script, reusing valid values unless forced. Secret values remain server-side; private browser credential consumption is not supported.",
			promptSnippet: "Look up test environment URLs and parameter readiness.",
			promptGuidelines: [
				"Use data_space_env before executing or automating cases that need a base URL, tenant, account, billing period or other environment-specific parameter — do not invent these values.",
				"Refresh requires one unambiguous environment. Secret-dependent execution remains blocked until a private execution adapter is available; never copy credentials into scripts or artifacts.",
			],
			parameters: {
				type: "object",
				properties: {
					project: {
						type: "string",
						description: "Restrict to one project by name, code or id (substring). Omit to include every project.",
					},
					env: { type: "string", description: "Environment name or id (substring), e.g. 测试环境 / 预发环境." },
					action: {
						type: "string",
						enum: ["list", "refresh"],
						description:
							"list (default): no network or writes. refresh: prepare one environment, reusing valid cached values.",
					},
					force: { type: "boolean", description: "Refresh even when cached values are valid (default false)." },
				},
			},
			async execute(_id, params) {
				const p = params && typeof params === "object" ? params : {};
				const project = str(p.project, 80);
				const envWant = str(p.env, 80);
				const action = str(p.action, 12) === "refresh" ? "refresh" : "list";
				const scope = [project ? `项目「${project}」` : "", envWant ? `环境「${envWant}」` : ""]
					.filter(Boolean)
					.join(" · ");
				const match = (store) => {
					const out = [];
					const exactProject = (store.systems ?? []).some((s) => s.id === project);
					const exactEnv = (store.envs ?? []).some((e) => e.id === envWant);
					for (const s of store.systems ?? []) {
						if (project && (exactProject ? s.id !== project : !nameHit([s.id, s.name, s.code], project))) continue;
						const list = (store.envs ?? []).filter(
							(e) =>
								e.systemId === s.id && (!envWant || (exactEnv ? e.id === envWant : nameHit([e.id, e.name], envWant))),
						);
						if (!list.length) continue;
						out.push({
							system: s,
							envs: list.slice().sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault)),
						});
					}
					return out;
				};
				if (!match(ctx.store()).length) {
					return `没有找到匹配的环境${scope ? `（${scope}）` : ""}。可以先用 data_space_cases 的 stats 看看有哪些项目，或让用户先在「环境」页建一条。`;
				}

				// 只读查询不运行脚本；网络与动态值写入只来自显式 refresh。
				const notes = [];
				const candidates = match(ctx.store())
					.flatMap((g) => g.envs)
					.filter((e) => scriptReady(e.script));
				const selected = match(ctx.store()).flatMap((g) => g.envs);
				if (action === "refresh" && selected.length !== 1)
					return `环境准备阻塞：匹配 ${selected.length} 个环境，请用明确 project/env ID 唯一指定；未运行任何脚本。`;
				const targets = action === "refresh" ? candidates : [];
				if (!candidates.length && action === "refresh") notes.push("这些环境没有启用内置脚本，没有可取的动态值。");
				if (targets.length && typeof ctx.refreshEnv === "function") {
					for (const env of targets) {
						const out = await ctx.refreshEnv(env.id, { force: p.force === true });
						if (out?.ok)
							notes.push(
								`「${str(env.name, 60)}」动态参数${out.cached ? "有效期内复用" : "已刷新"}；来源：环境内置脚本。`,
							);
						else if (!out?.ok) notes.push(`「${str(env.name, 60)}」动态值未更新：${oneline(out?.error || "未知错误")}`);
					}
				}
				if (targets.length && typeof ctx.refreshEnv !== "function")
					notes.push("环境准备阻塞：当前宿主不支持脚本刷新。");

				const store = ctx.store();
				const groups = match(store);
				const hit = groups.reduce((n, g) => n + g.envs.length, 0);
				const nowMs = Date.now();
				const body = groups
					.map(
						(g) =>
							`### ${str(g.system.name, 60)}${g.system.code ? `（${g.system.code}）` : ""}\n${g.envs.map((e) => envBlock(e, nowMs)).join("\n")}`,
					)
					.join("\n\n");
				const head = `数据空间 · 环境 · 命中 ${hit} 个${scope ? `（${scope}）` : ""}\n敏感参数只给名字，不返回明文。配置可读；网络、身份/角色、数据初态未验证。`;
				if (groups.some((g) => g.envs.some((e) => [...(e.params ?? []), ...(e.dynamic ?? [])].some((v) => v.secret))))
					notes.push("私密参数执行链未接入：依赖这些秘密的浏览器测试保持阻塞，不得经模型、用例、报告或归档转交明文。");
				const tail = [
					...notes.map((n) => `- ${n}`),
					...(action === "refresh" ? [] : ["- 需要 Token / 会话之类的最新值时，用 action=refresh 让脚本现取。"]),
				].join("\n");
				let output = `${head}\n\n${body}${tail ? `\n\n${tail}` : ""}`;
				for (const env of store.envs ?? []) output = redactEnvSecrets(output, env);
				return maskSecrets(output);
			},
		},
		{
			name: "data_space_record_result",
			label: "回写执行结果",
			description:
				"Record pass / fail / blocked results for Data Space cases after executing them, so the workspace shows the latest outcome and pass rate. Accepts the `<!-- data-space: ... -->` anchor copied from the conversation to resolve the whole batch.",
			promptSnippet: "write test results back to the user's Data Space cases",
			promptGuidelines: [
				"Call data_space_record_result after actually running the cases, one entry per case, with a short note for failures (symptom + suspected cause).",
				"If the user's message carries an anchor comment, pass it as `anchor` instead of retyping ids.",
				"Do not record results you did not observe; if execution was skipped, say so instead of writing 通过.",
				"Set task to a short batch name when recording several cases.",
				"Pass `env` (environment name or id) when you executed against a specific environment, so the result records where it ran.",
			],
			parameters: {
				type: "object",
				properties: {
					results: {
						type: "array",
						description: "One entry per case executed.",
						items: {
							type: "object",
							properties: {
								case: { type: "string", description: "Case code (PMS-004) or id." },
								verdict: { type: "string", enum: ["通过", "失败", "阻塞"], description: "Observed outcome." },
								note: { type: "string", description: "Short note, mainly for failures (symptom, suspected cause)." },
								env: {
									type: "string",
									description:
										"Environment name or id this case ran against (optional; defaults to the call-level env).",
								},
							},
							required: ["case", "verdict"],
						},
					},
					anchor: {
						type: "string",
						description:
							"The `<!-- data-space: revision=… cases=… -->` line from the conversation; resolves the batch.",
					},
					task: {
						type: "string",
						description:
							"Short name of this execution run (e.g. 「经营合同 P0 回归」). Results recorded in one call share a task, shown in the Execution Results tab.",
					},
					env: {
						type: "string",
						description:
							"Environment name or id for the whole batch (e.g. 测试环境). Omit if it ran locally or the environment is unknown.",
					},
				},
			},
			async execute(_id, params) {
				const p = params && typeof params === "object" ? params : {};
				const entries = Array.isArray(p.results) ? p.results : [];
				const byKey = new Map();
				for (const e of entries) {
					const key = str(e?.case, 64);
					if (!key) continue;
					const verdict = normalizeVerdict(e?.verdict);
					if (!verdict) continue;
					byKey.set(key.toLowerCase(), { case: key, verdict, note: str(e?.note, 300), env: str(e?.env, 64) });
				}
				let anchorNote = "";
				if (str(p.anchor, 4000)) {
					const { ids } = parseAnchor(p.anchor);
					for (const id of ids) if (!byKey.has(id.toLowerCase())) byKey.set(id.toLowerCase(), null);
					anchorNote = ids.length ? `锚点含 ${ids.length} 条用例。` : "锚点解析失败，仅使用 results。";
				}
				const list = [...byKey.values()].filter(Boolean);
				if (!list.length) return "没有可记录的结果：请给 results（每条含 case 与 verdict）。";
				const out = ctx.record(list, "ai", { taskName: str(p.task, 80), env: str(p.env, 64) });
				const lines = [`已记录 ${out.recorded.length} 条执行结果（结果 revision ${out.runsRevision}）`];
				if (out.recorded[0]?.taskName)
					lines.push(`任务：「${out.recorded[0].taskName}」— 可在数据空间「执行结果」页按任务查看`);
				for (const r of out.recorded)
					lines.push(
						`- ${r.code || r.caseId} · ${r.verdict}${r.env ? ` · ${r.env}` : ""}${r.note ? ` — ${r.note}` : ""}`,
					);
				if (out.unknown?.length) lines.push(`未匹配（编号或 id 不存在）：${out.unknown.join("、")}`);
				lines.push(anchorNote ? `提示：${anchorNote}` : "");
				return maskSecrets(lines.filter(Boolean).join("\n"));
			},
		},
	];
}
