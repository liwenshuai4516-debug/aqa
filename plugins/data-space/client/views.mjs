/**
 * 数据空间的页面渲染：左侧层级树、概览、用例库、数据集、设置。
 * 只输出 HTML 字符串，不做事件绑定（见 entry.mjs）。
 */
import {
	CASE_STATUS,
	S,
	casesOfFeature,
	casesOfModule,
	casesOfSystem,
	caseMatches,
	datasetNames,
	esc,
	featureOf,
	featuresOf,
	filteredRuns,
	fmtTime,
	isRunStale,
	moduleOf,
	modulesOf,
	observedTypes,
	pathOfFeature,
	pathText,
	resultOf,
	resultStats,
	runsGroups,
	runsSummary,
	systemOf,
	typeCounts,
} from "./state.mjs";
import { RUN_RANGES, RUN_SOURCES, sourceLabel, stampText, verdictClass } from "./results.mjs";

import { isIntroduced } from "./brief.mjs";

export const ICON = {
	db: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c1.7 1.7 13.5 1.7 16 0V5"/><path d="M4 11v6c1.7 1.7 13.5 1.7 16 0v-6"/></svg>`,
	plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
	edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.6 3.4a2.1 2.1 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5z"/></svg>`,
	copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/></svg>`,
	trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M18.5 6l-1 14h-11l-1-14"/></svg>`,
	case: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 10.5l2 2 4.5-4.5"/><path d="M8 17h8"/></svg>`,
	brief: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 3v-9.5A7.5 7.5 0 0 1 11.5 5h2A7.5 7.5 0 0 1 21 11.5z"/><path d="M9.5 11.5h5"/><path d="M12 9v5"/></svg>`,
};

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

/* ------------------------------------------------------------------ 左侧项目列表 */

function projectTypeSplit(systemId) {
	const list = casesOfSystem(systemId);
	const api = list.filter((c) => c.type === "接口").length;
	return { total: list.length, api, ui: list.length - api };
}

function projectRow(s) {
	const on = S.sel.systemId === s.id;
	const mods = modulesOf(s.id);
	const featTotal = S.features.filter((f) => mods.some((m) => m.id === f.moduleId)).length;
	const { total, api, ui } = projectTypeSplit(s.id);
	return `<button class="dsp-project ${on ? "on" : ""}" data-act="sel-project" data-id="${esc(s.id)}" title="${esc(s.name)}">
		<span class="dsp-dot ${esc(s.color)}"></span>
		<span class="dsp-project-main">
			<span class="dsp-project-name">${esc(s.name)}${s.code ? `<em>${esc(s.code)}</em>` : ""}</span>
			<span class="dsp-project-meta">${mods.length} 模块 · ${featTotal} 功能 · 接口 ${api} / UI ${ui}</span>
		</span>
		<span class="dsp-cnt ${total ? "" : "zero"}">${total || "空"}</span>
	</button>`;
}

/** 左栏只列项目（带搜索），三级层级收进项目内部，避免项目一多就拉出一条长树。 */
export function projectListHtml() {
	const q = S.projectQ.trim().toLowerCase();
	const list = S.systems.filter((s) => !q || `${s.name} ${s.code} ${s.note}`.toLowerCase().includes(q));
	const allOn = !S.sel.systemId;
	return `<aside class="dsp-projects">
		<div class="dsp-projects-head">
			<span class="dsp-projects-title">项目</span>
			<span class="dsp-cnt">${S.systems.length}</span>
			<button class="dsp-btn icon" data-act="new-system" title="新建项目">${ICON.plus}</button>
		</div>
		<div class="dsp-projects-search">
			<input data-el="project-search" value="${esc(S.projectQ)}" placeholder="搜索项目名称 / 编号" />
		</div>
		<div class="dsp-projects-body">
			<button class="dsp-project all ${allOn ? "on" : ""}" data-act="sel-all">
				${ICON.case}
				<span class="dsp-project-main">
					<span class="dsp-project-name">全部用例</span>
					<span class="dsp-project-meta">跨项目检索与维护</span>
				</span>
				<span class="dsp-cnt">${S.cases.length}</span>
			</button>
			${
				list.length
					? list.map(projectRow).join("")
					: `<div class="dsp-projects-empty">${S.systems.length ? "没有匹配的项目" : "还没有项目"}<button class="dsp-btn primary" data-act="new-system">＋ 新建项目</button></div>`
			}
		</div>
		<div class="dsp-projects-foot">${list.length === S.systems.length ? `共 ${S.systems.length} 个项目 · 进项目内管理用例` : `筛选出 ${list.length} / ${S.systems.length} 个项目`}</div>
	</aside>`;
}

/* ------------------------------------------------------------------ 概览 */

function statCard(label, value, hint) {
	return `<div class="dsp-stat"><div class="dsp-stat-label">${label}</div><div class="dsp-stat-value">${value}</div><div class="dsp-stat-hint">${esc(hint)}</div></div>`;
}

