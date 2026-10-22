import { describe, expect, it, afterEach } from "vitest";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	rmSync,
	realpathSync,
	existsSync,
	symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { enableApiTesting } from "../../scripts/enable-api-testing.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const temporary: string[] = [];
const setup = () => {
	const base = mkdtempSync(join(tmpdir(), "api-testing-registration-"));
	temporary.push(base);
	const agentDir = join(base, "agent"),
		dataDir = join(base, "data");
	mkdirSync(agentDir);
	return { base, agentDir, dataDir };
};
afterEach(() => {
	for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("explicit API testing installation", () => {
	it("requires an explicit host directory before modifying anything", async () => {
		await expect(enableApiTesting(root)).rejects.toThrow(/explicit host data directory/);
	});
	it("registers app-wide skills and plugin idempotently while preserving settings and disabled choices", async () => {
		const { agentDir, dataDir } = setup();
		const before = {
			theme: "light",
			skills: ["existing-skill"],
			disabledSkills: ["api-test-review"],
			packages: [{ source: "existing-package" }],
		};
		const settings = join(agentDir, "settings.json");
		writeFileSync(settings, JSON.stringify(before));
		const result = await enableApiTesting(root, { agentDir, dataDir });
		const first = readFileSync(settings, "utf8");
		await enableApiTesting(root, { agentDir, dataDir });
		expect(readFileSync(settings, "utf8")).toBe(first);
		const after = JSON.parse(first);
		expect(after).toMatchObject({ ...before, skills: expect.arrayContaining(before.skills) });
		expect(after.skills).toHaveLength(4);
		for (const name of ["api-test-workflow", "api-test-review", "api-test-analyze"])
			expect(after.skills).toContain(join(root, ".pi/skills", name));
		expect(realpathSync(result.pluginPath)).toBe(realpathSync(join(root, "plugins/api-testing")));
	});
	it("preserves a conflicting installed plugin and does not rewrite settings", async () => {
		const { agentDir, dataDir } = setup();
		const plugin = join(dataDir, "plugins/api-testing");
		mkdirSync(plugin, { recursive: true });
		writeFileSync(join(plugin, "keep.txt"), "local-installation");
		const settings = join(agentDir, "settings.json");
		writeFileSync(settings, '{"theme":"light"}');
		await expect(enableApiTesting(root, { agentDir, dataDir })).rejects.toThrow(/another installation/);
		expect(readFileSync(settings, "utf8")).toBe('{"theme":"light"}');
		expect(readFileSync(join(plugin, "keep.txt"), "utf8")).toBe("local-installation");
	});
	it("rejects another plugin symlink without replacing it", async () => {
		const { base, agentDir, dataDir } = setup();
		const other = join(base, "other");
		mkdirSync(other);
		mkdirSync(join(dataDir, "plugins"), { recursive: true });
		const plugin = join(dataDir, "plugins/api-testing");
		symlinkSync(other, plugin, "junction");
		await expect(enableApiTesting(root, { agentDir, dataDir })).rejects.toThrow(/another installation/);
		expect(realpathSync(plugin)).toBe(realpathSync(other));
	});
	it.each(['{"skills":{}}', "[]", '{"skills":'])(
		"rejects invalid settings without creating a plugin: %s",
		async (contents) => {
			const { agentDir, dataDir } = setup();
			const settings = join(agentDir, "settings.json");
			writeFileSync(settings, contents);
			await expect(enableApiTesting(root, { agentDir, dataDir })).rejects.toThrow();
			expect(readFileSync(settings, "utf8")).toBe(contents);
			expect(existsSync(join(dataDir, "plugins/api-testing"))).toBe(false);
		},
	);
});
