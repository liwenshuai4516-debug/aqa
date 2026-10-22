/**
 * data-space 示例执行记录（demo-runs.mjs）单测。
 *
 * 锁住的行为：
 *   - 空库 / 无用例 → 空数组（页面与路由据此给提示，而不是生成没有归属的孤儿记录）；
 *   - 条数与构成：3 个批量任务 + 2 条手工单条，覆盖通过 / 失败 / 阻塞三种结论；
 *   - 记录字段合法：caseId 都是库里真实用例、verdict 在合法集合内、id 唯一、按时间升序、不落在未来；
 *   - 「失败后复测」的用例最近一条是「通过」，说明只追加不改历史；
 *   - 恰好一条标了旧版本（演示「可能过期」），其余都用当前用例版本；
 *   - 走一遍 normalizeRuns 后一条不丢（形状与真实回写一致）；
 *   - 用例很少时退化不报错。
 */
import { describe, expect, it } from "vitest";
import { buildDemoRuns } from "../../plugins/data-space/demo-runs.mjs";
import { VERDICTS, isStale, latestByCase, normalizeRuns, summarize } from "../../plugins/data-space/runs.mjs";

const NOW = new Date("2026-10-22T10:00:00.000Z");
const CASE_AT = "2026-10-22T08:00:00.000Z";

type CaseRow = Record<string, unknown>;
type FeatureRow = Record<string, unknown>;

const mkCase = (id: string, code: string, featureId: string, title = `${code} 用例`): CaseRow => ({
	id,
	code,
	title,
	featureId,
	updatedAt: CASE_AT,
});

const store = {
	features: [
		{ id: "ft-a", name: "经营合同" },
		{ id: "ft-b", name: "设备台账" },
		{ id: "ft-c", name: "压力监测" },
	],
	cases: [
		mkCase("c1", "PMS-001", "ft-a"),
		mkCase("c2", "PMS-002", "ft-a"),
		mkCase("c3", "PMS-003", "ft-a"),
		mkCase("c4", "PMS-004", "ft-a"),
		mkCase("c5", "PMS-005", "ft-a"),
		mkCase("c6", "PMS-006", "ft-a"),
		mkCase("c7", "WOP-001", "ft-b"),
		mkCase("c8", "WOP-002", "ft-b"),
		mkCase("c9", "WDS-001", "ft-c"),
		mkCase("c10", "WDS-002", "ft-c"),
		mkCase("c11", "WDS-003", "ft-c"),
	],
};

const demo = buildDemoRuns(store, { now: NOW });

describe("buildDemoRuns", () => {
	it("无用例时返回空数组", () => {
		expect(buildDemoRuns({ cases: [], features: [] }, { now: NOW })).toEqual([]);
		expect(buildDemoRuns({}, { now: NOW })).toEqual([]);
	});

	it("生成 11 条记录：3 个批量任务 + 2 条手工单条", () => {
		expect(demo.length).toBe(11);
		const taskIds = new Set(demo.filter((r) => r.taskId).map((r) => r.taskId));
		expect(taskIds.size).toBe(3);
		const manual = demo.filter((r) => r.source === "manual");
		expect(manual.length).toBe(2);
		expect(manual.every((r) => !r.taskId && !r.taskName)).toBe(true);
	});

	it("三条结论都有，够看统计卡与通过率", () => {
		const counts = { 通过: 0, 失败: 0, 阻塞: 0 };
		for (const r of demo) counts[r.verdict as keyof typeof counts] += 1;
		expect(counts["通过"]).toBeGreaterThan(0);
		expect(counts["失败"]).toBeGreaterThan(0);
		expect(counts["阻塞"]).toBeGreaterThan(0);
	});

	it("每条记录都指向真实用例，结论合法，id 唯一", () => {
		const ids = new Set();
		const caseIds = new Set(store.cases.map((c) => c.id));
		for (const r of demo) {
			expect(caseIds.has(r.caseId)).toBe(true);
			expect(VERDICTS).toContain(r.verdict);
			expect(r.code).toBe(store.cases.find((c) => c.id === r.caseId)!.code);
			expect(r.note.length).toBeGreaterThan(0);
			expect(ids.has(r.id)).toBe(false);
			ids.add(r.id);
		}
	});

	it("时间按升序排列且都在过去（不会造出未来记录）", () => {
		const times = demo.map((r) => r.at);
		expect([...times].sort()).toEqual(times);
		for (const at of times) expect(new Date(at).getTime()).toBeLessThanOrEqual(NOW.getTime());
	});

	it("任务名带上功能名，同批任务名一致", () => {
		const first = demo.filter((r) => r.taskId === "demo-task-1");
		expect(first.length).toBe(5); // 4 条 + 1 条复测
		expect(new Set(first.map((r) => r.taskName))).toEqual(new Set(["经营合同 P0 回归"]));
	});

	it("失败后复测的那条用例，最近结果是「通过」", () => {
		const latest = latestByCase(demo);
		const pms003 = store.cases.find((c) => c.id === "c3")!;
		expect(pms003.code).toBe("PMS-003");
		// 批内第 3 条被判失败，批末追加一条复测通过
		const records = demo.filter((r) => r.caseId === "c3");
		expect(records.map((r) => r.verdict)).toEqual(["失败", "通过"]);
		expect(latest.get("c3")!.verdict).toBe("通过");
	});

	it("恰好一条标了旧版本（演示「可能过期」），其余都用当前版本", () => {
		const stale = demo.filter((r) =>
			isStale(
				r,
				store.cases.find((c) => c.id === r.caseId),
			),
		);
		expect(stale.length).toBe(1);
		expect(stale[0]!.taskId).toBe("demo-task-2");
		const rest = demo.filter(
			(r) =>
				!isStale(
					r,
					store.cases.find((c) => c.id === r.caseId),
				),
		);
		expect(rest.every((r) => r.caseUpdatedAt === CASE_AT)).toBe(true);
	});

	it("形状与真实回写一致：normalizeRuns 后一条不丢", () => {
		const normalized = normalizeRuns({ runs: demo }, store.cases);
		expect(normalized.runs.length).toBe(demo.length);
		const stats = summarize(normalized.runs, store.cases);
		// 覆盖 10 条用例（c11 没被编到），未执行单独计数、不进分母
		expect(stats.executed).toBe(10);
		expect(stats.untested).toBe(1);
		expect(stats.passRate).toBe(80);
	});

	it("用例很少时退化但不报错", () => {
		const one = buildDemoRuns({ cases: [mkCase("x1", "ONE-001", "ft-a")], features: [] }, { now: NOW });
		expect(one.length).toBe(1);
		expect(one[0]!.caseId).toBe("x1");
		const two = buildDemoRuns(
			{ cases: [mkCase("y1", "TWO-001", "ft-a"), mkCase("y2", "TWO-002", "ft-a")], features: [] },
			{ now: NOW },
		);
		expect(two.every((r) => r.caseId === "y1" || r.caseId === "y2")).toBe(true);
		expect(new Set(two.map((r) => r.id)).size).toBe(two.length);
	});
});