export function overviewHtml() {
	const covered = S.features.filter((f) => casesOfFeature(f.id).length).length;
	const featureTotal = S.features.length;
	const gaps = S.features.filter((f) => !casesOfFeature(f.id).length);
	const bySystem = S.systems.map((s) => ({
		s,
		cases: casesOfSystem(s.id).length,
		features: S.features.filter((f) => pathOfFeature(f.id).system?.id === s.id).length,
	}));
	const maxCases = Math.max(1, ...bySystem.map((x) => x.cases));
	const tCounts = typeCounts();
	const typeRows = [...tCounts.entries()].sort((a, b) => b[1] - a[1]);
	const maxType = Math.max(1, ...typeRows.map((r) => r[1]));
	const recent = [...S.cases]
		.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
		.slice(0, 6);
	const orphan = S.cases.filter((c) => !featureOf(c.featureId)).length;
	const rs = resultStats();
	const resultBars = [
		["通过", rs["通过"], "pass"],
		["失败", rs["失败"], "fail"],
		["阻塞", rs["阻塞"], "blocked"],
		["未执行", rs.untested, "none"],
	];
	const maxResult = Math.max(1, ...resultBars.map((b) => b[1]));
	const nearEnd = [...S.cases]
		.map((c) => ({ c, hit: resultOf(c) }))
		.filter((x) => x.hit && x.hit.run.verdict !== "通过")
		.sort((a, b) => String(b.hit.run.at).localeCompare(String(a.hit.run.at)))
		.slice(0, 5);

	return `
	${S.migratedFrom ? `<div class="dsp-tip">已从 0.1.0 版数据迁移：原来的「分组」变成了「项目」，数据集归属已清空为「未归类」。原文件已备份，见「设置」。</div>` : ""}
	<div class="dsp-stats">
		${statCard("项目", S.systems.length, "业务系统 / 产品")}
		${statCard("模块", S.modules.length, "按业务模块划分")}
		${statCard("功能", featureTotal, "用例的挂载点")}
		${statCard("用例", S.cases.length, orphan ? `含 ${orphan} 条未归类` : "接口 / UI 两类")}
		${statCard("数据集", S.datasets.length, "可被用例引用")}
		${statCard("通过率", `${rs.passRate}%`, `已执行 ${rs.executed} / ${rs.total} 条用例`)}
	</div>
	<div class="dsp-cols">
		<section class="dsp-card">
			<div class="dsp-card-head"><span>用例覆盖</span><span>${covered}/${featureTotal} 个功能</span></div>
			<div class="dsp-progress"><i style="width:${pct(covered, featureTotal)}%"></i></div>
			<div class="dsp-muted" style="margin:6px 0 14px">功能覆盖率 ${pct(covered, featureTotal)}% · 未覆盖 ${gaps.length} 个功能</div>
			<div class="dsp-card-head"><span>按类型分布</span><span>用例数</span></div>
			${
				typeRows.length
					? typeRows
							.map(
								([t, n]) =>
									`<div class="dsp-bar-row"><span class="dsp-bar-name">${typeBadge(t)}</span><span class="dsp-bar"><i style="width:${pct(n, maxType)}%"></i></span><span class="dsp-bar-num">${n}</span></div>`,
							)
							.join("")
					: `<div class="dsp-muted">还没有用例</div>`
			}
			<div class="dsp-card-head" style="margin-top:14px"><span>执行结果</span><span class="dsp-inline"><span>${rs.executed} 条已执行${rs.stale ? ` · ${rs.stale} 条已过期` : ""}</span><button class="dsp-btn" data-act="tab" data-tab="runs">查看记录 →</button></span></div>
			<div class="dsp-progress"><i class="pass" style="width:${rs.passRate}%"></i></div>
			<div class="dsp-muted" style="margin:6px 0 10px">通过率 ${rs.passRate}% · 未执行 ${rs.untested} 条（不计入分母）</div>
			${resultBars
				.map(
					([label, n, cls]) =>
						`<div class="dsp-bar-row"><span class="dsp-bar-name">${label}</span><span class="dsp-bar"><i class="${cls}" style="width:${pct(n, maxResult)}%"></i></span><span class="dsp-bar-num">${n}</span></div>`,
				)
				.join("")}
			<div class="dsp-card-head" style="margin-top:14px"><span>按项目分布</span><span>用例数</span></div>
			${
				bySystem.length
					? bySystem
							.map(
								(x) =>
									`<div class="dsp-bar-row"><span class="dsp-bar-name" title="${esc(x.s.name)}">${esc(x.s.name)}</span><span class="dsp-bar"><i style="width:${pct(x.cases, maxCases)}%"></i></span><span class="dsp-bar-num">${x.cases}</span></div>`,
							)
							.join("")
					: `<div class="dsp-muted">还没有项目</div>`
			}
		</section>
		<section class="dsp-card">
			<div class="dsp-card-head"><span>覆盖缺口</span><span>${gaps.length} 个功能没有用例</span></div>
			${
				gaps.length
					? `<div class="dsp-gap-list">${gaps
							.slice(0, 8)
							.map((f) => {
								const { system, module } = pathOfFeature(f.id);
								return `<button class="dsp-gap" data-act="goto-feature" data-id="${esc(f.id)}"><span class="dsp-gap-path">${esc(system?.name || "—")} / ${esc(module?.name || "—")}</span><b>${esc(f.name)}</b><span class="dsp-gap-go">去补用例 →</span></button>`;
							})
							.join("")}</div>`
					: `<div class="dsp-empty-inline">每个功能都已有用例 👍</div>`
			}
			<div class="dsp-card-head" style="margin-top:16px"><span>需要跟进</span><span>最近未通过的 ${nearEnd.length} 条</span></div>
			${
				nearEnd.length
					? `<div class="dsp-recent">${nearEnd
							.map(
								({ c, hit }) =>
									`<div class="dsp-recent-row" data-act="record-result" data-id="${esc(c.id)}" title="${esc(hit.run.note || "点一下登记新结果")}"><span class="dsp-result ${hit.run.verdict === "失败" ? "fail" : "blocked"}${hit.stale ? " stale" : ""}">${esc(hit.run.verdict)}</span><span class="dsp-recent-name">${esc(c.code ? `${c.code} · ` : "")}${esc(c.title)}</span><span class="dsp-recent-time">${fmtTime(hit.run.at)}</span></div>`,
							)
							.join("")}</div>`
					: `<div class="dsp-empty-inline">没有失败 / 阻塞的用例 👍</div>`
			}
			<div class="dsp-card-head" style="margin-top:16px"><span>最近更新</span><span></span></div>
			${
				recent.length
					? `<div class="dsp-recent">${recent
							.map(
								(c) =>
									`<div class="dsp-recent-row" data-act="edit-case" data-id="${esc(c.id)}"><span class="dsp-prio ${esc(c.priority)}">${esc(c.priority)}</span><span class="dsp-recent-name" title="${esc(c.title)}">${esc(c.title)}</span><span class="dsp-recent-time">${fmtTime(c.updatedAt)}</span></div>`,
							)
							.join("")}</div>`
					: `<div class="dsp-empty-inline">还没有用例</div>`
			}
		</section>
	</div>
	${footHtml()}`;
}

