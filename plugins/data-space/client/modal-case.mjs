/**
 * 用例弹窗：新建 / 编辑 / 删除 / 复制。
 * 步骤用「操作 → 预期」两列，关联数据集可直接勾选。
 */
import {
	CASE_STATUS,
	CASE_TYPES,
	PRIORITIES,
	S,
	esc,
	fmtTime,
	hooks,
	modulesOf,
	featuresOf,
	newId,
	nextCaseCode,
	pathOfFeature,
	pathText,
	persist,
	toast,
} from "./state.mjs";
import { pathSelects } from "./path-select.mjs";

const selOptions = (list, value) =>
	list.map(([v, l]) => `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(l)}</option>`).join("");

function stepRow(step, i) {
	return `<div class="dsp-step">
		<span class="dsp-step-no">${i + 1}</span>
		<textarea data-si="${i}" data-sf="action" rows="1" placeholder="操作步骤">${esc(step.action)}</textarea>
		<textarea data-si="${i}" data-sf="expect" rows="1" placeholder="预期结果">${esc(step.expect)}</textarea>
		<button class="dsp-btn icon danger" data-act="del-step" data-si="${i}" title="删除这一步">✕</button>
	</div>`;
}

function linkedList(m) {
	if (!S.datasets.length) return `<div class="dsp-empty-inline">还没有数据集，可先去「数据集」页建一份。</div>`;
	const picked = new Set(m.datasetIds ?? []);
	return `<div class="dsp-linked">${S.datasets
		.map(
			(d) =>
				`<label class="dsp-linked-item"><input type="checkbox" data-linked="${esc(d.id)}" ${picked.has(d.id) ? "checked" : ""} /><span class="dsp-linked-name">${esc(d.name)}</span><span class="dsp-muted">${esc(pathText(d.featureId, " / "))}</span></label>`,
		)
		.join("")}</div>`;
}

export function caseModalHtml() {
	const m = S.caseModal;
	if (!m) return "";
	const editing = !m.isNew;
	return `<div class="dsp-overlay" data-act="overlay">
		<div class="dsp-modal" data-stop="1">
			<div class="dsp-modal-head"><span>${editing ? `编辑用例 · ${esc(m.code || "未编号")}` : "新建用例"}</span><button class="dsp-btn icon" data-act="close-modal">✕</button></div>
			<div class="dsp-modal-body">
				<div class="dsp-field">
					<span>所属功能 *（项目 / 模块 / 功能）</span>
					${pathSelects("case", m)}
					${m.featureId ? `<span class="dsp-muted">当前路径：${esc(pathText(m.featureId))}</span>` : `<span class="dsp-muted">没有合适的层级？先回「用例库」左侧建项目、模块与功能。</span>`}
				</div>
				<div class="dsp-grid2">
					<label class="dsp-field"><span>用例标题 *</span><input data-f="title" value="${esc(m.title)}" placeholder="例如「新建经营合同-必填项完整可保存」" /></label>
					<label class="dsp-field"><span>用例编号</span><input data-f="code" value="${esc(m.code)}" placeholder="留空则按项目 code 自动生成" /></label>
					<label class="dsp-field"><span>优先级</span><select data-f="priority">${selOptions(
						PRIORITIES.map((p) => [p, p]),
						m.priority,
					)}</select></label>
					<label class="dsp-field"><span>用例类型</span><select data-f="type">${selOptions(
						[...new Set([...S.caseTypes, String(m.type || "").trim()].filter(Boolean))].map((t) => [t, t]),
						m.type,
					)}</select><span class="dsp-muted">当前支持接口 / UI，其他类型后续追加</span></label>
					<label class="dsp-field"><span>状态</span><select data-f="status">${selOptions(
						CASE_STATUS.map((s) => [s, s]),
						m.status,
					)}</select></label>
					<label class="dsp-field"><span>负责人</span><input data-f="owner" value="${esc(m.owner)}" placeholder="可空" /></label>
				</div>
				<label class="dsp-field"><span>标签（逗号分隔）</span><input data-f="tagsText" value="${esc(m.tagsText)}" placeholder="冒烟, 合同" /></label>
				<label class="dsp-field"><span>前置条件</span><textarea data-f="preconditions" rows="2" placeholder="登录状态、权限、已有数据等">${esc(m.preconditions)}</textarea></label>
				<div class="dsp-section">
					<div class="dsp-section-head"><span>操作步骤 · ${m.steps.length} 步</span><button class="dsp-btn" data-act="add-step">＋ 添加步骤</button></div>
					<div class="dsp-step dsp-step-head"><span></span><span>操作步骤</span><span>预期结果</span><span></span></div>
					${m.steps.map(stepRow).join("") || `<div class="dsp-empty-inline">还没有步骤，点「添加步骤」。</div>`}
				</div>
				<div class="dsp-section">
					<div class="dsp-section-head"><span data-el="linked-count">关联数据集 · ${(m.datasetIds ?? []).length} 份</span><span class="dsp-muted">勾选后可在用例里直接看到所用数据</span></div>
					${linkedList(m)}
				</div>
				<label class="dsp-field"><span>备注</span><textarea data-f="note" rows="2" placeholder="待确认事项、参考资料等">${esc(m.note)}</textarea></label>
			</div>
			<div class="dsp-modal-foot">
				${editing ? `<button class="dsp-btn danger" data-act="del-case" data-id="${esc(m.id)}">删除</button>` : ""}
				<span class="dsp-muted" style="margin-right:auto">${editing ? `上次更新 ${fmtTime(m.updatedAt)}` : ""}</span>
				<button class="dsp-btn" data-act="close-modal">取消</button>
				<button class="dsp-btn primary" data-act="save-case" ${S.saving ? "disabled" : ""}>保存</button>
			</div>
		</div>
	</div>`;
}

