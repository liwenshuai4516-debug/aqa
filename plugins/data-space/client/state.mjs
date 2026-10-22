/**
 * 数据空间视图的共享状态与小工具：读写快照、层级查询、编号生成。
 * 页面渲染（views.mjs）与弹窗（modals.mjs）都从这里取数据，事件绑定在 entry.mjs。
 */

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

export const ENVS = ["本地", "测试环境", "预发环境", "生产"];
export const PRIORITIES = ["P0", "P1", "P2", "P3"];
/** 当前只做接口 / UI 两类；追加类型时改服务端 model.mjs 的 CASE_TYPES，这里只是接口未就绪时的兜底。 */
export const CASE_TYPES = ["接口", "UI"];
export const CASE_STATUS = ["草稿", "待评审", "已评审", "已废弃"];
/** 执行结果的三种结论（与服务端 runs.mjs 的 VERDICTS 同义；快照会下发，这里是接口未就绪时的兜底）。 */
export const VERDICTS = ["通过", "失败", "阻塞"];
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
	datasets: [],
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
	tab: "overview",
	/** 项目列表选中：systemId 为空 = 全部用例；moduleId / featureId 为项目内筛选 */
	sel: { systemId: "", moduleId: "", featureId: "" },
	projectQ: "",
	caseQ: "",
	priority: "all",
	status: "all",
	/** 用例类型筛选：all | 具体类型 */
	caseType: "all",
	datasetQ: "",
	datasetScope: { systemId: "", moduleId: "", featureId: "" },
	caseModal: null,
	nodeModal: null,
	datasetModal: null,
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

export function datasetNames(ids) {
	return (ids ?? []).map((id) => S.datasets.find((d) => d.id === id)?.name).filter(Boolean);
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
	S.datasets = Array.isArray(data.datasets) ? data.datasets : [];
	S.caseTypes = Array.isArray(data.caseTypes) && data.caseTypes.length ? data.caseTypes.map(String) : [...CASE_TYPES];
	S.runs = Array.isArray(data.runs) ? data.runs : [];
	S.runsRevision = Number(data.runsRevision) || 0;
	S.verdicts = Array.isArray(data.verdicts) && data.verdicts.length ? data.verdicts.map(String) : [...VERDICTS];
	S.runIndex = buildRunIndex(S.runs);
}

/* ------------------------------------------------------------------ 执行结果 */

/** 流水 → 每条用例最近一条结果（时间晚的赢；同一秒按后写入的赢）。 */
export function buildRunIndex(runs) {
	const map = new Map();
	for (const r of runs ?? []) {
		if (!r?.caseId || !r.verdict) continue;
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

/** 概览统计：未执行的不进分母（"通过率"只对已执行用例有意义）。 */
export function resultStats() {
	const counts = { 通过: 0, 失败: 0, 阻塞: 0 };
	let stale = 0;
	for (const c of S.cases) {
		const hit = resultOf(c);
		if (!hit) continue;
		counts[hit.run.verdict] = (counts[hit.run.verdict] ?? 0) + 1;
		if (hit.stale) stale += 1;
	}
	const executed = counts["通过"] + counts["失败"] + counts["阻塞"];
	return {
		total: S.cases.length,
		executed,
		untested: Math.max(0, S.cases.length - executed),
		...counts,
		stale,
		passRate: executed ? Math.round((counts["通过"] / executed) * 100) : 0,
	};
}

/** 页面上登记的最近结果（手工 / AI 都走同一条链）。 */
export async function saveResult(caseId, verdict, note) {
	try {
		const r = await fetch(`${BASE}/runs`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ caseId, verdict, note }),
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
		datasets: S.datasets,
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
