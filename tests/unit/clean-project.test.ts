import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCleanup, planCleanup } from "../../scripts/clean-project.mjs";

describe("project cleanup boundaries", () => {
	let root: string;
	const dep = "tests/scratch/old/runtime/node_modules";
	const old = new Date(Date.now() - 10 * 86400000);
	const write = (path: string, text = "test") => {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), text);
	};
	const age = (path: string) => utimesSync(join(root, path), old, old);
	const fixture = () => {
		write("tests/scratch/old/runtime/package.json", "{}");
		write("tests/scratch/old/runtime/package-lock.json", "{}");
		write(dep + "/lib/index.js");
		for (const path of [dep + "/lib/index.js", dep + "/lib", dep]) age(path);
	};
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "pi-clean-project-"));
		execFileSync("git", ["init", "--quiet", root]);
		write(".gitignore", "tests/scratch/\nnode_modules/\n");
	});
	// The external symlink target below lives inside this owned fixture root.
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("preview leaves files intact; apply removes only reconstructible old dependencies", () => {
		fixture();
		for (const path of [
			"docs/evidence/report.json",
			"tests/scratch/old/result.json",
			"release/app.dmg",
			"node_modules/main.js",
			"dist/server.js",
			".pi/auth.json",
		])
			write(path);
		expect(planCleanup(root)).toMatchObject([{ path: dep, eligible: true }]);
		expect(existsSync(join(root, dep))).toBe(true);
		expect(applyCleanup(root)).toHaveLength(1);
		for (const path of [
			"docs/evidence/report.json",
			"tests/scratch/old/result.json",
			"release/app.dmg",
			"node_modules/main.js",
			"dist/server.js",
			".pi/auth.json",
		])
			expect(existsSync(join(root, path))).toBe(true);
		expect(applyCleanup(root)).toEqual([]);
	});
	it("uses newest nested write, not the parent directory timestamp", () => {
		fixture();
		write(dep + "/lib/index.js", "recent");
		expect(planCleanup(root)[0].eligible).toBe(false);
		expect(applyCleanup(root)).toEqual([]);
	});
	it("requires lockfiles and respects keep markers in ancestors or descendants", () => {
		fixture();
		rmSync(join(root, "tests/scratch/old/runtime/package-lock.json"));
		expect(planCleanup(root)).toEqual([]);
		fixture();
		write("tests/scratch/old/.cleanup-keep");
		expect(applyCleanup(root, { days: 0 })).toEqual([]);
		rmSync(join(root, "tests/scratch/old/.cleanup-keep"));
		write(dep + "/lib/.cleanup-keep");
		expect(applyCleanup(root, { days: 0 })).toEqual([]);
	});
	it("rejects tracked descendants even inside ignored dependency directories", () => {
		fixture();
		execFileSync("git", ["add", "-f", "--", dep + "/lib/index.js"], { cwd: root });
		expect(planCleanup(root)[0].reason).toBe("Git 跟踪文件");
		expect(applyCleanup(root, { days: 0 })).toEqual([]);
	});
	it("never traverses linked scratch directories, dependency roots or cache ancestors", () => {
		fixture();
		mkdirSync(join(root, "external"));
		write("external/keep.txt");
		symlinkSync(join(root, "external"), join(root, "tests/scratch/link"), "junction");
		rmSync(join(root, dep), { recursive: true });
		symlinkSync(join(root, "external"), join(root, dep), "junction");
		symlinkSync(join(root, "external"), join(root, "node_modules"), "junction");
		write("external/.vite/keep.txt");
		expect(planCleanup(root)).toEqual([]);
		expect(existsSync(join(root, "external/keep.txt"))).toBe(true);
	});
	it("removes only the selected cache, without following links inside dependencies", () => {
		fixture();
		write("node_modules/.vite/result");
		write("external/keep.txt");
		symlinkSync(join(root, "external"), join(root, dep, "external"), "junction");
		expect(applyCleanup(root, { days: 0, only: [dep] })).toHaveLength(1);
		expect(existsSync(join(root, "external/keep.txt"))).toBe(true);
		expect(existsSync(join(root, "node_modules/.vite/result"))).toBe(true);
	});
	it("revalidates state after a preview and rejects arbitrary deletion paths", () => {
		fixture();
		expect(planCleanup(root)[0].eligible).toBe(true);
		write("tests/scratch/.cleanup-keep");
		expect(applyCleanup(root)).toEqual([]);
		for (const path of ["../outside", "release", "tests/scratch/old"]) {
			expect(() => applyCleanup(root, { only: [path] })).toThrow("不在清理白名单中");
		}
		for (const days of [-1, NaN, Infinity]) expect(() => planCleanup(root, { days })).toThrow();
	});

	it.each([["--apply", "--days", "0"], ["--days", "-1"], ["--days", "invalid"], ["--unknown"]])(
		"rejects unsafe or malformed CLI arguments: %j",
		(...args) => {
			expect(() =>
				execFileSync(
					process.execPath,
					[fileURLToPath(new URL("../../scripts/clean-project.mjs", import.meta.url)), ...args],
					{
						stdio: "pipe",
					},
				),
			).toThrow();
		},
	);
});
