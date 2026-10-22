// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ModelTiming } from "../../web/src/components/ModelTiming.js";
import { LanguageProvider } from "../../web/src/i18n.js";

let root: Root | undefined;
afterEach(() => {
	act(() => root?.unmount());
	document.body.innerHTML = "";
	vi.useRealTimers();
});
it("updates elapsed time while running, settles to SDK timing, and clears its timer", () => {
	vi.useFakeTimers();
	vi.setSystemTime(10000);
	const container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	const render = (streaming: boolean, durationMs?: number) =>
		act(() =>
			root!.render(
				createElement(LanguageProvider, null, createElement(ModelTiming, { streaming, timestamp: 8000, durationMs })),
			),
		);
	render(true);
	expect(container.textContent).toContain("2.0s");
	act(() => vi.advanceTimersByTime(2000));
	expect(container.textContent).toContain("4.0s");
	render(false, 3995);
	expect(container.textContent).toContain("4.0s");
	expect(vi.getTimerCount()).toBe(0);
	render(false);
	expect(container.textContent).toBe("");
});
it("never shows invalid or unavailable historical measurements", () => {
	const container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	for (const durationMs of [undefined, NaN, Infinity, -1]) {
		act(() =>
			root!.render(createElement(LanguageProvider, null, createElement(ModelTiming, { streaming: false, durationMs }))),
		);
		expect(container.textContent).toBe("");
	}
});
