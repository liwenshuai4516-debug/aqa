/**
 * 「把用例引入 AI 对话」的核心逻辑：选内容 → 两档格式 → 锚点 → 意图指令 → 注入输入框。
 *
 * 几条刻意的设计：
 *   - **两档格式按条数自动切**：≤3 条走卡片档（步骤、预期、关联数据全带上），
 *     更多走清单档（一行一条的表格）。一个功能 30 条全量贴进去，字数既是钱也是噪音。
 *   - **末尾一行机器可读锚点** `<!-- data-space: revision=49 cases=id1,id2 -->`：
 *     后续要做的「执行结果回写」靠它定位是哪几条用例、什么版本；也能用来去重。
 *   - **脱敏默认开**：口令 / 令牌这类键值在文本里打成 `***`，数据集只带名称不带取值。
 *     （注入对话就进了模型上下文与历史记录，默认别带敏感值。）
 *   - **只入草稿不自动发送**：走宿主的 `compose()`，用户在输入框里补一句话再自己发。
 *     宿主没提供该能力时退回剪贴板，绝不静默丢内容。
 *
 * 执行本身不在这里做：接口类交给接口自动化流程、UI 类交给 UI 测试流程，
 * 数据空间的定位是「提供上下文 + 接回结果」。
 */
import { S, datasetNames, pathText } from "./state.mjs";

/** 格式档位（auto 按条数自动切）。 */
export const FORMAT_CHOICES = [
	{ id: "auto", label: "自动", hint: "≤3 条用卡片档，更多用清单档" },
	{ id: "card", label: "卡片档", hint: "每条带步骤与预期，信息全但费上下文" },
	{ id: "list", label: "清单档", hint: "一行一条的表格，省上下文" },
];

/** 引入后追加在末尾的指令（用户可改几个字再发）。 */
export const INTENT_CHOICES = [
	{
		id: "run",
		label: "执行测试",
		tail: "请按上述用例依次执行，逐条给出实际结果与通过 / 失败结论；失败时说明根因假设。",
	},
	{
		id: "auto",
		label: "转自动化",
		tail: "请把上述用例转成可执行的自动化脚本：先给出脚本结构、依赖与你需要我确认的参数。",
	},
	{
		id: "review",
		label: "用例评审",
		tail: "请评审上述用例：指出描述不清、步骤缺失、预期不可验证之处，并按优先级给出修改建议。",
	},
	{
		id: "more",
		label: "补充用例",
		tail: "请基于上述用例补充缺失场景（边界值、异常、权限），按同样的格式给出新增用例。",
	},
	{ id: "none", label: "不加指令", tail: "" },
];

/** 上限：卡片档单条信息量大，超过 20 条基本不可读；清单档 200 条足够覆盖一个项目。 */
export const BRIEF_LIMITS = { card: 20, list: 200, cardMax: 3 };

export const BRIEF_DEFAULTS = { format: "auto", intent: "run", redact: true, skip: true };

const oneline = (v) =>
	String(v ?? "")
		.replace(/\s*\n+\s*/g, "；")
		.trim();

/** 键值式敏感字段：`password: xxx` / `令牌：abc` / `Authorization=Bearer ...`。 */
const SECRET_RE =
	/((?:password|passwd|pwd|token|secret|api[-_]?key|authorization|cookie|密码|口令|令牌|密钥|凭证)\s*[:=：]\s*)(\S{2,})/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]{8,}/g;

/** 把键值型敏感内容打成 ***（保留键名，方便 AI 知道这里该传什么）。 */
export function maskSecrets(text) {
	return String(text ?? "")
		.replace(SECRET_RE, (_m, head) => `${head}***`)
		.replace(BEARER_RE, "Bearer ***");
}

/** 自动档按条数切；显式档位照用户选的来。 */
export function resolveFormat(pref, count) {
	if (pref === "card" || pref === "list") return pref;
	return count <= BRIEF_LIMITS.cardMax ? "card" : "list";
}

export function formatLabel(format) {
	return format === "card" ? "卡片档 · 每条含步骤与预期" : "清单档 · 一行一条";
}

export function intentOf(id) {
	return INTENT_CHOICES.find((i) => i.id === id) ?? INTENT_CHOICES[0];
}

const cell = (v, redact) => {
	const s = oneline(v).replace(/\|/g, "\\|");
	return redact ? maskSecrets(s) : s;
};

/** 卡片档：一条用例一块，步骤保留「操作 → 预期」两列语义。 */
function cardBlock(c, redact) {
	const text = (v) => (redact ? maskSecrets(oneline(v)) : oneline(v));
	const lines = [`#### 用例 ${oneline(c.code) || "未编号"} · ${oneline(c.title) || "未命名用例"}`];
	lines.push(`- 路径：${pathText(c.featureId)}`);
	const meta = [`类型：${oneline(c.type) || "未分类"}`, `优先级：${c.priority}`, `状态：${c.status}`];
	if (oneline(c.owner)) meta.push(`负责人：${oneline(c.owner)}`);
	lines.push(`- ${meta.join(" · ")}`);
	if (oneline(c.preconditions)) lines.push(`- 前置条件：${text(c.preconditions)}`);

	const steps = (c.steps ?? []).filter((s) => oneline(s?.action) || oneline(s?.expect));
	if (!steps.length) {
		lines.push("- 步骤：（未填步骤）");
	} else {
		lines.push("- 步骤：");
		steps.forEach((s, i) => {
			lines.push(`  ${i + 1}. ${text(s.action) || "—"}`);
			if (oneline(s.expect)) lines.push(`     - 预期：${text(s.expect)}`);
		});
	}

	const data = datasetNames(c.datasetIds);
	if (data.length) lines.push(`- 关联数据：${data.join("、")}`);
	if (oneline(c.note)) lines.push(`- 备注：${text(c.note)}`);
	return lines.join("\n");
}

