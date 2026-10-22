/**
 * 数据空间客户端视图入口 —— 纯 DOM，无框架；读写只走 /plugins-api/data-space。
 *
 * 结构：顶部品牌 + 一级导航（概览 / 用例库 / 数据集 / 设置）；
 * 用例库左侧是「系统 → 模块 → 功能」树，右侧是对应层级的用例；
 * 样式见 ./style.mjs（自包含，只吃宿主主题变量，深浅主题自动跟随）。
 */
import { CSS } from "./style.mjs";
import { BASE, S, applyStore, esc, hooks, load, newId, pathOfFeature, persist, toast } from "./state.mjs";
import { ICON, casesHtml, datasetsHtml, overviewHtml, settingsHtml, tabsList, treeHtml } from "./views.mjs";
import { caseModalHtml, copyCase, deleteCase, openCaseModal, saveCase } from "./modal-case.mjs";
import { deleteNode, nodeModalHtml, openNodeEdit, openNodeModal, saveNode } from "./modal-node.mjs";
import { copyDataset, datasetModalHtml, deleteDataset, openDatasetModal, saveDataset } from "./modal-dataset.mjs";
import { refreshPathSelects } from "./path-select.mjs";

/* ------------------------------------------------------------------ 骨架 */

function shellHtml() {
	return `
	<header class="dsp-head">
		<div class="dsp-head-row">
			<div class="dsp-brand">
				<span class="dsp-brand-icon">${ICON.db}</span>
				<div>
					<div class="dsp-brand-name">数据空间</div>
					<div class="dsp-brand-sub" data-el="sub">系统 / 模块 / 功能 / 用例 · 本机全局共享</div>
				</div>
			</div>
			<div class="dsp-head-right" data-el="head-right"></div>
		</div>
		<nav class="dsp-nav" data-el="nav"></nav>
	</header>
	<main class="dsp-body" data-el="body"></main>
	<div class="dsp-toast" data-el="toast"></div>
	<div data-el="overlay"></div>`;
}

function renderNav() {
	if (!S.nodes) return;
	const nav = S.nodes.nav;
	nav.innerHTML = tabsList()
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
	if (S.tab === "cases") {
		return `<div class="dsp-layout">${treeHtml()}<section class="dsp-content">${casesHtml()}</section></div>`;
	}
	if (S.tab === "datasets") return datasetsHtml();
	if (S.tab === "settings") return settingsHtml();
	return overviewHtml();
}

function renderHead() {
	if (!S.nodes) return;
	S.nodes.sub.textContent = S.error
		? "读取失败"
		: `revision ${S.revision} · 保存于 ${new Date(S.updatedAt || 0).toLocaleString("zh-CN", { hour12: false }) || "—"}`;
	S.nodes.headRight.innerHTML = `<div class="dsp-head-hint">${S.systems.length} 个系统 · ${S.features.length} 个功能 · ${S.cases.length} 条用例</div>`;
}

function renderBody() {
	if (!S.nodes) return;
	renderNav();
	S.nodes.body.innerHTML = bodyHtml();
}

function renderOverlay() {
	if (!S.nodes) return;
	S.nodes.overlay.innerHTML = caseModalHtml() + nodeModalHtml() + datasetModalHtml();
}

function render() {
	if (!S.nodes) return;
	renderHead();
	renderNav();
	S.nodes.body.innerHTML = bodyHtml();
	renderOverlay();
}

/** 搜索框在 body 内，重绘后把焦点与光标放回去。 */
function renderBodyKeepFocus(selector) {
	if (!S.nodes) return;
	const active = document.activeElement;
	const keep = Boolean(active && active.matches?.(selector));
	const pos = keep && typeof active.selectionStart === "number" ? active.selectionStart : null;
	renderBody();
	if (!keep) return;
	const next = S.nodes.body.querySelector(selector);
	if (!next) return;
	next.focus();
	if (pos !== null) {
		try {
			next.setSelectionRange(pos, pos);
		} catch {
			/* 某些 input 类型不支持 */
		}
	}
}

hooks.render = render;
hooks.renderOverlay = renderOverlay;

/* ------------------------------------------------------------------ 弹窗收尾 */

function closeModals() {
	S.caseModal = null;
	S.nodeModal = null;
	S.datasetModal = null;
	renderOverlay();
}

