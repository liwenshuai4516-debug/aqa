/**
 * data-space 0.12.0「环境内置脚本」纯逻辑单测（零端口零网络）：
 *   - 清洗：上限、方法收敛、同名请求头/提取项去重、无地址步骤丢弃、TTL 夹取；
 *   - 模板：占位符替换与缺变量清单（缺变量要报出来，不能把 `{{口令}}` 原样发出去）；
 *   - 地址：相对路径拼环境地址、绝对地址、拒绝带凭据 / 片段 / 非 HTTP(S)；
 *   - 提取：JSON 点路径（含下标与 `$.` 前缀）、数字转字符串、正则分组、取不到就报错；
 *   - 执行：多步串联（后一步用前一步取到的值 + 环境参数）、HTTP 4xx 中止、提取失败中止、
 *     失败时保留已取值但不写盘、超时；
 *   - 缓存：新鲜 / 过期 / 键不齐三种判定；
 *   - 落库：保存时按脚本原样保留动态值，脚本步骤一改就整组清掉，导入不带动态值。
 */
import { describe, expect, it } from "vitest";
import { normalizeStore } from "../../plugins/data-space/model.mjs";
import {
	dynamicFresh,
	dynamicKeys,
	dynamicSummary,
	extractValue,
	normalizeEnvDynamic,
	normalizeEnvScript,
	normalizeScriptRun,
	renderTemplate,
	resolveScriptUrl,
	runEnvScript,
	scriptReady,
} from "../../plugins/data-space/env-script.mjs";

const at = "2026-10-23T03:00:00.000Z";
const later = "2026-10-23T04:00:00.000Z";

const loginScript = (over = {}) => ({
	enabled: true,
	ttlMinutes: 60,
	steps: [
		{
			name: "登录",
			method: "POST",
			url: "/api/login",
			headers: [{ key: "Content-Type", value: "application/json" }],
			body: '{"username":"{{账号}}","password":"{{口令}}"}',
			extract: [{ key: "token", path: "data.access_token", secret: true }],
		},
	],
	...over,
});

/** 假 fetch：按顺序返回预设响应（可用函数按请求现算），并记录收到的请求便于断言。 */
type FakeResponse = { ok: boolean; status?: number; text?: string; error?: string };
function fakeFetch(responses: Array<FakeResponse | ((url: string, init?: Record<string, unknown>) => FakeResponse)>) {
	const calls: Array<Record<string, unknown> & { url: string }> = [];
	let i = 0;
	const fetchText = async (url: string, init?: Record<string, unknown>) => {
		calls.push({ url, ...(init ?? {}) });
		const next = responses[Math.min(i++, responses.length - 1)];
		return typeof next === "function" ? next(url, init) : next;
	};
	return { calls, fetchText };
}

