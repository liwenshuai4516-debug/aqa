/**
 * 数据空间 v4「执行结果」纯逻辑单测：client/results.mjs + runs.mjs 的任务字段。
 *
 * 覆盖：
 *   - 时间范围：今天 / 近 7 天 / 近 30 天 / 全部，滚动窗口以本地日界算；
 *   - 筛选：结论、环境、来源、关键词（编号 / 标题 / 备注 / 任务名 / 环境 / 路径）与组合；
 *   - 环境下拉候选：去重、排序、空值不列；
 *   - 统计：记录数、覆盖用例数、通过率、过期条数、最近时间；
 *   - 按任务分组：同 taskId 归组、无任务各自成组、按最近时间倒序、组内结论计数；
 *   - CSV：固定表头、引号 / 逗号 / 换行转义、过期列；
 *   - 落库：normalizeRun 保留 taskId / taskName，没有 taskId 的任务名视为脏数据丢弃。
 */
import { describe, expect, it } from "vitest";
import {
	envOptions,
	filterRuns,
	groupRuns,
	inRange,
	runStats,
	runsCsv,
	sortRunsDesc,
	stampText,
	verdictClass,
} from "../../plugins/data-space/client/results.mjs";
import { isStale, normalizeRun } from "../../plugins/data-space/runs.mjs";

const NOW = new Date(2026, 9, 20, 12, 0, 0); // 2026-10-20 12:00 本地时间
const iso = (d: Date): string => d.toISOString();
const daysAgo = (n: number, hour = 9): string => {
	const d = new Date(NOW);
	d.setDate(d.getDate() - n);
	d.setHours(hour, 0, 0, 0);
	return iso(d);
};

type Case = { id: string; code?: string; title?: string; featureId?: string; updatedAt?: string };
type Run = Partial<{
	caseId: string;
	code: string;
	verdict: string;
	note: string;
	source: string;
	caseUpdatedAt: string;
	taskId: string;
	taskName: string;
	env: string;
}> & { id: string; at: string };
type RunGroup = {
	key: string;
	taskId: string;
	name: string;
	at: string;
	source: string;
	rows: Run[];
	total: number;
	counts: Record<string, number>;
	stale: number;
};

const CASES = [
	{ id: "c1", code: "PMS-004", title: "新建经营合同-必填项完整可保存", featureId: "f1", updatedAt: daysAgo(0, 8) },
	{ id: "c2", code: "PMS-005", title: "合同金额为负时拦截", featureId: "f2", updatedAt: daysAgo(9, 8) },
];
const casesById = new Map(CASES.map((c) => [c.id, c]));
const pathOf = (c?: Case | null): string =>
	c?.id === "c1" ? "项目管理系统 / 合同管理 / 经营合同" : "项目管理系统 / 合同管理 / 合同校验";

const RUNS = [
	{
		id: "r1",
		caseId: "c1",
		code: "PMS-004",
		verdict: "通过",
		note: "",
		at: daysAgo(0, 9),
		source: "ai",
		caseUpdatedAt: CASES[0].updatedAt,
		taskId: "t1",
		taskName: "经营合同 P0 回归",
		env: "测试环境",
	},
	{
		id: "r2",
		caseId: "c2",
		code: "PMS-005",
		verdict: "失败",
		note: '返回 "500", 应为 409',
		at: daysAgo(3, 10),
		source: "ai",
		caseUpdatedAt: CASES[1].updatedAt,
		taskId: "t1",
		taskName: "经营合同 P0 回归",
		env: "测试环境",
	},
	{
		id: "r3",
		caseId: "c1",
		code: "PMS-004",
		verdict: "阻塞",
		note: "环境未就绪",
		at: daysAgo(10, 11),
		source: "manual",
		caseUpdatedAt: CASES[0].updatedAt,
		env: "本地",
	},
];

