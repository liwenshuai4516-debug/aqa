/**
 * 环境弹窗：一个环境 = 某项目的一个地址（名称 + baseUrl + 备注），同项目恰好一个默认。
 * 名称用 datalist 给常用写法建议（本地 / 测试环境 / 预发环境 / 生产），但不限制。
 */
import { ENV_PRESETS, S, envsOf, esc, hooks, newId, persist, toast } from "./state.mjs";

const withDefault = (list, id) => list.map((e) => ({ ...e, isDefault: e.id === id }));

export function envModalHtml() {
	const m = S.envModal;
	if (!m) return "";
	const nameOptions = [...new Set([...ENV_PRESETS, ...envsOf(m.systemId).map((e) => e.name)])];
	return `<div class="dsp-overlay" data-act="overlay">
		<div class="dsp-modal narrow" data-stop="1">
			<div class="dsp-modal-head"><span>${m.isNew ? "新建环境" : "编辑环境"}</span><button class="dsp-btn icon" data-act="close-modal">✕</button></div>
			<div class="dsp-modal-body">
				<label class="dsp-field"><span>所属项目 *</span><select data-f="systemId">${S.systems
					.map((s) => `<option value="${esc(s.id)}" ${m.systemId === s.id ? "selected" : ""}>${esc(s.name)}</option>`)
					.join("")}</select></label>
				<div class="dsp-grid2">
					<label class="dsp-field"><span>名称 *</span><input data-f="name" value="${esc(m.name)}" list="dsp-env-names" placeholder="例如「测试环境」" /><datalist id="dsp-env-names">${nameOptions
						.map((n) => `<option value="${esc(n)}"></option>`)
						.join("")}</datalist></label>
					<label class="dsp-field"><span>地址</span><input data-f="baseUrl" value="${esc(m.baseUrl)}" placeholder="https://pms-test.example.com" /></label>
				</div>
				<label class="dsp-field"><span>备注</span><input data-f="note" value="${esc(m.note)}" placeholder="例如「每次发版后重置数据」" /></label>
				<label class="dsp-check"><input type="checkbox" data-f="isDefault" ${m.isDefault ? "checked" : ""} /><span>设为该项目的默认环境（登记结果时默认选中它）</span></label>
				<div class="dsp-muted">只在本地记录地址与说明，不要在这里写账号、口令或密钥。</div>
			</div>
			<div class="dsp-modal-foot">
				${m.isNew ? "" : `<button class="dsp-btn danger" data-act="del-env" data-id="${esc(m.id)}">删除</button>`}
				<span style="margin-right:auto"></span>
				<button class="dsp-btn" data-act="close-modal">取消</button>
				<button class="dsp-btn primary" data-act="save-env" ${S.saving ? "disabled" : ""}>保存</button>
			</div>
		</div>
	</div>`;
}

export function openEnvModal(e) {
	if (e) {
		S.envModal = {
			id: e.id,
			isNew: false,
			systemId: e.systemId || S.systems[0]?.id || "",
			name: e.name || "",
			baseUrl: e.baseUrl || "",
			note: e.note || "",
			isDefault: !!e.isDefault,
			createdAt: e.createdAt || "",
		};
	} else {
		const systemId = S.envScope || S.sel.systemId || S.systems[0]?.id || "";
		const first = !envsOf(systemId).length;
		S.envModal = {
			id: newId(),
			isNew: true,
			systemId,
			name: "",
			baseUrl: "",
			note: "",
			// 项目的第一个环境自动成为默认，省得用户再点一次。
			isDefault: first,
			createdAt: "",
		};
	}
	hooks.renderOverlay();
}

export async function saveEnv() {
	const m = S.envModal;
	if (!m) return;
	const name = m.name.trim();
	if (!m.systemId) {
		toast("请选择所属项目");
		return;
	}
	if (!name) {
		toast("请填写环境名称");
		return;
	}
	// 同项目不允许重名：结果记录按名称筛选，重名就分不清了。
	const dup = envsOf(m.systemId).some((e) => e.id !== m.id && e.name === name);
	if (dup) {
		toast("这个项目下已有同名环境");
		return;
	}
	const nowIso = new Date().toISOString();
	const item = {
		id: m.id,
		systemId: m.systemId,
		name,
		baseUrl: m.baseUrl.trim().replace(/\/+$/, ""),
		note: m.note.trim(),
		isDefault: !!m.isDefault,
		createdAt: m.createdAt || nowIso,
		updatedAt: nowIso,
	};
	const prev = S.envs.find((x) => x.id === m.id);
	const from = prev?.systemId || item.systemId;
	const idx = S.envs.findIndex((x) => x.id === m.id);
	if (idx >= 0) S.envs[idx] = item;
	else S.envs.push(item);
	// 每个项目恰好一个默认：设了默认就清掉同项目其他默认；换了项目则原项目的默认要补一个。
	if (item.isDefault) {
		S.envs = S.envs.map((x) => (x.id === item.id || x.systemId !== item.systemId ? x : { ...x, isDefault: false }));
	}
	for (const sid of new Set([from, item.systemId])) {
		const list = envsOf(sid);
		if (list.length && !list.some((x) => x.isDefault)) {
			const first = list[0];
			S.envs = S.envs.map((x) => (x.id === first.id ? { ...x, isDefault: true } : x));
		}
	}
	if (S.envScope && item.systemId !== S.envScope) S.envScope = item.systemId;
	await persist();
	S.envModal = null;
	hooks.render();
}

export async function deleteEnv(id) {
	const e = S.envs.find((x) => x.id === id);
	if (!e) return;
	if (!window.confirm(`删除环境「${e.name}」？已登记的执行结果仍保留当时的环境名，不影响历史记录。`)) return;
	S.envs = S.envs.filter((x) => x.id !== id);
	// 删掉的是默认环境 → 同项目补一个默认，避免项目「没有默认」。
	const rest = envsOf(e.systemId);
	if (rest.length && !rest.some((x) => x.isDefault)) S.envs = withDefault(S.envs, rest[0].id);
	S.envModal = null;
	await persist();
	hooks.render();
}

export async function copyEnv(id) {
	const e = S.envs.find((x) => x.id === id);
	if (!e) return;
	const nowIso = new Date().toISOString();
	let name = `${e.name} 副本`;
	for (let i = 2; envsOf(e.systemId).some((x) => x.name === name); i += 1) name = `${e.name} 副本 ${i}`;
	S.envs.push({ ...e, id: newId(), name, isDefault: false, createdAt: nowIso, updatedAt: nowIso });
	await persist();
	hooks.render();
}
