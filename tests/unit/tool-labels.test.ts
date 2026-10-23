// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ThinkingBlock } from "../../web/src/components/ThinkingBlock.js";
import { ToolCallBlock } from "../../web/src/components/ToolCallBlock.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import { toolDisplayName, ZH_TOOL_LABELS } from "../../web/src/tool-labels.js";
import type { UiToolCallBlock } from "../../web/src/types.js";

/**
 * 工具卡展示名守卫：中文界面显示动作名（读取文件 / 执行命令 …），其余语言与
 * 未登记的工具一律回退机器名；`title` 上始终保留机器名，便于排查。
 */

let root: Root | null = null;

function mount(locale: string, child: ReturnType<typeof createElement>) {
	window.localStorage.setItem("pi-web-ui:lang", locale);
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root!.render(createElement(LanguageProvider, null, child));
	});
	return container;
}

function toolBlock(name: string): UiToolCallBlock {
	return { type: "toolCall", id: `call-${name}`, name, argumentsText: "{}" };
}

afterEach(() => {
	if (root) act(() => root!.unmount());
	root = null;
	document.body.innerHTML = "";
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("toolDisplayName", () => {
	it("中文界面（含 zh-Hant/zh-TW 等中文变体）取中文动作名", () => {
		expect(toolDisplayName("read", "zh")).toBe("读取文件");
		expect(toolDisplayName("bash", "zh")).toBe("执行命令");
		expect(toolDisplayName("grep", "zh-TW")).toBe("搜索内容");
	});

	it("非中文界面回退机器名", () => {
		expect(toolDisplayName("read", "en")).toBe("read");
		expect(toolDisplayName("bash", "ja")).toBe("bash");
		expect(toolDisplayName("read", undefined)).toBe("read");
	});

	it("未登记的工具（插件 / MCP 工具）回退机器名，不返回空串", () => {
		expect(toolDisplayName("mcp__demo__search", "zh")).toBe("mcp__demo__search");
		expect(toolDisplayName("some_plugin_tool", "zh")).toBe("some_plugin_tool");
		expect(toolDisplayName("", "zh")).toBe("");
	});

	it("映射表里没有空值，也没有与机器名同名的冗余条目", () => {
		for (const [name, label] of Object.entries(ZH_TOOL_LABELS)) {
			expect(label.trim(), `${name} 的展示名不能为空`).not.toBe("");
			expect(label, `${name} 的展示名不应与机器名相同`).not.toBe(name);
		}
	});
});

describe("卡片抬头渲染", () => {
	it("中文界面工具卡抬头显示中文名，title 保留机器名", () => {
		const container = mount(
			"zh",
			createElement(ToolCallBlock, {
				block: toolBlock("read"),
				view: { streaming: false },
			} as unknown as Parameters<typeof ToolCallBlock>[0]),
		);
		const nameEl = container.querySelector(".toolcall-name");
		expect(nameEl).not.toBeNull();
		const inner = nameEl!.querySelector("span[title='read']");
		expect(inner).not.toBeNull();
		expect(inner!.textContent?.trim()).toBe("读取文件");
		// 类名结构不变（样式与既有守卫依赖 .toolcall-name）
		expect(nameEl!.classList.contains("toolcall-name")).toBe(true);
	});

	it("英文界面保持机器名", () => {
		const container = mount(
			"en",
			createElement(ToolCallBlock, {
				block: toolBlock("read"),
				view: { streaming: false },
			} as unknown as Parameters<typeof ToolCallBlock>[0]),
		);
		const nameEl = container.querySelector(".toolcall-name");
		expect(nameEl!.textContent?.trim()).toBe("read");
	});

	it("思考卡抬头不再硬编码 think：中文显示 思考，英文显示 Thinking", () => {
		const zhContainer = mount(
			"zh",
			createElement(ThinkingBlock, { thinking: "先看日志", streaming: false, wrap: false }),
		);
		expect(zhContainer.querySelector(".thinking-name")!.textContent?.trim()).toBe("思考");

		act(() => root!.unmount());
		document.body.innerHTML = "";
		const enContainer = mount("en", createElement(ThinkingBlock, { thinking: "look", streaming: false, wrap: false }));
		expect(enContainer.querySelector(".thinking-name")!.textContent?.trim()).toBe("Thinking");
	});
});