describe("环境脚本清洗", () => {
	it("未配置时给安全默认：不启用、60 分钟、不放开外部主机", () => {
		expect(normalizeEnvScript(undefined)).toEqual({
			enabled: false,
			ttlMinutes: 60,
			allowForeignHost: false,
			steps: [],
		});
		expect(scriptReady(normalizeEnvScript({}))).toBe(false);
	});

	it("TTL 夹在 1~1440 分钟之间，非数字回落到 60", () => {
		expect(normalizeEnvScript({ ttlMinutes: 0 }).ttlMinutes).toBe(1);
		expect(normalizeEnvScript({ ttlMinutes: 99999 }).ttlMinutes).toBe(1440);
		expect(normalizeEnvScript({ ttlMinutes: "abc" }).ttlMinutes).toBe(60);
		expect(normalizeEnvScript({ ttlMinutes: 90.4 }).ttlMinutes).toBe(90);
	});

	it("方法收敛到白名单，未知方法按 POST", () => {
		expect(normalizeEnvScript({ steps: [{ url: "/a", method: "get" }] }).steps[0].method).toBe("GET");
		expect(normalizeEnvScript({ steps: [{ url: "/a", method: "TRACE" }] }).steps[0].method).toBe("POST");
	});

	it("同名请求头与同名提取键只留第一个，上限生效", () => {
		const script = normalizeEnvScript({
			steps: [
				{
					url: "/a",
					headers: [
						{ key: "Authorization", value: "1" },
						{ key: "authorization", value: "2" },
						{ key: "", value: "3" },
					],
					extract: [
						{ key: "token", path: "a" },
						{ key: "TOKEN", path: "b" },
					],
				},
			],
		});
		expect(script.steps[0].headers).toEqual([{ key: "Authorization", value: "1" }]);
		expect(script.steps[0].extract.map((x: { path: string }) => x.path)).toEqual(["a"]);
		const many = normalizeEnvScript({
			steps: [{ url: "/a", headers: Array.from({ length: 20 }, (_, i) => ({ key: `h${i}`, value: "" })) }],
		});
		expect(many.steps[0].headers).toHaveLength(12);
	});

	it("没有地址的步骤丢弃；有地址的步骤保留", () => {
		const script = normalizeEnvScript({
			steps: [
				{ name: "空", url: "", extract: [{ key: "a", path: "b" }] },
				{ name: "登录", url: "/api/login" },
			],
		});
		expect(script.steps).toHaveLength(1);
		expect(script.steps[0].name).toBe("登录");
	});

	it("步数上限 5，提取项默认按敏感处理", () => {
		const script = normalizeEnvScript({ steps: Array.from({ length: 8 }, (_, i) => ({ url: `/s${i}` })) });
		expect(script.steps).toHaveLength(5);
		expect(
			normalizeEnvScript({ steps: [{ url: "/a", extract: [{ key: "t", path: "x" }] }] }).steps[0].extract[0].secret,
		).toBe(true);
		expect(
			normalizeEnvScript({ steps: [{ url: "/a", extract: [{ key: "t", path: "x", secret: false }] }] }).steps[0]
				.extract[0].secret,
		).toBe(false);
	});

	it("只有启用且至少一步有地址才叫可执行", () => {
		expect(scriptReady(normalizeEnvScript(loginScript()))).toBe(true);
		expect(scriptReady(normalizeEnvScript(loginScript({ enabled: false })))).toBe(false);
		expect(scriptReady(normalizeEnvScript({ enabled: true, steps: [{ url: "" }] }))).toBe(false);
	});

	it("动态值键去重并保序；上次运行结果可空可截断", () => {
		expect(
			dynamicKeys(normalizeEnvScript({ steps: [{ url: "/a", extract: [{ key: "t" }, { key: "t" }, { key: "u" }] }] })),
		).toEqual(["t", "u"]);
		expect(normalizeScriptRun(null)).toBeNull();
		expect(normalizeScriptRun({ at, ok: true, ms: "12.6" })).toEqual({ at, ok: true, error: "", ms: 13 });
		expect(normalizeScriptRun({ at, ok: false, error: "x".repeat(400) })?.error).toHaveLength(300);
	});
});

describe("占位符与地址", () => {
	it("替换已知变量，未知变量进 missing 并从文本中移除", () => {
		const out = renderTemplate("{{账号}}/{{ 口令 }}/{{缺失}}", { 账号: "qa", 口令: "p@ss" });
		expect(out.text).toBe("qa/p@ss/");
		expect(out.missing).toEqual(["缺失"]);
	});

	it("没有占位符时原样返回", () => {
		expect(renderTemplate("plain text", {})).toEqual({ text: "plain text", missing: [] });
	});

	it("相对路径按环境地址拼，绝对地址原样用", () => {
		expect(resolveScriptUrl("https://pms-test.example.com", "/api/login")).toBe(
			"https://pms-test.example.com/api/login",
		);
		expect(resolveScriptUrl("https://pms-test.example.com/", "api/login")).toBe(
			"https://pms-test.example.com/api/login",
		);
		expect(resolveScriptUrl("https://pms-test.example.com", "https://sso.example.com/token")).toBe(
			"https://sso.example.com/token",
		);
	});

	it("没有环境地址时相对路径报错，并给一句可操作的提示", () => {
		expect(() => resolveScriptUrl("", "/api/login")).toThrow(/完整 URL/);
		expect(() => resolveScriptUrl("", "")).toThrow(/没有填地址/);
	});

	it("拒绝带凭据 / 片段 / 非 HTTP(S) 的地址", () => {
		expect(() => resolveScriptUrl("", "https://u:p@host/x")).toThrow(/账号口令/);
		expect(() => resolveScriptUrl("", "https://host/x#y")).toThrow(/片段/);
		expect(() => resolveScriptUrl("", "ftp://host/x")).toThrow(/HTTP\(S\)/);
	});
});