/** 当前打开的是哪个弹窗（用来路由 data-f 输入）。 */
function activeModal() {
	return S.caseModal || S.datasetModal || S.nodeModal || null;
}

/* ------------------------------------------------------------------ 点击 */

function onClick(e) {
	const hit = e.target.closest?.("[data-act]");
	if (!hit || !S.nodes?.root.contains(hit)) return;
	const act = hit.dataset.act;
	const id = hit.dataset.id;

	if (act === "overlay") {
		if (e.target === hit) closeModals();
		return;
	}
	if (act === "tab") {
		S.tab = hit.dataset.tab;
		render();
		return;
	}
	if (act === "sel-all") {
		S.sel = { systemId: "", moduleId: "", featureId: "" };
		render();
		return;
	}
	if (act === "sel-system") {
		S.sel = { systemId: id, moduleId: "", featureId: "" };
		S.tab = "cases";
		render();
		return;
	}
	if (act === "sel-module") {
		S.sel = { systemId: hit.dataset.sid || "", moduleId: id, featureId: "" };
		S.tab = "cases";
		render();
		return;
	}
	if (act === "sel-feature" || act === "goto-feature") {
		const { system, module } = pathOfFeature(id);
		S.sel = { systemId: system?.id || "", moduleId: module?.id || "", featureId: id };
		S.collapsed.delete(`s:${system?.id}`);
		S.collapsed.delete(`m:${module?.id}`);
		S.tab = "cases";
		render();
		return;
	}
	if (act === "toggle") {
		const key = hit.dataset.key;
		if (S.collapsed.has(key)) S.collapsed.delete(key);
		else S.collapsed.add(key);
		renderBody();
		return;
	}
	if (act === "prio") {
		S.priority = id;
		renderBody();
		return;
	}
	if (act === "reload") {
		void load().then(render);
		return;
	}
	if (act === "new-system") {
		openNodeModal("system");
		return;
	}
	if (act === "new-module") {
		openNodeModal("module", id);
		return;
	}
	if (act === "new-feature") {
		openNodeModal("feature", id);
		return;
	}
	if (act === "new-case") {
		openCaseModal(null);
		return;
	}
	if (act === "new-dataset") {
		openDatasetModal(null);
		return;
	}
	if (act === "edit-node") {
		openNodeEdit(hit.dataset.kind, id);
		return;
	}
	if (act === "edit-case") {
		openCaseModal(S.cases.find((c) => c.id === id) || null);
		return;
	}
	if (act === "copy-case") {
		void copyCase(id);
		return;
	}
	if (act === "del-case") {
		void deleteCase(id);
		return;
	}
	if (act === "edit-dataset") {
		openDatasetModal(S.datasets.find((d) => d.id === id) || null);
		return;
	}
	if (act === "copy-dataset") {
		void copyDataset(id);
		return;
	}
	if (act === "del-dataset") {
		void deleteDataset(id);
		return;
	}
	if (act === "add-step") {
		S.caseModal?.steps.push({ id: newId(), action: "", expect: "" });
		renderOverlay();
		return;
	}
	if (act === "del-step") {
		S.caseModal?.steps.splice(Number(hit.dataset.si), 1);
		renderOverlay();
		return;
	}
	if (act === "save-case") {
		void saveCase();
		return;
	}
	if (act === "add-record") {
		S.datasetModal?.records.push({ id: newId(), key: "", value: "", remark: "" });
		renderOverlay();
		return;
	}
	if (act === "del-record") {
		S.datasetModal?.records.splice(Number(hit.dataset.ri), 1);
		renderOverlay();
		return;
	}
	if (act === "save-dataset") {
		void saveDataset();
		return;
	}
	if (act === "save-node") {
		void saveNode();
		return;
	}
	if (act === "del-node") {
		void deleteNode();
		return;
	}
	if (act === "close-modal") {
		closeModals();
		return;
	}
	if (act === "export") {
		doExport();
		return;
	}
	if (act === "import") {
		S.nodes.root.querySelector('[data-el="import-file"]')?.click();
		return;
	}
	if (act === "reset") {
		void doReset();
	}
}

/* ------------------------------------------------------------------ 输入 */

