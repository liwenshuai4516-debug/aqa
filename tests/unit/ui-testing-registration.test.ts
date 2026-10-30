import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { enableUiTesting } from "../../scripts/enable-ui-testing.mjs";
import { deduplicateUiMcpExtensions, isUiTestingExtension } from "../../server/skill/skill-presentation.js";

const roots: string[] = [];
const hostAsset = ".pi/skills/ui-testing-workflow/assets/review-budget-host.mjs";
async function createHostFixture(root: string) {
	const host = join(root, hostAsset);
	await mkdir(dirname(host), { recursive: true });
	await copyFile(new URL(`../../${hostAsset}`, import.meta.url), host);
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("UI testing skill resource registration", () => {
	it("deduplicates legacy and canonical MCP entries only for the same project", () => {
		const legacy = { path: "/repo/capabilities/ui-testing/mcp-extension.mjs" };
		const canonical = { path: "/repo/.pi/skills/ui-testing-workflow/assets/mcp-extension.mjs" };
		const other = { path: "/other/capabilities/ui-testing/mcp-extension.mjs" };
		expect(deduplicateUiMcpExtensions([legacy, canonical, other])).toEqual([canonical, other]);
		expect(deduplicateUiMcpExtensions([canonical, legacy])).toEqual([canonical]);
		expect(deduplicateUiMcpExtensions([legacy])).toEqual([legacy]);
	});
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

	it.each([
		{ app: false, linked: false },
		{ app: false, linked: true },
		{ app: true, linked: false },
		{ app: true, linked: true },
	])("registers the installed native realpath once (app=$app, linked=$linked)", async ({ app, linked }) => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "ui registration 中文 ")));
		roots.push(root);
		const directory = app ? join(root, "应用 agent dir") : join(root, ".pi");
		const packageDir = join(root, linked ? "tools/e2e/node_modules/pi-ui-testing" : "node_modules/pi-ui-testing");
		const runtime = join(packageDir, "dist/extension.js");
		await mkdir(dirname(runtime), { recursive: true });
		await writeFile(runtime, "export default () => {};\n");
		await createHostFixture(root);
		if (linked) {
			await mkdir(join(root, "node_modules"));
			await symlink(packageDir, join(root, "node_modules/pi-ui-testing"), "dir");
		}
		await mkdir(directory, { recursive: true });
		const settings = join(directory, "settings.json");
		await writeFile(settings, JSON.stringify({ theme: "light", extensions: ["another-extension"] }));

		expect(await enableUiTesting(root, app ? directory : undefined)).toBe(settings);
		const first = await readFile(settings, "utf8");
		expect(JSON.parse(first)).toEqual({
			theme: "light",
			extensions: [
				"another-extension",
				app
					? join(root, ".pi/skills/ui-testing-workflow/assets/mcp-extension.mjs")
					: "../.pi/skills/ui-testing-workflow/assets/mcp-extension.mjs",
				app ? runtime : relative(directory, runtime),
				app ? join(root, hostAsset) : relative(directory, join(root, hostAsset)),
			],
			packages: [app ? join(root, "node_modules/pi-ui-testing") : "../node_modules/pi-ui-testing"],
			skills: [app ? join(root, ".pi/skills/ui-testing-workflow") : "./skills/ui-testing-workflow"],
		});
		await enableUiTesting(root, app ? directory : undefined);
		expect(await readFile(settings, "utf8")).toBe(first);
	});

	it.each([false, true])(
		"normalizes native logical/physical entries and retains disabled filters (app=%s)",
		async (app) => {
			const root = await realpath(await mkdtemp(join(tmpdir(), "ui registration 中文 ")));
			roots.push(root);
			const directory = app ? join(root, "应用 agent dir") : join(root, ".pi");
			const runtime = join(root, "tools/e2e/node_modules/pi-ui-testing/dist/extension.js");
			const logical = join(root, "node_modules/pi-ui-testing/dist/extension.js");
			await mkdir(dirname(runtime), { recursive: true });
			await writeFile(runtime, "export default () => {};\n");
			await createHostFixture(root);
			await mkdir(join(root, "node_modules"));
			await symlink(dirname(dirname(runtime)), dirname(dirname(logical)), "dir");
			await mkdir(directory, { recursive: true });
			const settings = join(directory, "settings.json");
			const canonical = app ? runtime : relative(directory, runtime);
			const filtered = { source: canonical, extensions: [], skills: ["keep-filter"] };
			for (const source of [logical, runtime, relative(directory, logical), relative(directory, runtime)]) {
				for (const entries of [
					[source],
					[source, canonical],
					[canonical, source],
					[source, { ...filtered, source }],
					[{ ...filtered, source }, canonical],
				]) {
					const disabled = entries.some((entry) => typeof entry === "object");
					const unrelated = { source: "other-extension", extensions: [] };
					const original = {
						extensions: ["another-extension", ...entries, unrelated],
						packages: [
							{ source: app ? join(root, "node_modules/pi-ui-testing") : "../node_modules/pi-ui-testing", skills: [] },
						],
						disabledTools: ["ui_test_run"],
					};
					await writeFile(settings, JSON.stringify(original));
					await enableUiTesting(root, app ? directory : undefined);
					const first = await readFile(settings, "utf8");
					const actual = JSON.parse(first);
					expect(actual.extensions).toEqual([
						"another-extension",
						disabled ? filtered : canonical,
						unrelated,
						app
							? join(root, ".pi/skills/ui-testing-workflow/assets/mcp-extension.mjs")
							: "../.pi/skills/ui-testing-workflow/assets/mcp-extension.mjs",
						app ? join(root, hostAsset) : relative(directory, join(root, hostAsset)),
					]);
					expect(actual.packages).toEqual(original.packages);
					expect(actual.disabledTools).toEqual(original.disabledTools);
					await enableUiTesting(root, app ? directory : undefined);
					expect(await readFile(settings, "utf8")).toBe(first);
				}
			}
		},
	);

	it.each([
		{ app: false, installation: "absent" },
		{ app: true, installation: "absent" },
		{ app: false, installation: "incomplete" },
		{ app: true, installation: "incomplete" },
		{ app: false, installation: "broken-link" },
		{ app: true, installation: "broken-link" },
	])("does not add a missing native runtime (app=$app, installation=$installation)", async ({ app, installation }) => {
		const root = await mkdtemp(join(tmpdir(), "ui-maintenance-"));
		roots.push(root);
		const packageDir = join(root, "node_modules/pi-ui-testing");
		await createHostFixture(root);
		if (installation === "incomplete") await mkdir(packageDir, { recursive: true });
		if (installation === "broken-link") {
			await mkdir(join(root, "node_modules"));
			await symlink(join(root, "missing-package"), packageDir, "dir");
		}
		const directory = app ? join(root, "agent") : join(root, ".pi");
		const settings = await enableUiTesting(root, app ? directory : undefined);
		const first = await readFile(settings, "utf8");
		expect(JSON.parse(first).extensions).toEqual([
			app
				? join(root, ".pi/skills/ui-testing-workflow/assets/mcp-extension.mjs")
				: "../.pi/skills/ui-testing-workflow/assets/mcp-extension.mjs",
		]);
		expect(JSON.parse(first).packages).toEqual([app ? packageDir : "../node_modules/pi-ui-testing"]);
		await enableUiTesting(root, app ? directory : undefined);
		expect(await readFile(settings, "utf8")).toBe(first);
	});

	it.each([
		{ app: false, linked: false },
		{ app: false, linked: true },
		{ app: true, linked: false },
		{ app: true, linked: true },
	])(
		"normalizes independent host entries and preserves filters (app=$app, linked=$linked)",
		async ({ app, linked }) => {
			const root = await realpath(await mkdtemp(join(tmpdir(), "ui host 中文 ")));
			roots.push(root);
			const directory = app ? join(root, "应用 agent dir") : join(root, ".pi");
			const packageDir = join(root, linked ? "tools/e2e/node_modules/pi-ui-testing" : "node_modules/pi-ui-testing");
			const runtime = join(packageDir, "dist/extension.js");
			await mkdir(dirname(runtime), { recursive: true });
			await writeFile(runtime, "export default () => {};\n");
			if (linked) {
				await mkdir(join(root, "node_modules"));
				await symlink(packageDir, join(root, "node_modules/pi-ui-testing"), "dir");
			}
			await createHostFixture(root);
			await mkdir(directory, { recursive: true });
			const settings = join(directory, "settings.json");
			const absoluteHost = join(root, hostAsset);
			const relativeHost = relative(directory, absoluteHost);
			const host = app ? absoluteHost : relativeHost;
			const canonical = app
				? join(root, ".pi/skills/ui-testing-workflow/assets/mcp-extension.mjs")
				: "../.pi/skills/ui-testing-workflow/assets/mcp-extension.mjs";
			const native = app ? runtime : relative(directory, runtime);
			for (const source of [absoluteHost, relativeHost]) {
				for (const filters of [undefined, [], ["keep-host-filter"]]) {
					const filtered = { source: host, extensions: filters, skills: ["keep-skill-filter"] };
					for (const entries of [
						[source],
						[source, host],
						[host, source],
						...(filters
							? [
									[source, { ...filtered, source }],
									[{ ...filtered, source }, host],
								]
							: []),
					]) {
						const hasFilter = entries.some((entry) => typeof entry === "object");
						const unrelated = { source: "other-extension", extensions: [] };
						const original = {
							theme: "light",
							extensions: ["another-extension", ...entries, unrelated],
							packages: [
								{
									source: app ? join(root, "node_modules/pi-ui-testing") : "../node_modules/pi-ui-testing",
									extensions: [],
								},
							],
							disabledTools: ["ui_test_run"],
						};
						await writeFile(settings, JSON.stringify(original));
						await enableUiTesting(root, app ? directory : undefined);
						const first = await readFile(settings, "utf8");
						const actual = JSON.parse(first);
						expect(actual).toEqual({
							...original,
							extensions: ["another-extension", hasFilter ? filtered : host, unrelated, canonical, native],
							skills: [app ? join(root, ".pi/skills/ui-testing-workflow") : "./skills/ui-testing-workflow"],
						});
						await enableUiTesting(root, app ? directory : undefined);
						expect(await readFile(settings, "utf8")).toBe(first);
					}
				}
			}
		},
	);

	it.each([false, true])("does not add a missing host helper with native installed (app=%s)", async (app) => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "ui-host-missing-")));
		roots.push(root);
		const directory = app ? join(root, "agent") : join(root, ".pi");
		const runtime = join(root, "node_modules/pi-ui-testing/dist/extension.js");
		await mkdir(dirname(runtime), { recursive: true });
		await writeFile(runtime, "export default () => {};\n");
		const settings = await enableUiTesting(root, app ? directory : undefined);
		const first = await readFile(settings, "utf8");
		expect(JSON.parse(first).extensions).toEqual([
			app
				? join(root, ".pi/skills/ui-testing-workflow/assets/mcp-extension.mjs")
				: "../.pi/skills/ui-testing-workflow/assets/mcp-extension.mjs",
			app ? runtime : relative(directory, runtime),
		]);
		await enableUiTesting(root, app ? directory : undefined);
		expect(await readFile(settings, "utf8")).toBe(first);
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