export function footHtml() {
	return `<div class="dsp-foot">项目 ${S.systems.length} · 模块 ${S.modules.length} · 功能 ${S.features.length} · 用例 ${S.cases.length} · 数据集 ${S.datasets.length} · 上次保存 ${fmtTime(S.updatedAt)}</div>`;
}

export const tabsList = () => [
	["overview", "概览", null],
	["cases", "用例库", S.cases.length],
	["runs", "执行结果", S.runs.length],
	["datasets", "数据集", S.datasets.length],
	["settings", "设置", null],
];

/* ------------------------------------------------------------------ 用例库 */

const prioBadge = (p) => `<span class="dsp-prio ${esc(p)}">${esc(p)}</span>`;
const statusBadge = (s) => `<span class="dsp-status ${esc(s)}">${esc(s)}</span>`;

/** 执行结果徽章：通过 / 失败 / 阻塞 / 未执行；过期（用例改过）降不透明度并标注。 */
function resultBadge(c) {
	const hit = resultOf(c);
	if (!hit) {
		return `<button class="dsp-result none" data-act="record-result" data-id="${esc(c.id)}" title="还没执行过，点这里登记结果">未执行</button>`;
	}
	const cls = hit.run.verdict === "通过" ? "pass" : hit.run.verdict === "失败" ? "fail" : "blocked";
	const when = fmtTime(hit.run.at);
	const src = hit.run.source === "ai" ? "AI 回写" : "手工登记";
	const title = `${hit.run.verdict} · ${when} · ${src}${hit.run.note ? ` · ${hit.run.note}` : ""}${
		hit.stale ? " · 用例已更新，结果可能过期" : ""
	}`;
	return `<button class="dsp-result ${cls}${hit.stale ? " stale" : ""}" data-act="record-result" data-id="${esc(c.id)}" title="${esc(title)}">${esc(hit.run.verdict)}<span class="dsp-result-time">${esc(fmtTime(hit.run.at))}</span></button>`;
}

function crumb(parts) {
	return `<div class="dsp-crumb">${parts
		.map(([label, act, id], i) =>
			label === null
				? `<span class="dsp-crumb-sep">/</span>`
				: `<button data-act="${act}"${id ? ` data-id="${esc(id)}"` : ""}>${esc(label)}</button>${i < parts.length - 1 ? `<span class="dsp-crumb-sep">/</span>` : ""}`,
		)
		.join("")}</div>`;
}

const typeBadge = (t) => {
	const name = String(t || "").trim() || "未分类";
	const cls = name === "接口" ? "api" : name === "UI" ? "ui" : "other";
	return `<span class="dsp-type ${cls}" title="用例类型">${esc(name)}</span>`;
};

function caseRow(c, showPath) {
	const steps = c.steps?.length ?? 0;
	const linked = datasetNames(c.datasetIds);
	const briefed = isIntroduced(c);
	return `<tr>
		<td class="dsp-code-cell">${esc(c.code || "—")}</td>
		<td class="dsp-cell-main">
			<div class="dsp-case-title" data-act="edit-case" data-id="${esc(c.id)}" title="${esc(c.title)}"><b>${esc(c.title)}</b>${
				briefed ? `<span class="dsp-briefed" title="本轮已引入 AI 对话；数据改动后会自动消失">已引入</span>` : ""
			}${
				(c.tags ?? []).length
					? `<span class="dsp-tags">${c.tags
							.slice(0, 2)
							.map((t) => `<span class="dsp-tag">${esc(t)}</span>`)
							.join("")}</span>`
					: ""
			}</div>
			${showPath ? `<div class="dsp-case-path">${esc(pathText(c.featureId, " / "))}</div>` : ""}
		</td>
		<td class="dsp-type-cell">${typeBadge(c.type)}</td>
		<td>${prioBadge(c.priority)}</td>
		<td>${statusBadge(c.status)}</td>
		<td class="dsp-result-cell">${resultBadge(c)}</td>
		<td class="dsp-num-cell">${steps}</td>
		<td class="dsp-num-cell" title="${esc(linked.join("、"))}">${linked.length}</td>
		<td class="dsp-num-cell">${fmtTime(c.updatedAt)}</td>
		<td><div class="dsp-row-actions">
			<button class="dsp-btn icon" data-act="brief-case" data-id="${esc(c.id)}" title="引入到 AI 对话">${ICON.brief}</button>
			<button class="dsp-btn icon" data-act="edit-case" data-id="${esc(c.id)}" title="编辑">${ICON.edit}</button>
			<button class="dsp-btn icon" data-act="copy-case" data-id="${esc(c.id)}" title="复制到同功能">${ICON.copy}</button>
			<button class="dsp-btn icon danger" data-act="del-case" data-id="${esc(c.id)}" title="删除">${ICON.trash}</button>
		</div></td>
	</tr>`;
}

function caseTable(list, showPath) {
	return `<div class="dsp-table-wrap"><table class="dsp-table${showPath ? " wide" : ""}">
		<colgroup><col style="width:86px"/><col style="width:auto"/><col style="width:82px"/><col style="width:64px"/><col style="width:74px"/><col style="width:104px"/><col style="width:52px"/><col style="width:52px"/><col style="width:104px"/><col style="width:136px"/></colgroup>
		<thead><tr><th>编号</th><th>用例标题</th><th>类型</th><th>优先级</th><th>状态</th><th>最近结果</th><th>步骤</th><th>数据</th><th>更新</th><th></th></tr></thead>
		<tbody>${list.map((c) => caseRow(c, showPath)).join("")}</tbody></table></div>`;
}

