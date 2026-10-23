/** Projection only: intake order is not native approval, semantic revision order or execution status. */
export function versionIndex(cases) {
	const index = new Map(),
		families = new Map();
	for (const c of cases) {
		const n = c.nativeSource;
		const info = { recent: true, grouped: false, revision: n?.revision ?? c.automation?.revision ?? "" };
		index.set(c.id, info);
		if (
			!n ||
			n.featureId !== c.featureId ||
			![n.workspace, n.engine, n.projectId, n.envId, n.lineageId, n.nativeCaseId].every(
				(v) => typeof v === "string" && v,
			) ||
			!Number.isSafeInteger(n.intakeRevision) ||
			n.intakeRevision < 1
		)
			continue;
		const key = JSON.stringify([n.workspace, n.engine, n.projectId, n.envId, n.lineageId, n.nativeCaseId, c.featureId]);
		const family = families.get(key) ?? [];
		family.push({ info, order: n.intakeRevision });
		families.set(key, family);
	}
	for (const family of families.values()) {
		const latest = Math.max(...family.map((v) => v.order));
		for (const { info, order } of family) {
			info.grouped = true;
			info.recent = order === latest;
		}
	}
	return index;
}
export function filterVersions(cases, mode, all = cases) {
	if (mode === "all") return cases;
	const index = versionIndex(all);
	return cases.filter((c) => index.get(c.id)?.recent !== false);
}
const labels = {
	source: ["原生来源与修订", "Native source and revision"],
	recent: ["最近入库版本", "Latest imported revisions"],
	all: ["全部版本（含历史）", "All revisions (including history)"],
	revision: ["修订", "Revision"],
	history: ["历史入库版本", "Historical imported revision"],
	unknown: ["版本关系未确认", "Revision relationship unverified"],
	hint: [
		"按同一原生资产的入库顺序展示；不代表原生最新、批准或已执行。旧数据缺少关系时全部保留。",
		"Uses intake order within one native asset; does not imply the latest native version, approval or execution. Unverified relationships remain visible.",
	],
};
export function versionText(key) {
	const en = typeof document !== "undefined" && document.documentElement.lang.startsWith("en");
	return labels[key][en ? 1 : 0];
}