describe("时间范围与排序", () => {
	it("今天只算今天的记录", () => {
		expect(inRange(daysAgo(0, 9), "today", NOW)).toBe(true);
		expect(inRange(daysAgo(1, 23), "today", NOW)).toBe(false);
		expect(inRange(daysAgo(0, 9), "all", NOW)).toBe(true);
	});

	it("近 7 / 30 天按滚动窗口，边界日算在内", () => {
		expect(inRange(daysAgo(0, 9), "7d", NOW)).toBe(true);
		expect(inRange(daysAgo(6, 9), "7d", NOW)).toBe(true);
		expect(inRange(daysAgo(7, 9), "7d", NOW)).toBe(false);
		expect(inRange(daysAgo(29, 9), "30d", NOW)).toBe(true);
		expect(inRange(daysAgo(30, 9), "30d", NOW)).toBe(false);
	});

	it("时间解析不出来时不混进任何范围筛选", () => {
		expect(inRange("", "today", NOW)).toBe(false);
		expect(inRange("not-a-date", "7d", NOW)).toBe(false);
		expect(inRange("not-a-date", "all", NOW)).toBe(true);
	});

	it("流水按时间倒序，同一时刻后写入的在前", () => {
		const same = [
			{ id: "a", at: "2026-10-20T02:00:00.000Z", caseId: "c1" },
			{ id: "b", at: "2026-10-20T03:00:00.000Z", caseId: "c1" },
			{ id: "c", at: "2026-10-20T02:00:00.000Z", caseId: "c1" },
		];
		expect(sortRunsDesc(same).map((r: Run) => r.id)).toEqual(["b", "c", "a"]);
	});
});

describe("执行记录筛选", () => {
	const base = { casesById, pathOf, now: NOW };

	it("按结论与来源筛选", () => {
		expect(filterRuns(RUNS, { ...base, verdict: "失败" }).map((r: Run) => r.id)).toEqual(["r2"]);
		expect(filterRuns(RUNS, { ...base, source: "manual" }).map((r: Run) => r.id)).toEqual(["r3"]);
		expect(filterRuns(RUNS, { ...base, verdict: "all", source: "all" })).toHaveLength(3);
	});

	it("关键词覆盖编号 / 标题 / 备注 / 任务名 / 环境 / 路径", () => {
		expect(filterRuns(RUNS, { ...base, q: "PMS-005" }).map((r: Run) => r.id)).toEqual(["r2"]);
		expect(filterRuns(RUNS, { ...base, q: "金额为负" }).map((r: Run) => r.id)).toEqual(["r2"]);
		expect(filterRuns(RUNS, { ...base, q: "500" }).map((r: Run) => r.id)).toEqual(["r2"]);
		expect(filterRuns(RUNS, { ...base, q: "回归" }).map((r: Run) => r.id)).toEqual(["r1", "r2"]);
		expect(filterRuns(RUNS, { ...base, q: "合同校验" }).map((r: Run) => r.id)).toEqual(["r2"]);
		expect(filterRuns(RUNS, { ...base, q: "环境未就绪" }).map((r: Run) => r.id)).toEqual(["r3"]);
		expect(filterRuns(RUNS, { ...base, q: "测试环境" }).map((r: Run) => r.id)).toEqual(["r1", "r2"]);
	});

	it("按环境筛选，与环境候选下拉同源", () => {
		expect(filterRuns(RUNS, { ...base, env: "测试环境" }).map((r: Run) => r.id)).toEqual(["r1", "r2"]);
		expect(filterRuns(RUNS, { ...base, env: "本地" }).map((r: Run) => r.id)).toEqual(["r3"]);
		expect(filterRuns(RUNS, { ...base, env: "all" })).toHaveLength(3);
		expect(envOptions(RUNS)).toEqual(["本地", "测试环境"]);
	});

	it("时间范围与结论可以叠加", () => {
		const rows = filterRuns(RUNS, { ...base, range: "7d", verdict: "通过" });
		expect(rows.map((r: Run) => r.id)).toEqual(["r1"]);
		expect(filterRuns(RUNS, { ...base, range: "today" }).map((r: Run) => r.id)).toEqual(["r1"]);
	});

	it("空值不会命中任何记录", () => {
		expect(filterRuns([{ id: "x", verdict: "通过", at: daysAgo(0, 9) }], base)).toHaveLength(0);
	});
});

