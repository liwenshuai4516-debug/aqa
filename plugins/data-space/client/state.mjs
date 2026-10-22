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
export const CASE_TYPES = ["功能", "接口", "UI", "性能", "兼容", "安全"];
export const CASE_STATUS = ["草稿", "待评审", "已评审", "已废弃"];
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
	tab: "overview",
	/** 树选中：三级同时为空 = 全部用例 */
	sel: { systemId: "", moduleId: "", featureId: "" },
	collapsed: new Set(),
	caseQ: "",
	priority: "all",
	status: "all",
	datasetQ: "",
	datasetScope: { systemId: "", moduleId: "", featureId: "" },
	caseModal: null,
	nodeModal: null,
	datasetModal: null,
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

/** 功能 → 所属模块 / 系统 / 路径文本。 */
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

/** 用例编号：优先用系统 code，如 PMS-004；没有 code 用 CASE-004。 */
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
	const hay = [c.code, c.title, c.owner, c.note, ...(c.tags ?? []), pathText(c.featureId)].join(" ").toLowerCase();
	return hay.includes(s);
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
