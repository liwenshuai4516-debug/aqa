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

	it.each([false, true])(
		"retains legacy registration and resource filters without duplicate loading (app=%s)",
		async (app) => {
			const root = await mkdtemp(join(tmpdir(), "ui-maintenance-"));
			roots.push(root);
			const path = (relative: string) => (app ? join(root, relative) : `../${relative}`);
			const legacy = {
				extensions: [{ source: path("capabilities/ui-testing/mcp-extension.mjs"), extensions: [] }],
				skills: [path("capabilities/ui-testing/ui-testing-workflow")],
			};
			if (!app) {
				await enableUiTesting(root);
			}
			const settings = join(root, app ? "settings.json" : ".pi/settings.json");
			await writeFile(settings, JSON.stringify(legacy));
			await enableUiTesting(root, app ? root : undefined);
			const actual = JSON.parse(await readFile(settings, "utf8"));
			expect(actual.extensions).toEqual(legacy.extensions);
			expect(actual.skills).toEqual(legacy.skills);
			expect(actual.packages).toHaveLength(1);
		},
	);

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
