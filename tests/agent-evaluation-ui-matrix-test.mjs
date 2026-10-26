/** Real local Playwright execution; controlled review response, no model/business service. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ready } from "./fixtures/data-space/ui-run-fixture.mjs";
import { TestAssetReader } from "../server/test-asset-reader.ts";
const output = await mkdtemp(join(tmpdir(), "agent-evaluation-ui-matrix-"));
await mkdir(join(output, "data/api-testing/assets"), { recursive: true });
const cleanup = [],
	count = 41;
const code = `import {test,expect} from 'playwright/test';
test.use({storageState:{cookies:[],origins:[]}});
${Array.from({ length: count }, (_, index) => {
	const id = index + 1;
	return `test('C${id} Name persists',async({page})=>{
 const key='qa-C${id}-'+crypto.randomUUID();await page.goto('/');
 await page.getByRole('textbox',{name:'Name'}).fill(key);
 await page.getByRole('button',{name:'Save'}).click();await page.reload();
 await test.step('A${id} Name persists after reload',async()=>{await expect(page.getByRole('listitem')).toHaveText([key]);});
});`;
}).join("\n")}`;
const result = {
	status: "running",
	output,
	scope:
		"local synthetic targets; real UI diagnostic/formal runners, controlled review response, no independent approval or model assessment",
	actualModelCalls: 0,
	actualCliCalls: 0,
	nativeRunnerCalls: 0,
};
try {
	const ui = await ready({ after: (close) => cleanup.push(close) }, { caseCount: count, testCode: code });
	assert.equal(ui.reviewed.decision, "approved");
	// Activate a target defect only after the original positive/negative admission checks.
	const failedIds = Array.from({ length: count }, (_, index) => index + 1).filter((id) => (id - 1) % 3 === 0);
	ui.f.fixture.state.discardNamePrefixes = failedIds.map((id) => `qa-C${id}-`);
	result.nativeRunnerCalls++;
	const executed = await ui.service.start({ ...ui.request, timeout_ms: 120000 });
	assert.equal(executed.run.data.exit_code, 1);
	const reader = new TestAssetReader(join(output, "data")),
		run = await reader.read("ui", ui.f.root, executed.run_ref);
	assert.equal(run.complete, true);
	assert.equal(run.rows.length, count);
	for (const row of run.rows) {
		assert.equal(row.status, failedIds.includes(Number(row.caseId.slice(1))) ? "failed" : "passed");
		assert.equal(row.evidenceComplete, true);
	}
	assert.equal(new Set(run.rows.map((row) => row.caseId)).size, count);
	assert.equal(run.rows.filter((row) => row.status === "passed").length, 27);
	assert.equal(run.rows.filter((row) => row.status === "failed").length, 14);
	const original = await readFile(join(ui.f.root, executed.run_ref.path));
	await writeFile(join(output, "native-run.json"), JSON.stringify(run, null, 2));
	await writeFile(join(output, "native-manifest.json"), original);
	await writeFile(
		join(output, "ledger.json"),
		JSON.stringify(
			{
				store: {
					cases: [
						{
							automation: {
								engine: "ui",
								workspace: ui.f.root,
								reference: executed.run_ref,
								expectedRows: run.rows,
							},
						},
					],
				},
			},
			null,
			2,
		),
	);
	Object.assign(result, {
		status: "PASS",
		workspace: ui.f.root,
		reference: executed.run_ref,
		passed: 27,
		failed: 14,
		complete: true,
		fault: { discardNamePrefixes: ui.f.fixture.state.discardNamePrefixes },
		note: "nativeRunnerCalls counts formal start only; admission also executes positive/negative probes",
	});
} catch (error) {
	result.status = "FAIL";
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	for (const close of cleanup.reverse()) await close();
	await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}
