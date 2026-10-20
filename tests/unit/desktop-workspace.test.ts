import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateWorkspace } from "../../desktop/workspace.js";

describe("desktop workspace selection", () => {
	it("rejects home, its symlink, files and nonexistent paths without creating them", () => {
		const root = mkdtempSync(join(tmpdir(), "desktop-workspace-"));
		try {
			expect(() => validateWorkspace(homedir())).toThrow("主目录");
			symlinkSync(homedir(), join(root, "home"), "junction");
			expect(() => validateWorkspace(join(root, "home"))).toThrow("主目录");
			writeFileSync(join(root, "file"), "sample");
			expect(() => validateWorkspace(join(root, "file"))).toThrow("文件夹");
			expect(() => validateWorkspace(join(root, "missing"))).toThrow();
			mkdirSync(join(root, "中文 project"));
			expect(validateWorkspace(join(root, "中文 project"))).toContain("中文 project");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
