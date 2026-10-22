/**
 * 数据空间客户端视图 —— 纯 DOM，无框架；读写只走 /plugins-api/data-space。
 *
 * 结构：顶部一条一级导航（概览 / 数据集 / 分组 / 设置），下面是内容区；
 * 样式见 ./style.mjs（自包含，只吃宿主主题变量，深浅主题自动跟随）。
 */
import { CSS } from "./style.mjs";

function appRoot() {
	try {
		const u = new URL(import.meta.url);
		const i = u.pathname.indexOf("/plugins/");
		return `${u.origin}${i >= 0 ? u.pathname.slice(0, i) : ""}`;
	} catch {
		return "";
	}
}

const base = () => `${appRoot()}/plugins-api/data-space`;
const ENVS = ["本地", "测试环境", "预发环境", "生产"];
const COLORS = [
	["blue", "蓝"],
	["green", "绿"],
	["amber", "橙"],
	["purple", "紫"],
	["gray", "灰"],
];

const svg = (body) =>
	`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICON = svg(
	`<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c1.7 1.7 13.5 1.7 16 0V5"/><path d="M4 11v6c1.7 1.7 13.5 1.7 16 0v-6"/>`,
);
const ICON_EDIT = svg(`<path d="M12 20h9"/><path d="M16.6 3.4a2.1 2.1 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5z"/>`);
const ICON_COPY = svg(
	`<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>`,
);
const ICON_TRASH = svg(`<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M18.5 6l-1 14h-11l-1-14"/>`);

const S = {
	loaded: false,
	error: "",
	revision: 0,
	updatedAt: "",
	dir: "",
	file: "",
	groups: [],
	datasets: [],
	tab: "overview",
	group: "all",
	q: "",
	editing: null,
	saving: false,
};

let newGroup = { name: "", color: "blue" };
let toastTimer = null;
let nodes = null;

/* ------------------------------------------------------------------ 小工具 */

