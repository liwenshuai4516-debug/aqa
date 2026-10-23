/**
 * 环境脚本：环境被真正使用时，按「声明式 HTTP 步骤」取回可变的测试参数（token / 会话 id / 签名盐…），
 * 存进环境的动态值里，避免每次执行前再手工登一次、也避免拿着过期 token 跑测试。
 *
 * 刻意**不做任意 JS 执行**：一个脚本就是若干步骤，每步只做两件事——
 *   1) 发一个 HTTP 请求（method / url / headers / body）；
 *   2) 从响应里按路径取值（JSON 点路径或正则），把结果存成动态值。
 * 这样脚本可读、可审、可测：没有 eval / vm / 子进程，最坏情况就是一个 HTTP 请求。
 *
 * 占位符 `{{名称}}`：可用 `baseUrl`、`env`（环境名）、环境里的任意参数名，以及前面步骤取到的值。
 * 例：登录步骤取到 token，后一步用 `Authorization: Bearer {{token}}`。
 *
 * 提取表达式：
 *   - `data.access_token` / `$.data.items.0.token`：按 JSON 点路径取（数字段按下标）；
 *   - `regex:token=([^&]+)`：正则取第一个捕获组（没有捕获组取整段）。
 *
 * 出站请求由调用方注入（index.mjs 接宿主 host.net.fetch，走白名单 + 超时 + 512KB 上限），
 * 本模块不自己发请求，因此单测可以用假 fetch 完整覆盖。
 */

/** 脚本规模上限：够覆盖「登录 → 取租户 → 取签名」这类链路，又不至于把环境弹窗变成 IDE。 */
export const SCRIPT_LIMITS = {
	steps: 5,
	headers: 12,
	extracts: 8,
	key: 60,
	url: 500,
	body: 4000,
	path: 200,
	dynamic: 20,
	ttl: { min: 1, max: 1440, def: 60 },
	deadlineMs: 30_000,
};

export const SCRIPT_METHODS = ["POST", "GET", "PUT", "PATCH", "DELETE", "HEAD"];
const METHOD_SET = new Set(SCRIPT_METHODS);

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const bool = (v) => v === true || v === "true" || v === 1;

/**
 * 脚本配置清洗：未知字段丢掉、长度截断、方法收敛到列表内、同名请求头 / 提取项只留第一个。
 * 没有 url 的步骤直接丢掉（页面上加了步骤还没填地址）；没有提取项的步骤保留——
 * 有些接口只是「先调一下拿会话」，不需要取值。
 */
export function normalizeEnvScript(raw) {
	const o = raw && typeof raw === "object" ? raw : {};
	const steps = (Array.isArray(o.steps) ? o.steps : [])
		.slice(0, SCRIPT_LIMITS.steps)
		.map((item) => {
			const so = item && typeof item === "object" ? item : {};
			const headers = [];
			const seenHeaders = new Set();
			for (const h of Array.isArray(so.headers) ? so.headers : []) {
				const ho = h && typeof h === "object" ? h : {};
				const key = str(ho.key, SCRIPT_LIMITS.key);
				if (!key) continue;
				const low = key.toLowerCase();
				if (seenHeaders.has(low)) continue;
				seenHeaders.add(low);
				headers.push({ key, value: typeof ho.value === "string" ? ho.value.slice(0, 1000) : "" });
				if (headers.length >= SCRIPT_LIMITS.headers) break;
			}
			const extract = [];
			const seenKeys = new Set();
			for (const x of Array.isArray(so.extract) ? so.extract : []) {
				const xo = x && typeof x === "object" ? x : {};
				const key = str(xo.key, SCRIPT_LIMITS.key);
				if (!key) continue;
				const low = key.toLowerCase();
				if (seenKeys.has(low)) continue;
				seenKeys.add(low);
				extract.push({
					key,
					path: str(xo.path, SCRIPT_LIMITS.path),
					// 动态值默认按敏感处理：脚本取回来的多半是 token / 会话，默认别往页面上摊明文。
					secret: xo.secret === undefined ? true : bool(xo.secret),
				});
				if (extract.length >= SCRIPT_LIMITS.extracts) break;
			}
			const method = String(so.method ?? "POST").toUpperCase();
			return {
				name: str(so.name, SCRIPT_LIMITS.key),
				method: METHOD_SET.has(method) ? method : "POST",
				url: str(so.url, SCRIPT_LIMITS.url),
				headers,
				body: typeof so.body === "string" ? so.body.slice(0, SCRIPT_LIMITS.body) : "",
				extract,
			};
		})
		// 没有地址的步骤跑不了，直接丢掉（页面上加了空步骤不算错误）。
		.filter((s) => s.url);

	const ttl = Number(o.ttlMinutes);
	return {
		enabled: bool(o.enabled),
		ttlMinutes: Number.isFinite(ttl)
			? Math.min(SCRIPT_LIMITS.ttl.max, Math.max(SCRIPT_LIMITS.ttl.min, Math.round(ttl)))
			: SCRIPT_LIMITS.ttl.def,
		// 默认只允许请求环境自身的地址：脚本会带上参数里的口令，别往第三方主机漏。
		allowForeignHost: bool(o.allowForeignHost),
		steps,
	};
}