/** 清单档：按功能分组的小表格。 */
function listBlock(cases, redact) {
	const groups = new Map();
	for (const c of cases) {
		const key = c.featureId || "";
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(c);
	}
	const out = [];
	for (const [fid, items] of groups) {
		out.push(`#### ${pathText(fid)}（${items.length} 条）`);
		out.push("| 编号 | 用例标题 | 类型 | 优先级 | 状态 | 步骤 |");
		out.push("| --- | --- | --- | --- | --- | --- |");
		for (const c of items) {
			out.push(
				`| ${cell(c.code, redact) || "—"} | ${cell(c.title, redact)} | ${cell(c.type, redact) || "—"} | ${c.priority} | ${c.status} | ${
					(c.steps ?? []).length
				} |`,
			);
		}
	}
	return out.join("\n");
}

/** 机器可读锚点：后续回写执行结果、判断是否同一批用例都靠它。 */
function anchor(cases, revision) {
	const ids = cases.map((c) => c.id).join(",");
	return `<!-- data-space: revision=${revision} cases=${ids} -->`;
}

/**
 * 生成引入文本。
 * @param {{cases?: object[], label?: string, filtered?: boolean, format?: string,
 *   intent?: string, redact?: boolean, revision?: number}} opts
 */
export function buildBrief(opts = {}) {
	const cases = Array.isArray(opts.cases) ? opts.cases.filter(Boolean) : [];
	const label = String(opts.label ?? "").trim() || "用例";
	const format = resolveFormat(opts.format ?? BRIEF_DEFAULTS.format, cases.length);
	const cap = BRIEF_LIMITS[format] ?? BRIEF_LIMITS.list;
	const kept = cases.slice(0, cap);
	const cut = cases.length - kept.length;
	const redact = opts.redact !== false;
	const intent = intentOf(opts.intent);
	const revision = Number(opts.revision ?? S.revision) || 0;

	const api = kept.filter((c) => oneline(c.type) === "接口").length;
	const ui = kept.filter((c) => oneline(c.type) === "UI").length;
	const rest = kept.length - api - ui;

	const head = [
		"### 数据空间 · 用例引入",
		`- 范围：${label}${opts.filtered ? "（已按当前筛选）" : ""}`,
		`- 用例：${kept.length} 条${cut > 0 ? `（共 ${cases.length} 条，本次只带前 ${cap} 条，其余请分批引入）` : ""} · 接口 ${api} / UI ${ui}${
			rest > 0 ? ` / 其他 ${rest}` : ""
		}`,
		`- 数据版本：revision ${revision} · ${formatLabel(format)}`,
	].join("\n");

	if (!kept.length) return { text: "", format, count: 0, total: 0, cut: 0, chars: 0, intent: intent.id };

	const body = format === "card" ? kept.map((c) => cardBlock(c, redact)).join("\n\n") : listBlock(kept, redact);
	const parts = [head, body, anchor(kept, revision)];
	if (intent.tail) parts.push(intent.tail);
	const text = `${parts.filter(Boolean).join("\n\n")}\n`;

	return { text, format, count: kept.length, total: cases.length, cut, chars: text.length, intent: intent.id };
}

/* ------------------------------------------------------------------ 去重 */

/** 本轮已引入记录：caseId → { rev, at }。数据改过（revision 变了）就不算「已引入」。 */
function introducedMap() {
	if (!(S.introduced instanceof Map)) S.introduced = new Map();
	return S.introduced;
}

export function isIntroduced(c) {
	const rec = c ? introducedMap().get(c.id) : null;
	return Boolean(rec && rec.rev === (Number(S.revision) || 0));
}

export function introducedAt(c) {
	return c ? (introducedMap().get(c.id)?.at ?? 0) : 0;
}

export function introducedCount(cases) {
	return (cases ?? []).filter(isIntroduced).length;
}

export function markIntroduced(cases, revision) {
	const rev = Number(revision) || 0;
	const at = Date.now();
	for (const c of cases ?? []) introducedMap().set(c.id, { rev, at });
}

/* ------------------------------------------------------------------ 注入 */

function hostApi() {
	try {
		const h = globalThis.__piWebUiHost;
		return h && typeof h.compose === "function" ? h : null;
	} catch {
		return null;
	}
}

/** 宿主是否提供「放进输入框草稿」的能力（宿主 API v2+）。 */
export function hostSupportsCompose() {
	return Boolean(hostApi());
}

/**
 * 把文本放进对话框草稿，并把视图切到对话（用户接着补一句话再发）。
 * 宿主不支持或输入框未就绪时退回剪贴板 —— 内容不会静默丢。
 * @returns {Promise<{ok: boolean, via: "composer" | "clipboard" | "none"}>}
 */
export async function composeBrief(text) {
	const api = hostApi();
	if (api) {
		try {
			if (api.compose({ text })) {
				try {
					api.setView?.("chat");
				} catch {
					/* 切视图失败不影响已放入的草稿 */
				}
				return { ok: true, via: "composer" };
			}
		} catch {
			/* 落到剪贴板 */
		}
	}
	try {
		await navigator.clipboard.writeText(text);
		return { ok: true, via: "clipboard" };
	} catch {
		return { ok: false, via: "none" };
	}
}

/** 字数展示：小于一千给原值，超过给 k。 */
export function fmtChars(n) {
	const v = Math.max(0, Number(n) || 0);
	return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}