describe("提取表达式", () => {
	it("JSON 点路径：嵌套、数字下标、`$.` 前缀", () => {
		const text = JSON.stringify({ data: { access_token: "abc", items: [{ id: 7 }] } });
		expect(extractValue(text, "data.access_token")).toBe("abc");
		expect(extractValue(text, "$.data.access_token")).toBe("abc");
		expect(extractValue(text, "data.items.0.id")).toBe("7");
	});

	it("非字符串标量转成字符串，对象转 JSON", () => {
		expect(extractValue('{"n":true}', "n")).toBe("true");
		expect(extractValue('{"o":{"a":1}}', "o")).toBe('{"a":1}');
	});

	it("路径断掉 / 取到空值都报错，而不是返回 undefined", () => {
		expect(() => extractValue('{"data":{}}', "data.token")).toThrow(/没有取到值/);
		expect(() => extractValue('{"data":1}', "data.token")).toThrow(/断开/);
		expect(() => extractValue('{"a":""}', "a")).toThrow(/空值/);
		expect(() => extractValue("not json", "a")).toThrow(/不是 JSON/);
	});

	it("正则取第一个捕获组，没捕获组取整段", () => {
		expect(extractValue("token=abc123&x=1", "regex:token=([^&]+)")).toBe("abc123");
		expect(extractValue("Bearer xyz", "regex:xyz")).toBe("xyz");
		expect(() => extractValue("nope", "regex:token=([^&]+)")).toThrow(/没有命中/);
	});
});

