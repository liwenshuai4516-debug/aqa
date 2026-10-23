/**
 * 数据空间视图的共享状态与小工具：读写快照、层级查询、编号生成。
 * 页面渲染（views.mjs）与弹窗（modals.mjs）都从这里取数据，事件绑定在 entry.mjs。
 */
import { filterRuns, groupRuns, runStats, runsCsv, sortRunsDesc } from "./results.mjs";

function appRoot() {
	try {
		const u = new URL(import.meta.url);
		const i = u.pathname.indexOf("/plugins/");
		return `${u.origin}${i >= 0 ? u.pathname.slice(0, i) : ""}`;
	} catch {
		return "";
	}
}

export const BASE = `${appRoot()}/plugins-api/data-space`;

export const PRIORITIES = ["P0", "P1", "P2", "P3"];
/** 环境名的常用写法：只给新建弹窗做输入建议（datalist），不是限定词表，用户可写「UAT 环境」之类。 */
export const ENV_PRESETS = ["本地", "测试环境", "预发环境", "生产"];
/** 环境参数的常用参数名：同样只做输入建议。 */
export const ENV_PARAM_PRESETS = ["账号", "口令", "租户", "组织编码", "数据库", "接口地址", "接口 Token", "验证码"];
/** 敏感参数在页面 / 导出 / AI 里的占位写法。 */
export const SECRET_MASK = "••••";
/** 单个环境的参数条数上限（与服务端 model.mjs 的 MAX.envParams 对齐）。 */
export const ENV_PARAM_MAX = 30;
/** 当前只做接口 / UI 两类；追加类型时改服务端 model.mjs 的 CASE_TYPES，这里只是接口未就绪时的兜底。 */
export const CASE_TYPES = ["接口", "UI"];
export const CASE_STATUS = ["草稿", "待评审", "已评审", "已废弃"];
/** 执行结果的三种结论（与服务端 runs.mjs 的 VERDICTS 同义；快照会下发，这里是接口未就绪时的兜底）。 */
export const VERDICTS = ["通过", "失败", "阻塞", "跳过", "取消", "未执行", "不稳定", "未知"];
export const COLORS = [
	["blue", "蓝"],
	["green", "绿"],
	["amber", "橙"],
	["purple", "紫"],
	["teal", "青"],
	["gray", "灰"],
	["red", "红"],
];

/** 渲染回调由 entry.mjs 注入：弹窗保存后需要重绘整页。 */
export const hooks = { render: () => {}, renderOverlay: () => {} };

export const S = {
	automationModal: null,
	automationSync: null,
	workspace: "",
	loaded: false,
	error: "",
	revision: 0,
	updatedAt: "",
	file: "",
	dir: "",
	migratedFrom: 0,
	systems: [],
	modules: [],
	features: [],
	cases: [],
	/** 项目环境地址簿：{ id, systemId, name, baseUrl, note, isDefault }，同项目恰好一个默认。 */
	envs: [],
	/** 服务端清理旧数据集的记录（设置页提示用）：{ datasets, cases, backup, at } | null。 */
	purged: null,
	/** 用例类型清单：服务端下发，追加新类型无需改页面。 */
	caseTypes: [...CASE_TYPES],
	/** 执行结果流水（服务端 runs.json）：只追加，按用例取最近一条。 */
	runs: [],
	runsRevision: 0,
	verdicts: [...VERDICTS],
	/** caseId → 最近一次执行结果；随 runs 变化重建（避免每行都扫一遍流水）。 */
	runIndex: new Map(),
	/** 手工登记结果的弹窗状态（见 modal-result.mjs）。 */
	resultModal: null,
	/** 「执行结果」页的视图（flat 流水 / task 按任务）与筛选条件。 */
	runsView: "flat",
	runsQ: "",
	runsVerdict: "all",
	runsSource: "all",
	runsRange: "all",
	/** 执行结果按环境筛选（"all" 或环境名）。 */
	runsEnv: "all",
	/** 「按任务」视图里展开的任务 key（空 = 全部收起）。 */
	runsOpen: "",
	tab: "overview",
	/** 项目列表选中：systemId 为空 = 全部用例；moduleId / featureId 为项目内筛选 */
	sel: { systemId: "", moduleId: "", featureId: "" },
	projectQ: "",
	caseQ: "",
	priority: "all",
	status: "all",
	/** 用例类型筛选：all | 具体类型 */
	caseType: "all",
	caseVersion: "recent",
	envQ: "",
	/** 环境页的项目筛选（systemId；空 = 全部项目）。 */
	envScope: "",
	caseModal: null,
	nodeModal: null,
	envModal: null,
	/** 「引入到 AI 对话」弹窗状态（见 modal-brief.mjs）。 */
	brief: null,
	/** 本轮已引入用例：caseId → { rev, at }；数据改过（revision 变）就不再算已引入。 */
	introduced: new Map(),
	saving: false,
	nodes: null,
	toastTimer: null,
};

