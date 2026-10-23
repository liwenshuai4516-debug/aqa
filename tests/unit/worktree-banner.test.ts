// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { WorktreeBanner } from "../../web/src/components/WorktreeBanner.js";
import { LanguageProvider } from "../../web/src/i18n.js";
import type { LinkedWorktreeEntry, WorktreeInfo } from "../../web/src/types.js";

/**
 * 工作树横幅删除守卫：服务端对含未提交修改的工作树要求 force=true，界面必须在
 * 二次确认后真的带上该参数，否则点垃圾桶只会一直报「包含未提交的文件修改」。
 */

let root: Root | null = null;

function mount(worktree: WorktreeInfo, onRemove: (path: string, force?: boolean) => void) {
	window.localStorage.setItem("pi-web-ui:lang", "zh");
	const container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	act(() => {
		root!.render(
			createElement(
				LanguageProvider,
				null,
				createElement(WorktreeBanner, { worktree, onSwitch: () => {}, onRemove }),
			),
		);
	});
	return container;
}

function linked(overrides: Partial<LinkedWorktreeEntry> = {}): LinkedWorktreeEntry {
	return {
		path: "/repo/.worktrees/tool-context-budget",
		branch: "(detached)",
		isCurrent: false,
		isMain: false,
		isDirty: false,
		uncommittedCount: 0,
		...overrides,
	};
}

/** 主仓库视角：名下有 1 个关联工作树。 */
function mainRepo(entry: LinkedWorktreeEntry): WorktreeInfo {
	return {
		isLinkedWorktree: false,
		currentPath: "/repo",
		branch: "master",
		mainPath: "/repo",
		mainBranch: "master",
		linkedWorktrees: [entry],
	};
}

/** 当前就在该关联工作树内。 */
function insideLinkedWorktree(entry: LinkedWorktreeEntry): WorktreeInfo {
	return {
		isLinkedWorktree: true,
		currentPath: entry.path,
		branch: entry.branch,
		mainPath: "/repo",
		mainBranch: "master",
		linkedWorktrees: [entry],
	};
}

function clickRemove(container: HTMLElement, index = 0) {
	const buttons = container.querySelectorAll<HTMLButtonElement>(".worktree-banner-btn.danger");
	expect(buttons.length).toBeGreaterThan(index);
	act(() => {
		buttons[index].dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
}

afterEach(() => {
	if (root) act(() => root!.unmount());
	root = null;
	document.body.innerHTML = "";
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("工作树横幅删除确认", () => {
	it("干净的工作树一次确认即删除，不带 force", () => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
		const onRemove = vi.fn();
		const container = mount(mainRepo(linked()), onRemove);

		clickRemove(container);

		expect(confirm).toHaveBeenCalledTimes(1);
		expect(onRemove).toHaveBeenCalledWith("/repo/.worktrees/tool-context-budget");
	});

	it("有未提交修改时二次确认后带 force 删除", () => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
		const onRemove = vi.fn();
		const container = mount(mainRepo(linked({ isDirty: true, uncommittedCount: 15 })), onRemove);

		clickRemove(container);

		expect(confirm).toHaveBeenCalledTimes(2);
		expect(confirm.mock.calls[1][0]).toContain("15");
		expect(onRemove).toHaveBeenCalledTimes(1);
		expect(onRemove).toHaveBeenCalledWith("/repo/.worktrees/tool-context-budget", true);
	});

	it("第二次确认取消时不发送删除请求", () => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true).mockReturnValueOnce(false);
		const onRemove = vi.fn();
		const container = mount(mainRepo(linked({ isDirty: true, uncommittedCount: 3 })), onRemove);

		clickRemove(container);

		expect(confirm).toHaveBeenCalledTimes(2);
		expect(onRemove).not.toHaveBeenCalled();
	});

	it("第一次确认取消时既不删也不追问强制删除", () => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
		const onRemove = vi.fn();
		const container = mount(mainRepo(linked({ isDirty: true, uncommittedCount: 3 })), onRemove);

		clickRemove(container);

		expect(confirm).toHaveBeenCalledTimes(1);
		expect(onRemove).not.toHaveBeenCalled();
	});

	it("当前就在脏工作树内时同样走二次确认并带 force", () => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
		const onRemove = vi.fn();
		const entry = linked({ isCurrent: true, isDirty: true, uncommittedCount: 2 });
		const container = mount(insideLinkedWorktree(entry), onRemove);

		clickRemove(container);

		expect(confirm).toHaveBeenCalledTimes(2);
		expect(onRemove).toHaveBeenCalledWith(entry.path, true);
	});

	it("脏状态但未给计数时二次确认仍带 force（计数回退为 1）", () => {
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
		const onRemove = vi.fn();
		const container = mount(mainRepo(linked({ isDirty: true, uncommittedCount: undefined })), onRemove);

		clickRemove(container);

		expect(confirm).toHaveBeenCalledTimes(2);
		expect(confirm.mock.calls[1][0]).toContain("1");
		expect(onRemove).toHaveBeenCalledWith("/repo/.worktrees/tool-context-budget", true);
	});
});
