/**
 * 环境弹窗：一个环境 = 某项目的一个地址（名称 + baseUrl + 参数 + 备注），同项目恰好一个默认。
 * 名称用 datalist 给常用写法建议（本地 / 测试环境 / 预发环境 / 生产），但不限制。
 * 参数是键值对：测试要用的账号、租户、数据库这类，勾「敏感」的只在本地存，页面与 AI 里都打折。
 */
import {
	ENV_PARAM_MAX,
	ENV_PARAM_PRESETS,
	ENV_PRESETS,
	ENV_SCRIPT_MAX,
	S,
	dynamicOf,
	dynamicTimeText,
	dynamicValueText,
	envsOf,
	esc,
	hooks,
	newId,
	paramsOf,
	persist,
	scriptOf,
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

/* ------------------------------------------------------------ 内置脚本（动态值） */

const SCRIPT_METHODS = ["POST", "GET", "PUT", "PATCH", "DELETE", "HEAD"];

/** 一键模板：登录接口取 token。占位符用中文键，和「参数」里的常用写法对得上。 */
export function scriptTemplate() {
	return {
		enabled: true,
		ttlMinutes: 60,
		allowForeignHost: false,
		steps: [
			{
				name: "登录",
				method: "POST",
				url: "/api/login",
				headers: [{ key: "Content-Type", value: "application/json" }],
				body: '{\n  "username": "{{账号}}",\n  "password": "{{口令}}"\n}',
				extract: [{ key: "token", path: "data.access_token", secret: true }],
			},
		],
	};
}

/** 把环境里的脚本拷成可编辑对象（快照里的对象不能直接改，否则取消也改掉了）。 */
export function editableScript(env) {
	const s = scriptOf(env);
	return {
		enabled: s.enabled,
		ttlMinutes: s.ttlMinutes,
		allowForeignHost: s.allowForeignHost,
		steps: s.steps.map((x) => ({
			name: String(x?.name ?? ""),
			method: String(x?.method || "POST").toUpperCase(),
			url: String(x?.url ?? ""),
			headers: (Array.isArray(x?.headers) ? x.headers : []).map((h) => ({
				key: String(h?.key ?? ""),
				value: String(h?.value ?? ""),
			})),
			body: String(x?.body ?? ""),
			extract: (Array.isArray(x?.extract) ? x.extract : []).map((v) => ({
				key: String(v?.key ?? ""),
				path: String(v?.path ?? ""),
				secret: v?.secret !== false,
			})),
		})),
	};
}

function scriptHeaderRow(stepIndex, h, i) {
	return `<div class="dsp-script-row">
		<input data-esi="${stepIndex}" data-ehi="${i}" data-ehf="key" value="${esc(h.key)}" placeholder="请求头名，如 Authorization" />
		<input data-esi="${stepIndex}" data-ehi="${i}" data-ehf="value" value="${esc(h.value)}" placeholder="值，可用 {{token}}" />
		<button class="dsp-btn icon danger" data-act="del-env-script-header" data-esi="${stepIndex}" data-ehi="${i}" title="删除这个请求头">✕</button>
	</div>`;
}

function scriptExtractRow(stepIndex, x, i) {
	return `<div class="dsp-script-row">
		<input data-esi="${stepIndex}" data-exi="${i}" data-exf="key" value="${esc(x.key)}" placeholder="存成什么名字，如 token" />
		<input data-esi="${stepIndex}" data-exi="${i}" data-exf="path" value="${esc(x.path)}" placeholder="data.access_token 或 regex:token=([^&]+)" />
		<label class="dsp-param-secret" title="敏感值：列表与 AI 对话里只显示 ●●●●"><input type="checkbox" data-esi="${stepIndex}" data-exi="${i}" data-exf="secret" ${x.secret ? "checked" : ""} /><span>敏感</span></label>
		<button class="dsp-btn icon danger" data-act="del-env-script-extract" data-esi="${stepIndex}" data-exi="${i}" title="删除这个提取项">✕</button>
	</div>`;
}

function scriptStepCard(step, i) {
	const headers = Array.isArray(step.headers) ? step.headers : [];
	const extracts = Array.isArray(step.extract) ? step.extract : [];
	return `<div class="dsp-step-card">
		<div class="dsp-step-head">
			<b>步骤 ${i + 1}</b>
			<input data-esi="${i}" data-esf="name" value="${esc(step.name)}" placeholder="名称，如「登录」" />
			<select data-esi="${i}" data-esf="method">${SCRIPT_METHODS.map(
				(m) => `<option value="${m}" ${step.method === m ? "selected" : ""}>${m}</option>`,
			).join("")}</select>
			<button class="dsp-btn icon danger" data-act="del-env-script-step" data-esi="${i}" title="删除这一步">✕</button>
		</div>
		<label class="dsp-field"><span>地址</span><input data-esi="${i}" data-esf="url" value="${esc(step.url)}" placeholder="/api/login 或完整 URL" /></label>
		<div class="dsp-field"><span>请求头 · ${headers.length} 项</span>${headers.map((h, hi) => scriptHeaderRow(i, h, hi)).join("")}<button class="dsp-btn" data-act="add-env-script-header" data-esi="${i}" ${headers.length >= ENV_SCRIPT_MAX.headers ? "disabled" : ""}>＋ 请求头</button></div>
		<label class="dsp-field"><span>请求体（JSON / 表单文本）</span><textarea rows="3" data-esi="${i}" data-esf="body" placeholder='{"username":"{{账号}}","password":"{{口令}}"}'>${esc(step.body)}</textarea></label>
		<div class="dsp-field"><span>取哪些值 · ${extracts.length} 项</span>${extracts.map((x, xi) => scriptExtractRow(i, x, xi)).join("")}<button class="dsp-btn" data-act="add-env-script-extract" data-esi="${i}" ${extracts.length >= ENV_SCRIPT_MAX.extracts ? "disabled" : ""}>＋ 提取项</button></div>
	</div>`;
}

function scriptSection(m) {
	const s = m.script;
	const dyn = dynamicOf(S.envs.find((e) => e.id === m.id));
	const steps = s.steps;
	return `<div class="dsp-section">
		<div class="dsp-section-head"><span>内置脚本 · ${steps.length ? `${steps.length} 步` : "未配置"}</span><span class="dsp-inline">
			<button class="dsp-btn" data-act="env-script-template" title="填入一个「登录接口取 Token」的例子，再按自己的接口改">用登录模板</button>
			<button class="dsp-btn" data-act="add-env-script-step" ${steps.length >= ENV_SCRIPT_MAX.steps ? "disabled" : ""}>＋ 步骤</button>
		</span></div>
		<label class="dsp-check"><input type="checkbox" data-script="enabled" ${s.enabled ? "checked" : ""} /><span>启用：用到这个环境时自动跑一遍脚本，取回最新动态值（如 Token），不用每回先手工登录</span></label>
		<div class="dsp-grid2">
			<label class="dsp-field"><span>动态值有效期（分钟）</span><input type="number" min="1" max="1440" data-script="ttlMinutes" value="${s.ttlMinutes}" /></label>
			<label class="dsp-check" title="默认只允许请求环境自身的地址"><input type="checkbox" data-script="allowForeignHost" ${s.allowForeignHost ? "checked" : ""} /><span>允许请求环境以外的主机（如统一认证中心）</span></label>
		</div>
		${steps.length ? steps.map(scriptStepCard).join("") : `<div class="dsp-empty-inline">还没有步骤。点「用登录模板」可以一键填一个「登录 → 取 token」的例子。</div>`}
		${
			dyn.length
				? `<div class="dsp-dyn-row"><span class="dsp-muted">当前动态值：</span>${dyn
						.map((v) => {
							const time = dynamicTimeText(v);
							return `<span class="dsp-dyn" title="${esc(time || "脚本取到的动态值")}">${esc(v.key)}=<b>${esc(dynamicValueText(v))}</b>${time ? `<i>${esc(time)}</i>` : ""}</span>`;
						})
						.join("")}</div>`
				: ""
		}
		<div class="dsp-muted">脚本只做两件事：发一个 HTTP 请求、从响应里取字段（不做任意代码执行）。占位符 <code>{{账号}}</code> 取参数、<code>{{token}}</code> 取上一步结果；提取写 <code>data.access_token</code> 或 <code>regex:token=([^&]+)</code>。保存后，启用状态下用这个环境时才会去取新值。</div>
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
				${scriptSection(m)}
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
			script: editableScript(e),
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
			script: editableScript(null),
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
	// 脚本：空行 / 空提取行丢掉；没填地址的步骤跑不了，别静默存着。
	const rawSteps = (m.script?.steps ?? []).map((s) => ({
		name: String(s?.name ?? "").trim(),
		method: String(s?.method || "POST").toUpperCase(),
		url: String(s?.url ?? "").trim(),
		headers: (s?.headers ?? [])
			.map((h) => ({ key: String(h?.key ?? "").trim(), value: String(h?.value ?? "").trim() }))
			.filter((h) => h.key),
		body: String(s?.body ?? ""),
		extract: (s?.extract ?? [])
			.map((x) => ({
				key: String(x?.key ?? "").trim(),
				path: String(x?.path ?? "").trim(),
				secret: x?.secret !== false,
			}))
			.filter((x) => x.key),
	}));
	const orphan = rawSteps.findIndex((s) => !s.url && s.extract.length);
	if (orphan >= 0) {
		toast(`步骤 ${orphan + 1} 填了提取项但没填地址`);
		return;
	}
	const script = {
		enabled: !!m.script?.enabled,
		ttlMinutes: Math.min(1440, Math.max(1, Math.round(Number(m.script?.ttlMinutes) || 60))),
		allowForeignHost: !!m.script?.allowForeignHost,
		steps: rawSteps.filter((s) => s.url),
	};
	if (script.enabled && !script.steps.length) {
		toast("脚本启用了，但还没有填地址的步骤");
		return;
	}
	const noPath = script.steps.flatMap((s) => s.extract).find((x) => !x.path);
	if (noPath) {
		toast(`提取项 ${noPath.key} 还没填表达式（如 data.access_token）`);
		return;
	}
	const dupKey = (() => {
		const seen = new Set();
		for (const s of script.steps)
			for (const x of s.extract) {
				const low = x.key.toLowerCase();
				if (seen.has(low)) return x.key;
				seen.add(low);
			}
		return "";
	})();
	if (dupKey) {
		toast(`提取项重名：${dupKey}（同一脚本里名字不能重复）`);
		return;
	}
	const item = {
		id: m.id,
		systemId: m.systemId,
		name,
		baseUrl: m.baseUrl.trim().replace(/\/+$/, ""),
		params: named,
		script,
		note: m.note.trim(),
		isDefault: !!m.isDefault,
		createdAt: m.createdAt || nowIso,
		updatedAt: nowIso,
	};
	const prev = S.envs.find((x) => x.id === m.id);
	// 动态值是服务端取回的运行时缓存：保存在页面这一侧原样带上，等保存返回的快照再刷新。
	if (prev) {
		item.dynamic = prev.dynamic ?? [];
		item.scriptRun = prev.scriptRun ?? null;
	}
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
		// 脚本一并复制（接口地址、取值路径是配置）；动态值是取回的缓存，副本从零开始。
		script: editableScript(e),
		dynamic: [],
		scriptRun: null,
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