function onInput(e) {
	const el = e.target;
	if (!el || !S.nodes) return;
	const modal = activeModal();
	if (el.dataset.el === "case-search") {
		S.caseQ = el.value;
		renderBodyKeepFocus('[data-el="case-search"]');
		return;
	}
	if (el.dataset.el === "dataset-search") {
		S.datasetQ = el.value;
		renderBodyKeepFocus('[data-el="dataset-search"]');
		return;
	}
	if (modal && el.dataset.f) {
		modal[el.dataset.f] = el.value;
		return;
	}
	if (S.caseModal && el.dataset.si !== undefined && el.dataset.sf) {
		const step = S.caseModal.steps[Number(el.dataset.si)];
		if (step) step[el.dataset.sf] = el.value;
		return;
	}
	if (S.datasetModal && el.dataset.ri !== undefined && el.dataset.rf) {
		const row = S.datasetModal.records[Number(el.dataset.ri)];
		if (row) row[el.dataset.rf] = el.value;
	}
}

function onChange(e) {
	const el = e.target;
	if (!el || !S.nodes) return;

	if (el.dataset.el === "import-file") {
		void doImport(el);
		return;
	}
	if (el.dataset.el === "case-status") {
		S.status = el.value;
		renderBody();
		return;
	}
	if (el.dataset.el === "ds-system") {
		S.datasetScope = { systemId: el.value, moduleId: "", featureId: "" };
		renderBody();
		return;
	}
	if (el.dataset.el === "ds-module") {
		S.datasetScope = { ...S.datasetScope, moduleId: el.value, featureId: "" };
		renderBody();
		return;
	}
	if (el.dataset.el === "ds-feature") {
		S.datasetScope = { ...S.datasetScope, featureId: el.value };
		renderBody();
		return;
	}
	if (el.dataset.el === "case-system" && S.caseModal) {
		S.caseModal.systemId = el.value;
		S.caseModal.moduleId = "";
		S.caseModal.featureId = "";
		refreshPathSelects("case");
		return;
	}
	if (el.dataset.el === "case-module" && S.caseModal) {
		S.caseModal.moduleId = el.value;
		S.caseModal.featureId = "";
		refreshPathSelects("case");
		return;
	}
	if (el.dataset.el === "case-feature" && S.caseModal) {
		S.caseModal.featureId = el.value;
		return;
	}
	if (el.dataset.el === "dataset-system" && S.datasetModal) {
		S.datasetModal.systemId = el.value;
		S.datasetModal.moduleId = "";
		S.datasetModal.featureId = "";
		refreshPathSelects("dataset");
		return;
	}
	if (el.dataset.el === "dataset-module" && S.datasetModal) {
		S.datasetModal.moduleId = el.value;
		S.datasetModal.featureId = "";
		refreshPathSelects("dataset");
		return;
	}
	if (el.dataset.el === "dataset-feature" && S.datasetModal) {
		S.datasetModal.featureId = el.value;
		return;
	}
	if (el.dataset.linked && S.caseModal) {
		const set = new Set(S.caseModal.datasetIds ?? []);
		if (el.checked) set.add(el.dataset.linked);
		else set.delete(el.dataset.linked);
		S.caseModal.datasetIds = [...set];
		// 只改计数文字，不动 DOM 其余部分（保留滚动位置与勾选焦点）
		const cnt = document.querySelector('[data-el="linked-count"]');
		if (cnt) cnt.textContent = `关联数据集 · ${set.size} 份`;
		return;
	}
	const modal = activeModal();
	if (modal && el.dataset.f) modal[el.dataset.f] = el.value;
}

/* ------------------------------------------------------------------ 导入导出 / 重置 */