function esc(v) {
	return String(v ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
}

function newId() {
	try {
		return crypto.randomUUID();
	} catch {
		return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}
}

function fmtTime(iso) {
	if (!iso) return "—";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "—";
	const p = (n) => String(n).padStart(2, "0");
	return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function groupOf(id) {
	return S.groups.find((g) => g.id === id) ?? null;
}

function countIn(groupId) {
	return S.datasets.filter((d) => (groupId === "" ? !d.groupId : d.groupId === groupId)).length;
}

function filteredDatasets() {
	const q = S.q.trim().toLowerCase();
	return S.datasets.filter((d) => {
		const match = S.group === "all" ? true : S.group === "__none" ? !d.groupId : d.groupId === S.group;
		if (!match) return false;
		if (!q) return true;
		const hay = [d.name, d.env, d.note, ...(d.tags || [])].join(" ").toLowerCase();
		return hay.includes(q);
	});
}

function toast(text) {
	if (!nodes) return;
	nodes.toast.textContent = text;
	nodes.toast.classList.add("on");
	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => nodes?.toast.classList.remove("on"), 2200);
}

function applyStore(data) {
	S.loaded = true;
	S.error = "";
	S.revision = Number(data.revision) || 0;
	S.updatedAt = data.updatedAt || "";
	S.dir = data.dir || "";
	S.file = data.file || "";
	S.groups = Array.isArray(data.groups) ? data.groups : [];
	S.datasets = Array.isArray(data.datasets) ? data.datasets : [];
}

async function load() {
	try {
		const r = await fetch(`${base()}/state`, { cache: "no-store" });
		const d = await r.json();
		if (!d?.ok) throw new Error(d?.error || "读取失败");
		applyStore(d);
	} catch {
		S.error = "读取数据失败：确认插件已启用，然后刷新页面重试。";
	}
	render();
}

/** 整份保存：带上本地 revision，服务端不一致回 409 + 最新快照。 */
async function persist() {
	S.saving = true;
	try {
		const r = await fetch(`${base()}/save`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ baseRevision: S.revision, groups: S.groups, datasets: S.datasets }),
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

/* ------------------------------------------------------------------ 骨架 */

function shellHtml() {
	const tabs = [
		["overview", "概览", null],
		["datasets", "数据集", S.datasets.length],
		["groups", "分组", S.groups.length],
		["settings", "设置", null],
	];
	return `
	<header class="dsp-head">
		<div class="dsp-head-row">
			<div class="dsp-brand">
				<span class="dsp-brand-icon">${ICON}</span>
				<div>
					<div class="dsp-brand-name">数据空间</div>
					<div class="dsp-brand-sub" data-el="sub">测试数据集中管理 · 本机全局共享</div>
				</div>
			</div>
			<div class="dsp-tools">
				<input class="dsp-search" data-el="search" placeholder="搜索名称 / 标签 / 环境" />
				<button class="dsp-btn primary" data-act="new-dataset">＋ 新建数据集</button>
			</div>
		</div>
		<nav class="dsp-nav" data-el="nav">
			${tabs
				.map(
					([id, label, n]) =>
						`<button data-act="tab" data-tab="${id}" class="${S.tab === id ? "on" : ""}">${label}${
							typeof n === "number" ? `<span class="dsp-num">${n}</span>` : ""
						}</button>`,
				)
				.join("")}
		</nav>
	</header>
	<main class="dsp-body" data-el="body"></main>
	<div class="dsp-toast" data-el="toast"></div>
	<div data-el="overlay"></div>
	`;
}

/* ------------------------------------------------------------------ 概览 */

function overviewHtml() {
	const total = S.datasets.reduce((n, d) => n + (d.records?.length || 0), 0);
	const envs = [...new Set(S.datasets.map((d) => d.env).filter(Boolean))];
	const maxCount = Math.max(1, ...S.groups.map((g) => countIn(g.id)));
	const bars = S.groups.length
		? S.groups
				.map((g) => {
					const n = countIn(g.id);
					return `<div class="dsp-bar-row"><span class="dsp-bar-name" title="${esc(g.name)}">${esc(g.name)}</span><span class="dsp-bar"><i style="width:${Math.round((n / maxCount) * 100)}%"></i></span><span class="dsp-bar-num">${n}</span></div>`;
				})
				.join("")
		: `<div class="dsp-muted">还没有分组，去「分组」页新建。</div>`;
	const recent = [...S.datasets]
		.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
		.slice(0, 6);
	return `
	<div class="dsp-stats">
		<div class="dsp-stat"><div class="dsp-stat-label">数据集</div><div class="dsp-stat-value">${S.datasets.length}</div><div class="dsp-stat-hint">按分组区分业务模块</div></div>
		<div class="dsp-stat"><div class="dsp-stat-label">分组</div><div class="dsp-stat-value">${S.groups.length}</div><div class="dsp-stat-hint">可改名 / 换色 / 删除</div></div>
		<div class="dsp-stat"><div class="dsp-stat-label">数据记录</div><div class="dsp-stat-value">${total}</div><div class="dsp-stat-hint">键值行合计</div></div>
		<div class="dsp-stat"><div class="dsp-stat-label">环境</div><div class="dsp-stat-value">${envs.length}</div><div class="dsp-stat-hint">${esc(envs.slice(0, 3).join(" · ") || "未标注")}</div></div>
	</div>
	<div class="dsp-cols">
		<section class="dsp-card"><div class="dsp-card-head">按分组分布</div>${bars}</section>
		<section class="dsp-card"><div class="dsp-card-head">最近更新</div>${
			recent.length
				? `<div class="dsp-recent">${recent
						.map(
							(d) =>
								`<div class="dsp-recent-row" data-act="edit-dataset" data-id="${esc(d.id)}"><span class="dsp-dot ${esc(groupOf(d.groupId)?.color || "gray")}"></span><span class="dsp-recent-name">${esc(d.name)}</span><span class="dsp-recent-time">${fmtTime(d.updatedAt)}</span></div>`,
						)
						.join("")}</div>`
				: `<div class="dsp-empty-inline">还没有数据集</div>`
		}</section>
	</div>
	${footHtml()}`;
}

function footHtml() {
	return `<div class="dsp-foot">共 ${S.datasets.length} 个数据集 · 上次保存 ${fmtTime(S.updatedAt)} · 数据文件 ${esc(S.file || "—")}</div>`;
}

/* ------------------------------------------------------------------ 数据集 */

function chip(id, label, n) {
	const on = S.group === id;
	return `<button class="dsp-chip ${on ? "on" : ""}" data-act="gfilter" data-gid="${esc(id)}">${esc(label)}<span class="dsp-num">${n}</span></button>`;
}

function datasetRow(d) {
	const g = groupOf(d.groupId);
	const tags = (d.tags || [])
		.slice(0, 3)
		.map((t) => `<span class="dsp-tag">${esc(t)}</span>`)
		.join("");
	return `<tr>
		<td><div class="dsp-name-cell" data-act="edit-dataset" data-id="${esc(d.id)}"><span class="dsp-dot ${esc(g?.color || "gray")}"></span><b title="${esc(d.name)}">${esc(d.name)}</b></div></td>
		<td>${esc(g?.name || "未分组")}</td>
		<td>${esc(d.env || "—")}</td>
		<td>${d.records?.length || 0}</td>
		<td><div class="dsp-tags">${tags || `<span class="dsp-muted">—</span>`}</div></td>
		<td>${fmtTime(d.updatedAt)}</td>
		<td><div class="dsp-row-actions">
			<button class="dsp-btn icon" data-act="edit-dataset" data-id="${esc(d.id)}" title="编辑">${ICON_EDIT}</button>
			<button class="dsp-btn icon" data-act="duplicate-dataset" data-id="${esc(d.id)}" title="复制">${ICON_COPY}</button>
			<button class="dsp-btn icon danger" data-act="delete-dataset" data-id="${esc(d.id)}" title="删除">${ICON_TRASH}</button>
		</div></td>
	</tr>`;
}

function datasetsHtml() {
	const chips = [chip("all", "全部", S.datasets.length)]
		.concat(S.groups.map((g) => chip(g.id, g.name, countIn(g.id))))
		.concat(countIn("") ? [chip("__none", "未分组", countIn(""))] : [])
		.join("");
	const list = filteredDatasets();
	const empty = S.datasets.length
		? `<div class="dsp-empty"><b>没有匹配的数据集</b>换个分组或清空搜索词试试。</div>`
		: `<div class="dsp-empty"><b>还没有数据集</b>把一份测试数据建成数据集，按分组区分，后面直接在这里查。<button class="dsp-btn primary" data-act="new-dataset">＋ 新建数据集</button></div>`;
	return `
	<div class="dsp-chips">${chips}</div>
	${
		list.length
			? `<div class="dsp-table-wrap"><table class="dsp-table">
		<colgroup><col style="width:26%"/><col style="width:13%"/><col style="width:11%"/><col style="width:8%"/><col style="width:17%"/><col style="width:13%"/><col style="width:12%"/></colgroup>
		<thead><tr><th>名称</th><th>分组</th><th>环境</th><th>记录</th><th>标签</th><th>更新时间</th><th></th></tr></thead>
		<tbody>${list.map(datasetRow).join("")}</tbody></table></div>`
			: empty
	}
	${footHtml()}`;
}

/* ------------------------------------------------------------------ 分组 */

function groupsHtml() {
	const rows = S.groups
		.map(
			(g) => `<div class="dsp-group-row">
			<span class="dsp-dot ${esc(g.color)}"></span>
			<input data-gid="${esc(g.id)}" data-gf="name" value="${esc(g.name)}" />
			<select data-gid="${esc(g.id)}" data-gf="color">${COLORS.map(
				([v, l]) => `<option value="${v}" ${g.color === v ? "selected" : ""}>${l}</option>`,
			).join("")}</select>
			<input class="dsp-group-note" data-gid="${esc(g.id)}" data-gf="note" value="${esc(g.note || "")}" placeholder="备注（可空）" />
			<span class="dsp-group-count">${countIn(g.id)} 个</span>
			<span class="dsp-group-actions">
				<button class="dsp-btn" data-act="group-save" data-gid="${esc(g.id)}">保存</button>
				<button class="dsp-btn danger" data-act="group-del" data-gid="${esc(g.id)}">删除</button>
			</span>
		</div>`,
		)
		.join("");
	return `
	<div class="dsp-group-new">
		<input data-el="new-group-name" value="${esc(newGroup.name)}" placeholder="新分组名称，例如「设备与监测」" style="width:240px" />
		<select data-el="new-group-color">${COLORS.map(
			([v, l]) => `<option value="${v}" ${newGroup.color === v ? "selected" : ""}>${l}</option>`,
		).join("")}</select>
		<button class="dsp-btn primary" data-act="group-add">＋ 添加分组</button>
		<span class="dsp-muted">删除分组不会删数据，里面的数据集会变成「未分组」。</span>
	</div>
	<div class="dsp-group">
		${rows || `<div class="dsp-empty-inline">还没有分组</div>`}
	</div>
	${footHtml()}`;
}

/* ------------------------------------------------------------------ 设置 */

function settingsHtml() {
	return `
	<div class="dsp-stack">
		<section class="dsp-card">
			<div class="dsp-card-head">数据文件位置</div>
			<div class="dsp-muted">数据存在本机数据目录，全局一份：不按项目、不按会话隔离，换会话 / 换项目读到的是同一批数据；插件升级或卸载都不会删它。</div>
			<div style="margin-top:8px"><span class="dsp-code">${esc(S.file || `${S.dir}/store.json`)}</span></div>
			<div class="dsp-muted" style="margin-top:8px">想用 AI 批量改数据，直接改这个文件即可（JSON：groups / datasets 两个数组），刷新页面就会读到。</div>
		</section>
		<section class="dsp-card">
			<div class="dsp-card-head">导入 / 导出</div>
			<div class="dsp-inline">
				<button class="dsp-btn" data-act="export">导出 JSON</button>
				<button class="dsp-btn" data-act="import">导入 JSON</button>
				<button class="dsp-btn danger" data-act="reset">恢复示例数据</button>
				<span class="dsp-muted">导入会整份替换当前数据（先导出备份更稳）。</span>
			</div>
			<input type="file" accept="application/json,.json" data-el="import-file" style="display:none" />
		</section>
		<section class="dsp-card">
			<div class="dsp-card-head">当前状态</div>
			<div class="dsp-muted">数据版本 revision ${S.revision} · 上次保存 ${fmtTime(S.updatedAt)} · 数据集 ${S.datasets.length} 个 · 分组 ${S.groups.length} 个</div>
		</section>
	</div>`;
}

/* ------------------------------------------------------------------ 弹窗 */

function recordRow(r, i) {
	return `<div class="dsp-kv">
		<input data-ri="${i}" data-rf="key" value="${esc(r.key)}" placeholder="字段名" />
		<textarea data-ri="${i}" data-rf="value" rows="1" placeholder="值">${esc(r.value)}</textarea>
		<input data-ri="${i}" data-rf="remark" value="${esc(r.remark || "")}" placeholder="备注" />
		<button class="dsp-btn icon danger" data-act="del-record" data-ri="${i}" title="删除这一行">✕</button>
	</div>`;
}

function modalHtml() {
	const d = S.editing;
	if (!d) return "";
	const options = [`<option value="">未分组</option>`]
		.concat(
			S.groups.map(
				(g) => `<option value="${esc(g.id)}" ${d.groupId === g.id ? "selected" : ""}>${esc(g.name)}</option>`,
			),
		)
		.join("");
	return `<div class="dsp-overlay" data-act="overlay">
		<div class="dsp-modal" data-stop="1">
			<div class="dsp-modal-head"><span>${d.isNew ? "新建数据集" : "编辑数据集"}</span><button class="dsp-btn icon" data-act="close-modal">✕</button></div>
			<div class="dsp-modal-body">
				<div class="dsp-grid2">
					<label class="dsp-field"><span>名称 *</span><input data-f="name" value="${esc(d.name)}" placeholder="例如「登录成功-普通账号」" /></label>
					<label class="dsp-field"><span>分组</span><select data-f="groupId">${options}</select></label>
					<label class="dsp-field"><span>环境</span><input data-f="env" value="${esc(d.env)}" list="dsp-envs" placeholder="本地 / 测试环境 / 预发环境" /><datalist id="dsp-envs">${ENVS.map((e) => `<option value="${e}"></option>`).join("")}</datalist></label>
					<label class="dsp-field"><span>标签（逗号分隔）</span><input data-f="tagsText" value="${esc(d.tagsText)}" placeholder="冒烟, 登录" /></label>
				</div>
				<label class="dsp-field"><span>说明</span><textarea data-f="note" rows="2" placeholder="这份数据用来测什么、有什么前提">${esc(d.note)}</textarea></label>
				<div class="dsp-section">
					<div class="dsp-section-head"><span>数据记录 · ${d.records.length} 行</span><button class="dsp-btn" data-act="add-record">＋ 添加一行</button></div>
					<div class="dsp-kv dsp-kv-head"><span>字段名</span><span>值</span><span>备注</span><span></span></div>
					${d.records.map(recordRow).join("") || `<div class="dsp-empty-inline">还没有记录，点「添加一行」。</div>`}
				</div>
			</div>
			<div class="dsp-modal-foot">
				<button class="dsp-btn" data-act="close-modal">取消</button>
				<button class="dsp-btn primary" data-act="save-dataset" ${S.saving ? "disabled" : ""}>保存</button>
			</div>
		</div>
	</div>`;
}

/* ------------------------------------------------------------------ 渲染 */

function tabsList() {
	return [
		["overview", "概览", null],
		["datasets", "数据集", S.datasets.length],
		["groups", "分组", S.groups.length],
		["settings", "设置", null],
	];
}

function renderNav() {
	if (!nodes) return;
	nodes.nav.innerHTML = tabsList()
		.map(
			([id, label, n]) =>
				`<button data-act="tab" data-tab="${id}" class="${S.tab === id ? "on" : ""}">${label}${
					typeof n === "number" ? `<span class="dsp-num">${n}</span>` : ""
				}</button>`,
		)
		.join("");
}

function errorHtml() {
	return `<div class="dsp-empty"><b>读取失败</b>${esc(S.error)}<button class="dsp-btn" data-act="reload">重新读取</button></div>`;
}

function bodyHtml() {
	if (S.error) return errorHtml();
	if (S.tab === "datasets") return datasetsHtml();
	if (S.tab === "groups") return groupsHtml();
	if (S.tab === "settings") return settingsHtml();
	return overviewHtml();
}

function renderOverlay() {
	if (!nodes) return;
	nodes.overlay.innerHTML = modalHtml();
}

function renderBody() {
	if (!nodes) return;
	renderNav();
	nodes.body.innerHTML = bodyHtml();
}

function render() {
	if (!nodes) return;
	renderNav();
	nodes.sub.textContent = S.error ? "读取失败" : `revision ${S.revision} · 保存于 ${fmtTime(S.updatedAt)}`;
	nodes.body.innerHTML = bodyHtml();
	renderOverlay();
}

/* ------------------------------------------------------------------ 弹窗 / 增删改 */

function openModal(ds) {
	if (ds) {
		S.editing = {
			id: ds.id,
			isNew: false,
			name: ds.name || "",
			groupId: ds.groupId || "",
			env: ds.env || "",
			tagsText: (ds.tags || []).join(", "),
			note: ds.note || "",
			createdAt: ds.createdAt || new Date().toISOString(),
			records: (ds.records || []).map((r) => ({ ...r })),
		};
	} else {
		S.editing = {
			id: newId(),
			isNew: true,
			name: "",
			groupId: S.groups[0]?.id || "",
			env: "测试环境",
			tagsText: "",
			note: "",
			createdAt: new Date().toISOString(),
			records: [{ id: newId(), key: "", value: "", remark: "" }],
		};
	}
	renderOverlay();
}

function closeModal() {
	S.editing = null;
	renderOverlay();
}

async function saveDataset() {
	const d = S.editing;
	if (!d) return;
	const name = d.name.trim();
	if (!name) {
		toast("请填写数据集名称");
		return;
	}
	const nowIso = new Date().toISOString();
	const tags = [
		...new Set(
			d.tagsText
				.split(/[,，、\s]+/)
				.map((s) => s.trim())
				.filter(Boolean),
		),
	].slice(0, 12);
	const records = d.records
		.filter((r) => r.key.trim() || r.value.trim() || String(r.remark || "").trim())
		.map((r) => ({
			id: r.id || newId(),
			key: r.key.trim(),
			value: r.value,
			remark: String(r.remark || "").trim(),
		}));
	const payload = {
		id: d.id,
		name,
		groupId: d.groupId || "",
		env: d.env.trim(),
		tags,
		note: d.note.trim(),
		records,
		createdAt: d.createdAt || nowIso,
		updatedAt: nowIso,
	};
	const idx = S.datasets.findIndex((x) => x.id === d.id);
	if (idx >= 0) S.datasets[idx] = { ...S.datasets[idx], ...payload };
	else S.datasets.push(payload);
	if (await persist()) {
		S.editing = null;
		render();
	}
}

async function duplicateDataset(id) {
	const src = S.datasets.find((d) => d.id === id);
	if (!src) return;
	const nowIso = new Date().toISOString();
	S.datasets.push({
		...src,
		id: newId(),
		name: `${src.name} 副本`,
		records: (src.records || []).map((r) => ({ ...r, id: newId() })),
		createdAt: nowIso,
		updatedAt: nowIso,
	});
	if (await persist()) render();
	else await load();
}

async function removeDataset(id) {
	const d = S.datasets.find((x) => x.id === id);
	if (!d) return;
	if (!window.confirm(`删除数据集「${d.name}」？`)) return;
	S.datasets = S.datasets.filter((x) => x.id !== id);
	if (await persist()) render();
	else await load();
}

async function addGroup() {
	const name = newGroup.name.trim();
	if (!name) {
		toast("请填写分组名称");
		return;
	}
	S.groups.push({ id: newId(), name, color: newGroup.color, note: "", createdAt: new Date().toISOString() });
	newGroup = { name: "", color: newGroup.color };
	if (await persist()) render();
	else await load();
}

async function saveGroup(gid) {
	if (!groupOf(gid)) return;
	if (await persist()) render();
	else await load();
}

async function delGroup(gid) {
	const g = groupOf(gid);
	if (!g) return;
	if (!window.confirm(`删除分组「${g.name}」？组内数据集会变成「未分组」，数据本身不删。`)) return;
	S.groups = S.groups.filter((x) => x.id !== gid);
	S.datasets = S.datasets.map((d) => (d.groupId === gid ? { ...d, groupId: "" } : d));
	if (S.group === gid) S.group = "all";
	if (await persist()) render();
	else await load();
}

function doExport() {
	const payload = { groups: S.groups, datasets: S.datasets, exportedAt: new Date().toISOString() };
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = `data-space-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 5000);
	toast("已导出 JSON");
}

async function doImport(input) {
	const file = input.files?.[0];
	input.value = "";
	if (!file) return;
	let parsed;
	try {
		parsed = JSON.parse(await file.text());
	} catch {
		toast("导入失败：不是合法的 JSON");
		return;
	}
	const groups = Array.isArray(parsed?.groups) ? parsed.groups : null;
	const datasets = Array.isArray(parsed?.datasets) ? parsed.datasets : null;
	if (!groups || !datasets) {
		toast("文件格式不对：需要 groups / datasets 两个数组");
		return;
	}
	if (!window.confirm(`导入会替换当前 ${S.datasets.length} 个数据集，继续？`)) return;
	const nowIso = new Date().toISOString();
	S.groups = groups.map((g) => ({
		id: g?.id || newId(),
		name: g?.name || "未命名分组",
		color: COLORS.some(([v]) => v === g?.color) ? g.color : "blue",
		note: g?.note || "",
		createdAt: g?.createdAt || nowIso,
	}));
	S.datasets = datasets.map((d) => ({
		id: d?.id || newId(),
		name: d?.name || "未命名数据集",
		groupId: d?.groupId || "",
		env: d?.env || "",
		tags: Array.isArray(d?.tags) ? d.tags : [],
		note: d?.note || "",
		records: (Array.isArray(d?.records) ? d.records : []).map((r) => ({
			id: r?.id || newId(),
			key: r?.key || "",
			value: typeof r?.value === "string" ? r.value : "",
			remark: r?.remark || "",
		})),
		createdAt: d?.createdAt || nowIso,
		updatedAt: d?.updatedAt || nowIso,
	}));
	if (await persist()) {
		S.group = "all";
		render();
	} else await load();
}

async function doReset() {
	if (!window.confirm("恢复示例数据会覆盖当前全部数据集与分组，继续？")) return;
	try {
		const r = await fetch(`${base()}/reset`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirm: true }),
		});
		const d = await r.json();
		if (!d?.ok) {
			toast(d?.error || "重置失败");
			return;
		}
		applyStore(d);
		S.tab = "overview";
		S.group = "all";
		S.q = "";
		if (nodes) nodes.search.value = "";
		render();
		toast("已恢复示例数据");
	} catch {
		toast("重置失败：无法连接插件服务");
	}
}

/* ------------------------------------------------------------------ 事件 */

function onClick(e) {
	const hit = e.target.closest?.("[data-act]");
	if (!hit || !nodes?.root.contains(hit)) return;
	const act = hit.dataset.act;
	if (act === "overlay") {
		if (e.target === hit) closeModal();
		return;
	}
	const id = hit.dataset.id;
	if (act === "tab") {
		S.tab = hit.dataset.tab;
		S.q = "";
		nodes.search.value = "";
		render();
		return;
	}
	if (act === "gfilter") {
		S.group = hit.dataset.gid;
		renderBody();
		return;
	}
	if (act === "reload") {
		void load();
		return;
	}
	if (act === "new-dataset") {
		openModal(null);
		return;
	}
	if (act === "edit-dataset") {
		openModal(S.datasets.find((d) => d.id === id) || null);
		return;
	}
	if (act === "duplicate-dataset") {
		void duplicateDataset(id);
		return;
	}
	if (act === "delete-dataset") {
		void removeDataset(id);
		return;
	}
	if (act === "close-modal") {
		closeModal();
		return;
	}
	if (act === "add-record") {
		S.editing?.records.push({ id: newId(), key: "", value: "", remark: "" });
		renderOverlay();
		return;
	}
	if (act === "del-record") {
		S.editing?.records.splice(Number(hit.dataset.ri), 1);
		renderOverlay();
		return;
	}
	if (act === "save-dataset") {
		void saveDataset();
		return;
	}
	if (act === "group-add") {
		void addGroup();
		return;
	}
	if (act === "group-save") {
		void saveGroup(hit.dataset.gid);
		return;
	}
	if (act === "group-del") {
		void delGroup(hit.dataset.gid);
		return;
	}
	if (act === "export") {
		doExport();
		return;
	}
	if (act === "import") {
		nodes.root.querySelector('[data-el="import-file"]')?.click();
		return;
	}
	if (act === "reset") {
		void doReset();
	}
}

function onInput(e) {
	const el = e.target;
	if (!el || !nodes) return;
	if (el === nodes.search) {
		S.q = el.value;
		renderBody();
		return;
	}
	if (el.dataset.el === "new-group-name") {
		newGroup.name = el.value;
		return;
	}
	if (el.dataset.gid && el.dataset.gf) {
		const g = groupOf(el.dataset.gid);
		if (g) g[el.dataset.gf] = el.value;
		return;
	}
	if (S.editing && el.dataset.f) {
		S.editing[el.dataset.f] = el.value;
		return;
	}
	if (S.editing && el.dataset.ri !== undefined && el.dataset.rf) {
		const r = S.editing.records[Number(el.dataset.ri)];
		if (r) r[el.dataset.rf] = el.value;
	}
}

function onChange(e) {
	const el = e.target;
	if (!el || !nodes) return;
	if (el.dataset.el === "import-file") {
		void doImport(el);
		return;
	}
	if (el.dataset.el === "new-group-color") {
		newGroup.color = el.value;
		return;
	}
	if (el.dataset.gid && el.dataset.gf === "color") {
		const g = groupOf(el.dataset.gid);
		if (g) g.color = el.value;
		return;
	}
	if (S.editing && el.dataset.f) S.editing[el.dataset.f] = el.value;
}

/* ------------------------------------------------------------------ 挂载 */

export default {
	mount(el) {
		el.innerHTML = "";
		const style = document.createElement("style");
		style.textContent = CSS;
		el.appendChild(style);
		const root = document.createElement("div");
		root.className = "dsp";
		root.innerHTML = shellHtml();
		el.appendChild(root);
		nodes = {
			root,
			nav: root.querySelector('[data-el="nav"]'),
			body: root.querySelector('[data-el="body"]'),
			toast: root.querySelector('[data-el="toast"]'),
			overlay: root.querySelector('[data-el="overlay"]'),
			sub: root.querySelector('[data-el="sub"]'),
			search: root.querySelector('[data-el="search"]'),
		};
		root.addEventListener("click", onClick);
		root.addEventListener("input", onInput);
		root.addEventListener("change", onChange);
		render();
		void load();
		return () => {
			root.removeEventListener("click", onClick);
			root.removeEventListener("input", onInput);
			root.removeEventListener("change", onChange);
			if (toastTimer) clearTimeout(toastTimer);
			nodes = null;
			el.innerHTML = "";
		};
	},
};
