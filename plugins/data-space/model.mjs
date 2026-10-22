/**
 * 数据空间的数据模型：常量、清洗、旧库迁移。
 *
 * 结构（version 3）：
 *   systems -> modules(systemId) -> features(moduleId) -> cases(featureId)
 *   envs(systemId)  每个项目自己的地址簿（测试 / 预发 / 生产…），同项目恰好一个默认
 * 层级一律扁平父引用：搜索、移动、导入导出都比嵌套树简单，悬空引用在清洗时统一处理。
 */
import { createHash, randomUUID } from "node:crypto";

/** 单文件上限，防止一份畸形 store 把页面顶爆（演示版够用，真实数据量大再拆文件）。 */
export const MAX = {
	systems: 60,
	modules: 240,
	features: 720,
	cases: 3000,
	envs: 300,
	steps: 60,
	tags: 12,
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

const COLOR_SET = new Set(COLORS);
const PRIORITY_SET = new Set(PRIORITIES);
const STATUS_SET = new Set(CASE_STATUS);

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

/**
 * 0.1.0 的 groups + datasets：分组升级为系统。
 * 0.8.0 起不再有数据集，旧库里的 datasets 由 index.mjs 先备份再丢弃，这里只报个数。
 */
export function migrateLegacy(parsed) {
	const t = now();
	const droppedDatasets = Array.isArray(parsed?.datasets) ? parsed.datasets.length : 0;
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
		envs: [],
		droppedDatasets,
		migratedFrom: 1,
	};
}

/** 收进来的任何东西都必须先过这里：丢掉未知字段、截断长度、补 id、清掉悬空父引用。 */
export function normalizeStore(raw, previous) {
	const o = raw && typeof raw === "object" ? raw : {};
	const prevCases = new Map((previous?.cases ?? []).map((c) => [c.id, c]));
	const prevEnvs = new Map((previous?.envs ?? []).map((e) => [e.id, e]));

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
				note: typeof co.note === "string" ? co.note.slice(0, 2000) : "",
				automation: previous
					? (prevCases.get(co.id)?.automation ?? null)
					: co.automation && typeof co.automation === "object"
						? structuredClone(co.automation)
						: null,
				createdAt: prevCases.get(id)?.createdAt || str(co.createdAt, 40) || now(),
				updatedAt: str(co.updatedAt, 40) || now(),
			};
		})
		.filter((c) => dedupe(`c:${c.id}`));

	// Content changes always advance server-owned timestamps; unchanged content keeps its version.
	for (const c of cases) {
		const previousCase = prevCases.get(c.id);
		if (previousCase)
			c.updatedAt =
				caseFingerprint(c) === caseFingerprint(previousCase)
					? previousCase.updatedAt
					: new Date(Math.max(Date.now(), Date.parse(previousCase.updatedAt) + 1 || 0)).toISOString();
	}

	// 环境：项目自己的地址簿。悬空 systemId 丢掉；同项目恰好一个默认（先到先得，没标就把第一条设为默认）。
	const envs = (Array.isArray(o.envs) ? o.envs : [])
		.slice(0, MAX.envs)
		.map((e) => {
			const eo = e && typeof e === "object" ? e : {};
			const id = str(eo.id, 64) || uid();
			return {
				id,
				systemId: str(eo.systemId, 64),
				name: str(eo.name, 60) || "未命名环境",
				// 末尾多余的斜杠会让拼接出来的路径出现 `//`，存的时候就去掉。
				baseUrl: str(eo.baseUrl, 300).replace(/\/+$/, ""),
				note: str(eo.note, 300),
				isDefault: eo.isDefault === true || eo.isDefault === "true" || eo.isDefault === 1,
				createdAt: str(eo.createdAt, 40) || prevEnvs.get(id)?.createdAt || now(),
				updatedAt: str(eo.updatedAt, 40) || now(),
			};
		})
		.filter((e) => systemIds.has(e.systemId) && dedupe(`e:${e.id}`));

	// 每个项目只能有一个默认环境：同项目多个 isDefault 只认第一个，一个都没有就认第一条。
	const defaultSystems = new Set();
	for (const e of envs) {
		if (!e.isDefault) continue;
		if (defaultSystems.has(e.systemId)) e.isDefault = false;
		else defaultSystems.add(e.systemId);
	}
	for (const e of envs) {
		if (defaultSystems.has(e.systemId)) continue;
		e.isDefault = true;
		defaultSystems.add(e.systemId);
	}

	return {
		systems,
		modules,
		features,
		cases,
		envs,
		migratedFrom: Number(o.migratedFrom) || 0,
	};
}

/** Stable content identity; UI timestamps and automation associations are not approval. */
export function caseFingerprint(c) {
	return createHash("sha256")
		.update(JSON.stringify([c.featureId, c.code, c.title, c.type, c.preconditions, c.steps, c.note]))
		.digest("hex");
}
