import { automationModalHtml, openAutomation, automationAction } from "./modal-automation.mjs";
/**
 * 数据空间客户端视图入口 —— 纯 DOM，无框架；读写只走 /plugins-api/data-space。
 *
 * 结构：顶部一级导航（概览 / 用例库 / 执行结果 / 环境 / 设置）+ 右侧一行状态信息；
 * 用例库左侧是「项目列表」（可搜索），右侧是项目内的模块 / 功能筛选与用例；
 * 样式见 ./style.mjs（自包含，只吃宿主主题变量，深浅主题自动跟随）。
 */
import { CSS } from "./style.mjs";
import {
	BASE,
	ENV_SCRIPT_MAX,
	S,
	applyRuns,
	applyStore,
	esc,
	filteredRuns,
	hooks,
	load,
	moduleOf,
	newId,
	pathOfFeature,
	persist,
	refreshEnvScript,
	runsCsvText,
	scriptReadyOf,
	toast,
} from "./state.mjs";
import {
	casesHtml,
	currentCaseScope,
	envsHtml,
	overviewHtml,
	projectListHtml,
	runsHtml,
	settingsHtml,
	tabsList,
} from "./views.mjs";
import { briefModalHtml, composeBriefNow, openBrief } from "./modal-brief.mjs";
import { openResultModal, resultModalHtml, saveResultNow } from "./modal-result.mjs";
import { registerCaseMention } from "./mention.mjs";
import { caseModalHtml, copyCase, deleteCase, openCaseModal, saveCase } from "./modal-case.mjs";
import { deleteNode, nodeModalHtml, openNodeEdit, openNodeModal, saveNode } from "./modal-node.mjs";
import {
	copyEnv,
	copyEnvParams,
	deleteEnv,
	editableScript,
	envModalHtml,
	openEnvModal,
	saveEnv,
	scriptTemplate,
} from "./modal-env.mjs";
import { refreshPathSelects } from "./path-select.mjs";

/* ------------------------------------------------------------------ 骨架 */