/* ------------------------------------------------------------------ 基础工具 */

export function esc(v) {
	return String(v ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
}

export function newId() {
	try {
		return crypto.randomUUID();
	} catch {
		return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}
}

export function fmtTime(iso) {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "—";
	const p = (n) => String(n).padStart(2, "0");
	return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function toast(text) {
	const el = S.nodes?.toast;
	if (!el) return;
	el.textContent = text;
	el.classList.add("on");
	if (S.toastTimer) clearTimeout(S.toastTimer);
	S.toastTimer = setTimeout(() => el.classList.remove("on"), 2200);
}

/* ------------------------------------------------------------------ 层级查询 */

export const systemOf = (id) => S.systems.find((s) => s.id === id) ?? null;
export const moduleOf = (id) => S.modules.find((m) => m.id === id) ?? null;
export const featureOf = (id) => S.features.find((f) => f.id === id) ?? null;

export function modulesOf(systemId) {
	return S.modules.filter((m) => m.systemId === systemId);
}

export function featuresOf(moduleId) {
	return S.features.filter((f) => f.moduleId === moduleId);
}

export function casesOfFeature(featureId) {
	return S.cases.filter((c) => c.featureId === featureId);
}

export function casesOfModule(moduleId) {
	const ids = new Set(featuresOf(moduleId).map((f) => f.id));
	return S.cases.filter((c) => ids.has(c.featureId));
}

export function casesOfSystem(systemId) {
	const mids = new Set(modulesOf(systemId).map((m) => m.id));
	const fids = new Set(S.features.filter((f) => mids.has(f.moduleId)).map((f) => f.id));
	return S.cases.filter((c) => fids.has(c.featureId));
}

/** 功能 → 所属模块 / 项目 / 路径文本。 */
export function pathOfFeature(featureId) {
	const f = featureOf(featureId);
	const m = f ? moduleOf(f.moduleId) : null;
	const s = m ? systemOf(m.systemId) : null;
	return { feature: f, module: m, system: s };
}

export function pathText(featureId, sep = " / ") {
	const { feature, module, system } = pathOfFeature(featureId);
	if (!feature) return "未归类";
	return [system?.name, module?.name, feature.name].filter(Boolean).join(sep);
}

/** 某个功能的全路径（用于选择器 value）。 */
export function featureOptions(filter = {}) {
	const out = [];
	for (const s of S.systems) {
		for (const m of modulesOf(s.id)) {
			for (const f of featuresOf(m.id)) {
				out.push({ id: f.id, label: `${s.name} / ${m.name} / ${f.name}`, systemId: s.id, moduleId: m.id });
			}
		}
	}
	return out.filter(
		(o) => (!filter.systemId || o.systemId === filter.systemId) && (!filter.moduleId || o.moduleId === filter.moduleId),
	);
}

export function envsOf(systemId) {
	return S.envs.filter((e) => e.systemId === systemId);
}

export const envById = (id) => S.envs.find((e) => e.id === id) ?? null;

/** 项目默认环境：同项目保证恰好一个（服务端清洗），这里再兜一层第一条。 */
export function defaultEnvOf(systemId) {
	const list = envsOf(systemId);
	return list.find((e) => e.isDefault) ?? list[0] ?? null;
}

/** 用例所属项目的默认环境（没归类或没配环境的返回 null）。 */
export function envOfCase(c) {
	const { system } = pathOfFeature(c?.featureId);
	return system ? defaultEnvOf(system.id) : null;
}

/** 环境的一行写法：名称 · 地址。 */
export function envLabel(env) {
	return env ? [env.name, env.baseUrl].filter(Boolean).join(" · ") : "";
}

export function paramsOf(env) {
	return Array.isArray(env?.params) ? env.params : [];
}

/** 参数的展示值：敏感值一律占位，空值给一个短横线；不把口令带进标题栏 / 列表。 */
export function paramValueText(p) {
	if (p?.secret) return SECRET_MASK;
	const v = String(p?.value ?? "").trim();
	return v || "—";
}

/** `键=值` 的一行写法（敏感值已脱敏），用于列表标题与提示。 */
export function paramText(p) {
	return `${String(p?.key ?? "")}=${paramValueText(p)}`;
}

/* -------------------------------------------------------------- 环境内置脚本 */

/** 与服务端同一组上限，页面先拦一下，别让人加到第 6 步才知道不行。 */
export const ENV_SCRIPT_MAX = { steps: 5, headers: 12, extracts: 8 };

/** 环境脚本（结构由服务端清洗）：页面只保证拿到能直接编辑的对象。 */
export function scriptOf(env) {
	const s = env?.script && typeof env.script === "object" ? env.script : {};
	return {
		enabled: !!s.enabled,
		ttlMinutes: Number(s.ttlMinutes) || 60,
		allowForeignHost: !!s.allowForeignHost,
		steps: Array.isArray(s.steps) ? s.steps : [],
	};
}

/** 能不能跑：启用了且至少一步有地址（与服务端 scriptReady 同口径）。 */
export function scriptReadyOf(env) {
	const s = scriptOf(env);
	return s.enabled && s.steps.some((x) => String(x?.url ?? "").trim());
}

export function dynamicOf(env) {
	return Array.isArray(env?.dynamic) ? env.dynamic : [];
}

/** 提取出的每个键都有值、且都未过期，才算新鲜（要么不用重跑，要么过期了才重跑）。 */
export function dynamicFreshOf(env, nowMs = Date.now()) {
	const list = dynamicOf(env);
	if (!list.length) return false;
	const keys = scriptOf(env)
		.steps.flatMap((s) => (Array.isArray(s?.extract) ? s.extract : []))
		.map((x) => String(x?.key ?? "").toLowerCase())
		.filter(Boolean);
	const got = new Set(list.map((v) => String(v?.key ?? "").toLowerCase()));
	if (!keys.every((k) => got.has(k))) return false;
	return list.every((v) => {
		const t = Date.parse(String(v?.expiresAt ?? ""));
		return !Number.isFinite(t) || t > nowMs;
	});
}

/** 动态值的展示值：敏感值只给 ●●●●，token 不进可见文本与 title。 */
export function dynamicValueText(v) {
	if (v?.secret) return SECRET_MASK;
	const s = String(v?.value ?? "").trim();
	return s || "—";
}

/** 动态值的时间说明：`10-23 11:42 更新 · 12:42 过期`；已过期直接说。 */
export function dynamicTimeText(v, nowMs = Date.now()) {
	const parts = [];
	if (v?.at) parts.push(`${fmtTime(v.at)} 更新`);
	const exp = Date.parse(String(v?.expiresAt ?? ""));
	if (Number.isFinite(exp)) parts.push(exp > nowMs ? `${fmtTime(v.expiresAt)} 过期` : "已过期");
	return parts.join(" · ");
}

/** 手动跑一次环境脚本（页面按钮）；成功或失败都重载，让脚本状态同步到界面。 */
export async function refreshEnvScript(envId) {
	let ok = false;
	try {
		const r = await fetch(`${BASE}/env/refresh`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ envId, force: true }),
		});
		const d = await r.json().catch(() => null);
		if (!d) toast("运行失败：插件服务没有响应");
		else if (!d.ok) toast(`脚本未跑通：${d.error || "未知原因"}`);
		else toast(d.cached ? "动态值还在有效期" : "已取到最新动态值");
		ok = Boolean(d?.ok);
	} catch {
		toast("运行失败：无法连接插件服务");
	}
	await load();
	return ok;
}

