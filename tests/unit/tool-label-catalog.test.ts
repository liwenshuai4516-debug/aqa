// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	collectToolLabels,
	getToolLabel,
	getToolLabelCatalog,
	resetToolLabelCatalog,
	setPluginToolLabels,
	subscribeToolLabels,
} from "../../web/src/tool-label-catalog.js";
import type { UiPluginInfo } from "../../web/src/types.js";

/**
 * 插件自带展示名目录（`plugins` 消息 → 工具名到 label 的映射）：
 * 空值/同名标签不算起名、内容没变不重复通知、只读查询按名 trim 命中。
 */

function plugin(id: string, tools: Array<{ name: string; label?: string }>): UiPluginInfo {
	return { id, agentTools: tools } as unknown as UiPluginInfo;
}

afterEach(() => {
	resetToolLabelCatalog();
});

describe("collectToolLabels", () => {
	it("跨插件收集 label，并按工具名稳定排序", () => {
		const map = collectToolLabels([
			plugin("b", [{ name: "browser_use", label: "浏览器操作" }]),
			plugin("a", [
				{ name: "db_query", label: "分页查数据" },
				{ name: "db_exec", label: "执行 SQL" },
			]),
		]);
		expect([...map.keys()]).toEqual(["browser_use", "db_exec", "db_query"]);
		expect(map.get("db_exec")).toBe("执行 SQL");
	});

	it("空白标签、与机器名相同的标签、无名条目都跳过", () => {
		const map = collectToolLabels([
			plugin("p", [
				{ name: "no_label" },
				{ name: "blank", label: "   " },
				{ name: "same", label: "same" },
				{ name: "  spaced  ", label: "  取色  " },
				{ name: "", label: "没有名字" },
			]),
		]);
		expect([...map.keys()]).toEqual(["spaced"]);
		expect(map.get("spaced")).toBe("取色");
	});

	it("同名工具先到先得（宿主本身禁止重复注册，这里只保证结果确定）", () => {
		const map = collectToolLabels([
			plugin("a", [{ name: "dup", label: "先来的" }]),
			plugin("b", [{ name: "dup", label: "后来的" }]),
		]);
		expect(map.get("dup")).toBe("先来的");
	});

	it("没有插件 / 没有工具时返回空表", () => {
		expect(collectToolLabels(undefined).size).toBe(0);
		expect(collectToolLabels([]).size).toBe(0);
		expect(collectToolLabels([plugin("a", [])]).size).toBe(0);
	});
});

describe("setPluginToolLabels", () => {
	it("装载后可按名查询，且目录引用稳定（内容不变时不通知）", () => {
		const notify = vi.fn();
		const off = subscribeToolLabels(notify);
		try {
			setPluginToolLabels([plugin("a", [{ name: "db_exec", label: "执行 SQL" }])]);
			expect(notify).toHaveBeenCalledTimes(1);
			const first = getToolLabelCatalog();
			expect(getToolLabel("db_exec")).toBe("执行 SQL");
			expect(getToolLabel("  db_exec  ")).toBe("执行 SQL");
			expect(getToolLabel("missing")).toBeUndefined();
			expect(getToolLabel(undefined)).toBeUndefined();

			// 同一份内容的另一次广播：不替换引用、不通知（工具卡订阅的就是它）
			setPluginToolLabels([plugin("a", [{ name: "db_exec", label: "执行 SQL" }])]);
			expect(notify).toHaveBeenCalledTimes(1);
			expect(getToolLabelCatalog()).toBe(first);

			// 插件重载换了名字：替换引用并通知
			setPluginToolLabels([plugin("a", [{ name: "db_exec", label: "执行 SQL 语句" }])]);
			expect(notify).toHaveBeenCalledTimes(2);
			expect(getToolLabelCatalog()).not.toBe(first);
			expect(getToolLabel("db_exec")).toBe("执行 SQL 语句");
		} finally {
			off();
		}
	});

	it("插件全部卸载后回到空目录（查询一律 undefined）", () => {
		setPluginToolLabels([plugin("a", [{ name: "db_exec", label: "执行 SQL" }])]);
		setPluginToolLabels([]);
		expect(getToolLabelCatalog().size).toBe(0);
		expect(getToolLabel("db_exec")).toBeUndefined();
	});
});
