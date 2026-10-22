/**
 * data-space v2/v3 纯逻辑单测：结果流水（runs.mjs）、AI 工具（tools.mjs）、`@` 提及（mention.mjs）。
 *
 * 全部走真实源码，零端口零 token：
 *   - 结论归一（pass / failed / 跳过 之类同义词收敛）；
 *   - 流水收紧：未知用例丢弃、按时间排序、超量裁旧、revision 保留；
 *   - 最近结果 / 过期判定（用例改过则旧结果降级为参考）；
 *   - 概览统计：未执行不进分母，通过率按已执行算；
 *   - 锚点解析：revision + cases 列表；
 *   - data_space_cases：list / get / stats、按项目·功能·结果筛选、卡片档带步骤；
 *   - data_space_record_result：按编号回写、未知编号不静默丢、锚点补全批次；
 *   - `@` 提及：编号精确 > 编号前缀 > 标题命中、空查询列最近更新、功能/模块范围命中、插入文本不以 @ 开头。
 */
import { describe, expect, it } from "vitest";
import {
	MAX_RUNS,
	isStale,
	latestByCase,
	normalizeRun,
	normalizeRuns,
	normalizeVerdict,
	parseAnchor,
	summarize,
} from "../../plugins/data-space/runs.mjs";
import { createDataSpaceTools, featurePath, formatCaseLines, formatStats } from "../../plugins/data-space/tools.mjs";
import { searchMentions } from "../../plugins/data-space/client/mention.mjs";

const stamp = "2026-10-20T02:00:00.000Z";

type Row = Record<string, unknown>;

const baseStore = (over: Row = {}) => ({
	version: 3,
	revision: 49,
	updatedAt: stamp,
	systems: [
		{ id: "s1", name: "项目管理系统", code: "PMS", color: "blue", note: "", createdAt: stamp },
		{ id: "s2", name: "供水调度", code: "WSS", color: "green", note: "", createdAt: stamp },
	],
	modules: [
		{ id: "m1", systemId: "s1", name: "合同管理", note: "", createdAt: stamp },
		{ id: "m2", systemId: "s2", name: "调度管理", note: "", createdAt: stamp },
	],
	features: [
		{ id: "f1", moduleId: "m1", name: "经营合同", note: "", createdAt: stamp },
		{ id: "f2", moduleId: "m2", name: "调度指令", note: "", createdAt: stamp },
		{ id: "f3", moduleId: "m1", name: "合同变更", note: "", createdAt: stamp },
	],
	cases: [
		{
			id: "c1",
			featureId: "f1",
			code: "PMS-004",
			title: "新建经营合同-必填项完整可保存",
			type: "接口",
			priority: "P0",
			status: "已评审",
			owner: "张工",
			tags: ["冒烟"],
			preconditions: "已登录且具备合同新增权限",
			steps: [
				{ id: "s1", action: "POST /contracts", expect: "201 且返回合同号" },
				{ id: "s2", action: "GET /contracts/{id}", expect: "字段与提交一致" },
			],
			note: "",
			createdAt: stamp,
			updatedAt: stamp,
		},
		{
			id: "c2",
			featureId: "f1",
			code: "PMS-005",
			title: "合同金额为负时拦截",
			type: "接口",
			priority: "P1",
			status: "草稿",
			owner: "",
			tags: [],
			preconditions: "",
			steps: [{ id: "s1", action: "提交 amount=-1", expect: "400 参数错误" }],
			note: "",
			createdAt: stamp,
			updatedAt: stamp,
		},
		{
			id: "c3",
			featureId: "f2",
			code: "WSS-010",
			title: "调度指令下发后状态变为已确认",
			type: "UI",
			priority: "P2",
			status: "已评审",
			owner: "李工",
			tags: [],
			preconditions: "",
			steps: [{ id: "s1", action: "点击下发", expect: "列表状态变为已确认" }],
			note: "",
			createdAt: "2026-10-21T00:00:00.000Z",
			updatedAt: "2026-10-21T00:00:00.000Z",
		},
	],
	envs: [
		{
			id: "e1",
			systemId: "s1",
			name: "测试环境",
			baseUrl: "https://pm-test.example.com",
			note: "",
			isDefault: true,
			createdAt: stamp,
			updatedAt: stamp,
		},
	],
	runs: [],
	...over,
});