function caseToolbar() {
	const chips = ["all", "P0", "P1", "P2", "P3"]
		.map(
			(p) =>
				`<button class="dsp-chip ${S.priority === p ? "on" : ""}" data-act="prio" data-id="${p}">${p === "all" ? "全部优先级" : p}</button>`,
		)
		.join("");
	const counts = typeCounts();
	const typeChips = [["all", "全部类型", S.cases.length], ...observedTypes().map((t) => [t, t, counts.get(t) ?? 0])]
		.map(
			([v, label, n]) =>
				`<button class="dsp-chip ${S.caseType === v ? "on" : ""}" data-act="type" data-id="${esc(v)}">${esc(label)}<span class="dsp-chip-num">${n}</span></button>`,
		)
		.join("");
	return `<div class="dsp-toolbar">
		<input class="dsp-search" data-el="case-search" value="${esc(S.caseQ)}" placeholder="搜索编号 / 标题 / 类型 / 标签 / 负责人" />
		<select data-el="case-status"><option value="all">全部状态</option>${CASE_STATUS.map((s) => `<option value="${esc(s)}" ${S.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
		<div class="dsp-chips" style="margin:0">${chips}</div>
		<div class="dsp-chips dsp-chips-sep" style="margin:0">${typeChips}</div>
	</div>`;
}

function visibleCases(base) {
	return base.filter(
		(c) =>
			caseMatches(c, S.caseQ) &&
			(S.priority === "all" || c.priority === S.priority) &&
			(S.status === "all" || c.status === S.status) &&
			(S.caseType === "all" || String(c.type || "").trim() === S.caseType),
	);
}

function emptyCases(text, fid) {
	return `<div class="dsp-empty"><b>${esc(text)}</b>把这一步的操作步骤、预期结果和数据都记下来，后面直接复用。<button class="dsp-btn primary" data-act="new-case"${fid ? ` data-id="${esc(fid)}"` : ""}>＋ 新建用例</button></div>`;
}

function scopeChips(items) {
	return items
		.map(
			({ label, count, act, id, sid, on, title }) =>
				`<button class="dsp-chip ${on ? "on" : ""}" data-act="${act}"${id ? ` data-id="${esc(id)}"` : ""}${sid ? ` data-sid="${esc(sid)}"` : ""} title="${esc(title || label)}">${esc(label)}${
					typeof count === "number" ? `<span class="dsp-chip-num">${count}</span>` : ""
				}</button>`,
		)
		.join("");
}

/** 项目内视图：项目头 + 模块 / 功能两级筛选 + 用例表（层级不再往左栏里培）。 */
function projectView(systemId) {
	const s = systemOf(systemId);
	if (!s)
		return `<div class="dsp-empty"><b>这个项目已被删除</b><button class="dsp-btn" data-act="sel-all">回到全部用例</button></div>`;

	const mods = modulesOf(s.id);
	const activeModule = S.sel.moduleId ? moduleOf(S.sel.moduleId) : null;
	const activeFeature = S.sel.featureId ? featureOf(S.sel.featureId) : null;
	const moduleFeatures = activeModule ? featuresOf(activeModule.id) : [];
	const scopeCases = activeFeature
		? casesOfFeature(activeFeature.id)
		: activeModule
			? casesOfModule(activeModule.id)
			: casesOfSystem(s.id);
	const list = visibleCases(scopeCases);
	const projectCases = casesOfSystem(s.id);
	const api = projectCases.filter((c) => c.type === "接口").length;
	const featureTotal = S.features.filter((f) => mods.some((m) => m.id === f.moduleId)).length;

	const crumbParts = [[s.name, "sel-project", s.id]];
	if (activeModule) crumbParts.push([activeModule.name, "sel-module", activeModule.id]);
	if (activeFeature) crumbParts.push([activeFeature.name, "sel-feature", activeFeature.id]);

	const head = activeFeature
		? { title: activeFeature.name, note: activeFeature.note, kind: "feature", id: activeFeature.id, label: "功能" }
		: activeModule
			? { title: activeModule.name, note: activeModule.note, kind: "module", id: activeModule.id, label: "模块" }
			: { title: s.name, note: s.note, kind: "system", id: s.id, label: "项目" };

	const meta = activeFeature
		? `所属模块 ${activeModule?.name || "—"} · 编号前缀 ${(s.code || "CASE").toUpperCase()} · 项目合计接口 ${api} / UI ${projectCases.length - api}`
		: activeModule
			? `${moduleFeatures.length} 个功能 · ${scopeCases.length} 条用例 · 项目合计接口 ${api} / UI ${projectCases.length - api}`
			: `${mods.length} 个模块 · ${featureTotal} 个功能 · 接口 ${api} / UI ${projectCases.length - api}`;

	const moduleChips = scopeChips([
		{
			label: "全部模块",
			count: projectCases.length,
			act: "sel-project",
			id: s.id,
			on: !activeModule,
			title: "查看项目内全部用例",
		},
		...mods.map((m) => ({
			label: m.name,
			count: casesOfModule(m.id).length,
			act: "sel-module",
			id: m.id,
			sid: s.id,
			on: activeModule?.id === m.id,
			title: m.note || m.name,
		})),
	]);
	const featureChips = activeModule
		? scopeChips([
				{
					label: "全部功能",
					count: casesOfModule(activeModule.id).length,
					act: "sel-module",
					id: activeModule.id,
					sid: s.id,
					on: !activeFeature,
					title: "查看模块内全部用例",
				},
				...moduleFeatures.map((f) => ({
					label: f.name,
					count: casesOfFeature(f.id).length,
					act: "sel-feature",
					id: f.id,
					on: activeFeature?.id === f.id,
					title: f.note || f.name,
				})),
			])
		: "";

	const hint =
		!activeModule && !mods.length
			? `<div class="dsp-empty"><b>这个项目还没有模块</b>例如「合同管理」「供应商管理」；模块下再建功能，用例挂在功能上。<button class="dsp-btn primary" data-act="new-module" data-id="${esc(s.id)}">＋ 新建模块</button></div>`
			: activeModule && !moduleFeatures.length
				? `<div class="dsp-empty"><b>这个模块还没有功能</b>功能是更细的业务入口，例如「经营合同」「合同变更」。<button class="dsp-btn primary" data-act="new-feature" data-id="${esc(activeModule.id)}" data-sid="${esc(s.id)}">＋ 新建功能</button></div>`
				: "";

	const emptyList = scopeCases.length
		? `<div class="dsp-empty"><b>没有匹配的用例</b>换个关键词或筛选条件试试。</div>`
		: emptyCases(activeFeature ? "这个功能还没有用例" : "这个范围还没有用例", activeFeature?.id);

	const sub = [head.note ? esc(head.note) : "", meta].filter(Boolean).join(" · ");

	return `
	${crumbParts.length > 1 ? crumb(crumbParts) : ""}
	<div class="dsp-page-head">
		<div class="dsp-page-title-wrap">
			<h3>${esc(head.title)}${head.kind === "system" && s.code ? `<span class="dsp-code">${esc(s.code)}</span>` : ""}<span class="dsp-num">${scopeCases.length} 条用例</span></h3>
			<div class="dsp-page-sub">${sub}</div>
		</div>
		<div class="dsp-inline">
			<button class="dsp-btn" data-act="brief-scope" title="把当前范围的 ${list.length} 条用例引入 AI 对话"${
				list.length ? "" : " disabled"
			}>${ICON.brief}引入对话${list.length ? ` · ${list.length}` : ""}</button>
			<button class="dsp-btn" data-act="edit-node" data-kind="${head.kind}" data-id="${esc(head.id)}">编辑${head.label}</button>
			${
				activeModule
					? `<button class="dsp-btn" data-act="new-feature" data-id="${esc(activeModule.id)}" data-sid="${esc(s.id)}">＋ 新建功能</button>`
					: `<button class="dsp-btn" data-act="new-module" data-id="${esc(s.id)}">＋ 新建模块</button>`
			}
			<button class="dsp-btn primary" data-act="new-case">＋ 新建用例</button>
		</div>
	</div>
	${
		mods.length
			? `<div class="dsp-scope">
		<div class="dsp-scope-line"><span class="dsp-scope-label">模块</span>${moduleChips}</div>
		${activeModule ? `<div class="dsp-scope-line"><span class="dsp-scope-label">功能</span>${featureChips}</div>` : ""}
	</div>`
			: ""
	}
	${hint || `${caseToolbar()}${list.length ? caseTable(list, !activeFeature) : emptyList}`}
	${footHtml()}`;
}

function allView() {
	const list = visibleCases(S.cases);
	const orphan = S.cases.filter((c) => !featureOf(c.featureId));
	if (!S.systems.length) {
		return `
	<div class="dsp-page-head">
		<div><h3>全部用例<span class="dsp-num">0 条</span></h3><div class="dsp-page-sub">先建一个项目（例如「项目管理系统」），再往下加模块、功能与用例。</div></div>
		<button class="dsp-btn primary" data-act="new-system">＋ 新建项目</button>
	</div>
	<div class="dsp-empty"><b>还没有项目</b>左侧列表按项目组织用例，项目多了也能搜索定位。<button class="dsp-btn primary" data-act="new-system">＋ 新建项目</button></div>
	${footHtml()}`;
	}
	return `
	<div class="dsp-page-head">
		<div><h3>全部用例<span class="dsp-num">${S.cases.length} 条</span></h3><div class="dsp-page-sub">跨项目查看；左侧点项目进入项目内管理，标题下方是所属项目 / 模块 / 功能。</div></div>
		<div class="dsp-inline">
			<button class="dsp-btn" data-act="brief-scope" title="把当前范围的 ${list.length} 条用例引入 AI 对话"${
				list.length ? "" : " disabled"
			}>${ICON.brief}引入对话${list.length ? ` · ${list.length}` : ""}</button>
			<button class="dsp-btn" data-act="new-system">＋ 新建项目</button>
			<button class="dsp-btn primary" data-act="new-case">＋ 新建用例</button>
		</div>
	</div>
	${caseToolbar()}
	${orphan.length ? `<div class="dsp-tip">有 ${orphan.length} 条用例没有归属功能（功能被删或导入时缺失），编辑时选一个功能即可归位。</div>` : ""}
	${list.length ? caseTable(list, true) : S.cases.length ? `<div class="dsp-empty"><b>没有匹配的用例</b>换个关键词或筛选条件试试。</div>` : emptyCases("还没有用例")}
	${footHtml()}`;
}

export function casesHtml() {
	if (!S.sel.systemId) return allView();
	return projectView(S.sel.systemId);
}

/**
 * 当前可见范围的用例（跟随搜索 / 优先级 / 状态 / 类型筛选）——
 * 「引入对话」引的就是用户眼前这一屏，所见即所引。
 * @returns {{label: string, cases: object[], total: number, filtered: boolean}}
 */
export function currentCaseScope() {
	const pack = (label, base) => {
		const shown = visibleCases(base);
		return { label, cases: shown, total: base.length, filtered: shown.length !== base.length };
	};

	if (!S.sel.systemId) return pack("全部用例", S.cases);
	const s = systemOf(S.sel.systemId);
	if (!s) return pack("用例", S.cases);
	const activeModule = S.sel.moduleId ? moduleOf(S.sel.moduleId) : null;
	const activeFeature = S.sel.featureId ? featureOf(S.sel.featureId) : null;
	const base = activeFeature
		? casesOfFeature(activeFeature.id)
		: activeModule
			? casesOfModule(activeModule.id)
			: casesOfSystem(s.id);
	const label = [s.name, activeModule?.name, activeFeature?.name].filter(Boolean).join(" / ");
	return pack(label, base);
}

/* ------------------------------------------------------------------ 执行结果 */

const sourceBadge = (source) =>
	`<span class="dsp-source ${source === "ai" ? "ai" : "manual"}">${esc(sourceLabel(source))}</span>`;

const verdictBadge = (v, stale) =>
	`<span class="dsp-result ${verdictClass(v)}${stale ? " stale" : ""}">${esc(v)}</span>`;

/** 用例被删后流水仍可能短暂存在（内存里刚删）：如实显示，不静默丢行。 */
function runCaseLabel(r, c, stale) {
	return `<div class="dsp-run-case"><b>${esc(r.code || c?.code || "未编号")} · ${esc(c?.title || "用例已删除")}</b>${
		stale ? `<span class="dsp-warn">可能过期</span>` : ""
	}</div>`;
}

function runRow(r) {
	const c = S.cases.find((x) => x.id === r.caseId) ?? null;
	const stale = isRunStale(r, c);
	const path = c ? pathText(c.featureId) : "—";
	const actions = c
		? `<div class="dsp-row-actions">
			<button class="dsp-btn icon" data-act="brief-case" data-id="${esc(c.id)}" title="引入到 AI 对话">${ICON.brief}</button>
			<button class="dsp-btn" data-act="record-result" data-id="${esc(c.id)}" title="再登记一次结果（旧记录仍保留）">重新登记</button>
		</div>`
		: "";
	return `<tr>
		<td class="dsp-runs-time" title="${esc(stampText(r.at))}">${esc(fmtTime(r.at))}</td>
		<td>${verdictBadge(r.verdict, stale)}</td>
		<td class="dsp-cell-main">${runCaseLabel(r, c, stale)}</td>
		<td class="dsp-path-cell" title="${esc(path)}">${esc(path)}</td>
		<td>${sourceBadge(r.source)}</td>
		<td class="dsp-muted" title="${esc(r.taskName || "")}">${esc(r.taskName || "—")}</td>
		<td class="dsp-run-note" title="${esc(r.note || "")}">${esc(r.note || "—")}</td>
		<td>${actions}</td>
	</tr>`;
}

function runsTable(rows) {
	return `<div class="dsp-table-wrap"><table class="dsp-table runs">
		<colgroup><col style="width:108px"/><col style="width:66px"/><col style="width:auto"/><col style="width:164px"/><col style="width:82px"/><col style="width:128px"/><col style="width:196px"/><col style="width:132px"/></colgroup>
		<thead><tr><th>时间</th><th>结论</th><th>用例</th><th>所属路径</th><th>来源</th><th>任务</th><th>备注</th><th></th></tr></thead>
		<tbody>${rows.map(runRow).join("")}</tbody></table></div>`;
}

function taskRow(r) {
	const c = S.cases.find((x) => x.id === r.caseId) ?? null;
	const stale = isRunStale(r, c);
	const title = c?.title || "用例已删除";
	return `<button class="dsp-task-row" data-act="goto-case" data-id="${esc(r.caseId)}">
		${verdictBadge(r.verdict, stale)}
		<span class="dsp-task-code">${esc(r.code || c?.code || "—")}</span>
		<span class="dsp-task-title" title="${esc(title)}">${esc(title)}</span>
		<span class="dsp-task-note" title="${esc(r.note || "")}">${esc(r.note || "")}</span>
		<span class="dsp-task-when">${esc(fmtTime(r.at))}</span>
	</button>`;
}

const TASK_PREVIEW = 8;

function taskCard(g) {
	const long = g.rows.length > TASK_PREVIEW;
	const open = S.runsOpen === g.key;
	const shown = long && !open ? g.rows.slice(0, TASK_PREVIEW) : g.rows;
	const pctPass = g.total ? Math.round((g.counts["通过"] / g.total) * 100) : 0;
	return `<section class="dsp-task">
		<div class="dsp-task-head">
			<span class="dsp-task-name" title="${esc(g.name)}">${esc(g.name)}</span>
			${sourceBadge(g.source)}
			<span class="dsp-task-when" title="${esc(stampText(g.at))}">${esc(fmtTime(g.at))}</span>
			<span class="dsp-task-sum">通过 ${g.counts["通过"]} · 失败 ${g.counts["失败"]} · 阻塞 ${g.counts["阻塞"]} · 共 ${g.total} 条${
				g.stale ? ` · <span class="dsp-warn">${g.stale} 条过期</span>` : ""
			}</span>
			<span class="dsp-task-bar"><i style="width:${pctPass}%"></i></span>
		</div>
		<div class="dsp-task-rows">${shown.map(taskRow).join("")}</div>
		${
			long
				? `<button class="dsp-btn dsp-task-more" data-act="toggle-runs-task" data-id="${esc(g.key)}">${
						open ? "收起" : `展开其余 ${g.rows.length - shown.length} 条`
					}</button>`
				: ""
		}
	</section>`;
}

function runsToolbar(rows) {
	const verdictChips = ["all", ...(S.verdicts.length ? S.verdicts : ["通过", "失败", "阻塞"])]
		.map(
			(v) =>
				`<button class="dsp-chip ${S.runsVerdict === v ? "on" : ""}" data-act="runs-verdict" data-id="${esc(v)}">${
					v === "all" ? "全部结论" : esc(v)
				}</button>`,
		)
		.join("");
	const viewChips = [
		["flat", "流水"],
		["task", "按任务"],
	]
		.map(
			([v, l]) =>
				`<button class="dsp-chip ${S.runsView === v ? "on" : ""}" data-act="runs-view" data-id="${v}">${l}</button>`,
		)
		.join("");
	const sources = RUN_SOURCES.map(
		([v, l]) => `<option value="${esc(v)}" ${S.runsSource === v ? "selected" : ""}>${esc(l)}</option>`,
	).join("");
	const ranges = RUN_RANGES.map(
		([v, l]) => `<option value="${esc(v)}" ${S.runsRange === v ? "selected" : ""}>${esc(l)}</option>`,
	).join("");
	return `<div class="dsp-toolbar">
		<input class="dsp-search" data-el="runs-search" value="${esc(S.runsQ)}" placeholder="搜索编号 / 标题 / 备注 / 任务 / 路径" />
		<div class="dsp-chips" style="margin:0">${verdictChips}</div>
		<select data-el="runs-source">${sources}</select>
		<select data-el="runs-range">${ranges}</select>
		<div class="dsp-chips dsp-chips-sep" style="margin:0">${viewChips}</div>
		<span class="dsp-muted">${rows.length} / ${S.runs.length}</span>
	</div>`;
}

/** 「执行结果」页：流水与按任务两种视图，共用一套筛选。 */
export function runsHtml() {
	const all = S.runs;
	const rows = filteredRuns();
	const st = runsSummary(rows);
	const filtered = rows.length !== all.length;
	const headSub = all.length
		? `覆盖 ${st.cases} 条用例 · 通过 ${st["通过"]} / 失败 ${st["失败"]} / 阻塞 ${st["阻塞"]} · 通过率 ${st.passRate}%${
				st.stale ? ` · ${st.stale} 条可能过期` : ""
			}${filtered ? ` · 已筛出 ${rows.length} 条` : ""}`
		: "在用例表登记结果，或在对话里执行后由 AI 回写；两类记录都汇总在这里。";
	const needFollow = (st["失败"] ?? 0) + (st["阻塞"] ?? 0);

	const head = `
	<div class="dsp-page-head">
		<div class="dsp-page-title-wrap">
			<h3>执行结果<span class="dsp-num">${all.length} 条记录</span></h3>
			<div class="dsp-page-sub">${headSub}</div>
		</div>
		<div class="dsp-inline">
			<button class="dsp-btn" data-act="export-runs"${rows.length ? "" : " disabled"} title="导出当前筛选的流水为 CSV">导出 CSV</button>
			<button class="dsp-btn" data-act="reload" title="重新读取服务端数据">刷新</button>
		</div>
	</div>`;

	if (!all.length) {
		return `${head}
	<div class="dsp-empty"><b>还没有执行记录</b>在「用例库」点某条用例的「未执行」徽章就能登记；或在对话里执行后会由 AI 回写。<div class="dsp-inline" style="margin-top:12px"><button class="dsp-btn" data-act="tab" data-tab="cases">去用例库登记</button><button class="dsp-btn" data-act="load-demo-runs" title="生成一批演示用的执行记录，不会改动用例">载入示例记录</button></div><div class="dsp-muted" style="margin-top:8px">示例记录只用于预览页面效果，随时可在「设置」里清空。</div></div>
	${footHtml()}`;
	}

	const stats = `<div class="dsp-stats">
		${statCard("执行记录", st.total, `覆盖 ${st.cases} 条用例 · ${st.tasks} 个任务`)}
		${statCard("通过率", `${st.passRate}%`, `通过 ${st["通过"]} / ${st.total} 条记录`)}
		${statCard("需要跟进", needFollow, `失败 ${st["失败"]} · 阻塞 ${st["阻塞"]}`)}
		${statCard("最近执行", fmtTime(st.lastAt), st.stale ? `${st.stale} 条结论已过期，建议重跑` : "结果均为最新")}
	</div>`;

	const list = rows.length
		? S.runsView === "task"
			? `<div class="dsp-task-list">${runsGroups(rows).map(taskCard).join("")}</div>`
			: runsTable(rows)
		: `<div class="dsp-empty"><b>没有匹配的执行记录</b>换个关键词，或把结论 / 来源 / 时间改回「全部」。</div>`;

	return `${head}${stats}${runsToolbar(rows)}${list}${footHtml()}`;
}

/* ------------------------------------------------------------------ 数据集 */

function scopeSelect(name, value, options) {
	return `<select data-el="${name}">${options.map(([v, l]) => `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
}

function datasetRow(d) {
	const { feature, module, system } = pathOfFeature(d.featureId);
	const where = feature ? `${system?.name || "—"} / ${module?.name || "—"} / ${feature.name}` : "未归类";
	return `<tr>
		<td><div class="dsp-name-cell" data-act="edit-dataset" data-id="${esc(d.id)}"><span class="dsp-dot ${esc(system?.color || "gray")}"></span><b title="${esc(d.name)}">${esc(d.name)}</b></div></td>
		<td class="dsp-muted" title="${esc(where)}">${esc(where)}</td>
		<td>${esc(d.env || "—")}</td>
		<td class="dsp-num-cell">${d.records?.length || 0}</td>
		<td><div class="dsp-tags">${
			(d.tags ?? [])
				.slice(0, 3)
				.map((t) => `<span class="dsp-tag">${esc(t)}</span>`)
				.join("") || `<span class="dsp-muted">—</span>`
		}</div></td>
		<td class="dsp-num-cell">${fmtTime(d.updatedAt)}</td>
		<td><div class="dsp-row-actions">
			<button class="dsp-btn icon" data-act="edit-dataset" data-id="${esc(d.id)}" title="编辑">${ICON.edit}</button>
			<button class="dsp-btn icon" data-act="copy-dataset" data-id="${esc(d.id)}" title="复制">${ICON.copy}</button>
			<button class="dsp-btn icon danger" data-act="del-dataset" data-id="${esc(d.id)}" title="删除">${ICON.trash}</button>
		</div></td>
	</tr>`;
}

function scopedDatasets() {
	const { systemId, moduleId, featureId } = S.datasetScope;
	const q = S.datasetQ.trim().toLowerCase();
	return S.datasets.filter((d) => {
		if (featureId && d.featureId !== featureId) return false;
		if (!featureId && moduleId) {
			const fids = new Set(featuresOf(moduleId).map((f) => f.id));
			if (!fids.has(d.featureId)) return false;
		}
		if (!featureId && !moduleId && systemId) {
			const mids = new Set(modulesOf(systemId).map((m) => m.id));
			const fids = new Set(S.features.filter((f) => mids.has(f.moduleId)).map((f) => f.id));
			if (!fids.has(d.featureId)) return false;
		}
		if (!q) return true;
		return [d.name, d.env, d.note, ...(d.tags ?? []), pathText(d.featureId)].join(" ").toLowerCase().includes(q);
	});
}

export function datasetsHtml() {
	const { systemId, moduleId, featureId } = S.datasetScope;
	const list = scopedDatasets();
	const modOptions = [["", "全部模块"], ...(systemId ? modulesOf(systemId).map((m) => [m.id, m.name]) : [])];
	const featOptions = [["", "全部功能"], ...(moduleId ? featuresOf(moduleId).map((f) => [f.id, f.name]) : [])];
	return `
	<div class="dsp-page-head">
		<div><h3>数据集<span class="dsp-num">${S.datasets.length} 份</span></h3><div class="dsp-page-sub">键值记录按功能归类；用例编辑时可直接勾选引用，避免同一份账号、参数反复抄写。</div></div>
		<button class="dsp-btn primary" data-act="new-dataset">＋ 新建数据集</button>
	</div>
	<div class="dsp-toolbar">
		<input class="dsp-search" data-el="dataset-search" value="${esc(S.datasetQ)}" placeholder="搜索名称 / 标签 / 备注" />
		${scopeSelect("ds-system", systemId, [["", "全部项目"], ...S.systems.map((s) => [s.id, s.name])])}
		${scopeSelect("ds-module", moduleId, modOptions)}
		${scopeSelect("ds-feature", featureId, featOptions)}
		<span class="dsp-muted">${list.length} / ${S.datasets.length}</span>
	</div>
	${
		list.length
			? `<div class="dsp-table-wrap"><table class="dsp-table ds"><colgroup><col style="width:26%"/><col style="width:26%"/><col style="width:92px"/><col style="width:56px"/><col style="width:13%"/><col style="width:100px"/><col style="width:112px"/></colgroup><thead><tr><th>名称</th><th>所属功能</th><th>环境</th><th>记录</th><th>标签</th><th>更新时间</th><th></th></tr></thead><tbody>${list.map(datasetRow).join("")}</tbody></table></div>`
			: `<div class="dsp-empty"><b>${S.datasets.length ? "没有匹配的数据集" : "还没有数据集"}</b>${S.datasets.length ? "换个筛选条件或清空搜索词试试。" : "把一份账号、参数或边界值建成数据集，挂在对应功能下。"}<button class="dsp-btn primary" data-act="new-dataset">＋ 新建数据集</button></div>`
	}
	${footHtml()}`;
}

/* ------------------------------------------------------------------ 设置 */

export function settingsHtml() {
	const covered = S.features.filter((f) => casesOfFeature(f.id).length).length;
	return `
	<div class="dsp-stack">
		${S.migratedFrom ? `<section class="dsp-card"><div class="dsp-card-head">数据已完成升级</div><div class="dsp-muted">检测到 0.1.0 版数据（分组 + 数据集），已自动升级为「项目 / 模块 / 功能 / 用例」结构：原分组变成项目，code 留空（可在项目编辑里补，例如 PMS），数据集归属清空为未归类。升级前的旧文件已备份在同一目录，文件名形如 <span class="dsp-code">store.json.v1-&lt;时间戳&gt;.bak</span>。</div></section>` : ""}
		<section class="dsp-card">
			<div class="dsp-card-head">数据文件位置</div>
			<div class="dsp-muted">数据存在本机数据目录，全局一份：不按项目、不按会话隔离，换会话 / 换项目读到的是同一批数据；插件升级或卸载都不会删它。</div>
			<div style="margin-top:8px"><span class="dsp-code">${esc(S.file || "—")}</span></div>
			<div class="dsp-muted" style="margin-top:8px">想用 AI 批量改数据，直接改这个文件即可（JSON：systems / modules / features / cases / datasets 五个数组），刷新页面就会读到。</div>
		</section>
		<section class="dsp-card">
			<div class="dsp-card-head">导入 / 导出</div>
			<div class="dsp-inline">
				<button class="dsp-btn" data-act="export">导出 JSON</button>
				<button class="dsp-btn" data-act="import">导入 JSON</button>
				<button class="dsp-btn danger" data-act="reset">恢复示例数据</button>
				<span class="dsp-muted">导入会整份替换当前数据（先导出备份更稳）；也接受 0.1.0 版「分组 + 数据集」格式，导入后自动升级。</span>
			</div>
			<input type="file" accept="application/json,.json" data-el="import-file" style="display:none" />
		</section>
		<section class="dsp-card">
			<div class="dsp-card-head">执行记录</div>
			<div class="dsp-muted">共 ${S.runs.length} 条 · 结果 revision ${S.runsRevision} · 单独落在 <span class="dsp-code">runs.json</span>，与用例数据分开保存，清空不会动用例。</div>
			<div class="dsp-inline" style="margin-top:8px">
				<button class="dsp-btn danger" data-act="clear-runs"${S.runs.length ? "" : " disabled"}>清空执行记录</button>
				${S.runs.length ? "" : '<button class="dsp-btn" data-act="load-demo-runs">载入示例记录</button>'}
				<span class="dsp-muted">「恢复示例数据」也会一并清空执行记录。</span>
			</div>
		</section>
		<section class="dsp-card">
			<div class="dsp-card-head">当前状态</div>
			<div class="dsp-muted">revision ${S.revision} · 上次保存 ${fmtTime(S.updatedAt)} · 项目 ${S.systems.length} · 模块 ${S.modules.length} · 功能 ${S.features.length} · 用例覆盖率 ${covered}/${S.features.length}</div>
		</section>
		<section class="dsp-card">
			<div class="dsp-card-head">建议的维护方式</div>
			<ul class="dsp-tips">
				<li>项目用产品 / 业务线名（项目管理系统），模块用业务域（合同管理），功能用一个可操作的入口（经营合同、合同变更）。</li>
				<li>用例挂在功能下，标题写「场景-要点」，编号按项目 code 自动生成（PMS-004）；复制用例后编号会重新分配。</li>
				<li>账号、参数、边界值放在数据集里，用例勾选引用，一份数据可被多条用例共用。</li>
				<li>「概览」里的覆盖缺口就是还没有用例的功能，点一下直接跳过去补。</li>
			</ul>
		</section>
	</div>`;
}
