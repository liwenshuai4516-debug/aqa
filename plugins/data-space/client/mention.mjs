/**
 * `@` 提及提供者：在对话输入框里打 `@` 就能点名用例 / 功能 / 模块（v2）。
 *
 * 与面板按钮的分工：
 *   - 面板「引入对话」= 批量、带全文（卡片 / 清单 / 引用档）；
 *   - `@` = 临时点名一条（或整功能 / 整模块），只插入一行轻引用 —— 例如
 *     `「用例 PMS-004 · 新建经营合同」`。明细由 AI 用 data_space_cases 按编号拉，
 *     不把步骤全塞进输入框（一个功能 30 条内联就是几万字）。
 *
 * 数据来源：
 *   - 页面已加载过 → 直接用 S（和用例库同一份，刚改完立刻搜得到）；
 *   - 没打开过数据空间页 → 自己取一次 /state 并缓存 8 秒（打 @ 时零等待；过期先回旧值再后台刷新）。
 *   - 插件被禁用后路由不可用 → 返回空数组，不抛错（宿主按空结果处理）。
 */
import { BASE, S, buildRunIndex, isRunStale } from "./state.mjs";

export const PROVIDER_ID = "data-space:cases";
export const PROVIDER_LABEL = "数据空间用例";
const CACHE_MS = 8000;
const MAX_HITS = 8;
const MAX_CASES = 6;

let cache = { at: 0, store: null };
let inflight = null;

const oneline = (v) =>
	String(v ?? "")
		.replace(/\s*\n+\s*/g, " ")
		.trim();

/** 没打开过页面时自己取一份快照（8 秒缓存；失败回空，不打断补全）。 */
async function remoteStore() {
	if (cache.store && Date.now() - cache.at < CACHE_MS) return cache.store;
	if (!inflight) {
		inflight = (async () => {
			try {
				const r = await fetch(`${BASE}/state`, { cache: "no-store" });
				const d = await r.json();
				if (!d?.ok) return cache.store;
				cache = {
					at: Date.now(),
					store: {
						systems: d.systems ?? [],
						modules: d.modules ?? [],
						features: d.features ?? [],
						cases: d.cases ?? [],
						envs: d.envs ?? [],
						runs: d.runs ?? [],
						revision: d.revision ?? 0,
					},
				};
				return cache.store;
			} catch {
				return cache.store;
			} finally {
				inflight = null;
			}
		})();
	}
	return inflight;
}

function storeNow() {
	return S.loaded ? S : cache.store;
}

/** 当前数据（页面已加载用页面的；否则取缓存 / 网络）。 */
async function currentStore() {
	if (S.loaded) return S;
	const cached = storeNow();
	if (cached && Date.now() - cache.at < CACHE_MS) return cached;
	// 有旧缓存就先回旧的（补全不能等网络），同时后台刷新下一次用
	if (cached) void remoteStore();
	return (await Promise.race([remoteStore(), new Promise((r) => setTimeout(() => r(cached), 1200))])) ?? cached;
}

function pathOf(store, featureId) {
	const f = (store.features ?? []).find((x) => x.id === featureId);
	if (!f) return { path: "", feature: null, module: null, system: null };
	const m = (store.modules ?? []).find((x) => x.id === f.moduleId);
	const s = m ? (store.systems ?? []).find((x) => x.id === m.systemId) : null;
	return { path: [s?.name, m?.name, f.name].filter(Boolean).join(" / "), feature: f, module: m, system: s };
}

/** 用例 → 一行命中（text 是写进输入框的轻引用）。 */
function caseHit(store, c, q, runIndex) {
	const { path } = pathOf(store, c.featureId);
	const hit = resultOf2(runIndex, c);
	const meta = [c.type || "未分类", c.priority, c.status].filter(Boolean).join(" · ");
	const hint = [path || "未归类", meta, hit ? `最近 ${hit.run.verdict}${hit.stale ? "（已过期）" : ""}` : ""]
		.filter(Boolean)
		.join(" · ");
	const code = oneline(c.code);
	return {
		title: `${code || "（无编号）"} · ${oneline(c.title)}`,
		hint,
		text: `「用例 ${code ? `${code} · ` : ""}${oneline(c.title)}」`,
		rank: 0,
		code: code.toLowerCase(),
		titleLower: oneline(c.title).toLowerCase(),
		q,
	};
}

function resultOf2(runIndex, c) {
	const run = runIndex?.get(c.id) ?? null;
	return run ? { run, stale: isRunStale(run, c) } : null;
}

