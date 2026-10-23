import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateRecordingSeed } from "../../.pi/skills/ui-testing-workflow/assets/recording-preflight.mjs";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "recording-preflight-")));
	roots.push(root);
	mkdirSync(join(root, "node_modules"));
	symlinkSync(realpathSync("node_modules/@playwright"), join(root, "node_modules/@playwright"));
	mkdirSync(join(root, "tests"));
	writeFileSync(join(root, "package.json"), '{"type":"module"}');
	writeFileSync(
		join(root, "playwright.config.mjs"),
		"export default {testDir:'./tests',use:{baseURL:'http://127.0.0.1:18981'},projects:[{name:'chromium'}]};",
	);
	writeFileSync(
		join(root, "tests/seed.spec.ts"),
		"import {test} from '@playwright/test';test('seed',async()=>{throw new Error('must not execute');});",
	);
	return root;
}
it("collects a relative seed from a custom testDir without running its test body", async () => {
	const cwd = fixture();
	await expect(
		validateRecordingSeed(cwd, { project: "chromium", seedFile: "tests/seed.spec.ts" }),
	).resolves.toBeUndefined();
});
it("blocks missing, ambiguous and multi-test seeds before business actions", async () => {
	const cwd = fixture();
	await expect(validateRecordingSeed(cwd, { project: "chromium", seedFile: "missing.spec.ts" })).rejects.toThrow();
	writeFileSync(join(cwd, "seed.spec.ts"), "export {};");
	await expect(validateRecordingSeed(cwd, { project: "chromium", seedFile: "seed.spec.ts" })).rejects.toThrow("多个");
	rmSync(join(cwd, "seed.spec.ts"));
	writeFileSync(
		join(cwd, "tests/seed.spec.ts"),
		"import {test} from '@playwright/test';test('one',()=>{});test('two',()=>{});",
	);
	await expect(validateRecordingSeed(cwd, { project: "chromium", seedFile: "tests/seed.spec.ts" })).rejects.toThrow(
		"单个",
	);
});
it("requires explicit project and seed, rejects missing browser projects and dependency gaps", async () => {
	const cwd = fixture();
	await expect(validateRecordingSeed(cwd, {})).rejects.toThrow("明确");
	await expect(validateRecordingSeed(cwd, { project: "unknown", seedFile: "tests/seed.spec.ts" })).rejects.toThrow();
	rmSync(join(cwd, "node_modules"), { recursive: true });
	await expect(validateRecordingSeed(cwd, { project: "chromium", seedFile: "tests/seed.spec.ts" })).rejects.toThrow(
		"缺少可用",
	);
});