/** 用例编号：优先用项目 code，如 PMS-004；没有 code 用 CASE-004。 */
export function nextCaseCode(systemId) {
	const sys = systemOf(systemId);
	const prefix = (sys?.code || "CASE").toUpperCase();
	const used = casesOfSystem(systemId)
		.map((c) => {
			const m = /^([A-Z0-9]+)-(\d+)$/.exec(String(c.code || "").toUpperCase());
			return m && m[1] === prefix ? Number(m[2]) : 0;
		})
		.filter((n) => Number.isFinite(n));
	return `${prefix}-${String(Math.max(0, ...used) + 1).padStart(3, "0")}`;
}

export function caseMatches(c, q) {
	const s = q.trim().toLowerCase();
	if (!s) return true;
	const hay = [c.code, c.title, c.type, c.owner, c.note, ...(c.tags ?? []), pathText(c.featureId)]
		.join(" ")
		.toLowerCase();
	return hay.includes(s);
}

/** 类型清单：已配置类型 + 数据里已存在的其他类型（旧数据不丢），保持稳定顺序。 */
export function observedTypes() {
	const out = [...S.caseTypes];
	for (const c of S.cases) {
		const t = String(c.type || "").trim();
		if (t && !out.includes(t)) out.push(t);
	}
	return out;
}