const run = (caseId: string, verdict: string, at: string, extra: Row = {}) =>
	({ id: `r-${caseId}-${at}`, caseId, verdict, at, note: "", source: "ai", caseUpdatedAt: stamp, ...extra }) as Row;

describe("结论归一与流水收紧", () => {
	it("同义词收敛到三种结论，无法识别返回空", () => {
		expect(normalizeVerdict("通过")).toBe("通过");
		expect(normalizeVerdict("pass")).toBe("通过");
		expect(normalizeVerdict("FAILED")).toBe("失败");
		expect(normalizeVerdict("blocked")).toBe("阻塞");
		expect(normalizeVerdict("跳过")).toBe("阻塞");
		expect(normalizeVerdict("大概可以")).toBe("");
	});

	it("normalizeRun 需要用例存在且结论合法", () => {
		const cases = new Map([["c1", { id: "c1", code: "PMS-004", updatedAt: stamp }]]);
		expect(normalizeRun({ caseId: "c1", verdict: "通过" }, cases)?.code).toBe("PMS-004");
		expect(normalizeRun({ caseId: "c9", verdict: "通过" }, cases)).toBeNull();
		expect(normalizeRun({ caseId: "c1", verdict: "跑了一下" }, cases)).toBeNull();
	});

	it("丢弃用例已删的记录、按时间排序、超量裁掉最旧的", () => {
		const cases = [{ id: "c1", updatedAt: stamp }];
		const many = Array.from({ length: MAX_RUNS + 5 }, (_, i) =>
			run("c1", "通过", new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()),
		);
		const kept = normalizeRuns({ version: 1, revision: 7, runs: [...many, run("ghost", "通过", stamp)] }, cases);
		expect(kept.revision).toBe(7);
		expect(kept.runs).toHaveLength(MAX_RUNS);
		expect((kept.runs as Row[]).every((r) => r.caseId === "c1")).toBe(true);
		// 裁掉的是最旧的：末尾应是最新时间
		expect(kept.runs.at(-1)?.at).toBe(many.at(-1)?.at);
	});

	it("同一用例取时间最晚的一条；坏输入不炸", () => {
		const map = latestByCase([
			run("c1", "失败", "2026-10-20T01:00:00.000Z"),
			run("c1", "通过", "2026-10-20T02:00:00.000Z"),
		]);
		expect(map.get("c1")?.verdict).toBe("通过");
		expect(latestByCase(undefined).size).toBe(0);
		expect(normalizeRuns(null, []).runs).toEqual([]);
	});
});

describe("结果过期与统计", () => {
	it("用例在记录之后被改过 → 结果过期", () => {
		const stale = run("c1", "通过", "2026-10-19T00:00:00.000Z", { caseUpdatedAt: "2026-10-19T00:00:00.000Z" });
		expect(isStale(stale, { id: "c1", updatedAt: "2026-10-20T00:00:00.000Z" })).toBe(true);
		expect(isStale(stale, { id: "c1", updatedAt: "2026-10-19T00:00:00.000Z" })).toBe(false);
		expect(isStale(stale, { id: "c1" })).toBe(false);
	});

	it("未执行不计入分母，通过率只算已执行", () => {
		const store = baseStore();
		const s = summarize(
			[run("c1", "通过", "2026-10-20T01:00:00.000Z"), run("c2", "失败", "2026-10-20T02:00:00.000Z")],
			store.cases as Row[],
		);
		expect(s.total).toBe(3);
		expect(s.executed).toBe(2);
		expect(s.untested).toBe(1);
		expect(s.passRate).toBe(50);
		expect(s.stale).toBe(0);
	});

	it("没有执行记录时不出现 NaN", () => {
		const s = summarize([], baseStore().cases as Row[]);
		expect(s.passRate).toBe(0);
		expect(s.untested).toBe(3);
	});
});