/** 能跑的最小条件：启用了，且至少有一个填了地址的步骤。 */
export function scriptReady(script) {
	return Boolean(script?.enabled) && (script?.steps ?? []).some((s) => str(s?.url, SCRIPT_LIMITS.url));
}

/** 脚本会写出的动态值键（保存脚本时用来清理旧值、判断缓存是否还完整）。 */
export function dynamicKeys(script) {
	const keys = [];
	for (const step of script?.steps ?? []) {
		for (const x of step?.extract ?? []) {
			const key = str(x?.key, SCRIPT_LIMITS.key);
			if (key && !keys.includes(key)) keys.push(key);
		}
	}
	return keys;
}

/** 动态值清洗：键 / 值长度截断、同名只留第一个、时间补成 ISO 串。 */
export function normalizeEnvDynamic(raw) {
	const out = [];
	const seen = new Set();
	for (const item of Array.isArray(raw) ? raw : []) {
		const o = item && typeof item === "object" ? item : {};
		const key = str(o.key, SCRIPT_LIMITS.key);
		if (!key) continue;
		const low = key.toLowerCase();
		if (seen.has(low)) continue;
		seen.add(low);
		out.push({
			key,
			value: typeof o.value === "string" ? o.value.slice(0, 500) : "",
			secret: o.secret === undefined ? true : bool(o.secret),
			at: str(o.at, 40),
			expiresAt: str(o.expiresAt, 40),
		});
		if (out.length >= SCRIPT_LIMITS.dynamic) break;
	}
	return out;
}

/** 上次运行结果（成功 / 失败都记）：页面与工具都要能说清「为什么没有新 token」。 */
export function normalizeScriptRun(raw) {
	const o = raw && typeof raw === "object" ? raw : null;
	if (!o) return null;
	return {
		at: str(o.at, 40),
		ok: bool(o.ok),
		error: str(o.error, 300),
		ms: Number.isFinite(Number(o.ms)) ? Math.max(0, Math.round(Number(o.ms))) : 0,
	};
}

/**
 * 动态值是否还能直接用：
 *   - 有值；脚本提取的每个键都在（脚本改过就重取，避免新旧混用）；
 *   - 每一条都没过期（expiresAt 为空视为不过期，由用户自己把握）。
 */
export function dynamicFresh(env, nowMs = Date.now()) {
	const list = Array.isArray(env?.dynamic) ? env.dynamic : [];
	const keys = dynamicKeys(env?.script);
	if (!list.length || !keys.length) return false;
	const got = new Set(list.map((v) => String(v?.key ?? "").toLowerCase()));
	if (!keys.every((k) => got.has(k.toLowerCase()))) return false;
	return list.every((v) => {
		const at = Date.parse(String(v?.expiresAt ?? ""));
		return !Number.isFinite(at) || at > nowMs;
	});
}

/** 动态值的一条摘要：`10-23 11:42 更新 · 12:42 过期`；过期就直说。 */
export function dynamicSummary(value, nowMs = Date.now()) {
	const at = Date.parse(String(value?.at ?? ""));
	const exp = Date.parse(String(value?.expiresAt ?? ""));
	const stamp = (ms) => {
		if (!Number.isFinite(ms)) return "";
		const d = new Date(ms);
		const p = (n) => String(n).padStart(2, "0");
		return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
	};
	const parts = [];
	if (Number.isFinite(at)) parts.push(`${stamp(at)} 更新`);
	if (Number.isFinite(exp)) parts.push(exp > nowMs ? `${stamp(exp)} 过期` : "已过期");
	return parts.join(" · ");
}