function doExport() {
	const payload = {
		systems: S.systems,
		modules: S.modules,
		features: S.features,
		cases: S.cases,
		datasets: S.datasets,
		exportedAt: new Date().toISOString(),
	};
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = `data-space-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 5000);
	toast("已导出 JSON");
}

/** 兼容 0.1.0 的「分组 + 数据集」格式：分组 → 系统，数据集归属清空。 */
function normalizeImport(parsed) {
	const nowIso = new Date().toISOString();
	const asArr = (v) => (Array.isArray(v) ? v : []);
	const systems = asArr(parsed?.systems).map((s) => ({
		id: s?.id || newId(),
		name: s?.name || "未命名系统",
		code: s?.code || "",
		color: s?.color || "blue",
		note: s?.note || "",
		createdAt: s?.createdAt || nowIso,
	}));
	const legacy = !asArr(parsed?.systems).length && Array.isArray(parsed?.groups);
	if (legacy) {
		for (const g of parsed.groups) {
			systems.push({
				id: g?.id || newId(),
				name: g?.name || "未命名系统",
				code: "",
				color: g?.color || "blue",
				note: g?.note || "",
				createdAt: g?.createdAt || nowIso,
			});
		}
	}
	const modules = asArr(parsed?.modules).map((m) => ({
		id: m?.id || newId(),
		systemId: m?.systemId || "",
		name: m?.name || "未命名模块",
		note: m?.note || "",
		createdAt: m?.createdAt || nowIso,
	}));
	const features = asArr(parsed?.features).map((f) => ({
		id: f?.id || newId(),
		moduleId: f?.moduleId || "",
		name: f?.name || "未命名功能",
		note: f?.note || "",
		createdAt: f?.createdAt || nowIso,
	}));
	const cases = asArr(parsed?.cases).map((c) => ({
		id: c?.id || newId(),
		featureId: c?.featureId || "",
		code: c?.code || "",
		title: c?.title || "未命名用例",
		priority: c?.priority || "P2",
		type: c?.type || "功能",
		status: c?.status || "草稿",
		owner: c?.owner || "",
		tags: Array.isArray(c?.tags) ? c.tags : [],
		preconditions: c?.preconditions || "",
		steps: asArr(c?.steps).map((s) => ({ id: s?.id || newId(), action: s?.action || "", expect: s?.expect || "" })),
		datasetIds: asArr(c?.datasetIds),
		note: c?.note || "",
		createdAt: c?.createdAt || nowIso,
		updatedAt: c?.updatedAt || nowIso,
	}));
	const datasets = asArr(parsed?.datasets).map((d) => ({
		id: d?.id || newId(),
		featureId: legacy ? "" : d?.featureId || "",
		name: d?.name || "未命名数据集",
		env: d?.env || "",
		tags: Array.isArray(d?.tags) ? d.tags : [],
		note: d?.note || "",
		records: asArr(d?.records).map((r) => ({
			id: r?.id || newId(),
			key: r?.key || "",
			value: typeof r?.value === "string" ? r.value : "",
			remark: r?.remark || "",
		})),
		createdAt: d?.createdAt || nowIso,
		updatedAt: d?.updatedAt || nowIso,
	}));
	return { systems, modules, features, cases, datasets };
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
	if (!Array.isArray(parsed?.systems) && !Array.isArray(parsed?.groups) && !Array.isArray(parsed?.datasets)) {
		toast("文件格式不对：需要 systems / modules / features / cases / datasets");
		return;
	}
	if (!window.confirm(`导入会替换当前全部数据（${S.systems.length} 系统 / ${S.cases.length} 用例），继续？`)) return;
	const next = normalizeImport(parsed);
	S.systems = next.systems;
	S.modules = next.modules;
	S.features = next.features;
	S.cases = next.cases;
	S.datasets = next.datasets;
	S.sel = { systemId: "", moduleId: "", featureId: "" };
	S.datasetScope = { systemId: "", moduleId: "", featureId: "" };
	await persist();
	render();
}

async function doReset() {
	if (!window.confirm("恢复示例数据会覆盖当前全部系统、功能、用例与数据集，继续？")) return;
	try {
		const r = await fetch(`${BASE}/reset`, {
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
		S.sel = { systemId: "", moduleId: "", featureId: "" };
		S.caseQ = "";
		S.priority = "all";
		S.status = "all";
		render();
		toast("已恢复示例数据");
	} catch {
		toast("重置失败：无法连接插件服务");
	}
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
		S.nodes = {
			root,
			nav: root.querySelector('[data-el="nav"]'),
			body: root.querySelector('[data-el="body"]'),
			toast: root.querySelector('[data-el="toast"]'),
			overlay: root.querySelector('[data-el="overlay"]'),
			sub: root.querySelector('[data-el="sub"]'),
			headRight: root.querySelector('[data-el="head-right"]'),
		};
		root.addEventListener("click", onClick);
		root.addEventListener("input", onInput);
		root.addEventListener("change", onChange);
		render();
		void load().then(render);
		return () => {
			root.removeEventListener("click", onClick);
			root.removeEventListener("input", onInput);
			root.removeEventListener("change", onChange);
			if (S.toastTimer) clearTimeout(S.toastTimer);
			S.nodes = null;
			el.innerHTML = "";
		};
	},
};