describe("锚点解析", () => {
	it("取出 revision 与 cases", () => {
		const a = parseAnchor("……\n<!-- data-space: revision=49 cases=c1,c2 -->\n");
		expect(a.revision).toBe(49);
		expect(a.ids).toEqual(["c1", "c2"]);
	});

	it("没有锚点或写坏时返回空", () => {
		expect(parseAnchor("普通文本")).toEqual({ ids: [], revision: 0 });
		expect(parseAnchor("<!-- data-space: -->").ids).toEqual([]);
	});
});

describe("data_space_cases 工具", () => {
	const store = baseStore();
	const ctx = (runs: Row[] = []) => ({
		store: () => store,
		runs: () => ({ version: 1, revision: 3, runs }),
		record: () => ({ ok: true, recorded: [], unknown: [], runsRevision: 3 }),
	});
	const call = async (params: Row, runs: Row[] = []) => {
		const tool = createDataSpaceTools(ctx(runs)).find((t) => t.name === "data_space_cases");
		return String(await tool!.execute("call-1", params));
	};

	it("路径拼成「项目 / 模块 / 功能」", () => {
		expect(featurePath(store, "f1")).toBe("项目管理系统 / 合同管理 / 经营合同");
		expect(featurePath(store, "ghost")).toBe("");
	});

	it("按项目 / 功能筛选，默认一条一段（清单档）", async () => {
		const text = await call({ project: "项目管理" });
		expect(text).toContain("命中 2 条");
		expect(text).toContain("PMS-005"); // P1 排在 P0 之后
		expect(text).not.toContain("WSS-010");
		expect(text.indexOf("PMS-004")).toBeLessThan(text.indexOf("PMS-005"));
		expect(text).toContain("数据 revision 49");
	});

	it("按类型和最近结果筛选", async () => {
		const runs = [run("c2", "失败", "2026-10-20T02:00:00.000Z")];
		expect(await call({ type: "UI" })).toContain("WSS-010");
		const failed = await call({ result: "失败" }, runs);
		expect(failed).toContain("PMS-005");
		expect(failed).toContain("最近 失败");
		const untested = await call({ result: "未执行" }, runs);
		expect(untested).toContain("PMS-004");
		expect(untested).not.toContain("PMS-005");
	});

	it("get 只按编号或 id 取，缺的列出来；卡片档带步骤与预期", async () => {
		const card = await call({ action: "get", ids: ["pms-004", "PMS-999"], detail: "card" });
		expect(card).toContain("PMS-004");
		expect(card).toContain("1) POST /contracts → 预期：201 且返回合同号");
		expect(card).toContain("环境：测试环境 · https://pm-test.example.com");
		expect(card).toContain("未找到：PMS-999");
		expect(card).not.toContain("p@ssw0rd"); // 环境只有名称与地址，不带任何账号口令
		expect(await call({ action: "get", ids: ["nope"] })).toContain("没有找到这些用例");
	});

	it("stats 给覆盖与通过率", async () => {
		const text = await call({ action: "stats" }, [run("c1", "通过", "2026-10-20T01:00:00.000Z")]);
		expect(text).toContain("用例 3");
		expect(text).toContain("覆盖：2/3 个功能有用例");
		expect(text).toContain("通过率 100%");
		expect(text).toContain("环境分布：1/2 个项目已设地址");
	});

	it("格式化函数单独可用（供别的视图复用）", () => {
		const lines = formatCaseLines(store, [store.cases[0] as Row], latestByCase([]));
		expect(lines).toContain("最近 未执行");
		expect(formatStats(store, [])).toContain("结果 revision 0");
	});
});

