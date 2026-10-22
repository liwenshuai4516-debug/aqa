/**
 * data-space 0.8.0「项目环境」纯逻辑单测：model.mjs 清洗 + client/state.mjs 取用 + runs.mjs 落库。
 *
 * 全部走真实源码，零端口零 token：
 *   - 清洗：悬空 systemId 丢弃、id 去重、名称截断、baseUrl 去尾斜杠、超上限截断；
 *   - 默认环境：同项目多个 isDefault 只留第一个，一个都没有就认第一条，项目之间互不影响；
 *   - 用例环境：取所属项目的默认环境，未归类 / 项目没配环境返回空；
 *   - 执行流水：env / envId 原样保留并截断，旧流水没有这两个字段也不炸。
 */
import { describe, expect, it } from "vitest";
import { MAX, normalizeStore } from "../../plugins/data-space/model.mjs";
import { S, applyStore, defaultEnvOf, envLabel, envOfCase, envsOf } from "../../plugins/data-space/client/state.mjs";
import { normalizeRun } from "../../plugins/data-space/runs.mjs";

const stamp = "2026-10-20T02:00:00.000Z";

const systems = [
	{ id: "s1", name: "项目管理系统", code: "PMS", color: "blue", note: "", createdAt: stamp },
	{ id: "s2", name: "供水调度", code: "WSS", color: "green", note: "", createdAt: stamp },
];
const modules = [{ id: "m1", systemId: "s1", name: "合同管理", note: "", createdAt: stamp }];
const features = [{ id: "f1", moduleId: "m1", name: "经营合同", note: "", createdAt: stamp }];

const env = (over: Record<string, unknown> = {}) => ({
	id: "e1",
	systemId: "s1",
	name: "测试环境",
	baseUrl: "https://pm-test.example.com",
	note: "",
	isDefault: false,
	createdAt: stamp,
	updatedAt: stamp,
	...over,
});

const build = (envs: unknown[], over: Record<string, unknown> = {}) =>
	normalizeStore({ systems, modules, features, cases: [], envs, ...over }, null);

describe("环境清洗", () => {
	it("悬空 systemId 与重复 id 直接丢弃", () => {
		const out = build([env({ id: "e1" }), env({ id: "e2", systemId: "ghost" }), env({ id: "e1", systemId: "s2" })]);
		expect(out.envs.map((e: Record<string, unknown>) => e.id)).toEqual(["e1"]);
	});

	it("名称截断、baseUrl 去尾斜杠、备注限长", () => {
		const out = build([
			env({
				name: "测试环境".repeat(30),
				baseUrl: "https://pm-test.example.com///",
				note: "长".repeat(400),
			}),
		]);
		const e = out.envs[0] as Record<string, unknown>;
		expect(String(e.name)).toHaveLength(60);
		expect(e.baseUrl).toBe("https://pm-test.example.com");
		expect(String(e.note)).toHaveLength(300);
	});

	it("超过上限只留前 300 条", () => {
		const many = Array.from({ length: MAX.envs + 20 }, (_, i) => env({ id: `e${i}` }));
		expect(build(many).envs).toHaveLength(MAX.envs);
	});

	it("旧库里没有 envs 也能读成空数组，不报错", () => {
		expect(normalizeStore({ systems, modules, features, cases: [] }, null).envs).toEqual([]);
	});
});

describe("默认环境", () => {
	it("同项目多个默认只认第一个", () => {
		const out = build([env({ id: "e1", isDefault: true }), env({ id: "e2", name: "预发环境", isDefault: true })]);
		expect(out.envs.map((e: Record<string, unknown>) => e.isDefault)).toEqual([true, false]);
	});

	it("一个都没标时把第一条设为默认，且项目之间互不影响", () => {
		const out = build([env({ id: "e1" }), env({ id: "e2", systemId: "s2", name: "生产" })]);
		expect(out.envs.map((e: Record<string, unknown>) => e.isDefault)).toEqual([true, true]);
	});

	it("字符串 / 数字形式的 true 也认", () => {
		const out = build([env({ id: "e1", isDefault: "true" }), env({ id: "e2", isDefault: 1 })]);
		expect(out.envs[0].isDefault).toBe(true);
		expect(out.envs[1].isDefault).toBe(false);
	});
});

describe("页面取用", () => {
	applyStore({
		revision: 7,
		systems,
		modules,
		features,
		cases: [{ id: "c1", featureId: "f1", code: "PMS-001", title: "用例", steps: [] }],
		envs: [
			env({ id: "e1", isDefault: false }),
			env({ id: "e2", name: "预发环境", baseUrl: "", isDefault: true }),
			env({ id: "e3", systemId: "s2", name: "生产", baseUrl: "https://wss.example.com", isDefault: true }),
		],
	});

	it("按项目取，默认环境认 isDefault", () => {
		expect(envsOf("s1").map((e: Record<string, unknown>) => e.id)).toEqual(["e1", "e2"]);
		expect((defaultEnvOf("s1") as Record<string, unknown>)?.id).toBe("e2");
		expect(defaultEnvOf("ghost")).toBeNull();
	});

	it("同一项目没有默认时退回第一条（服务端清洗之外的兜底）", () => {
		expect((defaultEnvOf("s2") as Record<string, unknown>)?.id).toBe("e3");
	});

	it("用例取所属项目的默认环境；未归类为空", () => {
		expect(envLabel(envOfCase({ featureId: "f1" }))).toBe("预发环境");
		expect(envOfCase({ featureId: "f-ghost" })).toBeNull();
	});

	it("环境一行写法：名称 · 地址，地址为空就只写名称", () => {
		expect(envLabel({ name: "测试环境", baseUrl: "https://a.example.com" })).toBe("测试环境 · https://a.example.com");
		expect(envLabel({ name: "预发环境", baseUrl: "" })).toBe("预发环境");
		expect(envLabel(null)).toBe("");
		expect(S.envs).toHaveLength(3);
	});
});

describe("流水带环境", () => {
	const casesById = new Map([["c1", { id: "c1", code: "PMS-001", updatedAt: stamp }]]);

	it("env / envId 原样保留", () => {
		const run = normalizeRun(
			{ id: "r1", caseId: "c1", verdict: "通过", at: stamp, source: "ai", env: "测试环境", envId: "e1" },
			casesById,
		) as Record<string, unknown>;
		expect(run.env).toBe("测试环境");
		expect(run.envId).toBe("e1");
	});

	it("旧流水没有环境字段时是空串，不算脏数据", () => {
		const run = normalizeRun({ id: "r2", caseId: "c1", verdict: "失败", at: stamp }, casesById) as Record<
			string,
			unknown
		>;
		expect(run.env).toBe("");
		expect(run.envId).toBe("");
	});

	it("环境名超长截断到 60", () => {
		const run = normalizeRun(
			{ id: "r3", caseId: "c1", verdict: "通过", at: stamp, env: "环".repeat(120) },
			casesById,
		) as Record<string, unknown>;
		expect(String(run.env)).toHaveLength(60);
	});
});
