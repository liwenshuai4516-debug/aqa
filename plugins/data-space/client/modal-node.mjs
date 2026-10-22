/**
 * 层级节点弹窗：新建 / 编辑 / 删除系统、模块、功能。
 * 删除只删层级本身，用例与数据集退回「未归类」，不会连带删除资产。
 */
import {
	COLORS,
	S,
	casesOfFeature,
	esc,
	featureOf,
	featuresOf,
	hooks,
	moduleOf,
	modulesOf,
	newId,
	pathText,
	persist,
	toast,
} from "./state.mjs";

const KIND_LABEL = { system: "系统", module: "模块", feature: "功能" };
const selOptions = (list, value) =>
	list.map(([v, l]) => `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(l)}</option>`).join("");

export function nodeModalHtml() {
	const m = S.nodeModal;
	if (!m) return "";
	const kind = KIND_LABEL[m.kind];
	const placeholder =
		m.kind === "system" ? "例如「项目管理系统」" : m.kind === "module" ? "例如「合同管理」" : "例如「经营合同」";
	const note =
		m.kind === "system"
			? "删除系统会同时删除其模块与功能；用例与数据集不会删除，会变成「未归类」。"
			: m.kind === "module"
				? "删除模块会同时删除其功能；用例与数据集不会删除，会变成「未归类」。"
				: "删除功能后，其用例与数据集会变成「未归类」，不会被删除。";
	return `<div class="dsp-overlay" data-act="overlay">
		<div class="dsp-modal narrow" data-stop="1">
			<div class="dsp-modal-head"><span>${m.isNew ? `新建${kind}` : `编辑${kind}`}</span><button class="dsp-btn icon" data-act="close-modal">✕</button></div>
			<div class="dsp-modal-body">
				<div class="dsp-muted">${esc(m.pathText || "")}</div>
				<label class="dsp-field"><span>名称 *</span><input data-f="name" value="${esc(m.name)}" placeholder="${esc(placeholder)}" /></label>
				${
					m.kind === "system"
						? `<div class="dsp-grid2">
					<label class="dsp-field"><span>编号前缀（用于用例编号）</span><input data-f="code" value="${esc(m.code || "")}" placeholder="PMS" maxlength="12" /></label>
					<label class="dsp-field"><span>颜色</span><select data-f="color">${selOptions(COLORS, m.color)}</select></label>
				</div>`
						: ""
				}
				<label class="dsp-field"><span>说明</span><textarea data-f="note" rows="3" placeholder="这个${kind}负责什么、边界在哪">${esc(m.note)}</textarea></label>
				${m.isNew ? "" : `<div class="dsp-muted">${note}</div>`}
			</div>
			<div class="dsp-modal-foot">
				${m.isNew ? "" : `<button class="dsp-btn danger" data-act="del-node">删除</button>`}
				<span style="margin-right:auto"></span>
				<button class="dsp-btn" data-act="close-modal">取消</button>
				<button class="dsp-btn primary" data-act="save-node">保存</button>
			</div>
		</div>
	</div>`;
}

export function openNodeModal(kind, parentId) {
	if (kind === "system") {
		S.nodeModal = {
			isNew: true,
			kind,
			id: newId(),
			parentId: "",
			name: "",
			code: "",
			color: "blue",
			note: "",
			pathText: "顶层：一个系统 / 产品",
		};
	} else if (kind === "module") {
		const s = S.systems.find((x) => x.id === parentId);
		S.nodeModal = {
			isNew: true,
			kind,
			id: newId(),
			parentId,
			name: "",
			note: "",
			pathText: `归属系统：${s?.name || "—"}`,
		};
	} else {
		const f = featureOf(parentId);
		S.nodeModal = {
			isNew: true,
			kind,
			id: newId(),
			parentId,
			name: "",
			note: "",
			pathText: `归属：${f ? pathText(f.id) : "—"}`,
		};
	}
	hooks.renderOverlay();
}

export function openNodeEdit(kind, id) {
	if (kind === "system") {
		const s = S.systems.find((x) => x.id === id);
		if (!s) return;
		S.nodeModal = {
			isNew: false,
			kind,
			id,
			parentId: "",
			name: s.name,
			code: s.code || "",
			color: s.color || "blue",
			note: s.note || "",
			pathText: `系统 · ${s.name}`,
		};
	} else if (kind === "module") {
		const m = moduleOf(id);
		if (!m) return;
		const s = S.systems.find((x) => x.id === m.systemId);
		S.nodeModal = {
			isNew: false,
			kind,
			id,
			parentId: m.systemId,
			name: m.name,
			note: m.note || "",
			pathText: `${s?.name || "—"} / ${m.name}`,
		};
	} else {
		const f = featureOf(id);
		if (!f) return;
		S.nodeModal = {
			isNew: false,
			kind,
			id,
			parentId: f.moduleId,
			name: f.name,
			note: f.note || "",
			pathText: pathText(f.id),
		};
	}
	hooks.renderOverlay();
}