describe("执行脚本", () => {
	const env = {
		name: "测试环境",
		baseUrl: "https://pms-test.example.com",
		params: [
			{ key: "账号", value: "qa_admin", secret: false },
			{ key: "口令", value: "s3cret", secret: true },
		],
	};

	it("单步登录：取到 token，请求体里的参数被替换", async () => {
		const { calls, fetchText } = fakeFetch([{ ok: true, status: 200, text: '{"data":{"access_token":"tk-1"}}' }]);
		const out = await runEnvScript({ env, script: loginScript(), fetchText });
		expect(out.ok).toBe(true);
		expect(out.values).toEqual([{ key: "token", value: "tk-1", secret: true }]);
		expect(calls[0].url).toBe("https://pms-test.example.com/api/login");
		expect(calls[0].method).toBe("POST");
		expect(calls[0].body).toBe('{"username":"qa_admin","password":"s3cret"}');
		expect((calls[0].headers as Record<string, string>)["Content-Type"]).toBe("application/json");
	});

	it("两步串联：第二步用第一步取到的值做请求头，GET 不带 body", async () => {
		const script = {
			enabled: true,
			steps: [
				{
					name: "登录",
					url: "/api/login",
					body: '{"u":"{{账号}}"}',
					extract: [{ key: "token", path: "data.access_token" }],
				},
				{
					name: "取租户",
					method: "GET",
					url: "/api/tenants",
					headers: [{ key: "Authorization", value: "Bearer {{token}}" }],
				},
			],
		};
		const { calls, fetchText } = fakeFetch([
			{ ok: true, status: 200, text: '{"data":{"access_token":"tk-2"}}' },
			{ ok: true, status: 200, text: "{}" },
		]);
		const out = await runEnvScript({ env, script, fetchText });
		expect(out.ok).toBe(true);
		expect((calls[1].headers as Record<string, string>).Authorization).toBe("Bearer tk-2");
		expect(calls[1].body).toBeUndefined();
		expect(out.values).toHaveLength(1);
	});

	it("请求体缺少参数时直接报错，不发请求", async () => {
		const { calls, fetchText } = fakeFetch([{ ok: true, status: 200, text: "{}" }]);
		const script = loginScript({
			steps: [
				{ name: "登录", url: "/api/login", body: '{"u":"{{不存在的参数}}"}', extract: [{ key: "t", path: "a" }] },
			],
		});
		const out = await runEnvScript({ env, script, fetchText });
		expect(out.ok).toBe(false);
		expect(out.error).toContain("不存在的参数");
		expect(calls).toHaveLength(0);
	});

	it("HTTP 4xx 中止，错误里带上步骤名与状态码", async () => {
		const { fetchText } = fakeFetch([{ ok: true, status: 401, text: '{"error":"bad password"}' }]);
		const out = await runEnvScript({ env, script: loginScript(), fetchText });
		expect(out.ok).toBe(false);
		expect(out.error).toContain("登录");
		expect(out.error).toContain("401");
		expect(out.steps[0].ok).toBe(false);
	});

	it("宿主拒绝请求时把原因带出来", async () => {
		const { fetchText } = fakeFetch([{ ok: false, error: "net: 主机 pms-test.example.com 未授权" }]);
		const out = await runEnvScript({ env, script: loginScript(), fetchText });
		expect(out.ok).toBe(false);
		expect(out.error).toContain("未授权");
	});

	it("提取失败时保留已取到的值，但 ok=false（调用方不应写盘）", async () => {
		const script = {
			enabled: true,
			steps: [
				{ name: "登录", url: "/api/login", extract: [{ key: "token", path: "data.access_token" }] },
				{ name: "取租户", method: "GET", url: "/api/tenants", extract: [{ key: "tenant", path: "data.tenant_id" }] },
			],
		};
		const { fetchText } = fakeFetch([
			{ ok: true, status: 200, text: '{"data":{"access_token":"tk-3"}}' },
			{ ok: true, status: 200, text: '{"data":{}}' },
		]);
		const out = await runEnvScript({ env, script, fetchText });
		expect(out.ok).toBe(false);
		expect(out.values).toEqual([{ key: "token", value: "tk-3", secret: true }]);
		expect(out.error).toContain("tenant");
	});

	it("没有提取项的脚本跑完不算成功", async () => {
		const { fetchText } = fakeFetch([{ ok: true, status: 200, text: "{}" }]);
		const out = await runEnvScript({ env, script: { enabled: true, steps: [{ url: "/ping" }] }, fetchText });
		expect(out.ok).toBe(false);
		expect(out.error).toContain("提取");
	});

	it("超过墙钟上限就中止", async () => {
		const { fetchText } = fakeFetch([{ ok: true, status: 200, text: '{"data":{"access_token":"tk"}}' }]);
		const out = await runEnvScript({ env, script: loginScript(), fetchText, deadlineMs: -1 });
		expect(out.ok).toBe(false);
		expect(out.error).toContain("超时");
	});

	it("未启用的脚本不去请求，说明原因", async () => {
		const { calls, fetchText } = fakeFetch([{ ok: true, status: 200, text: "{}" }]);
		const out = await runEnvScript({ env, script: loginScript({ enabled: false }), fetchText });
		expect(out.ok).toBe(false);
		expect((out as { skipped?: boolean }).skipped).toBe(true);
		expect(calls).toHaveLength(0);
	});
});