export function typeCounts() {
	const map = new Map();
	for (const c of S.cases) {
		const t = String(c.type || "").trim() || "未分类";
		map.set(t, (map.get(t) ?? 0) + 1);
	}
	return map;
}

/* ------------------------------------------------------------------ 读写 */

export function applyStore(data) {
	S.loaded = true;
	S.automationSync = data.automationSync ?? null;
	S.workspace = data.workspace ?? "";
	S.error = "";
	S.revision = Number(data.revision) || 0;
	S.updatedAt = data.updatedAt || "";
	S.dir = data.dir || "";
	S.file = data.file || "";
	S.migratedFrom = Number(data.migratedFrom) || 0;
	S.systems = Array.isArray(data.systems) ? data.systems : [];
	S.modules = Array.isArray(data.modules) ? data.modules : [];
	S.features = Array.isArray(data.features) ? data.features : [];
	S.cases = Array.isArray(data.cases) ? data.cases : [];
	S.envs = Array.isArray(data.envs) ? data.envs : [];
	S.purged = data.purged && typeof data.purged === "object" ? data.purged : null;
	S.caseTypes = Array.isArray(data.caseTypes) && data.caseTypes.length ? data.caseTypes.map(String) : [...CASE_TYPES];
	S.runs = Array.isArray(data.runs) ? data.runs : [];
	S.runsRevision = Number(data.runsRevision) || 0;
	S.verdicts = Array.isArray(data.verdicts) && data.verdicts.length ? data.verdicts.map(String) : [...VERDICTS];
	S.runIndex = buildRunIndex(S.runs);
}

/**
 * 只更新执行结果（载入示例 / 清空后局部刷新）：不碰用例数据，
 * 也不会把用户当前的 tab 与筛选重置掉。
 */
export function applyRuns(data) {
	S.runs = Array.isArray(data?.runs) ? data.runs : [];
	S.runsRevision = Number(data?.runsRevision) || S.runsRevision;
	S.runIndex = buildRunIndex(S.runs);
}

/* ------------------------------------------------------------------ 执行结果 */

/** 流水 → 每条用例最近一条结果（时间晚的赢；同一秒按后写入的赢）。 */
export function buildRunIndex(runs) {
	const map = new Map();
	for (const r of runs ?? []) {
		if (!r?.caseId || !r.verdict || r.source === "demo") continue;
		const prev = map.get(r.caseId);
		if (!prev || String(r.at) >= String(prev.at)) map.set(r.caseId, r);
	}
	return map;
}

/** 用例后来改过 → 结果算过期（灰显并提示重跑，不当现行结论）。 */
export function isRunStale(run, c) {
	if (!run) return false;
	const recorded = String(run.caseUpdatedAt ?? "");
	const current = String(c?.updatedAt ?? "");
	if (!recorded || !current) return false;
	return current > recorded;
}

export function resultOf(c) {
	const run = c ? (S.runIndex.get(c.id) ?? null) : null;
	return run ? { run, stale: isRunStale(run, c) } : null;
}

/* ------------------------------------------------------------------ 执行结果页 */

export const caseById = (id) => S.cases.find((c) => c.id === id) ?? null;

