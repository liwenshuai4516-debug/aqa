import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlaywrightRuntime } from "../../.pi/skills/ui-testing-workflow/assets/playwright-runtime.mjs";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
it("rejects missing project dependencies instead of loading the host runtime", () => {
	const root = mkdtempSync(join(tmpdir(), "ui-runtime-missing-"));
	roots.push(root);
	expect(() => resolvePlaywrightRuntime(root)).toThrow("缺少可用");
});
it("selects workspace config, uses a dependency-free fallback and rejects ambiguous config", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "ui-runtime-")));
	roots.push(root);
	mkdirSync(join(root, "node_modules"));
	symlinkSync(realpathSync("node_modules/@playwright"), join(root, "node_modules/@playwright"));
	expect(resolvePlaywrightRuntime(root).fallback).toBe(true);
	writeFileSync(join(root, "playwright.config.ts"), "export default {};");
	expect(resolvePlaywrightRuntime(root)).toMatchObject({ config: join(root, "playwright.config.ts"), fallback: false });
	writeFileSync(join(root, "playwright.config.js"), "export default {};");
	expect(() => resolvePlaywrightRuntime(root)).toThrow("多个");
});