function featureHit(store, f) {
	const { path, module, system } = pathOf(store, f.id);
	const n = (store.cases ?? []).filter((c) => c.featureId === f.id).length;
	if (!n) return null;
	return {
		title: `功能 · ${oneline(f.name)}`,
		hint: `${path} · ${n} 条用例`,
		text: `「功能 ${oneline(f.name)}（${system?.name || ""}${module?.name ? ` / ${module.name}` : ""}）的全部 ${n} 条用例」`,
		rank: 1,
	};
}

function moduleHit(store, m) {
	const fids = new Set((store.features ?? []).filter((f) => f.moduleId === m.id).map((f) => f.id));
	const n = (store.cases ?? []).filter((c) => fids.has(c.featureId)).length;
	if (!n) return null;
	const s = (store.systems ?? []).find((x) => x.id === m.systemId);
	return {
		title: `模块 · ${oneline(m.name)}`,
		hint: `${s?.name || ""} · ${n} 条用例`,
		text: `「模块 ${oneline(m.name)}（${s?.name || ""}）的全部 ${n} 条用例」`,
		rank: 2,
	};
}

/** 排序：编号精确 > 编号前缀 > 编号包含 > 标题包含 > 其他字段命中。 */
function scoreCase(hit, q) {
	if (!q) return 9;
	if (hit.code === q) return 0;
	if (hit.code.startsWith(q)) return 1;
	if (hit.code.includes(q)) return 2;
	if (hit.titleLower.startsWith(q)) return 3;
	if (hit.titleLower.includes(q)) return 4;
	return 5;
}

/**
 * 纯函数：拿一份 store 和一个查询串，回 `@` 命中列表（供单测直接喂数据）。
 * 空查询只列最近更新的用例（刚改完的最容易想起来）。
 */
export function searchMentions(store, query, limit = MAX_HITS) {
	const src = store ?? { systems: [], modules: [], features: [], cases: [] };
	const q = oneline(query).toLowerCase();
	const runIndex = src.runs?.length ? buildRunIndex(src.runs) : S.runIndex;
	if (!q) {
		return [...(src.cases ?? [])]
			.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
			.slice(0, Math.min(MAX_CASES, limit))
			.map((c) => caseHit(src, c, q, runIndex))
			.map(({ title, hint, text }) => ({ title, hint, text }));
	}

	const cases = (src.cases ?? []).filter((c) => {
		const hay = [c.code, c.title, c.type, c.status, c.owner, ...(c.tags ?? []), pathOf(src, c.featureId).path]
			.join(" ")
			.toLowerCase();
		return hay.includes(q);
	});
	const scored = cases
		.map((c) => caseHit(src, c, q, runIndex))
		.sort((a, b) => scoreCase(a, q) - scoreCase(b, q) || a.code.localeCompare(b.code) || a.title.localeCompare(b.title))
		.slice(0, MAX_CASES);

	const scopes = [];
	const feats = (src.features ?? []).filter((f) => oneline(f.name).toLowerCase().includes(q));
	const mods = (src.modules ?? []).filter((m) => oneline(m.name).toLowerCase().includes(q));
	// 功能名命中优先于模块名（模块命中时往往已经能在功能里找到更精确的范围）
	for (const f of feats) {
		const hit = featureHit(src, f);
		if (hit) scopes.push(hit);
		if (scopes.length >= 2) break;
	}
	if (scopes.length < 2) {
		for (const m of mods) {
			const hit = moduleHit(src, m);
			if (hit && !scopes.some((s) => s.title.endsWith(m.name))) scopes.push(hit);
			if (scopes.length >= 2) break;
		}
	}

	return [...scored, ...scopes].slice(0, Math.max(1, limit)).map(({ title, hint, text }) => ({ title, hint, text }));
}

/** 真正的 search：先取数据，再走纯函数。宿主 2 秒超时，这里不抛错。 */
export async function searchCases(query) {
	try {
		const store = await currentStore();
		if (!store) return [];
		return searchMentions(store, query);
	} catch {
		return [];
	}
}

/** 注册到宿主（同 id 重复注册会覆盖，插件重载后依然只有一条）。 */
export function registerCaseMention() {
	try {
		const host = globalThis.__piWebUiHost;
		if (!host?.composerProviders?.register) return false;
		host.composerProviders.register({ id: PROVIDER_ID, label: PROVIDER_LABEL, search: (q) => searchCases(q) });
		return true;
	} catch {
		return false;
	}
}

/** 让下一次 `@` 一定取最新数据（页面保存 / 回写结果后调用）。 */
export function invalidateMentionCache() {
	cache = { at: 0, store: null };
}

/** 测试用：清掉模块级缓存，避免用例之间互相污染。 */
export function __resetMentionCache() {
	cache = { at: 0, store: null };
	inflight = null;
}