describe("统计与按任务分组", () => {
	it("统计按记录口径算通过率，未执行不参与", () => {
		const st = runStats(RUNS, { casesById, isStale });
		expect(st.total).toBe(3);
		expect(st.cases).toBe(2);
		expect(st.tasks).toBe(1);
		expect(st["通过"]).toBe(1);
		expect(st["失败"]).toBe(1);
		expect(st["阻塞"]).toBe(1);
		expect(st.passRate).toBe(33);
		expect(st.lastAt).toBe(RUNS[0].at);
		expect(st.stale).toBe(0);
	});

	it("用例改过 → 记录算过期", () => {
		const edited = new Map([["c1", { ...CASES[0], updatedAt: daysAgo(-1, 8) }]]);
		expect(runStats(RUNS, { casesById: edited, isStale }).stale).toBe(2);
	});

	it("同 taskId 归为一个任务，无任务各自成组", () => {
		const groups = groupRuns(RUNS, { casesById, isStale });
		expect(groups).toHaveLength(2);
		expect(groups[0].taskId).toBe("t1");
		expect(groups[0].name).toBe("经营合同 P0 回归");
		expect(groups[0].total).toBe(2);
		expect(groups[0].counts).toEqual({ 通过: 1, 失败: 1, 阻塞: 0 });
		expect(groups[0].source).toBe("ai");
		expect(groups[1].taskId).toBe("");
		expect(groups[1].name).toBe("单条登记");
		expect(groups[1].total).toBe(1);
	});

	it("任务按最近一次执行时间倒序，组内也按时间倒序", () => {
		const groups = groupRuns(RUNS, { casesById, isStale });
		expect(groups.map((g: RunGroup) => g.at)).toEqual([RUNS[0].at, RUNS[2].at]);
		expect(groups[0].rows.map((r: Run) => r.id)).toEqual(["r1", "r2"]);
	});
});

describe("CSV 导出", () => {
	it("表头固定，按当前顺序导出", () => {
		const csv = runsCsv(RUNS, { casesById, pathOf, isStale });
		const lines = csv.split("\r\n");
		expect(lines[0]).toBe('"时间","结论","环境","编号","用例标题","所属路径","来源","任务","过期","备注"');
		expect(lines).toHaveLength(4);
		expect(lines[1]).toContain('"PMS-004"');
		expect(lines[1]).toContain('"AI 登记（未核验）"');
		expect(lines[1]).toContain('"经营合同 P0 回归"');
	});

	it("引号、逗号与换行都按 CSV 规则转义", () => {
		const csv = runsCsv(RUNS, { casesById, pathOf, isStale });
		expect(csv).toContain('"返回 ""500"", 应为 409"');
		const multiline = runsCsv([{ ...RUNS[1], note: "第一行\n第二行" }], { casesById, pathOf, isStale });
		expect(multiline).toContain('"第一行\n第二行"');
	});

	it("用例被删后仍导出，标题标注已删除", () => {
		const csv = runsCsv([{ ...RUNS[0], caseId: "gone" }], { casesById, pathOf, isStale });
		expect(csv).toContain("（用例已删除）");
	});

	it("时间戳与结论颜色映射稳定", () => {
		expect(stampText("")).toBe("");
		expect(stampText("not-a-date")).toBe("");
		expect(stampText(daysAgo(0, 9))).toMatch(/^\d{4}-\d{2}-\d{2} 09:00$/);
		expect(verdictClass("通过")).toBe("pass");
		expect(verdictClass("失败")).toBe("fail");
		expect(verdictClass("阻塞")).toBe("blocked");
		expect(verdictClass("其他")).toBe("none");
	});
});

describe("任务字段落库", () => {
	it("normalizeRun 保留 taskId / taskName", () => {
		const run = normalizeRun(
			{ caseId: "c1", verdict: "通过", taskId: "t9", taskName: "回归批次", source: "ai" },
			casesById,
		);
		expect(run?.taskId).toBe("t9");
		expect(run?.taskName).toBe("回归批次");
	});

	it("只有任务名没有任务 id 时按无任务处理（不留半截数据）", () => {
		const run = normalizeRun({ caseId: "c1", verdict: "通过", taskName: "孤立任务" }, casesById);
		expect(run?.taskId).toBe("");
		expect(run?.taskName).toBe("");
	});
});
