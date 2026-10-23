/// <reference lib="dom" />
/**
 * 插件工具**自带的展示名**（`tool.label`）目录。
 *
 * 背景：工具卡抬头原来只认机器名（`api_test_execute` / `browser_use`），中文界面靠
 * `tool-labels.ts` 里的一张手写表兜底。插件注册工具时本来就能写 `label`（宿主会
 * 把它带进 `plugins` 消息的 `agentTools[].label`，设置面板与 `tool_info` 都在用），
 * 但卡片渲染没有读它 —— 插件写的中文名一直停留在设置页里。
 *
 * 这里把「插件清单 → 工具名到展示名的目录」收成模块级 store：
 *  - 数据源只有现成的 `plugins` 消息（`UiPluginInfo[].agentTools[]`），**不加协议字段、
 *    不改快照载荷**：卡片的展示名按工具名解析，历史消息同样适用；
 *  - 目录变了（装/卸/重载插件、逐工具启停后重新广播）才替换引用并通知，避免
 *    `useSyncExternalStore` 每次快照都判定「变了」而反复重渲染；
 *  - 只做展示：工具真实名仍是 `UiToolCallBlock.name`，审批判定、权限匹配、插件登记
 *    与系统提示词都不受影响。
 */
import { useSyncExternalStore } from "react";
import type { UiPluginInfo } from "./types";

/** 空目录（未加载任何插件工具时 `getSnapshot` 必须稳定返回同一引用）。 */
const EMPTY: ReadonlyMap<string, string> = new Map();

let catalog: ReadonlyMap<string, string> = EMPTY;

const listeners = new Set<() => void>();

function notify(): void {
	for (const l of listeners) l();
}

/**
 * 从插件清单里收集「工具名 → 自带展示名」。
 *
 * 规则（单测覆盖）：
 *  - 工具名或标签为空/全空白 → 跳过（不能出现空标题）；
 *  - 标签与机器名相同 → 跳过（等于没起名字，交给静态表/原名回退）；
 *  - 同名工具先到先得（宿主本来就不允许两个插件注册同名工具，这里只保证结果确定）；
 *  - 输出按工具名排序的 Map，便于比对与断言。
 */
export function collectToolLabels(plugins: readonly UiPluginInfo[] | null | undefined): Map<string, string> {
	const found = new Map<string, string>();
	for (const p of plugins ?? []) {
		for (const tool of p?.agentTools ?? []) {
			const name = typeof tool?.name === "string" ? tool.name.trim() : "";
			const label = typeof tool?.label === "string" ? tool.label.trim() : "";
			if (!name || !label || label === name) continue;
			if (!found.has(name)) found.set(name, label);
		}
	}
	const sorted = new Map<string, string>();
	for (const name of [...found.keys()].sort()) sorted.set(name, found.get(name)!);
	return sorted;
}

function sameCatalog(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
	if (a === b) return true;
	if (a.size !== b.size) return false;
	for (const [name, label] of a) if (b.get(name) !== label) return false;
	return true;
}

/**
 * 用最新的插件清单刷新目录（由 App 在 `plugins` 消息变化时调用）。
 *
 * 内容没变时不替换引用、不通知 —— `plugins` 消息在插件状态下会重复广播，而这条
 * store 被每一张工具卡订阅。
 */
export function setPluginToolLabels(plugins: readonly UiPluginInfo[] | null | undefined): void {
	const next = collectToolLabels(plugins);
	if (sameCatalog(catalog, next)) return;
	catalog = next.size > 0 ? next : EMPTY;
	notify();
}

/** 当前目录（引用稳定，可直接作为 `useSyncExternalStore` 的快照）。 */
export function getToolLabelCatalog(): ReadonlyMap<string, string> {
	return catalog;
}

/** 单个工具的插件自带名；没有则 undefined（交给静态表/原名回退）。 */
export function getToolLabel(name: string | null | undefined): string | undefined {
	const key = typeof name === "string" ? name.trim() : "";
	return key ? catalog.get(key) : undefined;
}

/** 订阅目录变化。返回退订函数。 */
export function subscribeToolLabels(cb: () => void): () => void {
	listeners.add(cb);
	return () => {
		listeners.delete(cb);
	};
}

/** 仅供单测：清空目录（不通知订阅者），避免用例互相串。 */
export function resetToolLabelCatalog(): void {
	catalog = EMPTY;
}

/** React hook：卡片里取插件自带展示名（目录更新后自动重渲染）。 */
export function useToolLabel(name: string | null | undefined): string | undefined {
	const map = useSyncExternalStore(subscribeToolLabels, getToolLabelCatalog, getToolLabelCatalog);
	const key = typeof name === "string" ? name.trim() : "";
	return key ? map.get(key) : undefined;
}
