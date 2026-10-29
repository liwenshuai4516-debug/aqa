import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enableUiTesting } from "../../scripts/enable-ui-testing.mjs";
import { isUiTestingExtension } from "../../server/skill/skill-presentation.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("UI testing skill resource registration", () => {
	it("registers canonical app resources once and retains unrelated settings", async () => {
		const root = await mkdtemp(join(tmpdir(), "ui-maintenance-"));
		roots.push(root);
		const settings = join(root, "settings.json");
		await writeFile(settings, JSON.stringify({ theme: "light", extensions: ["another-extension"] }));
		await enableUiTesting(root, root);
		const first = await readFile(settings, "utf8");
		await enableUiTesting(root, root);
		expect(await readFile(settings, "utf8")).toBe(first);
		expect(JSON.parse(first)).toMatchObject({
			theme: "light",
			extensions: ["another-extension", join(root, ".pi/skills/ui-testing-workflow/assets/mcp-extension.mjs")],
			skills: [join(root, ".pi/skills/ui-testing-workflow")],
		});
	});

	it.each([false, true])("normalizes extension registrations and preserves filters (app=%s)", async (app) => {
		const root = await mkdtemp(join(tmpdir(), "ui-maintenance-"));
		roots.push(root);
		const path = (relative: string) => (app ? join(root, relative) : `../${relative}`);
		const legacy = path("capabilities/ui-testing/mcp-extension.mjs");
		const canonical = path(".pi/skills/ui-testing-workflow/assets/mcp-extension.mjs");
		if (!app) await enableUiTesting(root);
		const settings = join(root, app ? "settings.json" : ".pi/settings.json");
		const filtered = { source: canonical, extensions: [] };
		for (const [entries, expected] of [
			[[legacy], canonical],
			[[legacy, canonical], canonical],
			[[canonical, legacy], canonical],
			[[canonical], canonical],
			[[{ source: legacy, extensions: [] }], filtered],
			[[legacy, filtered], filtered],
			[[canonical, { source: legacy, extensions: [] }], filtered],
			[[filtered], filtered],
			[[join(root, "capabilities/ui-testing/mcp-extension.mjs"), canonical], canonical],
			[[join(root, ".pi/skills/ui-testing-workflow/assets/mcp-extension.mjs"), canonical], canonical],
		] as const) {
			const original = {
				extensions: ["another-extension", ...entries, { source: "other-extension", extensions: [] }],
				skills: [path("capabilities/ui-testing/ui-testing-workflow")],
				disabledTools: ["ui_test_run"],
			};
			await writeFile(settings, JSON.stringify(original));
			await enableUiTesting(root, app ? root : undefined);
			const first = await readFile(settings, "utf8");
			const actual = JSON.parse(first);
			expect(actual.extensions).toEqual(["another-extension", expected, { source: "other-extension", extensions: [] }]);
			expect(actual.skills).toEqual(original.skills);
			expect(actual.disabledTools).toEqual(original.disabledTools);
			expect(actual.packages).toHaveLength(1);
			await enableUiTesting(root, app ? root : undefined);
			expect(await readFile(settings, "utf8")).toBe(first);
		}
	});

	it("recognizes both new and legacy MCP resources for capability disable gating", () => {
		for (const path of [
			"/repo/.pi/skills/ui-testing-workflow/assets/mcp-extension.mjs",
			"C:\\repo\\.pi\\skills\\ui-testing-workflow\\assets\\mcp-extension.mjs",
			"/repo/capabilities/ui-testing/mcp-extension.mjs",
		])
			expect(isUiTestingExtension({ path })).toBe(true);
		expect(isUiTestingExtension({ path: "/other/mcp-extension.mjs" })).toBe(false);
	});
});
