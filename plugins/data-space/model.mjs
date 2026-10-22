/**
 * 数据空间的数据模型：常量、清洗、旧库迁移。
 *
 * 结构（version 2）：
 *   systems  -> modules(systemId) -> features(moduleId) -> cases(featureId)
 *   datasets(featureId?)  用例可用 datasetIds 引用数据集
 * 层级一律扁平父引用：搜索、移动、导入导出都比嵌套树简单，悬空引用在清洗时统一处理。
 */
import { randomUUID } from "node:crypto";

/** 单文件上限，防止一份畸形 store 把页面顶爆（演示版够用，真实数据量大再拆文件）。 */
export const MAX = {
	systems: 60,
	modules: 240,
	features: 720,
	cases: 3000,
	datasets: 500,
	records: 200,
	steps: 60,
	tags: 12,
	linked: 20,
};

export const COLORS = ["blue", "green", "amber", "purple", "gray", "teal", "red"];
export const PRIORITIES = ["P0", "P1", "P2", "P3"];
/**
 * 用例类型：当前只做「接口 / UI」两类。
 * 追加新类型（性能、兼容、安全……）时只改这一行，服务端会把清单下发给页面，
 * 类型筛选、下拉与徽章都从这份清单取；旧数据里已有的其他类型不会被改写。
 */
export const CASE_TYPES = ["接口", "UI"];
export const CASE_STATUS = ["草稿", "待评审", "已评审", "已废弃"];
export const ENVS = ["本地", "测试环境", "预发环境", "生产"];

const COLOR_SET = new Set(COLORS);
const PRIORITY_SET = new Set(PRIORITIES);
const STATUS_SET = new Set(CASE_STATUS);
const ENV_SET = new Set(ENVS);

export const now = () => new Date().toISOString();
export const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
export const uid = () => randomUUID();

function strList(v, max, len) {
	return [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, len)).filter(Boolean))].slice(0, max);
}

function oneOf(v, set, fallback) {
	const s = str(v, 20);
	return set.has(s) ? s : fallback;
}

/** 0.1.0 的 groups + datasets：分组升级为系统，数据集归属留空，原数据一条不丢。 */
export function migrateLegacy(parsed) {
	const t = now();
	const prevDatasets = Array.isArray(parsed?.datasets) ? parsed.datasets : [];
	const systems = (Array.isArray(parsed?.groups) ? parsed.groups : []).map((g) => {
		const go = g && typeof g === "object" ? g : {};
		return {
			id: str(go.id, 64) || uid(),
			name: str(go.name, 60) || "未命名系统",
			code: "",
			color: COLOR_SET.has(go.color) ? go.color : "blue",
			note: str(go.note, 200),
			createdAt: str(go.createdAt, 40) || t,
		};
	});
	return {
		systems,
		modules: [],
		features: [],
		cases: [],
		datasets: prevDatasets.map((d) => ({ ...(d && typeof d === "object" ? d : {}), featureId: "" })),
		migratedFrom: 1,
	};
}

