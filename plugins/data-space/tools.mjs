/**
 * 数据空间的 AI 工具（v2/v3）：查询用例 & 回写执行结果。
 *
 * 定位：**对话里按需取数**。面板里的「引入对话」把内容内联进 prompt，适合少量用例一眼看全；
 * 一旦是整功能 / 整模块，内联就是几万字。所以批量场景走「轻引用（引用档）+ 工具按需拉明细」：
 * 模型拿着编号或锚点调 `data_space_cases` 取步骤与预期，执行完用 `data_space_record_result` 回写。
 *
 * 约束：
 *   - 只读工具不写盘；回写工具只追加执行记录（runs.json），不改用例内容。
 *   - 输出里不带数据集取值（只带名称），避免口令 / 生产地址经工具结果进上下文。
 *   - 文本给模型看，不追求好看；一条用例一行，字段用 · 分隔，超量时明确说「只给了前 N 条」。
 */
import { isStale, latestByCase, normalizeVerdict, parseAnchor, summarize } from "./runs.mjs";

const str = (v, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const oneline = (v) => str(v, 400).replace(/\s*\n+\s*/g, "；");

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

function datasetNames(store, ids) {
	return (ids ?? []).map((id) => (store.datasets ?? []).find((d) => d.id === id)?.name).filter(Boolean);
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
			const meta = [c.type || "未分类", c.priority, c.status, `最近 ${resultTag(runsByCase, c)}`].join(" · ");
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
			const data = datasetNames(store, c.datasetIds);
			if (data.length) lines.push(`   关联数据（仅名称，取值按需现取）：${data.join("、")}`);
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
		`- 项目 ${(store.systems ?? []).length} · 模块 ${(store.modules ?? []).length} · 功能 ${features.length} · 用例 ${(store.cases ?? []).length} · 数据集 ${(store.datasets ?? []).length}`,
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
				return `${head}\n\n${body || "（没有匹配的用例）"}${tail}`;
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
							},
							required: ["case", "verdict"],
						},
					},
					anchor: {
						type: "string",
						description:
							"The `<!-- data-space: revision=… cases=… -->` line from the conversation; resolves the batch.",
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
					byKey.set(key.toLowerCase(), { case: key, verdict, note: str(e?.note, 300) });
				}
				let anchorNote = "";
				if (str(p.anchor, 4000)) {
					const { ids } = parseAnchor(p.anchor);
					for (const id of ids) if (!byKey.has(id.toLowerCase())) byKey.set(id.toLowerCase(), null);
					anchorNote = ids.length ? `锚点含 ${ids.length} 条用例。` : "锚点解析失败，仅使用 results。";
				}
				const list = [...byKey.values()].filter(Boolean);
				if (!list.length) return "没有可记录的结果：请给 results（每条含 case 与 verdict）。";
				const out = ctx.record(list, "ai");
				const lines = [`已记录 ${out.recorded.length} 条执行结果（结果 revision ${out.runsRevision}）`];
				for (const r of out.recorded)
					lines.push(`- ${r.code || r.caseId} · ${r.verdict}${r.note ? ` — ${r.note}` : ""}`);
				if (out.unknown?.length) lines.push(`未匹配（编号或 id 不存在）：${out.unknown.join("、")}`);
				lines.push(anchorNote ? `提示：${anchorNote}` : "");
				return lines.filter(Boolean).join("\n");
			},
		},
	];
}