const PLACEHOLDER_RE = /\{\{\s*([^{}]{1,60}?)\s*\}\}/g;

/**
 * 占位符替换。缺变量时返回 missing，而不是把 `{{x}}` 原样发出去
 * （登录请求带着字面 `{{口令}}` 通常只得到 401，报错却很难看懂）。
 */
export function renderTemplate(text, vars) {
	const missing = [];
	const out = String(text ?? "").replace(PLACEHOLDER_RE, (_m, name) => {
		const key = String(name).trim();
		if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key] ?? "");
		if (!missing.includes(key)) missing.push(key);
		return "";
	});
	return { text: out, missing };
}

/**
 * 脚本请求地址：相对路径按环境地址拼（`/api/login`），绝对地址原样用。
 * 只收无凭据、无片段的 HTTP(S)：带 `user:pass@` 的地址会把口令写进日志与界面。
 */
export function resolveScriptUrl(baseUrl, raw) {
	const value = str(raw, SCRIPT_LIMITS.url);
	if (!value) throw new Error("脚本步骤没有填地址");
	const base = str(baseUrl, 300);
	let parsed;
	try {
		// 带协议的（http/https/ftp…）按绝对地址解析，协议不对由下面的检查报错；
		// 否则按环境地址拼（/api 与 api 两种写法都当作根路径）。
		parsed = /^[a-z][a-z0-9+.\-]*:/i.test(value)
			? new URL(value)
			: base
				? new URL(value.startsWith("/") ? value : `/${value}`, `${base.replace(/\/+$/, "")}/`)
				: null;
	} catch {
		parsed = null;
	}
	if (!parsed) throw new Error(`脚本地址无效：${value}${base ? "" : "（环境没有填地址，步骤需要用完整 URL）"}`);
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("脚本地址只支持 HTTP(S)");
	if (parsed.username || parsed.password) throw new Error("脚本地址不能带账号口令");
	if (parsed.hash) throw new Error("脚本地址不能带 #片段");
	return parsed.toString();
}

/**
 * 按表达式取值：JSON 点路径（可带 `$.` 前缀、数字段按下标）或 `regex:…`。
 * 取不到就抛错——动态值宁可不写，也不要把 "undefined" 存成 token。
 */
export function extractValue(text, spec) {
	const expr = str(spec, SCRIPT_LIMITS.path);
	if (!expr) throw new Error("提取表达式为空");
	if (/^regex:/i.test(expr)) {
		const pattern = expr.slice(6).trim();
		let re;
		try {
			re = new RegExp(pattern);
		} catch {
			throw new Error(`正则无效：${pattern}`);
		}
		const hit = re.exec(String(text ?? ""));
		if (!hit) throw new Error("正则没有命中响应内容");
		const value = String(hit[1] ?? hit[0] ?? "").trim();
		if (!value) throw new Error("正则命中但内容为空");
		return value;
	}
	let body;
	try {
		body = JSON.parse(String(text ?? ""));
	} catch {
		throw new Error("响应不是 JSON，无法按路径提取（可改用 regex:）");
	}
	const segments = expr
		.replace(/^\$\.?/, "")
		.split(".")
		.map((s) => s.trim())
		.filter(Boolean);
	if (!segments.length) throw new Error("提取表达式为空");
	let cur = body;
	for (const seg of segments) {
		if (cur === null || cur === undefined || typeof cur !== "object") {
			throw new Error(`路径 ${segments.join(".")} 在「${seg}」处断开`);
		}
		cur = cur[seg];
	}
	if (cur === null || cur === undefined) throw new Error(`路径 ${segments.join(".")} 没有取到值`);
	const value =
		typeof cur === "string"
			? cur
			: typeof cur === "number" || typeof cur === "boolean"
				? String(cur)
				: JSON.stringify(cur);
	const trimmed = String(value).trim();
	if (!trimmed) throw new Error(`路径 ${segments.join(".")} 取到空值`);
	return trimmed;
}

const compactError = (err) =>
	String(err?.message || err || "未知错误")
		.replace(/\s+/g, " ")
		.trim();

