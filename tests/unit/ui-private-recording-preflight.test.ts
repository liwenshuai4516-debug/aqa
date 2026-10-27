import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePrivateRecordingSeed } from "../../.pi/skills/ui-testing-workflow/assets/private-recording-preflight.mjs";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "private-seed-")));
	roots.push(root);
	await mkdir(join(root, "tests"));
	await mkdir(join(root, "node_modules/@playwright"), { recursive: true });
	for (const name of ["@playwright/test", "playwright", "pi-ui-testing"])
		await symlink(await realpath(join("tools/e2e/node_modules", name)), join(root, "node_modules", name), "dir");
	await writeFile(join(root, "package.json"), '{"type":"module"}');
	const config = "export default {testDir:'./tests',use:{trace:'off'},projects:[{name:'chromium'}]};";
	await writeFile(join(root, "playwright.config.mjs"), config);
	const environment = { environment_id: "fixture", role: "fixture", base_url: "http://127.0.0.1:18983/" };
	const code = `import {test,expect} from 'pi-ui-testing/recording-fixtures';
test.use({uiEnvironment:${JSON.stringify(environment)},uiOwner:{task_id:'fixture',kind:'recording',id:'fixture'},uiProjectRoot:process.cwd()});
test('seed',async({page})=>{expect(page).toBeTruthy();});`;
	await writeFile(join(root, "tests/seed.spec.ts"), code);
	const prepared = {
		capture: { seedRef: { path: "tests/seed.spec.ts" }, project: "chromium" },
		captureContext: { environment, sessionId: "fixture" },
		snapshot: { workspace: root, childEnv: {}, assertCurrent: async () => {} },
	};
	return { root, prepared, code, config };
}
it("collects a direct managed fixture seed without executing its body", async () => {
	const f = await fixture();
	await writeFile(
		join(f.root, "tests/seed.spec.ts"),
		f.code.replace("expect(page)", "throw Error('body executed');expect(page)"),
	);
	await expect(validatePrivateRecordingSeed(f.prepared)).resolves.toBeUndefined();
});
it("rejects an ordinary seed, fixture override, mismatched environment/owner and runtime-dependent options", async () => {
	const f = await fixture();
	for (const code of [
		f.code.replace("pi-ui-testing/recording-fixtures", "@playwright/test"),
		f.code.replace("test.use({", "test.use({page:async()=>{},"),
		f.code.replace('"role":"fixture"', '"role":"other"'),
		f.code.replace("kind:'recording',id:'fixture'", "kind:'recording',id:'other'"),
		f.code.replace("uiProjectRoot:process.cwd()", "uiProjectRoot:'/different'"),
		f.code + "\ntest.use({storageState:'unverified'});",
		f.code.replace("test('seed'", "test.extend({})('seed'"),
	]) {
		await writeFile(join(f.root, "tests/seed.spec.ts"), code);
		await expect(validatePrivateRecordingSeed(f.prepared)).rejects.toThrow("受管采集 seed");
	}
});
it("rejects incompatible collection settings before any browser body", async () => {
	const f = await fixture();
	for (const config of [
		f.config.replace("trace:'off'", "trace:'on'"),
		f.config.replace("trace:'off'", "browserName:'firefox',trace:'off'"),
	]) {
		await writeFile(join(f.root, "playwright.config.mjs"), config);
		await expect(validatePrivateRecordingSeed(f.prepared)).rejects.toThrow("受管采集 seed");
	}
});