/** 用例 → 「项目 / 模块 / 功能」；搜索与 CSV 都用它，避免每个调用点自己拼。 */
const casePath = (c) => (c ? pathText(c.featureId) : "");

/** 当前筛选下的执行流水（时间倒序）：「执行结果」页与 CSV 导出共用一个口径。 */
export function filteredRuns() {
	const casesById = new Map(S.cases.map((c) => [c.id, c]));
	return sortRunsDesc(
		filterRuns(S.runs, {
			q: S.runsQ,
			verdict: S.runsVerdict,
			source: S.runsSource,
			range: S.runsRange,
			env: S.runsEnv,
			casesById,
			pathOf: casePath,
		}),
	);
}

/** 流水统计：记录数、覆盖用例数、通过率、过期条数。 */
export function runsSummary(rows) {
	return runStats(rows, { casesById: new Map(S.cases.map((c) => [c.id, c])), isStale: isRunStale });
}

/** 按任务聚合（没有 taskId 的记录各自成组）。 */
export function runsGroups(rows) {
	return groupRuns(rows, { casesById: new Map(S.cases.map((c) => [c.id, c])), isStale: isRunStale });
}

/** 导出 CSV 文本（调用方负责加 BOM 与下载）。 */
export function runsCsvText(rows) {
	return runsCsv(rows, {
		casesById: new Map(S.cases.map((c) => [c.id, c])),
		pathOf: casePath,
		isStale: isRunStale,
	});
}

/** 概览统计：未执行的不进分母（"通过率"只对已执行用例有意义）。 */
export function resultStats() {
	const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
	let stale = 0;
	for (const c of S.cases) {
		const hit = resultOf(c);
		if (!hit) continue;
		if (hit.stale) {
			stale += 1;
			continue;
		}
		counts[hit.run.verdict] = (counts[hit.run.verdict] ?? 0) + 1;
	}
	const executed = Object.entries(counts)
		.filter(([key]) => key !== "未执行")
		.reduce((sum, [, n]) => sum + n, 0);
	return {
		total: S.cases.length,
		executed,
		untested: Math.max(0, S.cases.length - executed),
		...counts,
		stale,
		passRate: executed ? Math.round((counts["通过"] / executed) * 100) : 0,
	};
}

/** 页面上登记的最近结果（手工 / AI 都走同一条链）；env 可传环境名或 id。 */
export async function saveResult(caseId, verdict, note, env = "") {
	try {
		const r = await fetch(`${BASE}/runs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ caseId, verdict, note, env }),
		});
		const d = await r.json().catch(() => null);
		if (!d?.ok) return { ok: false, error: d?.error || "登记失败" };
		S.runs = Array.isArray(d.runs) ? d.runs : S.runs;
		S.runsRevision = Number(d.runsRevision) || S.runsRevision;
		S.runIndex = buildRunIndex(S.runs);
		return { ok: true, runsRevision: S.runsRevision };
	} catch {
		return { ok: false, error: "登记失败：无法连接插件服务" };
	}
}

export async function load() {
	try {
		const r = await fetch(`${BASE}/state`, { cache: "no-store" });
		const d = await r.json();
		if (!d?.ok) throw new Error(d?.error || "读取失败");
		applyStore(d);
	} catch {
		S.error = "读取数据失败：确认插件已启用，然后刷新页面重试。";
	}
}

export function payload() {
	return {
		systems: S.systems,
		modules: S.modules,
		features: S.features,
		cases: S.cases,
		envs: S.envs,
	};
}

/** 整份保存：带上本地 revision，服务端不一致回 409 + 最新快照。 */
export async function persist() {
	S.saving = true;
	try {
		const r = await fetch(`${BASE}/save`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ baseRevision: S.revision, ...payload() }),
		});
		const d = await r.json().catch(() => null);
		if (r.status === 409 && d?.store) {
			applyStore(d.store);
			toast("数据已被其他窗口更新，已载入最新版本，请重新修改");
			return false;
		}
		if (!d?.ok) {
			toast(d?.error || "保存失败");
			return false;
		}
		applyStore(d);
		toast("已保存");
		return true;
	} catch {
		toast("保存失败：无法连接插件服务");
		return false;
	} finally {
		S.saving = false;
	}
}