describe("动态值缓存", () => {
	const script = normalizeEnvScript(loginScript());
	const fresh = { key: "token", value: "tk", secret: true, at, expiresAt: later };

	it("键齐全且未过期才算新鲜", () => {
		expect(dynamicFresh({ script, dynamic: [fresh] }, Date.parse(at))).toBe(true);
		expect(dynamicFresh({ script, dynamic: [fresh] }, Date.parse(later))).toBe(false);
	});

	it("脚本里的键没取全，或没有动态值，都算不新鲜", () => {
		expect(dynamicFresh({ script, dynamic: [] })).toBe(false);
		expect(dynamicFresh({ script, dynamic: [{ ...fresh, key: "另一个" }] }, Date.parse(at))).toBe(false);
		expect(
			dynamicFresh({ script: normalizeEnvScript({ enabled: true, steps: [{ url: "/a" }] }), dynamic: [fresh] }),
		).toBe(false);
	});

	it("没有过期时间的条目视为长期有效", () => {
		expect(
			dynamicFresh({ script, dynamic: [{ ...fresh, expiresAt: "" }] }, Date.parse("2030-01-01T00:00:00.000Z")),
		).toBe(true);
	});

	it("摘要写清更新时间与过期状态", () => {
		expect(dynamicSummary(fresh, Date.parse("2026-10-23T03:30:00.000Z"))).toContain("更新");
		expect(dynamicSummary(fresh, Date.parse("2026-10-23T05:00:00.000Z"))).toContain("已过期");
	});

	it("动态值按上限截断、同名去重、默认敏感", () => {
		const list = normalizeEnvDynamic([
			{ key: "token", value: "a".repeat(900) },
			{ key: "TOKEN", value: "b" },
			{ key: "", value: "c" },
		]);
		expect(list).toHaveLength(1);
		expect(list[0].value).toHaveLength(500);
		expect(list[0].secret).toBe(true);
	});
});

describe("保存时保留动态值", () => {
	const system = { id: "s1", name: "项目管理系统", code: "PMS", color: "blue", note: "", createdAt: at };
	const baseEnv = { id: "e1", systemId: "s1", name: "测试环境", baseUrl: "https://x.example.com", params: [] };

	it("脚本没改动时，整份保存不会冲掉已取到的动态值", () => {
		const previous = normalizeStore(
			{
				systems: [system],
				envs: [
					{
						...baseEnv,
						script: loginScript(),
						dynamic: [{ key: "token", value: "tk", secret: true, at, expiresAt: later }],
					},
				],
			},
			null,
		);
		const saved = normalizeStore({ systems: [system], envs: [{ ...baseEnv, script: loginScript() }] }, previous);
		expect(saved.envs[0].dynamic).toEqual([{ key: "token", value: "tk", secret: true, at, expiresAt: later }]);
	});

	it("脚本步骤一改，旧动态值整组清掉", () => {
		const previous = normalizeStore(
			{
				systems: [system],
				envs: [{ ...baseEnv, script: loginScript(), dynamic: [{ key: "token", value: "tk", secret: true, at }] }],
			},
			null,
		);
		const changed = loginScript({
			steps: [{ name: "换接口", url: "/api/v2/login", extract: [{ key: "token", path: "token" }] }],
		});
		const saved = normalizeStore({ systems: [system], envs: [{ ...baseEnv, script: changed }] }, previous);
		expect(saved.envs[0].dynamic).toEqual([]);
	});

	it("页面传上来的 dynamic 不被采信（服务端所有）", () => {
		const previous = normalizeStore({ systems: [system], envs: [{ ...baseEnv, script: loginScript() }] }, null);
		const saved = normalizeStore(
			{
				systems: [system],
				envs: [{ ...baseEnv, script: loginScript(), dynamic: [{ key: "token", value: "伪造", secret: true }] }],
			},
			previous,
		);
		expect(saved.envs[0].dynamic).toEqual([]);
	});

	it("脚本配置经过清洗后落库，动态值与上次运行结果可读", () => {
		const store = normalizeStore(
			{
				systems: [system],
				envs: [
					{
						...baseEnv,
						script: { enabled: true, ttlMinutes: 0, steps: [{ url: "/api/login", method: "post" }] },
						scriptRun: { at, ok: false, error: "HTTP 401" },
					},
				],
			},
			null,
		);
		expect(store.envs[0].script.enabled).toBe(true);
		expect(store.envs[0].script.ttlMinutes).toBe(1);
		expect(store.envs[0].script.steps[0].method).toBe("POST");
		expect(store.envs[0].scriptRun).toEqual({ at, ok: false, error: "HTTP 401", ms: 0 });
		expect(store.envs[0].dynamic).toEqual([]);
	});
});
