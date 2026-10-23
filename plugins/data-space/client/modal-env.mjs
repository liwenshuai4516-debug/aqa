/**
 * 环境弹窗：一个环境 = 某项目的一个地址（名称 + baseUrl + 参数 + 备注），同项目恰好一个默认。
 * 名称用 datalist 给常用写法建议（本地 / 测试环境 / 预发环境 / 生产），但不限制。
 * 参数是键值对：测试要用的账号、租户、数据库这类，勾「敏感」的只在本地存，页面与 AI 里都打折。
 */
import {
	ENV_PARAM_MAX,
	ENV_PARAM_PRESETS,
	ENV_PRESETS,
	S,
	envsOf,
	esc,
	hooks,
	newId,
	paramsOf,
	persist,
	toast,
} from "./state.mjs";

const withDefault = (list, id) => list.map((e) => ({ ...e, isDefault: e.id === id }));

/** 参数行：键 / 值 / 敏感开关 / 删除。敏感值在列表与 AI 里一律占位，编辑时看得到明文。 */
function paramRow(p, i) {
	return `<div class="dsp-param">
		<input data-pi="${i}" data-pf="key" value="${esc(p.key)}" placeholder="例如 账号" list="dsp-env-param-keys" />
		<input data-pi="${i}" data-pf="value" value="${esc(p.value)}" placeholder="例如 qa_admin" />
		<label class="dsp-param-secret" title="敏感值：列表、CSV 与 AI 对话里只显示 ●●●●"><input type="checkbox" data-pi="${i}" data-pf="secret" ${p.secret ? "checked" : ""} /><span>敏感</span></label>
		<button class="dsp-btn icon danger" data-act="del-env-param" data-pi="${i}" title="删除这个参数">✕</button>
	</div>`;
}

function paramsSection(m) {
	const rows = paramsOf(m);
	return `<div class="dsp-section">
		<div class="dsp-section-head"><span>参数 · ${rows.length} 项</span><button class="dsp-btn" data-act="add-env-param">＋ 添加参数</button></div>
		<datalist id="dsp-env-param-keys">${ENV_PARAM_PRESETS.map((k) => `<option value="${esc(k)}"></option>`).join("")}</datalist>
		${
			rows.length
				? `<div class="dsp-param dsp-param-head"><span>参数名</span><span>值</span><span>敏感</span><span></span></div>${rows.map(paramRow).join("")}`
				: `<div class="dsp-empty-inline">还没有参数。常用的有账号、租户、口令、数据库，点「添加参数」按需填。</div>`
		}
		<div class="dsp-muted">参数只存在本地；勾选「敏感」的值在列表、导出与 AI 对话里都显示为 ●●●●，测完用完记得自己确认。</div>
	</div>`;
}

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
				${paramsSection(m)}
				<label class="dsp-check"><input type="checkbox" data-f="isDefault" ${m.isDefault ? "checked" : ""} /><span>设为该项目的默认环境（登记结果时默认选中它）</span></label>
				<div class="dsp-muted">地址与参数都只存在本地，刷新页面、重启应用都不会丢。</div>
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
			params: paramsOf(e).map((p) => ({ key: p.key, value: p.value, secret: !!p.secret })),
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
			params: [],
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
	// 参数：空行直接丢；填了值却没名称的提醒一下，别让人以为存进去了；同名只留一行。
	const rows = paramsOf(m).map((p) => ({
		key: String(p.key ?? "").trim(),
		value: String(p.value ?? "").trim(),
		secret: !!p.secret,
	}));
	if (rows.some((p) => !p.key && p.value)) {
		toast("有参数没填名称，补上或删掉这一行再保存");
		return;
	}
	const named = rows.filter((p) => p.key);
	const seenKeys = new Set();
	for (const p of named) {
		const low = p.key.toLowerCase();
		if (seenKeys.has(low)) {
			toast(`参数名重复：${p.key}（同一个环境里只能有一个）`);
			return;
		}
		seenKeys.add(low);
	}
	if (named.length > ENV_PARAM_MAX) {
		toast(`一个环境最多 ${ENV_PARAM_MAX} 个参数，当前 ${named.length} 个`);
		return;
	}
	const nowIso = new Date().toISOString();
	const item = {
		id: m.id,
		systemId: m.systemId,
		name,
		baseUrl: m.baseUrl.trim().replace(/\/+$/, ""),
		params: named,
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
	S.envs.push({
		...e,
		id: newId(),
		name,
		isDefault: false,
		params: paramsOf(e).map((p) => ({ ...p })),
		createdAt: nowIso,
		updatedAt: nowIso,
	});
	await persist();
	hooks.render();
}

/** 复制参数为 `KEY=VALUE`（一行一个），方便直接贴进 .env 或接口工具；含敏感值时先确认。 */
export async function copyEnvParams(id) {
	const e = S.envs.find((x) => x.id === id);
	if (!e) return;
	const ps = paramsOf(e);
	if (!ps.length) {
		toast("这个环境还没有参数");
		return;
	}
	const secrets = ps.filter((p) => p.secret).length;
	if (secrets && !window.confirm(`其中 ${secrets} 个敏感参数会以明文复制到剪贴板，确认？`)) return;
	try {
		await navigator.clipboard.writeText(ps.map((p) => `${p.key}=${p.value}`).join("\n"));
		toast(`已复制 ${ps.length} 个参数${secrets ? `（含 ${secrets} 个敏感值）` : ""}`);
	} catch {
		toast("复制失败：浏览器不允许写剪贴板");
	}
}
