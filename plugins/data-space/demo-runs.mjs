/**
 * 示例执行记录生成器（演示用）。
 *
 * 为什么单独一个生成器、而不是塞进 seed：
 *   - 用例是「资产」，执行记录是「台账」。资产可以送示例，台账里塞假结论容易被当成真实结论，
 *     所以只在页面显式点「载入示例记录」时生成，而且只允许在空台账上载入（见 index.mjs 的路由）。
 *   - 生成器按当前库里真实的用例（编号 / 功能）来编，换一份用例库也不会造出孤儿记录。
 *
 * 编出来的样子（够看出页面所有形态）：
 *   - 三个批量任务（AI 回写）：一批里有通过 / 失败 / 阻塞，另有「失败后复测转通过」的追加记录；
 *   - 两条手工登记的单条记录（不构成任务）；
 *   - 一条「结论可能过期」：记录时用例版本比现在旧（演示过期降级）。
 *
 * 记录形状与 runs.mjs 完全一致：{ id, caseId, code, verdict, note, at, source, caseUpdatedAt, taskId, taskName }
 */
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 备注按结论分池，取模挑选：同样的用例库每次生成同样的内容，测试可预期。 */
const NOTES = {
	通过: [
		"按用例步骤逐条执行，实际结果与预期一致",
		"回归通过，未发现退化",
		"边界值复测通过，边界外仍被正确拦截",
		"前置条件补齐后通过，耗时 2s 内",
	],
	失败: [
		"实际结果与预期不一致：接口返回 500，参数校验未生效",
		"期望被拦截，实际返回 201 并落库，缺必填校验",
		"页面提示成功但列表未刷新，查库确认未写入",
	],
	阻塞: ["测试环境前置数据未就绪，本轮无法验证，待数据补齐重跑", "依赖的模拟器不可用，先标记阻塞"],
};

const pickNote = (verdict, seed) => {
	const pool = NOTES[verdict] ?? NOTES.通过;
	return pool[seed % pool.length];
};

/** 按功能分组：一个功能一批，正好对应「按任务看整批结论」。组内按编号排序保证稳定。 */
function groupByFeature(cases) {
	const map = new Map();
	for (const c of cases) {
		const key = String(c.featureId || "");
		const g = map.get(key) ?? { featureId: key, cases: [], used: false };
		g.cases.push(c);
		map.set(key, g);
	}
	const groups = [...map.values()];
	for (const g of groups) {
		g.cases.sort((a, b) => String(a.code || a.title).localeCompare(String(b.code || b.title)));
	}
	// 用例多的功能排在前面：优先把「一次跑一批」的效果演示出来
	groups.sort((a, b) => b.cases.length - a.cases.length || String(a.featureId).localeCompare(String(b.featureId)));
	return groups;
}

/**
 * 批次计划：size 取前几条、ago 相对现在的偏移、verdicts 逐条结论、
 * retest 指定「哪一条在批末复测转通过」、stale 指定「哪一条按旧版本记录」。
 */
const PLAN = [
	{ size: 4, ago: 2 * DAY + 2 * HOUR, verdicts: ["通过", "通过", "失败", "通过"], retest: 2, label: "P0 回归" },
	{ size: 2, ago: 1 * DAY + 3 * HOUR, verdicts: ["通过", "阻塞"], stale: 0, label: "冒烟", retest: -1 },
	{ size: 3, ago: 3 * HOUR, verdicts: ["通过", "通过", "通过"], retest: -1, label: "复测" },
];

/**
 * 生成示例流水。store 只需 cases / features（features 只用来取功能名做任务名）。
 * 用例不足时自然退化：组不够就少几个任务，一条用例也没有就返回空数组。
 */
export function buildDemoRuns(store, opts = {}) {
	const nowDate = opts.now instanceof Date ? opts.now : new Date(opts.now ?? Date.now());
	const clock = nowDate.getTime();
	const cases = (Array.isArray(store?.cases) ? store.cases : []).filter((c) => c?.id);
	if (!cases.length) return [];
	const featureNames = new Map((Array.isArray(store?.features) ? store.features : []).map((f) => [f.id, f.name]));

	const out = [];
	const used = new Set();
	let seq = 0;

	const push = (c, verdict, atMs, extra = {}) => {
		seq += 1;
		const iso = new Date(atMs).toISOString();
		const current = String(c.updatedAt || "");
		out.push({
			id: `demo-run-${seq}`,
			caseId: c.id,
			code: c.code || "",
			verdict,
			note: extra.note ?? pickNote(verdict, seq),
			at: iso,
			source: extra.source === "manual" ? "manual" : "ai",
			// 只有「当前用例版本确实晚于这次执行」才记旧版本，避免把不过期的记录标成过期
			caseUpdatedAt: extra.stale && current > iso ? iso : current,
			taskId: extra.taskId || "",
			taskName: extra.taskName || "",
		});
	};

	const groups = groupByFeature(cases);
	let gi = 0;
	PLAN.forEach((plan, pi) => {
		while (gi < groups.length && groups[gi].used) gi += 1;
		const group = groups[gi];
		if (!group) return;
		group.used = true;
		const picked = group.cases.filter((c) => !used.has(c.id)).slice(0, plan.size);
		if (!picked.length) return;

		const taskId = `demo-task-${pi + 1}`;
		const name = featureNames.get(group.featureId) || "";
		const taskName = name ? `${name} ${plan.label}` : `批量${plan.label} · 第 ${pi + 1} 批`;
		const baseAt = clock - plan.ago;

		picked.forEach((c, i) => {
			used.add(c.id);
			const atMs = baseAt + i * 4 * MINUTE;
			push(c, plan.verdicts[i] ?? "通过", atMs, {
				taskId,
				taskName,
				stale: plan.stale === i,
			});
		});

		// 复测：同一用例再登记一条通过，演示「只追加不改历史，最近一条才是现行结论」
		const retestCase = plan.retest >= 0 ? picked[plan.retest] : null;
		if (retestCase) {
			push(retestCase, "通过", baseAt + (picked.length + 1) * 4 * MINUTE, {
				taskId,
				taskName,
				note: "缺陷修复后复测通过（原失败记录保留在流水里）",
			});
		}
	});

	// 剩下的用例里挑两条做「手工单条登记」：不构成任务，结果页按单条分组
	cases
		.filter((c) => !used.has(c.id))
		.slice(0, 2)
		.forEach((c, i) => {
			push(c, i === 0 ? "失败" : "通过", clock - (5 + i * 21) * HOUR, { source: "manual" });
		});

	return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