export function openCaseModal(c) {
	if (c) {
		const { system, module } = pathOfFeature(c.featureId);
		S.caseModal = {
			id: c.id,
			isNew: false,
			code: c.code || "",
			title: c.title || "",
			priority: c.priority || "P2",
			type: c.type || CASE_TYPES[0],
			status: c.status || "草稿",
			owner: c.owner || "",
			tagsText: (c.tags ?? []).join(", "),
			preconditions: c.preconditions || "",
			steps: (c.steps ?? []).map((s) => ({ ...s })),
			datasetIds: [...(c.datasetIds ?? [])],
			note: c.note || "",
			updatedAt: c.updatedAt || "",
			systemId: system?.id || "",
			moduleId: module?.id || "",
			featureId: c.featureId || "",
		};
	} else {
		const { system, module } = pathOfFeature(S.sel.featureId || "");
		const m = {
			id: newId(),
			isNew: true,
			code: "",
			title: "",
			priority: "P2",
			type: CASE_TYPES[0],
			status: "草稿",
			owner: "",
			tagsText: "",
			preconditions: "",
			steps: [{ id: newId(), action: "", expect: "" }],
			datasetIds: [],
			note: "",
			updatedAt: "",
			systemId: system?.id || S.sel.systemId || S.systems[0]?.id || "",
			moduleId: module?.id || "",
			featureId: S.sel.featureId || "",
		};
		// 只选了系统 / 模块时，尽量把下级也预选好，少点几次。
		if (!m.moduleId && m.systemId) m.moduleId = modulesOf(m.systemId)[0]?.id || "";
		if (!m.featureId && m.moduleId) m.featureId = featuresOf(m.moduleId)[0]?.id || "";
		S.caseModal = m;
	}
	hooks.renderOverlay();
}

export async function saveCase() {
	const m = S.caseModal;
	if (!m) return;
	const title = m.title.trim();
	if (!title) {
		toast("请填写用例标题");
		return;
	}
	if (!m.featureId) {
		toast("请选择所属功能");
		return;
	}
	const nowIso = new Date().toISOString();
	const code = m.code.trim() || nextCaseCode(pathOfFeature(m.featureId).system?.id || "");
	const steps = (m.steps ?? [])
		.filter((s) => s.action.trim() || s.expect.trim())
		.map((s) => ({ id: s.id || newId(), action: s.action.trim(), expect: s.expect.trim() }));
	const item = {
		id: m.id,
		featureId: m.featureId,
		code,
		title,
		priority: m.priority,
		type: m.type,
		status: m.status,
		owner: m.owner.trim(),
		tags: [
			...new Set(
				m.tagsText
					.split(/[,，、\s]+/)
					.map((s) => s.trim())
					.filter(Boolean),
			),
		].slice(0, 12),
		preconditions: m.preconditions.trim(),
		steps,
		datasetIds: [...(m.datasetIds ?? [])],
		note: m.note.trim(),
		createdAt: S.cases.find((x) => x.id === m.id)?.createdAt || nowIso,
		updatedAt: nowIso,
	};
	const idx = S.cases.findIndex((x) => x.id === m.id);
	if (idx >= 0) S.cases[idx] = item;
	else S.cases.push(item);
	await persist();
	S.caseModal = null;
	hooks.render();
}

export async function deleteCase(id) {
	const c = S.cases.find((x) => x.id === id);
	if (!c) return;
	if (!window.confirm(`删除用例「${c.title}」？删除后不可恢复（可先在设置页导出备份）。`)) return;
	S.cases = S.cases.filter((x) => x.id !== id);
	S.caseModal = null;
	await persist();
	hooks.render();
}

export async function copyCase(id) {
	const c = S.cases.find((x) => x.id === id);
	if (!c) return;
	const nowIso = new Date().toISOString();
	const { system } = pathOfFeature(c.featureId);
	S.cases.push({
		...c,
		id: newId(),
		code: nextCaseCode(system?.id || ""),
		title: `${c.title} 副本`,
		steps: (c.steps ?? []).map((s) => ({ ...s, id: newId() })),
		createdAt: nowIso,
		updatedAt: nowIso,
	});
	await persist();
	hooks.render();
}
