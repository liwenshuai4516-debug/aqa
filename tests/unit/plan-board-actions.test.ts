import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanBoard } from "../../web/src/components/PlanBoard.js";
import { LanguageProvider } from "../../web/src/i18n.js";

function render(planMode: boolean, streaming: boolean) {
	return renderToStaticMarkup(
		createElement(
			LanguageProvider,
			null,
			createElement(PlanBoard, {
				plan: { steps: [{ id: "check", title: "Check environment", status: "in_progress" }], activeStepId: "check" },
				planMode,
				streaming,
			}),
		),
	);
}

describe("Plan board implementation entry", () => {
	it("keeps progress visible without an implementation entry during normal execution", () => {
		const html = render(false, true);
		expect(html).toContain("Check environment");
		expect(html).not.toContain('class="plan-board-implement"');
	});
	it("does not offer to restart a normal task after the agent stops", () => {
		expect(render(false, false)).not.toContain('class="plan-board-implement"');
	});
	it("waits for planning to finish before offering implementation", () => {
		expect(render(true, true)).not.toContain('class="plan-board-implement"');
		expect(render(true, false)).toContain('class="plan-board-implement"');
	});
});