/**
 * 跑一遍脚本，返回取到的动态值（不落盘，由调用方决定要不要保存）。
 *
 * opts:
 *   env        环境快照（baseUrl / name / params）
 *   now        当前时间（测试注入）
 *   fetchText  ({method, headers, body}) => {ok, status, text, error}，宿主出站能力的薄包装
 *   deadlineMs 整条链路的墙钟上限（默认 30s，够「登录 → 取租户」两步）
 *
 * 失败时返回 { ok:false, error, steps }，**已取到的部分值也一并返回**供页面展示诊断，
 * 但调用方不应把它写进环境（半套值比没有更危险）。
 */
export async function runEnvScript({
	env,
	script,
	now = new Date(),
	fetchText,
	deadlineMs = SCRIPT_LIMITS.deadlineMs,
}) {
	const s = normalizeEnvScript(script);
	if (!s.enabled) return { ok: false, skipped: true, error: "环境脚本未启用", values: [], steps: [] };
	if (!scriptReady(s))
		return { ok: false, error: "环境脚本没有可执行的步骤（至少一步要填地址）", values: [], steps: [] };
	if (typeof fetchText !== "function")
		return { ok: false, error: "当前宿主不支持出站请求，无法执行环境脚本", values: [], steps: [] };

	const started = Date.now();
	const vars = { baseUrl: str(env?.baseUrl, 300), env: str(env?.name, 60) };
	for (const p of env?.params ?? []) {
		const key = str(p?.key, SCRIPT_LIMITS.key);
		if (key) vars[key] = String(p?.value ?? "");
	}
	const values = [];
	const steps = [];
	const fail = (error) => ({ ok: false, error, values, steps, at: new Date(now).toISOString() });

	for (const [index, step] of s.steps.entries()) {
		const label = step.name || `步骤 ${index + 1}`;
		if (Date.now() - started > deadlineMs) return fail(`环境脚本超时（超过 ${Math.round(deadlineMs / 1000)} 秒）`);

		const urlText = renderTemplate(step.url, vars);
		if (urlText.missing.length) return fail(`「${label}」缺少参数：${urlText.missing.join("、")}`);
		let url;
		try {
			url = resolveScriptUrl(env?.baseUrl, urlText.text);
		} catch (err) {
			return fail(`「${label}」${compactError(err)}`);
		}

		const headers = {};
		for (const h of step.headers) {
			const rendered = renderTemplate(h.value, vars);
			if (rendered.missing.length) return fail(`「${label}」请求头 ${h.key} 缺少参数：${rendered.missing.join("、")}`);
			headers[h.key] = rendered.text;
		}
		let body;
		if (step.body && step.method !== "GET" && step.method !== "HEAD") {
			const rendered = renderTemplate(step.body, vars);
			if (rendered.missing.length) return fail(`「${label}」请求体缺少参数：${rendered.missing.join("、")}`);
			body = rendered.text;
		}

		const t0 = Date.now();
		let res;
		try {
			res = await fetchText(url, { method: step.method, headers, ...(body === undefined ? {} : { body }) });
		} catch (err) {
			return fail(`「${label}」请求失败：${compactError(err)}`);
		}
		const ms = Date.now() - t0;
		if (!res?.ok) {
			steps.push({
				name: label,
				ok: false,
				status: res?.status ?? 0,
				ms,
				error: compactError(res?.error ?? "请求失败"),
			});
			return fail(`「${label}」${compactError(res?.error ?? "请求失败")}`);
		}
		if (Number(res.status) >= 400) {
			steps.push({ name: label, ok: false, status: Number(res.status), ms, error: `HTTP ${res.status}` });
			return fail(`「${label}」返回 HTTP ${res.status}，脚本中止`);
		}

		const got = [];
		for (const item of step.extract) {
			try {
				const raw = extractValue(res.text, item.path);
				const value = raw.slice(0, 500);
				vars[item.key] = value;
				values.push({ key: item.key, value, secret: item.secret });
				got.push(item.key);
			} catch (err) {
				steps.push({ name: label, ok: false, status: Number(res.status), ms, error: compactError(err) });
				return fail(`「${label}」提取 ${item.key || "值"} 失败：${compactError(err)}`);
			}
		}
		steps.push({ name: label, ok: true, status: Number(res.status), ms, extracted: got });
	}

	if (!values.length) {
		return {
			ok: false,
			error: "脚本跑完了但没有任何提取项，未产生动态值",
			values: [],
			steps,
			at: new Date(now).toISOString(),
		};
	}
	return { ok: true, values, steps, at: new Date(now).toISOString() };
}