export async function saveNode() {
	const m = S.nodeModal;
	if (!m) return;
	const name = m.name.trim();
	if (!name) {
		toast("请填写名称");
		return;
	}
	const nowIso = new Date().toISOString();
	if (m.kind === "system") {
		const item = {
			id: m.id,
			name,
			code: (m.code || "").trim().toUpperCase().slice(0, 12),
			color: COLORS.some(([v]) => v === m.color) ? m.color : "blue",
			note: m.note.trim(),
			createdAt: S.systems.find((x) => x.id === m.id)?.createdAt || nowIso,
		};
		const idx = S.systems.findIndex((x) => x.id === m.id);
		if (idx >= 0) S.systems[idx] = item;
		else S.systems.push(item);
	} else if (m.kind === "module") {
		const item = {
			id: m.id,
			systemId: m.parentId,
			name,
			note: m.note.trim(),
			createdAt: S.modules.find((x) => x.id === m.id)?.createdAt || nowIso,
		};
		const idx = S.modules.findIndex((x) => x.id === m.id);
		if (idx >= 0) S.modules[idx] = item;
		else S.modules.push(item);
	} else {
		const item = {
			id: m.id,
			moduleId: m.parentId,
			name,
			note: m.note.trim(),
			createdAt: S.features.find((x) => x.id === m.id)?.createdAt || nowIso,
		};
		const idx = S.features.findIndex((x) => x.id === m.id);
		if (idx >= 0) S.features[idx] = item;
		else S.features.push(item);
	}
	if (await persist()) {
		// 新建后直接选中该节点，省一次点击。
		if (m.isNew) {
			if (m.kind === "system") S.sel = { systemId: m.id, moduleId: "", featureId: "" };
			else if (m.kind === "module") {
				const s = S.modules.find((x) => x.id === m.id)?.systemId || "";
				S.sel = { systemId: s, moduleId: m.id, featureId: "" };
			} else {
				const mod = moduleOf(m.parentId);
				S.sel = { systemId: mod?.systemId || "", moduleId: m.parentId, featureId: m.id };
				S.collapsed.delete(`s:${mod?.systemId}`);
				S.collapsed.delete(`m:${m.parentId}`);
			}
		}
		S.nodeModal = null;
	}
	hooks.render();
}

export async function deleteNode() {
	const m = S.nodeModal;
	if (!m) return;
	if (m.kind === "system") {
		const s = S.systems.find((x) => x.id === m.id);
		if (!s) return;
		if (!window.confirm(`删除系统「${s.name}」？其模块与功能会一并删除；用例与数据集不会被删除，会变成「未归类」。`))
			return;
		const mids = new Set(modulesOf(m.id).map((x) => x.id));
		const fids = new Set(S.features.filter((f) => mids.has(f.moduleId)).map((f) => f.id));
		S.systems = S.systems.filter((x) => x.id !== m.id);
		S.modules = S.modules.filter((x) => x.systemId !== m.id);
		S.features = S.features.filter((f) => !fids.has(f.id));
		S.cases = S.cases.map((c) => (fids.has(c.featureId) ? { ...c, featureId: "" } : c));
		S.datasets = S.datasets.map((d) => (fids.has(d.featureId) ? { ...d, featureId: "" } : d));
	} else if (m.kind === "module") {
		const mod = moduleOf(m.id);
		if (!mod) return;
		if (!window.confirm(`删除模块「${mod.name}」？其功能会一并删除；用例与数据集不会被删除，会变成「未归类」。`))
			return;
		const fids = new Set(featuresOf(m.id).map((f) => f.id));
		S.modules = S.modules.filter((x) => x.id !== m.id);
		S.features = S.features.filter((f) => !fids.has(f.id));
		S.cases = S.cases.map((c) => (fids.has(c.featureId) ? { ...c, featureId: "" } : c));
		S.datasets = S.datasets.map((d) => (fids.has(d.featureId) ? { ...d, featureId: "" } : d));
	} else {
		const f = featureOf(m.id);
		if (!f) return;
		const n = casesOfFeature(f.id).length;
		if (!window.confirm(`删除功能「${f.name}」？其 ${n} 条用例与数据集不会删除，会变成「未归类」。`)) return;
		S.features = S.features.filter((x) => x.id !== m.id);
		S.cases = S.cases.map((c) => (c.featureId === m.id ? { ...c, featureId: "" } : c));
		S.datasets = S.datasets.map((d) => (d.featureId === m.id ? { ...d, featureId: "" } : d));
	}
	S.sel = { systemId: "", moduleId: "", featureId: "" };
	S.nodeModal = null;
	await persist();
	hooks.render();
}
