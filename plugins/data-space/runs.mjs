/**
 * 执行结果的存储模型（v3「回写」这一环）。
 *
 * 为什么单独一个文件、不进 store.json：
 *   - store.json 是「用户编辑的内容」，整份保存 + revision 乐观并发；执行结果是流水，
 *     两者混在一起会让页面保存和 AI 回写互相抢 revision。
 *   - 结果只追加、按用例取最近一条，单独文件好裁剪也好排障。
 *
 * 记录形状：{ id, caseId, code, verdict, note, at, source, caseUpdatedAt, taskId, taskName }
 *   - caseUpdatedAt：记录当时用例的 updatedAt。用例后来被改过就当「结果已过期」，
 *     页面显示为灰色并提示重跑，不会把旧结论当现行结论。
 *   - source：ai（对话里由工具回写）/ manual（页面里手工登记）。
 *   - taskId / taskName：一次批量回写（AI 跑完一个功能 / 模块）归为同一个「测试任务」，
 *     「执行结果」页可以按任务看整批结论；手工登记的单条没有任务，taskId 为空。
 *
 * 文件形状：{ version: 1, revision: N, runs: [...] }，最多保留 MAX_RUNS 条（丢最旧）。
 */
import { randomUUID } from "node:crypto";

export const VERDICTS = ["通过", "失败", "阻塞"];
export const MAX_RUNS = 800;

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** 任务名太长会把结果页撑破，统一截断；没有 taskId 的任务名没有意义，直接丢掉。 */
const taskFields = (o) => {
	const taskId = str(o.taskId, 64);
	return { taskId, taskName: taskId ? str(o.taskName, 80) : "" };
};
const now = () => new Date().toISOString();

export function normalizeVerdict(v) {
	const s = str(v, 12);
	if (VERDICTS.includes(s)) return s;
	// 常见同义词收敛（模型写 pass / failed 时不必再来一次）
	const low = s.toLowerCase();
	if (["pass", "passed", "ok", "success", "通过", "成功"].includes(low)) return "通过";
	if (["fail", "failed", "error", "失败", "不通过"].includes(low)) return "失败";
	if (["block", "blocked", "skip", "skipped", "阻塞", "跳过"].includes(low)) return "阻塞";
	return "";
}

/** 任意输入 → 干净的一条执行记录；用例不存在则返回 null（由调用方登记为未匹配）。 */
export function normalizeRun(raw, casesById) {
	const o = raw && typeof raw === "object" ? raw : {};
	const caseId = str(o.caseId, 64);
	const verdict = normalizeVerdict(o.verdict);
	if (!caseId || !verdict) return null;
	const c = casesById?.get?.(caseId) ?? null;
	if (!c) return null;
	return {
		id: str(o.id, 64) || randomUUID(),
		caseId,
		code: str(o.code, 24) || str(c.code, 24),
		verdict,
		note: str(o.note, 300),
		at: str(o.at, 40) || now(),
		source: o.source === "manual" ? "manual" : "ai",
		caseUpdatedAt: str(o.caseUpdatedAt, 40) || str(c.updatedAt, 40),
		...taskFields(o),
	};
}

/** 收紧一整份 runs 文件：坏记录丢弃、用例已删的记录丢弃、超量裁掉最旧的。 */
export function normalizeRuns(raw, cases) {
	const casesById = new Map((cases ?? []).map((c) => [c.id, c]));
	const list = (Array.isArray(raw?.runs) ? raw.runs : [])
		.map((r) => normalizeRun(r, casesById))
		.filter(Boolean)
		.sort((a, b) => String(a.at).localeCompare(String(b.at)));
	const kept = list.slice(-MAX_RUNS);
	return {
		version: 1,
		revision: Number.isFinite(Number(raw?.revision)) ? Number(raw.revision) : 1,
		runs: kept,
	};
}

/** 每条用例的最近一次结果：caseId → run。 */
export function latestByCase(runs) {
	const map = new Map();
	for (const r of runs ?? []) {
		const prev = map.get(r.caseId);
		if (!prev || String(r.at) >= String(prev.at)) map.set(r.caseId, r);
	}
	return map;
}

/**
 * 用例后来被改过 → 这条结果算过期（仍保留记录，只是不再当现行结论）。
 * 两边都没有 updatedAt 时按「未过期」处理，避免误判。
 */
export function isStale(run, c) {
	if (!run) return false;
	const recorded = String(run.caseUpdatedAt ?? "");
	const current = String(c?.updatedAt ?? "");
	if (!recorded || !current) return false;
	return current > recorded;
}

/** 概览统计：只统计「已执行」的用例，未执行的不进分母。 */
export function summarize(runs, cases) {
	const latest = latestByCase(runs);
	const byId = new Map((cases ?? []).map((c) => [c.id, c]));
	const counts = { 通过: 0, 失败: 0, 阻塞: 0 };
	let stale = 0;
	for (const [caseId, run] of latest) {
		const c = byId.get(caseId);
		if (!c) continue;
		counts[run.verdict] = (counts[run.verdict] ?? 0) + 1;
		if (isStale(run, c)) stale += 1;
	}
	const executed = counts["通过"] + counts["失败"] + counts["阻塞"];
	const total = (cases ?? []).length;
	return {
		total,
		executed,
		untested: Math.max(0, total - executed),
		...counts,
		stale,
		passRate: executed ? Math.round((counts["通过"] / executed) * 100) : 0,
	};
}

/**
 * 解析对话里那行机器可读锚点：
 *   `<!-- data-space: revision=49 cases=id1,id2 -->`
 * 模型可以直接把锚点整段回传，省得自己挑 id；解析失败返回空，由调用方走别的参数。
 */
export function parseAnchor(text) {
	const src = String(text ?? "");
	const m = /<!--\s*data-space:([\s\S]*?)-->/i.exec(src);
	if (!m) return { ids: [], revision: 0 };
	const body = m[1];
	const rev = /revision\s*=\s*(\d+)/i.exec(body);
	const ids = /cases\s*=\s*([^\s]+)/i.exec(body);
	return {
		ids: ids
			? ids[1]
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean)
			: [],
		revision: rev ? Number(rev[1]) : 0,
	};
}
