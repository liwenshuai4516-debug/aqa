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
	fmtTime,
	moduleOf,
	modulesOf,
	pathOfFeature,
	pathText,
} from "./state.mjs";

export const ICON = {
	db: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c1.7 1.7 13.5 1.7 16 0V5"/><path d="M4 11v6c1.7 1.7 13.5 1.7 16 0v-6"/></svg>`,
	plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
	edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.6 3.4a2.1 2.1 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5z"/></svg>`,
	copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/></svg>`,
	trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M18.5 6l-1 14h-11l-1-14"/></svg>`,
	case: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 10.5l2 2 4.5-4.5"/><path d="M8 17h8"/></svg>`,
	chevron: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>`,
};

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

/* ------------------------------------------------------------------ 左侧树 */

function sysRow(s) {
	const on = S.sel.systemId === s.id && !S.sel.moduleId;
	const open = !S.collapsed.has(`s:${s.id}`);
	const total = casesOfSystem(s.id).length;
	return `<div class="dsp-tree-row lvl-sys ${on ? "on" : ""}" data-act="sel-system" data-id="${esc(s.id)}">
		<button class="dsp-caret ${open ? "open" : ""}" data-act="toggle" data-key="s:${esc(s.id)}" title="${open ? "收起" : "展开"}">${ICON.chevron}</button>
		<span class="dsp-dot ${esc(s.color)}"></span>
		<span class="dsp-tree-name" title="${esc(s.name)}">${esc(s.name)}${s.code ? `<em>${esc(s.code)}</em>` : ""}</span>
		<span class="dsp-cnt">${total}</span>
		<span class="dsp-tree-ops">
			<button class="dsp-btn icon" data-act="new-module" data-id="${esc(s.id)}" title="在此系统下新建模块">${ICON.plus}</button>
			<button class="dsp-btn icon" data-act="edit-node" data-kind="system" data-id="${esc(s.id)}" title="编辑系统">${ICON.edit}</button>
		</span>
	</div>
	${
		open
			? modulesOf(s.id)
					.map((m) => modRow(m, s))
					.join("")
			: ""
	}`;
}

function modRow(m, s) {
	const on = S.sel.moduleId === m.id;
	const open = !S.collapsed.has(`m:${m.id}`);
	const total = casesOfModule(m.id).length;
	return `<div class="dsp-tree-row lvl-mod ${on ? "on" : ""}" data-act="sel-module" data-id="${esc(m.id)}" data-sid="${esc(s.id)}">
		<button class="dsp-caret ${open ? "open" : ""}" data-act="toggle" data-key="m:${esc(m.id)}" title="${open ? "收起" : "展开"}">${ICON.chevron}</button>
		<span class="dsp-tree-name" title="${esc(m.name)}">${esc(m.name)}</span>
		<span class="dsp-cnt">${total}</span>
		<span class="dsp-tree-ops">
			<button class="dsp-btn icon" data-act="new-feature" data-id="${esc(m.id)}" data-sid="${esc(s.id)}" title="在此模块下新建功能">${ICON.plus}</button>
			<button class="dsp-btn icon" data-act="edit-node" data-kind="module" data-id="${esc(m.id)}" title="编辑模块">${ICON.edit}</button>
		</span>
	</div>
	${
		open
			? featuresOf(m.id)
					.map((f) => featRow(f, m, s))
					.join("")
			: ""
	}`;
}

function featRow(f, m, s) {
	const on = S.sel.featureId === f.id;
	const n = casesOfFeature(f.id).length;
	return `<div class="dsp-tree-row lvl-feat ${on ? "on" : ""}" data-act="sel-feature" data-id="${esc(f.id)}" data-mid="${esc(m.id)}" data-sid="${esc(s.id)}">
		<span class="dsp-tree-bullet"></span>
		<span class="dsp-tree-name" title="${esc(f.name)}">${esc(f.name)}</span>
		<span class="dsp-cnt ${n ? "" : "zero"}">${n || "空"}</span>
		<span class="dsp-tree-ops">
			<button class="dsp-btn icon" data-act="new-case" data-id="${esc(f.id)}" title="在此功能下新建用例">${ICON.plus}</button>
			<button class="dsp-btn icon" data-act="edit-node" data-kind="feature" data-id="${esc(f.id)}" title="编辑功能">${ICON.edit}</button>
		</span>
	</div>`;
}

export function treeHtml() {
	const allSel = !S.sel.systemId && !S.sel.moduleId && !S.sel.featureId;
	return `<aside class="dsp-tree">
		<div class="dsp-tree-head">
			<span>系统 / 模块 / 功能</span>
			<button class="dsp-btn icon" data-act="new-system" title="新建系统">${ICON.plus}</button>
		</div>
		<div class="dsp-tree-body">
			<div class="dsp-tree-row lvl-all ${allSel ? "on" : ""}" data-act="sel-all">
				${ICON.case}<span class="dsp-tree-name">全部用例</span><span class="dsp-cnt">${S.cases.length}</span>
			</div>
			${
				S.systems.length
					? S.systems.map(sysRow).join("")
					: `<div class="dsp-tree-empty">还没有系统。<button class="dsp-btn primary" data-act="new-system">＋ 新建系统</button><span class="dsp-muted">先建「项目管理系统」这类系统，再往下加模块与功能。</span></div>`
			}
		</div>
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
	const recent = [...S.cases]
		.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
		.slice(0, 6);
	const orphan = S.cases.filter((c) => !featureOf(c.featureId)).length;

	return `
	${S.migratedFrom ? `<div class="dsp-tip">已从 0.1.0 版数据迁移：原来的「分组」变成了「系统」，数据集归属已清空为「未归类」。原文件已备份，见「设置」。</div>` : ""}
	<div class="dsp-stats">
		${statCard("系统", S.systems.length, "业务系统 / 产品")}
		${statCard("模块", S.modules.length, "按业务模块划分")}
		${statCard("功能", featureTotal, "用例的挂载点")}
		${statCard("用例", S.cases.length, orphan ? `含 ${orphan} 条未归类` : "跨系统统一编号")}
		${statCard("数据集", S.datasets.length, "可被用例引用")}
	</div>
	<div class="dsp-cols">
		<section class="dsp-card">
			<div class="dsp-card-head"><span>用例覆盖</span><span>${covered}/${featureTotal} 个功能</span></div>
			<div class="dsp-progress"><i style="width:${pct(covered, featureTotal)}%"></i></div>
			<div class="dsp-muted" style="margin:6px 0 14px">功能覆盖率 ${pct(covered, featureTotal)}% · 未覆盖 ${gaps.length} 个功能</div>
			<div class="dsp-card-head"><span>按系统分布</span><span>用例数</span></div>
			${
				bySystem.length
					? bySystem
							.map(
								(x) =>
									`<div class="dsp-bar-row"><span class="dsp-bar-name" title="${esc(x.s.name)}">${esc(x.s.name)}</span><span class="dsp-bar"><i style="width:${pct(x.cases, maxCases)}%"></i></span><span class="dsp-bar-num">${x.cases}</span></div>`,
							)
							.join("")
					: `<div class="dsp-muted">还没有系统</div>`
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
	return `<div class="dsp-foot">系统 ${S.systems.length} · 模块 ${S.modules.length} · 功能 ${S.features.length} · 用例 ${S.cases.length} · 数据集 ${S.datasets.length} · 上次保存 ${fmtTime(S.updatedAt)}</div>`;
}

export const tabsList = () => [
	["overview", "概览", null],
	["cases", "用例库", S.cases.length],
	["datasets", "数据集", S.datasets.length],
	["settings", "设置", null],
];

/* ------------------------------------------------------------------ 用例库 */

const prioBadge = (p) => `<span class="dsp-prio ${esc(p)}">${esc(p)}</span>`;
const statusBadge = (s) => `<span class="dsp-status ${esc(s)}">${esc(s)}</span>`;

function crumb(parts) {
	return `<div class="dsp-crumb">${parts
		.map(([label, act, id], i) =>
			label === null
				? `<span class="dsp-crumb-sep">/</span>`
				: `<button data-act="${act}"${id ? ` data-id="${esc(id)}"` : ""}>${esc(label)}</button>${i < parts.length - 1 ? `<span class="dsp-crumb-sep">/</span>` : ""}`,
		)
		.join("")}</div>`;
}

function caseRow(c, showPath) {
	const steps = c.steps?.length ?? 0;
	const linked = datasetNames(c.datasetIds);
	return `<tr>
		<td class="dsp-code-cell">${esc(c.code || "—")}</td>
		<td><div class="dsp-case-title" data-act="edit-case" data-id="${esc(c.id)}"><b title="${esc(c.title)}">${esc(c.title)}</b>${
			(c.tags ?? []).length
				? `<span class="dsp-tags">${c.tags
						.slice(0, 2)
						.map((t) => `<span class="dsp-tag">${esc(t)}</span>`)
						.join("")}</span>`
				: ""
		}</div></td>
		${showPath ? `<td class="dsp-muted" title="${esc(pathText(c.featureId, " / "))}">${esc(pathText(c.featureId, " / "))}</td>` : ""}
		<td>${prioBadge(c.priority)}</td>
		<td>${statusBadge(c.status)}</td>
		<td class="dsp-num-cell">${steps}</td>
		<td class="dsp-num-cell" title="${esc(linked.join("、"))}">${linked.length}</td>
		<td class="dsp-num-cell">${fmtTime(c.updatedAt)}</td>
		<td><div class="dsp-row-actions">
			<button class="dsp-btn icon" data-act="edit-case" data-id="${esc(c.id)}" title="编辑">${ICON.edit}</button>
			<button class="dsp-btn icon" data-act="copy-case" data-id="${esc(c.id)}" title="复制到同功能">${ICON.copy}</button>
			<button class="dsp-btn icon danger" data-act="del-case" data-id="${esc(c.id)}" title="删除">${ICON.trash}</button>
		</div></td>
	</tr>`;
}

function caseTable(list, showPath) {
	return `<div class="dsp-table-wrap"><table class="dsp-table${showPath ? " wide" : ""}">
		<colgroup><col style="width:86px"/><col style="width:auto"/>${showPath ? `<col style="width:200px"/>` : ""}<col style="width:64px"/><col style="width:74px"/><col style="width:52px"/><col style="width:52px"/><col style="width:104px"/><col style="width:112px"/></colgroup>
		<thead><tr><th>编号</th><th>用例标题</th>${showPath ? "<th>所属功能</th>" : ""}<th>优先级</th><th>状态</th><th>步骤</th><th>数据</th><th>更新</th><th></th></tr></thead>
		<tbody>${list.map((c) => caseRow(c, showPath)).join("")}</tbody></table></div>`;
}

function caseToolbar() {
	const chips = ["all", "P0", "P1", "P2", "P3"]
		.map(
			(p) =>
				`<button class="dsp-chip ${S.priority === p ? "on" : ""}" data-act="prio" data-id="${p}">${p === "all" ? "全部优先级" : p}</button>`,
		)
		.join("");
	return `<div class="dsp-toolbar">
		<input class="dsp-search" data-el="case-search" value="${esc(S.caseQ)}" placeholder="搜索编号 / 标题 / 标签 / 负责人" />
		<div class="dsp-chips" style="margin:0">${chips}</div>
		<select data-el="case-status"><option value="all">全部状态</option>${CASE_STATUS.map((s) => `<option value="${esc(s)}" ${S.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
	</div>`;
}

function visibleCases(base) {
	return base.filter(
		(c) =>
			caseMatches(c, S.caseQ) &&
			(S.priority === "all" || c.priority === S.priority) &&
			(S.status === "all" || c.status === S.status),
	);
}

function emptyCases(text, fid) {
	return `<div class="dsp-empty"><b>${esc(text)}</b>把这一步的操作步骤、预期结果和数据都记下来，后面直接复用。<button class="dsp-btn primary" data-act="new-case"${fid ? ` data-id="${esc(fid)}"` : ""}>＋ 新建用例</button></div>`;
}

function featureView(featureId) {
	const { feature, module, system } = pathOfFeature(featureId);
	if (!feature)
		return `<div class="dsp-empty"><b>这个功能已被删除</b><button class="dsp-btn" data-act="sel-all">回到全部用例</button></div>`;
	const all = casesOfFeature(featureId);
	const list = visibleCases(all);
	const p0 = all.filter((c) => c.priority === "P0").length;
	const datasets = S.datasets.filter((d) => d.featureId === featureId);
	return `
	${crumb([
		[system?.name, "sel-system", system?.id],
		[module?.name, "sel-module", module?.id],
		[feature.name, "sel-feature", feature.id],
	])}
	<div class="dsp-page-head">
		<div>
			<h3>${esc(feature.name)}<span class="dsp-num">${all.length} 条用例</span></h3>
			<div class="dsp-muted">${esc(feature.note || "没有填写功能说明")}</div>
			<div class="dsp-meta-line">${p0 ? `P0 ${p0} 条 · ` : ""}数据集 ${datasets.length} 份 · 编号前缀 ${esc((system?.code || "CASE").toUpperCase())}</div>
		</div>
		<div class="dsp-inline">
			<button class="dsp-btn" data-act="edit-node" data-kind="feature" data-id="${esc(feature.id)}">编辑功能</button>
			<button class="dsp-btn primary" data-act="new-case" data-id="${esc(feature.id)}">＋ 新建用例</button>
		</div>
	</div>
	${caseToolbar()}
	${list.length ? caseTable(list, false) : all.length ? `<div class="dsp-empty"><b>没有匹配的用例</b>换个关键词或筛选条件试试。</div>` : emptyCases("这个功能还没有用例", featureId)}
	${footHtml()}`;
}

function moduleView(moduleId) {
	const m = moduleOf(moduleId);
	const s = m ? (S.systems.find((x) => x.id === m.systemId) ?? null) : null;
	if (!m)
		return `<div class="dsp-empty"><b>这个模块已被删除</b><button class="dsp-btn" data-act="sel-all">回到全部用例</button></div>`;
	const feats = featuresOf(m.id);
	const total = casesOfModule(m.id).length;
	return `
	${crumb([
		[s?.name, "sel-system", s?.id],
		[m.name, "sel-module", m.id],
	])}
	<div class="dsp-page-head">
		<div><h3>${esc(m.name)}<span class="dsp-num">${feats.length} 个功能 · ${total} 条用例</span></h3><div class="dsp-muted">${esc(m.note || "没有填写模块说明")}</div></div>
		<div class="dsp-inline">
			<button class="dsp-btn" data-act="edit-node" data-kind="module" data-id="${esc(m.id)}">编辑模块</button>
			<button class="dsp-btn primary" data-act="new-feature" data-id="${esc(m.id)}" data-sid="${esc(s?.id || "")}">＋ 新建功能</button>
		</div>
	</div>
	${
		feats.length
			? `<div class="dsp-cards">${feats
					.map((f) => {
						const list = casesOfFeature(f.id);
						const p0 = list.filter((c) => c.priority === "P0").length;
						return `<button class="dsp-feature-card" data-act="sel-feature" data-id="${esc(f.id)}"><div class="dsp-feature-top"><b>${esc(f.name)}</b><span class="dsp-cnt ${list.length ? "" : "zero"}">${list.length || "空"}</span></div><div class="dsp-muted">${esc(f.note || "点击进入该功能")}</div><div class="dsp-feature-foot">${p0 ? `P0 ${p0} 条 · ` : ""}数据集 ${S.datasets.filter((d) => d.featureId === f.id).length} 份</div></button>`;
					})
					.join("")}</div>`
			: `<div class="dsp-empty"><b>这个模块还没有功能</b>功能是用例的挂载点，例如「合同管理」下的「经营合同」。<button class="dsp-btn primary" data-act="new-feature" data-id="${esc(m.id)}" data-sid="${esc(s?.id || "")}">＋ 新建功能</button></div>`
	}
	${footHtml()}`;
}

function systemView(systemId) {
	const s = S.systems.find((x) => x.id === systemId);
	if (!s)
		return `<div class="dsp-empty"><b>这个系统已被删除</b><button class="dsp-btn" data-act="sel-all">回到全部用例</button></div>`;
	const mods = modulesOf(s.id);
	const total = casesOfSystem(s.id).length;
	return `
	${crumb([[s.name, "sel-system", s.id]])}
	<div class="dsp-page-head">
		<div><h3>${esc(s.name)}${s.code ? `<span class="dsp-code">${esc(s.code)}</span>` : ""}<span class="dsp-num">${mods.length} 个模块 · ${total} 条用例</span></h3><div class="dsp-muted">${esc(s.note || "没有填写系统说明")}</div></div>
		<div class="dsp-inline">
			<button class="dsp-btn" data-act="edit-node" data-kind="system" data-id="${esc(s.id)}">编辑系统</button>
			<button class="dsp-btn primary" data-act="new-module" data-id="${esc(s.id)}">＋ 新建模块</button>
		</div>
	</div>
	${
		mods.length
			? `<div class="dsp-cards">${mods
					.map((m) => {
						const fs_ = featuresOf(m.id);
						const n = casesOfModule(m.id).length;
						return `<button class="dsp-feature-card" data-act="sel-module" data-id="${esc(m.id)}" data-sid="${esc(s.id)}"><div class="dsp-feature-top"><b>${esc(m.name)}</b><span class="dsp-cnt ${n ? "" : "zero"}">${n}</span></div><div class="dsp-muted">${esc(m.note || "点击进入该模块")}</div><div class="dsp-feature-foot">${fs_.length} 个功能：${esc(
							fs_
								.slice(0, 3)
								.map((f) => f.name)
								.join("、") || "—",
						)}${fs_.length > 3 ? "…" : ""}</div></button>`;
					})
					.join("")}</div>`
			: `<div class="dsp-empty"><b>这个系统还没有模块</b>例如「合同管理」「供应商管理」。<button class="dsp-btn primary" data-act="new-module" data-id="${esc(s.id)}">＋ 新建模块</button></div>`
	}
	${footHtml()}`;
}

function allView() {
	const list = visibleCases(S.cases);
	const orphan = S.cases.filter((c) => !featureOf(c.featureId));
	return `
	<div class="dsp-page-head">
		<div><h3>全部用例<span class="dsp-num">${S.cases.length} 条</span></h3><div class="dsp-muted">跨系统查看，标题下方是所属功能路径；点标题可直接编辑。</div></div>
		<div class="dsp-inline">
			<button class="dsp-btn" data-act="new-system">＋ 新建系统</button>
			<button class="dsp-btn primary" data-act="new-case">＋ 新建用例</button>
		</div>
	</div>
	${caseToolbar()}
	${orphan.length ? `<div class="dsp-tip">有 ${orphan.length} 条用例没有归属功能（功能被删或导入时缺失），编辑时选一个功能即可归位。</div>` : ""}
	${list.length ? caseTable(list, true) : S.cases.length ? `<div class="dsp-empty"><b>没有匹配的用例</b>换个关键词或筛选条件试试。</div>` : emptyCases("还没有用例")}
	${footHtml()}`;
}

export function casesHtml() {
	const { systemId, moduleId, featureId } = S.sel;
	if (featureId) return featureView(featureId);
	if (moduleId) return moduleView(moduleId);
	if (systemId) return systemView(systemId);
	return allView();
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
		<div><h3>数据集<span class="dsp-num">${S.datasets.length} 份</span></h3><div class="dsp-muted">键值记录按功能归类；用例编辑时可直接勾选引用，避免同一份账号、参数反复抄写。</div></div>
		<button class="dsp-btn primary" data-act="new-dataset">＋ 新建数据集</button>
	</div>
	<div class="dsp-toolbar">
		<input class="dsp-search" data-el="dataset-search" value="${esc(S.datasetQ)}" placeholder="搜索名称 / 标签 / 备注" />
		${scopeSelect("ds-system", systemId, [["", "全部系统"], ...S.systems.map((s) => [s.id, s.name])])}
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
		${S.migratedFrom ? `<section class="dsp-card"><div class="dsp-card-head">数据已完成升级</div><div class="dsp-muted">检测到 0.1.0 版数据（分组 + 数据集），已自动升级为「系统 / 模块 / 功能 / 用例」结构：原分组变成系统，code 留空（可在系统编辑里补，例如 PMS），数据集归属清空为未归类。升级前的旧文件已备份在同一目录，文件名形如 <span class="dsp-code">store.json.v1-&lt;时间戳&gt;.bak</span>。</div></section>` : ""}
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
			<div class="dsp-card-head">当前状态</div>
			<div class="dsp-muted">revision ${S.revision} · 上次保存 ${fmtTime(S.updatedAt)} · 系统 ${S.systems.length} · 模块 ${S.modules.length} · 功能 ${S.features.length} · 用例覆盖率 ${covered}/${S.features.length}</div>
		</section>
		<section class="dsp-card">
			<div class="dsp-card-head">建议的维护方式</div>
			<ul class="dsp-tips">
				<li>系统用产品 / 项目名（项目管理系统），模块用业务域（合同管理），功能用一个可操作的入口（经营合同、合同变更）。</li>
				<li>用例挂在功能下，标题写「场景-要点」，编号按系统 code 自动生成（PMS-004）；复制用例后编号会重新分配。</li>
				<li>账号、参数、边界值放在数据集里，用例勾选引用，一份数据可被多条用例共用。</li>
				<li>「概览」里的覆盖缺口就是还没有用例的功能，点一下直接跳过去补。</li>
			</ul>
		</section>
	</div>`;
}
