/**
 * 「执行结果」页的纯逻辑：筛选、统计、按任务分组、导出 CSV。
 *
 * 为什么不写进 views.mjs：这些函数不碰 DOM，可以直接被 vitest 引用（与 brief.mjs 同一路数），
 * 筛选与分组的边界（空值、时间范围、任务缺失、过期记录）在单测里锁住，页面只负责画。
 *
 * 记录形状见 ../../runs.mjs：{ id, caseId, code, verdict, note, at, source, caseUpdatedAt, taskId, taskName, env, envId }
 *   - taskId 由服务端在一次回写多条时生成（AI 批量执行）；页面手工登记的单条没有任务，
 *     在「按任务」视图里各自成为一条「单条登记」。
 *   - env 是这轮跑的环境名；环境被删后仍保留当时的名字，所以筛选按名字做，不依赖 envId。
 */

export const RUN_RANGES = [
	["all", "全部时间"],
	["today", "今天"],
	["7d", "近 7 天"],
	["30d", "近 30 天"],
];

export const RUN_SOURCES = [
	["all", "全部来源"],
	["ai", "AI 登记（未核验）"],
	["manual", "手工登记"],
	["automation", "原生证据同步"],
	["demo", "示例（非实际执行）"],
];

const DAY = 24 * 60 * 60 * 1000;

/** 流水里出现过的环境名（去重、按名称排序），给筛选下拉用。 */
export function envOptions(runs) {
	const set = new Set();
	for (const r of runs ?? []) {
		const v = String(r?.env ?? "").trim();
		if (v) set.add(v);
	}
	return [...set].sort((a, b) => a.localeCompare(b));
}

export function sourceLabel(source) {
	return (
		{ ai: "AI 登记（未核验）", manual: "手工登记", automation: "原生证据同步", demo: "示例（非实际执行）" }[source] ||
		"未知来源"
	);
}

/** 结论 → 页面上的颜色类名（未执行不在流水里，兜底 none）。 */
export function verdictClass(verdict) {
	if (verdict === "通过") return "pass";
	if (verdict === "失败") return "fail";
	if (verdict === "阻塞") return "blocked";
	return "none";
}

const timeOf = (iso) => {
	const t = new Date(iso ?? "").getTime();
	return Number.isNaN(t) ? 0 : t;
};

