/**
 * 数据集弹窗：键值记录逐行维护，归属可选挂到某个功能。
 */
import { ENVS, S, esc, hooks, modulesOf, newId, pathOfFeature, persist, toast } from "./state.mjs";
import { pathSelects } from "./path-select.mjs";

function recordRow(r, i) {
	return `<div class="dsp-kv">
		<input data-ri="${i}" data-rf="key" value="${esc(r.key)}" placeholder="字段名" />
		<textarea data-ri="${i}" data-rf="value" rows="1" placeholder="值">${esc(r.value)}</textarea>
		<input data-ri="${i}" data-rf="remark" value="${esc(r.remark || "")}" placeholder="备注" />
		<button class="dsp-btn icon danger" data-act="del-record" data-ri="${i}" title="删除这一行">✕</button>
	</div>`;
}

export function datasetModalHtml() {
	const m = S.datasetModal;
	if (!m) return "";
	return `<div class="dsp-overlay" data-act="overlay">
		<div class="dsp-modal" data-stop="1">
			<div class="dsp-modal-head"><span>${m.isNew ? "新建数据集" : "编辑数据集"}</span><button class="dsp-btn icon" data-act="close-modal">✕</button></div>
			<div class="dsp-modal-body">
				<div class="dsp-grid2">
					<label class="dsp-field"><span>名称 *</span><input data-f="name" value="${esc(m.name)}" placeholder="例如「经营合同-新建参数」" /></label>
					<label class="dsp-field"><span>环境</span><input data-f="env" value="${esc(m.env)}" list="dsp-envs" placeholder="本地 / 测试环境 / 预发环境" /><datalist id="dsp-envs">${ENVS.map((e) => `<option value="${e}"></option>`).join("")}</datalist></label>
				</div>
				<div class="dsp-field"><span>所属功能（可空，空即未归类）</span>${pathSelects("dataset", m)}</div>
				<label class="dsp-field"><span>标签（逗号分隔）</span><input data-f="tagsText" value="${esc(m.tagsText)}" placeholder="冒烟, 合同" /></label>
				<label class="dsp-field"><span>说明</span><textarea data-f="note" rows="2" placeholder="这份数据用来测什么、有什么前提">${esc(m.note)}</textarea></label>
				<div class="dsp-section">
					<div class="dsp-section-head"><span>数据记录 · ${m.records.length} 行</span><button class="dsp-btn" data-act="add-record">＋ 添加一行</button></div>
					<div class="dsp-kv dsp-kv-head"><span>字段名</span><span>值</span><span>备注</span><span></span></div>
					${m.records.map(recordRow).join("") || `<div class="dsp-empty-inline">还没有记录，点「添加一行」。</div>`}
				</div>
			</div>
			<div class="dsp-modal-foot">
				${m.isNew ? "" : `<button class="dsp-btn danger" data-act="del-dataset" data-id="${esc(m.id)}">删除</button>`}
				<span style="margin-right:auto"></span>
				<button class="dsp-btn" data-act="close-modal">取消</button>
				<button class="dsp-btn primary" data-act="save-dataset" ${S.saving ? "disabled" : ""}>保存</button>
			</div>
		</div>
	</div>`;
}

export function openDatasetModal(d) {
	if (d) {
		const { system, module } = pathOfFeature(d.featureId);
		S.datasetModal = {
			id: d.id,
			isNew: false,
			name: d.name || "",
			env: d.env || "",
			tagsText: (d.tags ?? []).join(", "),
			note: d.note || "",
			records: (d.records ?? []).map((r) => ({ ...r })),
			systemId: system?.id || "",
			moduleId: module?.id || "",
			featureId: d.featureId || "",
			createdAt: d.createdAt || "",
		};
	} else {
		const { system, module } = pathOfFeature(S.datasetScope.featureId || "");
		const m = {
			id: newId(),
			isNew: true,
			name: "",
			env: "测试环境",
			tagsText: "",
			note: "",
			records: [{ id: newId(), key: "", value: "", remark: "" }],
			systemId: system?.id || S.datasetScope.systemId || S.systems[0]?.id || "",
			moduleId: module?.id || S.datasetScope.moduleId || "",
			featureId: S.datasetScope.featureId || "",
			createdAt: "",
		};
		// 先选到系统 / 模块，功能下拉才有内容；功能本身允许留空（未归类）。
		if (!m.moduleId && m.systemId) m.moduleId = modulesOf(m.systemId)[0]?.id || "";
		S.datasetModal = m;
	}
	hooks.renderOverlay();
}

export async function saveDataset() {
	const m = S.datasetModal;
	if (!m) return;
	const name = m.name.trim();
	if (!name) {
		toast("请填写数据集名称");
		return;
	}
	const nowIso = new Date().toISOString();
	const records = (m.records ?? [])
		.filter((r) => r.key.trim() || String(r.value).trim() || String(r.remark || "").trim())
		.map((r) => ({ id: r.id || newId(), key: r.key.trim(), value: r.value, remark: String(r.remark || "").trim() }));
	const item = {
		id: m.id,
		featureId: m.featureId || "",
		name,
		env: m.env.trim(),
		tags: [
			...new Set(
				m.tagsText
					.split(/[,，、\s]+/)
					.map((s) => s.trim())
					.filter(Boolean),
			),
		].slice(0, 12),
		note: m.note.trim(),
		records,
		createdAt: m.createdAt || nowIso,
		updatedAt: nowIso,
	};
	const idx = S.datasets.findIndex((x) => x.id === m.id);
	if (idx >= 0) S.datasets[idx] = item;
	else S.datasets.push(item);
	await persist();
	S.datasetModal = null;
	hooks.render();
}

export async function deleteDataset(id) {
	const d = S.datasets.find((x) => x.id === id);
	if (!d) return;
	if (!window.confirm(`删除数据集「${d.name}」？引用它的用例会失去这份数据关联。`)) return;
	S.datasets = S.datasets.filter((x) => x.id !== id);
	S.cases = S.cases.map((c) =>
		(c.datasetIds ?? []).includes(id) ? { ...c, datasetIds: c.datasetIds.filter((x) => x !== id) } : c,
	);
	S.datasetModal = null;
	await persist();
	hooks.render();
}

export async function copyDataset(id) {
	const d = S.datasets.find((x) => x.id === id);
	if (!d) return;
	const nowIso = new Date().toISOString();
	S.datasets.push({
		...d,
		id: newId(),
		name: `${d.name} 副本`,
		records: (d.records ?? []).map((r) => ({ ...r, id: newId() })),
		createdAt: nowIso,
		updatedAt: nowIso,
	});
	await persist();
	hooks.render();
}