function shellHtml() {
	return `
	<header class="dsp-head">
		<nav class="dsp-nav" data-el="nav"></nav>
		<div class="dsp-head-hint" data-el="head-hint"></div>
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
		return `<div class="dsp-layout">${projectListHtml()}<section class="dsp-content">${casesHtml()}</section></div>`;
	}
	if (S.tab === "runs") return runsHtml();
	if (S.tab === "envs") return envsHtml();
	if (S.tab === "settings") return settingsHtml();
	return overviewHtml();
}

function renderHead() {
	if (!S.nodes?.headHint) return;
	S.nodes.headHint.textContent = S.error
		? "读取失败"
		: `${S.systems.length} 个项目 · ${S.features.length} 个功能 · ${S.cases.length} 条用例 · revision ${S.revision}`;
}

function renderBody() {
	if (!S.nodes) return;
	renderNav();
	S.nodes.body.innerHTML = bodyHtml();
}

function renderOverlay() {
	if (!S.nodes) return;
	S.nodes.overlay.innerHTML =
		caseModalHtml() + nodeModalHtml() + envModalHtml() + briefModalHtml() + resultModalHtml() + automationModalHtml();
}

function render() {
	if (!S.nodes) return;
	renderHead();
	if (S.automationSync?.error) toast(`自动化同步待处理：${S.automationSync.error}`);
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
	S.envModal = null;
	S.brief = null;
	S.resultModal = null;
	S.automationModal = null;
	renderOverlay();
}

/** 当前打开的是哪个弹窗（用来路由 data-f 输入）。 */
function activeModal() {
	return S.caseModal || S.envModal || S.nodeModal || S.resultModal || S.automationModal || null;
}

/* -------------------------------------------------------------- 环境脚本编辑 */

/** 按 data-esi 取当前编辑的步骤（弹窗关掉后返回 null，避免改到已释放的对象）。 */
function envScriptStep(el) {
	const index = Number(el.dataset.esi);
	return S.envModal?.script?.steps?.[index] ?? null;
}

/** 脚本里的文本输入：步骤字段 / 请求头 / 提取项，只改内存不重绘（保住焦点）。 */
function applyEnvScriptInput(el) {
	if (!S.envModal) return false;
	if (el.dataset.esf && el.dataset.esi !== undefined) {
		const step = envScriptStep(el);
		if (!step) return false;
		step[el.dataset.esf] = el.value;
		return true;
	}
	if (el.dataset.ehf && el.dataset.ehi !== undefined) {
		const header = envScriptStep(el)?.headers?.[Number(el.dataset.ehi)];
		if (!header) return false;
		header[el.dataset.ehf] = el.value;
		return true;
	}
	if (el.dataset.exf && el.dataset.exi !== undefined) {
		const item = envScriptStep(el)?.extract?.[Number(el.dataset.exi)];
		if (!item) return false;
		if (el.dataset.exf === "secret") item.secret = el.checked;
		else item[el.dataset.exf] = el.value;
		return true;
	}
	return false;
}

/** 脚本开关 / 有效期：只改标记，不重绘（否则输入到一半的步骤会丢焦点）。 */
function applyEnvScriptToggle(el) {
	const key = el.dataset.script;
	const script = S.envModal?.script;
	if (!script || !key) return false;
	if (key === "ttlMinutes") script.ttlMinutes = Number(el.value) || 60;
	else script[key] = el.checked;
	return true;
}

/** 行内「⚡」：手动跑一次脚本（用户点了才跑，不自动登录）。 */
async function runEnvScriptFor(id) {
	const env = S.envs.find((e) => e.id === id);
	if (!env) return;
	if (!scriptReadyOf(env)) {
		toast("这个环境没有可执行的脚本");
		return;
	}
	toast("正在运行环境脚本…");
	await refreshEnvScript(id);
	if (S.nodes) render();
}

/* ------------------------------------------------------------------ 点击 */

function onClick(e) {
	const hit = e.target.closest?.("[data-act]");
	if (!hit || !S.nodes?.root.contains(hit)) return;
	const act = hit.dataset.act;
	const id = hit.dataset.id;
	if (act === "automation-open") {
		openAutomation(id);
		return;
	}
	if (act.startsWith("automation-")) {
		void automationAction(act.slice(11));
		return;
	}

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
	if (act === "sel-project") {
		S.sel = { systemId: id, moduleId: "", featureId: "" };
		S.tab = "cases";
		render();
		return;
	}
	if (act === "sel-module") {
		const sid = hit.dataset.sid || moduleOf(id)?.systemId || "";
		S.sel = { systemId: sid, moduleId: id, featureId: "" };
		S.tab = "cases";
		render();
		return;
	}
	if (act === "sel-feature" || act === "goto-feature") {
		const { system, module } = pathOfFeature(id);
		S.sel = { systemId: system?.id || "", moduleId: module?.id || "", featureId: id };
		S.tab = "cases";
		render();
		return;
	}
	if (act === "type") {
		S.caseType = id || "all";
		renderBody();
		return;
	}
	if (act === "runs-verdict") {
		S.runsVerdict = id || "all";
		renderBody();
		return;
	}
	if (act === "runs-view") {
		S.runsView = id === "task" ? "task" : "flat";
		S.runsOpen = "";
		renderBody();
		return;
	}
	if (act === "toggle-runs-task") {
		S.runsOpen = S.runsOpen === id ? "" : id;
		renderBody();
		return;
	}
	if (act === "goto-case") {
		const c = S.cases.find((x) => x.id === id);
		if (!c) return;
		const { system, module } = pathOfFeature(c.featureId);
		S.sel = { systemId: system?.id || "", moduleId: module?.id || "", featureId: c.featureId };
		// 直接定位到这条用例：编号搜索在项目内唯一命中
		S.caseQ = c.code || c.title;
		S.tab = "cases";
		render();
		return;
	}
	if (act === "goto-envs") {
		S.envScope = id || "";
		S.tab = "envs";
		render();
		return;
	}
	if (act === "export-runs") {
		doExportRuns();
		return;
	}
	if (act === "prio") {
		S.priority = id;
		renderBody();
		return;
	}
	if (act === "brief-scope") {
		openBrief(currentCaseScope());
		return;
	}
	if (act === "brief-case") {
		const c = S.cases.find((x) => x.id === id);
		if (!c) return;
		openBrief({ label: `${c.code || "未编号"} · ${c.title}`, cases: [c], skip: false });
		return;
	}
	if (act === "brief-format" && S.brief) {
		S.brief.format = id;
		renderOverlay();
		return;
	}
	if (act === "brief-intent" && S.brief) {
		S.brief.intent = id;
		renderOverlay();
		return;
	}
	if (act === "compose-brief") {
		void composeBriefNow();
		return;
	}
	if (act === "record-result") {
		openResultModal(id);
		return;
	}
	if (act === "result-verdict" && S.resultModal) {
		S.resultModal.verdict = id;
		renderOverlay();
		return;
	}
	if (act === "save-result") {
		void saveResultNow();
		return;
	}
	if (act === "reload") {
		void load().then(render);
		return;
	}
	if (act === "load-demo-runs") {
		void loadDemoRuns();
		return;
	}
	if (act === "clear-runs") {
		void clearRuns();
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
	if (act === "new-env") {
		openEnvModal(null);
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
	if (act === "edit-env") {
		openEnvModal(S.envs.find((e) => e.id === id) || null);
		return;
	}
	if (act === "copy-env") {
		void copyEnv(id);
		return;
	}
	if (act === "copy-env-params") {
		void copyEnvParams(id);
		return;
	}
	if (act === "add-env-param") {
		S.envModal?.params.push({ key: "", value: "", secret: false });
		renderOverlay();
		return;
	}
	if (act === "del-env-param") {
		S.envModal?.params.splice(Number(hit.dataset.pi), 1);
		renderOverlay();
		return;
	}
	if (act === "env-script-template") {
		const m = S.envModal;
		if (!m) return;
		if (m.script.steps.length && !window.confirm("用登录模板替换当前脚本步骤？")) return;
		m.script = scriptTemplate();
		renderOverlay();
		return;
	}
	if (act === "add-env-script-step") {
		const script = S.envModal?.script;
		if (!script) return;
		if (script.steps.length >= ENV_SCRIPT_MAX.steps) {
			toast(`一个脚本最多 ${ENV_SCRIPT_MAX.steps} 步`);
			return;
		}
		script.steps.push({ name: "", method: "POST", url: "", headers: [], body: "", extract: [] });
		renderOverlay();
		return;
	}
	if (act === "del-env-script-step") {
		S.envModal?.script.steps.splice(Number(hit.dataset.esi), 1);
		renderOverlay();
		return;
	}
	if (act === "add-env-script-header") {
		const step = S.envModal?.script?.steps?.[Number(hit.dataset.esi)];
		if (!step) return;
		step.headers = Array.isArray(step.headers) ? step.headers : [];
		if (step.headers.length >= ENV_SCRIPT_MAX.headers) {
			toast(`一步最多 ${ENV_SCRIPT_MAX.headers} 个请求头`);
			return;
		}
		step.headers.push({ key: "", value: "" });
		renderOverlay();
		return;
	}
	if (act === "del-env-script-header") {
		S.envModal?.script?.steps?.[Number(hit.dataset.esi)]?.headers?.splice(Number(hit.dataset.ehi), 1);
		renderOverlay();
		return;
	}
	if (act === "add-env-script-extract") {
		const step = S.envModal?.script?.steps?.[Number(hit.dataset.esi)];
		if (!step) return;
		step.extract = Array.isArray(step.extract) ? step.extract : [];
		if (step.extract.length >= ENV_SCRIPT_MAX.extracts) {
			toast(`一步最多 ${ENV_SCRIPT_MAX.extracts} 个提取项`);
			return;
		}
		step.extract.push({ key: "", path: "", secret: true });
		renderOverlay();
		return;
	}
	if (act === "del-env-script-extract") {
		S.envModal?.script?.steps?.[Number(hit.dataset.esi)]?.extract?.splice(Number(hit.dataset.exi), 1);
		renderOverlay();
		return;
	}
	if (act === "run-env-script") {
		void runEnvScriptFor(id);
		return;
	}
	if (act === "del-env") {
		void deleteEnv(id);
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
	if (act === "save-env") {
		void saveEnv();
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
	if (el.dataset.el === "project-search") {
		S.projectQ = el.value;
		renderBodyKeepFocus('[data-el="project-search"]');
		return;
	}
	if (el.dataset.el === "case-search") {
		S.caseQ = el.value;
		renderBodyKeepFocus('[data-el="case-search"]');
		return;
	}
	if (el.dataset.el === "env-search") {
		S.envQ = el.value;
		renderBodyKeepFocus('[data-el="env-search"]');
		return;
	}
	if (el.dataset.el === "runs-search") {
		S.runsQ = el.value;
		renderBodyKeepFocus('[data-el="runs-search"]');
		return;
	}
	if (S.envModal && applyEnvScriptInput(el)) return;
	if (modal && el.dataset.f) {
		modal[el.dataset.f] = el.value;
		return;
	}
	if (S.caseModal && el.dataset.si !== undefined && el.dataset.sf) {
		const step = S.caseModal.steps[Number(el.dataset.si)];
		if (step) step[el.dataset.sf] = el.value;
		return;
	}
	if (S.envModal && el.dataset.pi !== undefined && el.dataset.pf) {
		const param = S.envModal.params[Number(el.dataset.pi)];
		if (param) param[el.dataset.pf] = el.value;
	}
}

function onChange(e) {
	const el = e.target;
	if (!el || !S.nodes) return;

	if (S.automationModal && el.dataset.f) {
		S.automationModal[el.dataset.f] = el.value;
		return;
	}
	if (S.envModal && applyEnvScriptInput(el)) return;
	if (S.envModal && applyEnvScriptToggle(el)) return;
	// 敏感开关只改标记，不重绘：保住用户正在输入的焦点与滚动位置。
	if (S.envModal && el.dataset.pi !== undefined && el.dataset.pf === "secret") {
		const param = S.envModal.params[Number(el.dataset.pi)];
		if (param) param.secret = el.checked;
		return;
	}
	if (el.dataset.el === "import-file") {
		void doImport(el);
		return;
	}
	if (el.dataset.el === "brief-redact" && S.brief) {
		S.brief.redact = el.checked;
		renderOverlay();
		return;
	}
	if (el.dataset.el === "brief-skip" && S.brief) {
		S.brief.skip = el.checked;
		renderOverlay();
		return;
	}
	if (el.dataset.el === "case-status") {
		S.status = el.value;
		renderBody();
		return;
	}
	if (el.dataset.el === "runs-source") {
		S.runsSource = el.value;
		renderBody();
		return;
	}
	if (el.dataset.el === "runs-range") {
		S.runsRange = el.value;
		renderBody();
		return;
	}
	if (el.dataset.el === "runs-env") {
		S.runsEnv = el.value || "all";
		renderBody();
		return;
	}
	if (el.dataset.el === "env-system") {
		S.envScope = el.value;
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
		envs: S.envs,
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

/** 执行记录导出：只导当前筛选结果，带 BOM 方便 Excel 识别中文。 */
function doExportRuns() {
	const rows = filteredRuns();
	if (!rows.length) {
		toast("当前筛选没有可导出的记录");
		return;
	}
	const blob = new Blob([`\uFEFF${runsCsvText(rows)}`], { type: "text/csv;charset=utf-8" });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = `data-space-runs-${new Date().toISOString().slice(0, 10)}.csv`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 5000);
	toast(`已导出 ${rows.length} 条执行记录`);
}

/** 兼容 0.1.0 的「分组 + 数据集」格式：分组 → 系统；旧数据集直接丢弃（不再使用）。 */
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
		type: c?.type || "接口",
		status: c?.status || "草稿",
		owner: c?.owner || "",
		tags: Array.isArray(c?.tags) ? c.tags : [],
		preconditions: c?.preconditions || "",
		steps: asArr(c?.steps).map((s) => ({ id: s?.id || newId(), action: s?.action || "", expect: s?.expect || "" })),
		note: c?.note || "",
		createdAt: c?.createdAt || nowIso,
		updatedAt: c?.updatedAt || nowIso,
	}));
	const envs = asArr(parsed?.envs).map((e) => ({
		id: e?.id || newId(),
		systemId: e?.systemId || "",
		name: e?.name || "未命名环境",
		baseUrl: String(e?.baseUrl || "").replace(/\/+$/, ""),
		params: asArr(e?.params).map((p) => ({
			key: String(p?.key || "").slice(0, 60),
			value: String(p?.value || "").slice(0, 500),
			secret: p?.secret === true || p?.secret === "true",
		})),
		note: e?.note || "",
		isDefault: Boolean(e?.isDefault),
		// 导入带脚本配置（接口地址与取值路径）；动态值是本机运行时缓存，导入不带。
		script: editableScript({ script: e?.script }),
		dynamic: [],
		scriptRun: null,
		createdAt: e?.createdAt || nowIso,
		updatedAt: e?.updatedAt || nowIso,
	}));
	return { systems, modules, features, cases, envs };
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
	if (!Array.isArray(parsed?.systems) && !Array.isArray(parsed?.groups) && !Array.isArray(parsed?.envs)) {
		toast("文件格式不对：需要 systems / modules / features / cases / envs");
		return;
	}
	if (!window.confirm(`导入会替换当前全部数据（${S.systems.length} 个项目 / ${S.cases.length} 条用例），继续？`))
		return;
	const next = normalizeImport(parsed);
	S.systems = next.systems;
	S.modules = next.modules;
	S.features = next.features;
	S.cases = next.cases;
	S.envs = next.envs;
	S.sel = { systemId: "", moduleId: "", featureId: "" };
	S.envScope = "";
	S.envQ = "";
	await persist();
	render();
}

/**
 * 执行记录的两个局部操作（只动 runs，不动用例）：
 *   - 载入示例记录：仅空台账可用，服务端也会拦住（防止假结论混进真实台账）；
 *   - 清空执行记录：演示数据用完、或想重新从零跑一轮时用。
 */
async function loadDemoRuns() {
	if (S.runs.length) {
		toast("已有执行记录：示例记录只用于空台账预览");
		return;
	}
	if (!window.confirm("载入一批示例执行记录（演示用，可随时在设置里清空），继续？")) return;
	try {
		const r = await fetch(`${BASE}/runs/demo`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirm: true }),
		});
		const d = await r.json();
		if (!d?.ok) {
			toast(d?.error || "载入示例记录失败");
			return;
		}
		applyRuns(d);
		render();
		toast(`已载入 ${d.runs?.length ?? 0} 条示例记录`);
	} catch {
		toast("载入失败：无法连接插件服务");
	}
}

async function clearRuns() {
	if (!S.runs.length) return;
	if (!window.confirm(`清空全部 ${S.runs.length} 条执行记录？用例与环境不受影响，此操作不可撤销。`)) return;
	try {
		const r = await fetch(`${BASE}/runs/clear`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ confirm: true }),
		});
		const d = await r.json();
		if (!d?.ok) {
			toast(d?.error || "清空失败");
			return;
		}
		applyRuns(d);
		render();
		toast(`已清空 ${d.removed ?? 0} 条执行记录`);
	} catch {
		toast("清空失败：无法连接插件服务");
	}
}

async function doReset() {
	if (!window.confirm("恢复示例数据会覆盖当前全部项目、功能、用例与环境，继续？")) return;
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
		S.projectQ = "";
		S.priority = "all";
		S.status = "all";
		S.caseType = "all";
		render();
		toast("已恢复示例数据");
	} catch {
		toast("重置失败：无法连接插件服务");
	}
}

/* ------------------------------------------------------------------ 挂载 */

export default {
	mount(el, ctx) {
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
			headHint: root.querySelector('[data-el="head-hint"]'),
		};
		root.addEventListener("click", onClick);
		root.addEventListener("input", onInput);
		root.addEventListener("change", onChange);
		// AI 回写结果 / 其他窗口登记 → 服务端广播，这里刷新一次（不改当前 tab 与筛选）
		const offData = ctx?.onData?.((payload) => {
			if (!payload || typeof payload !== "object") return;
			if (payload.kind === "sync-error") {
				toast(payload.error);
				return;
			}
			if (!["runs", "store"].includes(payload.kind)) return;
			if (payload.kind === "runs" && Number(payload.revision) === S.runsRevision) return;
			void load().then(() => {
				if (S.nodes) render();
			});
		});
		render();
		void load().then(render);
		return () => {
			root.removeEventListener("click", onClick);
			root.removeEventListener("input", onInput);
			root.removeEventListener("change", onChange);
			try {
				offData?.();
			} catch {
				/* 已取消订阅 */
			}
			if (S.toastTimer) clearTimeout(S.toastTimer);
			S.nodes = null;
			el.innerHTML = "";
		};
	},
};

// 模块顶层就注册 `@` 提及提供者：插件 bundle 在进页时已统一加载，不必先打开数据空间页；
// 宿主缺 composerProviders（旧版）时静默跳过，不影响页面本身。
registerCaseMention();