describe("data_space_record_result 工具", () => {
	const store = baseStore();
	const recorded: Row[][] = [];
	const metas: Row[] = [];
	const ctx = {
		store: () => store,
		runs: () => ({ version: 1, revision: 3, runs: [] }),
		record: (entries: Row[], source: string, meta: Row = {}) => {
			recorded.push(entries);
			metas.push(meta);
			return {
				ok: true,
				recorded: entries.map((e) => ({
					code: String(e.case),
					verdict: e.verdict,
					note: e.note,
					env: e.env,
					caseId: "c1",
				})),
				unknown: [],
				runsRevision: 4 + recorded.length,
				source,
			};
		},
	};
	const tool = () => createDataSpaceTools(ctx).find((t) => t.name === "data_space_record_result")!;

	it("逐条回传结果，来源标 ai", async () => {
		recorded.length = 0;
		const text = String(
			await tool().execute("call-2", {
				results: [
					{ case: "PMS-004", verdict: "通过" },
					{ case: "PMS-005", verdict: "失败", note: "返回 500" },
				],
			}),
		);
		expect(recorded[0]).toHaveLength(2);
		expect(text).toContain("已记录 2 条");
		expect(text).toContain("PMS-005 · 失败 — 返回 500");
	});

	it("锚点里的用例会自动补进批次（结论仍以 results 为准）", async () => {
		recorded.length = 0;
		const text = String(
			await tool().execute("call-3", {
				results: [{ case: "PMS-004", verdict: "通过" }],
				anchor: "<!-- data-space: revision=49 cases=PMS-004,WSS-010 -->",
			}),
		);
		expect(recorded[0]).toHaveLength(1);
		expect(text).toContain("锚点含 2 条用例");
	});

	it("环境：批次级 env 传下去，单条 env 也能覆盖自己那一条", async () => {
		recorded.length = 0;
		metas.length = 0;
		const text = String(
			await tool().execute("call-5", {
				results: [
					{ case: "PMS-004", verdict: "通过" },
					{ case: "PMS-005", verdict: "失败", env: "预发环境" },
				],
				task: "经营合同 P0 回归",
				env: "测试环境",
			}),
		);
		expect(metas[0]).toMatchObject({ taskName: "经营合同 P0 回归", env: "测试环境" });
		expect(recorded[0].map((e) => e.env)).toEqual(["", "预发环境"]);
		expect(text).toContain("PMS-005 · 失败 · 预发环境");
	});

	it("没有可记录的内容时如实说明，不假装成功", async () => {
		const text = String(await tool().execute("call-4", {}));
		expect(text).toContain("没有可记录的结果");
	});
});

describe("@ 提及", () => {
	const store = baseStore();

	const titles = (q: string) => searchMentions(store, q).map((h) => h.title);

	it("编号精确命中排最前，前缀其次", () => {
		expect(titles("PMS-004")[0]).toBe("PMS-004 · 新建经营合同-必填项完整可保存");
		const byPrefix = titles("PMS");
		expect(byPrefix).toHaveLength(2);
		expect(byPrefix[0]).toContain("PMS-004");
	});

	it("按标题、负责人、路径关键词也能搜到", () => {
		expect(titles("金额为负")[0]).toContain("PMS-005");
		expect(titles("李工").some((t) => t.includes("WSS-010"))).toBe(true);
		expect(titles("调度指令").some((t) => t.includes("WSS-010"))).toBe(true);
	});

	it("功能名命中时追加范围项（整功能一次带入）", () => {
		const hits = searchMentions(store, "经营合同");
		const scope = hits.find((h) => h.title === "功能 · 经营合同");
		expect(scope).toBeTruthy();
		expect(scope?.hint).toContain("项目管理系统 / 合同管理 / 经营合同");
		expect(scope?.text).toContain("全部 2 条用例");
		expect(hits.length).toBeLessThanOrEqual(8);
	});

	it("空查询列最近更新的用例", () => {
		const hits = searchMentions(store, "");
		expect(hits[0]?.title).toContain("WSS-010"); // 2026-10-21 更新
	});

	it("插入文本不以 @ 开头（否则会把补全面板重新打开），并带编号标题", () => {
		for (const h of searchMentions(store, "经营合同")) {
			expect(h.text?.startsWith("@")).toBe(false);
		}
		expect(searchMentions(store, "PMS-004")[0]?.text).toBe("「用例 PMS-004 · 新建经营合同-必填项完整可保存」");
	});

	it("没有命中就返回空，不抛错", () => {
		expect(searchMentions(store, "根本不存在的关键词")).toEqual([]);
		expect(searchMentions({}, "PMS")).toEqual([]);
	});
});