/** 完整时间戳（CSV / title 用）：本地时区，YYYY-MM-DD HH:mm。 */
export function stampText(iso) {
	const d = new Date(iso ?? "");
	if (Number.isNaN(d.getTime())) return "";
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 时间范围判定（本地日界）：
 *   today = 今天 00:00 起；7d / 30d = 含今天的滚动窗口；all = 不过滤。
 * 一条记录的时间解析不出来时按「不匹配任何范围」处理，避免脏数据混进筛选结果。
 */
export function inRange(iso, range, now = new Date()) {
	if (!range || range === "all") return true;
	const t = timeOf(iso);
	if (!t) return false;
	const end = now.getTime();
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	if (range === "today") return t >= startOfToday && t <= end + DAY;
	const days = range === "7d" ? 7 : range === "30d" ? 30 : 0;
	if (!days) return true;
	return t >= startOfToday - (days - 1) * DAY && t <= end + DAY;
}

/**
 * 过滤流水。opts:
 *   q / verdict / source / range / env：页面筛选条件（"all" 或空 = 不过滤）
 *   casesById：Map<caseId, case>，用于按标题、路径搜索
 *   pathOf(case)：返回「项目 / 模块 / 功能」，搜索路径用（可缺省）
 *   now：便于单测固定时间
 */
export function filterRuns(runs, opts = {}) {
	const q = String(opts.q ?? "")
		.trim()
		.toLowerCase();
	const now = opts.now instanceof Date ? opts.now : new Date(opts.now ?? Date.now());
	const casesById = opts.casesById ?? new Map();
	const pathOf = typeof opts.pathOf === "function" ? opts.pathOf : () => "";
	return (runs ?? []).filter((r) => {
		if (!r || !r.caseId) return false;
		if (opts.verdict && opts.verdict !== "all" && r.verdict !== opts.verdict) return false;
		if (opts.source && opts.source !== "all" && r.source !== opts.source) return false;
		if (opts.env && opts.env !== "all" && String(r.env ?? "") !== opts.env) return false;
		if (!inRange(r.at, opts.range ?? "all", now)) return false;
		if (!q) return true;
		const c = casesById.get(r.caseId) ?? null;
		const hay = [r.code, c?.code, c?.title, r.note, r.env, r.taskName, pathOf(c)].join(" ").toLowerCase();
		return hay.includes(q);
	});
}

/** 时间倒序（同一时刻按写入顺序倒过来，保证「最新登记」在最前）。 */
export function sortRunsDesc(runs) {
	return (runs ?? [])
		.map((r, i) => ({ r, i }))
		.sort((a, b) => timeOf(b.r.at) - timeOf(a.r.at) || b.i - a.i)
		.map((x) => x.r);
}

/**
 * 统计一组流水。口径与概览一致：按「记录」算结论分布，通过率分母是记录数；
 * cases 是覆盖到的用例数（去重）；stale 是所引用例已更新、结论可能过期的记录数。
 */
export function runStats(rows, opts = {}) {
	const casesById = opts.casesById ?? new Map();
	const isStale = typeof opts.isStale === "function" ? opts.isStale : () => false;
	const counts = { 通过: 0, 失败: 0, 阻塞: 0 };
	const caseIds = new Set();
	const taskIds = new Set();
	let stale = 0;
	let eligible = 0,
		passed = 0;
	let lastAt = "";
	for (const r of rows ?? []) {
		if (r.source !== "demo" && !isStale(r, casesById.get(r.caseId))) {
			eligible++;
			if (r.verdict === "通过") passed++;
		}
		counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
		caseIds.add(r.caseId);
		if (r.taskId) taskIds.add(r.taskId);
		if (isStale(r, casesById.get(r.caseId))) stale += 1;
		if (!lastAt || timeOf(r.at) > timeOf(lastAt)) lastAt = r.at;
	}
	const total = (rows ?? []).length;
	return {
		total,
		cases: caseIds.size,
		tasks: taskIds.size,
		...counts,
		stale,
		eligible,
		currentPassed: passed,
		demo: (rows ?? []).filter((r) => r.source === "demo").length,
		lastAt,
		passRate: eligible ? Math.round((passed / eligible) * 100) : 0,
	};
}

/**
 * 按任务聚合。没有 taskId 的记录各自成组（name 默认「单条登记」），
 * 这样「按任务」视图不会把所有手工登记混成一坨，也不会丢掉任何一条记录。
 * 返回按最近一次执行时间倒序的任务列表。
 */
export function groupRuns(rows, opts = {}) {
	const isStale = typeof opts.isStale === "function" ? opts.isStale : () => false;
	const casesById = opts.casesById ?? new Map();
	const groups = new Map();
	for (const r of sortRunsDesc(rows)) {
		const key = r.taskId || `single:${r.id || r.caseId}`;
		let g = groups.get(key);
		if (!g) {
			g = {
				key,
				taskId: r.taskId || "",
				name: r.taskName || (r.taskId ? "未命名任务" : "单条登记"),
				at: r.at,
				source: r.source,
				rows: [],
			};
			groups.set(key, g);
		}
		g.rows.push(r);
		// 组内时间倒序已在 sortRunsDesc 里保证，第一条即最近一次
		if (timeOf(r.at) > timeOf(g.at)) g.at = r.at;
		if (r.source === "ai") g.source = "ai";
	}
	return [...groups.values()]
		.map((g) => ({
			...g,
			counts: {
				通过: g.rows.filter((r) => r.verdict === "通过").length,
				失败: g.rows.filter((r) => r.verdict === "失败").length,
				阻塞: g.rows.filter((r) => r.verdict === "阻塞").length,
			},
			total: g.rows.length,
			stale: g.rows.filter((r) => isStale(r, casesById.get(r.caseId))).length,
		}))
		.sort((a, b) => timeOf(b.at) - timeOf(a.at) || String(a.name).localeCompare(String(b.name)));
}

/** CSV 单元格：双引号包裹 + 内部双引号翻倍；空值留空。 */
function cell(v) {
	const raw = String(v ?? "");
	const s = /^[=+@\-\t\r\n]/.test(raw) ? "\'" + raw : raw;
	return `"${s.replace(/"/g, '""')}"`;
}

/**
 * 流水 → CSV。列固定，顺序便于在表格软件里直接透视；
 * 时间和结论放最前面，备注放最后（可能很长）。
 */
export function runsCsv(rows, opts = {}) {
	const casesById = opts.casesById ?? new Map();
	const pathOf = typeof opts.pathOf === "function" ? opts.pathOf : () => "";
	const isStale = typeof opts.isStale === "function" ? opts.isStale : () => false;
	const head = ["时间", "结论", "环境", "编号", "用例标题", "所属路径", "来源", "任务", "过期", "备注"];
	const lines = [head.map(cell).join(",")];
	for (const r of sortRunsDesc(rows)) {
		const c = casesById.get(r.caseId) ?? null;
		lines.push(
			[
				stampText(r.at),
				r.verdict,
				r.env || "",
				r.code || c?.code || "",
				c?.title || "（用例已删除）",
				pathOf(c),
				sourceLabel(r.source),
				r.taskName || "",
				isStale(r, c) ? "是" : "否",
				r.note || "",
			]
				.map(cell)
				.join(","),
		);
	}
	return lines.join("\r\n");
}