/** 收进来的任何东西都必须先过这里：丢掉未知字段、截断长度、补 id、清掉悬空父引用。 */
export function normalizeStore(raw, previous) {
	const o = raw && typeof raw === "object" ? raw : {};
	const prevCases = new Map((previous?.cases ?? []).map((c) => [c.id, c]));
	const prevDatasets = new Map((previous?.datasets ?? []).map((d) => [d.id, d]));

	const seen = new Set();
	const dedupe = (id) => {
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	};

	const systems = (Array.isArray(o.systems) ? o.systems : [])
		.slice(0, MAX.systems)
		.map((s) => {
			const so = s && typeof s === "object" ? s : {};
			return {
				id: str(so.id, 64) || uid(),
				name: str(so.name, 60) || "未命名系统",
				code: str(so.code, 12).toUpperCase(),
				color: oneOf(so.color, COLOR_SET, "blue"),
				note: str(so.note, 300),
				createdAt: str(so.createdAt, 40) || now(),
			};
		})
		.filter((s) => dedupe(`s:${s.id}`));
	const systemIds = new Set(systems.map((s) => s.id));

	const modules = (Array.isArray(o.modules) ? o.modules : [])
		.slice(0, MAX.modules)
		.map((m) => {
			const mo = m && typeof m === "object" ? m : {};
			return {
				id: str(mo.id, 64) || uid(),
				systemId: str(mo.systemId, 64),
				name: str(mo.name, 60) || "未命名模块",
				note: str(mo.note, 300),
				createdAt: str(mo.createdAt, 40) || now(),
			};
		})
		.filter((m) => systemIds.has(m.systemId) && dedupe(`m:${m.id}`));
	const moduleIds = new Set(modules.map((m) => m.id));

	const features = (Array.isArray(o.features) ? o.features : [])
		.slice(0, MAX.features)
		.map((f) => {
			const fo = f && typeof f === "object" ? f : {};
			return {
				id: str(fo.id, 64) || uid(),
				moduleId: str(fo.moduleId, 64),
				name: str(fo.name, 60) || "未命名功能",
				note: str(fo.note, 300),
				createdAt: str(fo.createdAt, 40) || now(),
			};
		})
		.filter((f) => moduleIds.has(f.moduleId) && dedupe(`f:${f.id}`));
	const featureIds = new Set(features.map((f) => f.id));

	const cases = (Array.isArray(o.cases) ? o.cases : [])
		.slice(0, MAX.cases)
		.map((c) => {
			const co = c && typeof c === "object" ? c : {};
			const id = str(co.id, 64) || uid();
			const steps = (Array.isArray(co.steps) ? co.steps : [])
				.slice(0, MAX.steps)
				.map((s) => {
					const so = s && typeof s === "object" ? s : {};
					return {
						id: str(so.id, 64) || uid(),
						action: typeof so.action === "string" ? so.action.slice(0, 1000) : "",
						expect: typeof so.expect === "string" ? so.expect.slice(0, 1000) : "",
					};
				})
				.filter((s) => s.action || s.expect);
			return {
				id,
				featureId: featureIds.has(str(co.featureId, 64)) ? str(co.featureId, 64) : "",
				code: str(co.code, 24),
				title: str(co.title, 160) || "未命名用例",
				priority: oneOf(co.priority, PRIORITY_SET, "P2"),
				// 类型是开放词表：只补默认值、不改写未知类型（后续加类型不丢历史数据）。
				type: str(co.type, 20) || CASE_TYPES[0],
				status: oneOf(co.status, STATUS_SET, "草稿"),
				owner: str(co.owner, 40),
				tags: strList(co.tags, MAX.tags, 24),
				preconditions: typeof co.preconditions === "string" ? co.preconditions.slice(0, 2000) : "",
				steps,
				datasetIds: strList(co.datasetIds, MAX.linked, 64),
				note: typeof co.note === "string" ? co.note.slice(0, 2000) : "",
				createdAt: str(co.createdAt, 40) || prevCases.get(id)?.createdAt || now(),
				updatedAt: str(co.updatedAt, 40) || now(),
			};
		})
		.filter((c) => dedupe(`c:${c.id}`));

	const datasets = (Array.isArray(o.datasets) ? o.datasets : [])
		.slice(0, MAX.datasets)
		.map((d) => {
			const dobj = d && typeof d === "object" ? d : {};
			const id = str(dobj.id, 64) || uid();
			const records = (Array.isArray(dobj.records) ? dobj.records : [])
				.slice(0, MAX.records)
				.map((r) => {
					const ro = r && typeof r === "object" ? r : {};
					return {
						id: str(ro.id, 64) || uid(),
						key: str(ro.key, 80),
						value: typeof ro.value === "string" ? ro.value.slice(0, 4000) : "",
						remark: str(ro.remark, 200),
					};
				})
				.filter((r) => r.key || r.value || r.remark);
			return {
				id,
				featureId: featureIds.has(str(dobj.featureId, 64)) ? str(dobj.featureId, 64) : "",
				name: str(dobj.name, 80) || "未命名数据集",
				env: ENV_SET.has(str(dobj.env, 20)) ? str(dobj.env, 20) : "",
				tags: strList(dobj.tags, MAX.tags, 24),
				note: typeof dobj.note === "string" ? dobj.note.slice(0, 2000) : "",
				records,
				createdAt: str(dobj.createdAt, 40) || prevDatasets.get(id)?.createdAt || now(),
				updatedAt: str(dobj.updatedAt, 40) || now(),
			};
		})
		.filter((d) => dedupe(`d:${d.id}`));

	// 用例引用的数据集必须真实存在（否则页面会显示空引用）。
	const datasetIds = new Set(datasets.map((d) => d.id));
	for (const c of cases) c.datasetIds = c.datasetIds.filter((id) => datasetIds.has(id));

	return {
		systems,
		modules,
		features,
		cases,
		datasets,
		migratedFrom: Number(o.migratedFrom) || 0,
	};
}
