/** U05 source-only preparation; no model, browser, diagnostic or formal execution. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ArtifactStore, UiWorkflowService, assetDigest, capabilities, checkDesign, sha256 } from "pi-ui-testing";
import { optimizationScope } from "./fixtures/data-space/ui-optimization-page.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const output = join(repo, "tests/scratch/ui-multifunction-candidate", String(Date.now()));
const root = join(output, "project");
await mkdir(root, { recursive: true });
const envelope = (kind, id, data) => ({ schema_version: "1.0", kind, id, created_at: new Date().toISOString(), data });
const result = { status: "FAIL", modelCalls: 0, browserStarts: 0, formalRunnerCalls: 0, checks: [], root };
const children = [];
const spawned = ({ process }) => children.push(process.spawnargs);
let observing = false;
try {
	const history = JSON.parse(
		await readFile(join(repo, "docs/ui-testing-evidence/optimization-u05-state-coverage.json"), "utf8"),
	);
	const archive = join(repo, history.evidence.archive);
	assert.equal(sha256(await readFile(archive)), history.evidence.archive_sha256);
	await promisify(execFile)("tar", ["-xzf", archive, "--strip-components=1", "-C", root]);
	await symlink(join(repo, "node_modules"), join(root, "node_modules"), "dir");
	await writeFile(join(root, "package.json"), '{"type":"module"}\n');
	const store = new ArtifactStore(root);
	const originalTasks = (await store.reindex()).records.filter((record) => record.kind === "task");
	const original = [history.tester.partial, history.viewer.partial];
	for (const ref of original) assert.equal((await store.load(ref)).data.status, "partial");
	const sourcePath = "qa/ui/scopes/declaration/fixture.mjs";
	const sourceBytes = await readFile(join(root, sourcePath));
	assert.equal(sha256(sourceBytes), history.fixture_sha256);
	assert.equal(
		sha256(sourceBytes),
		sha256(await readFile(join(repo, "tests/fixtures/data-space/ui-optimization-page.mjs"))),
	);
	const source = {
		source_id: "u00-declaration",
		oracle_type: "declaration",
		ref: { path: sourcePath, sha256: sha256(sourceBytes) },
		statement: JSON.stringify(optimizationScope),
	};
	// Observe only the candidate stage, after extracting already verified local evidence.
	subscribe("child_process", spawned);
	observing = true;
	const scopeRef = await store.put(
		envelope("scope", "u05-source-candidate", {
			project_id: "u05-fixture",
			environment_id: "isolated-design-only",
			role: "tester and viewer in separate contexts",
			goal: "Prepare all six u00-1 declared features and both role expectations from source; preserve historical browser partial tasks without advancing them.",
			allowed_actions: [
				"Read frozen source and historical public evidence; save and statically check an unapproved candidate. No browser or model calls.",
			],
			sources: [source],
			budget: { max_review_rounds: 3, max_tool_calls: 60 },
		}),
	);
	const draftRef = await store.putFile(
		"qa/ui/inventories/u05-source-candidate/drafts/design.md",
		"# U05 source-only candidate\n\nThe u00-1 declaration remains the oracle. Cover all six frozen features and both declared roles. Historical tester/viewer recordings remain partial and do not establish this candidate's execution readiness. Locators, all negative diagnostic probes and independent review remain pending.\n",
	);
	const inventoryRef = await store.put(
		envelope("inventory", "u05-source-candidate", {
			scope_ref: scopeRef,
			features: optimizationScope.features.map((feature) => ({
				module_id: "names",
				feature_id: feature.id,
				name: feature.id,
				entry: "/",
				role: feature.id === "permission" ? "tester and viewer in separate contexts" : "tester",
				actions: feature.assertions,
				scenarios: [{ scenario_id: feature.id + "-declared", title: feature.assertions.join("; ") }],
				coverage: "discovered",
				discovery: "source",
				source_refs: [source.ref],
				source_locations: [{ ref: source.ref, symbol: "optimizationScope", line: 2 }],
				priority: "P0",
				states: [],
				gaps: [
					"Source-only candidate: current script locators and assertions have not been executed or independently reviewed.",
				],
			})),
			unexplored: [
				"Other products and undeclared roles",
				"Repeated-button/frame variants and deployment/dependency changes are separate outstanding U05 coverage.",
			],
			draft_refs: [draftRef],
		}),
	);
	const rules = await store.putFile(
		"qa/ui/cases/u05-source-candidate/data-rules.json",
		JSON.stringify({
			initial: optimizationScope.initialNames,
			roles: optimizationScope.roles,
			inputs: ["Gamma", "a", "Missing", "U05-owned-item"],
			isolation:
				"Fresh non-persistent context per case, no imported storageState; viewer uses its own context. No external business requests or shared mutable data.",
			cleanup: optimizationScope.cleanup,
		}),
	);
	const titles = {
		search: "C-search Query and reset",
		edit: "C-edit Cancel and persisted save",
		details: "C-details Tabs and disclosure",
		paging: "C-paging Filtered page boundaries",
		permission: "C-permission Separate viewer and tester contexts",
		states: "C-states Loading empty and error",
	};
	const expected = {
		search: ["Query Gamma returns only Gamma.", "Reset clears Query, returns page 1 and Alpha/Beta."],
		edit: [
			"Dialog opens; filling then cancelling closes it and the name is absent after reload.",
			"Saving U05-owned-item produces exactly one matching persisted row after reload.",
		],
		details: [
			"About is selected/visible and List is unselected/hidden.",
			"Fixture version u00-1 is hidden, visible after expansion and hidden after collapse.",
		],
		paging: [
			"Filtering a after adding nonmatching U05-owned-item shows Alpha/Beta, Previous disabled, Next enabled.",
			"Next shows only Gamma with Next disabled; Previous restores Alpha/Beta with Previous disabled, Query remains a throughout.",
		],
		permission: [
			"Viewer identity is confirmed; Add exists in DOM but is hidden and absent from accessible button matches.",
			"Tester identity is confirmed and Add is visible/enabled.",
		],
		states: [
			"Read-only observer captures Loading with no rows before Ready with Alpha/Beta.",
			"Query Missing shows Empty with no rows.",
			"Simulate error shows Error loading names with no rows.",
		],
	};
	const cases = envelope("cases", "u05-source-candidate", {
		scope_ref: scopeRef,
		sources: [source],
		data_rules_ref: rules,
		cases: optimizationScope.features.map((feature) => ({
			case_id: "C-" + feature.id,
			module_id: "names",
			feature_id: feature.id,
			scenario_id: feature.id + "-declared",
			title: titles[feature.id],
			priority: "P0",
			preconditions: [
				"Frozen u00-1 declaration; new context with initial Alpha/Beta/Gamma and no imported state.",
				feature.id === "permission"
					? "Tester and viewer use separate contexts; query role is a synthetic fixture switch, not real authentication."
					: "Tester context; page identity and Ready are checked before each case.",
			],
			steps: feature.assertions.map((action, i) => ({
				step_id: `S-${feature.id}-${i + 1}`,
				action,
				assertion_ids: [`A-${feature.id}-${i + 1}`],
			})),
			assertions: feature.assertions.map((action, i) => ({
				assertion_id: `A-${feature.id}-${i + 1}`,
				step_id: `S-${feature.id}-${i + 1}`,
				source_id: source.source_id,
				oracle_type: "declaration",
				target: action,
				comparison: "exact declared result and state transition",
				expected: expected[feature.id][i],
				observation: "Pending execution: inspect the corresponding test.step, DOM state and per-case evidence.",
				evidence_required: true,
			})),
			cleanup:
				"Playwright closes the owned test context; permission case closes viewer context in finally. Close owned fixture servers after the batch.",
			data_row_id: "declared-initial",
			browser_project: "chromium",
		})),
		gaps: ["Design-only: independent review, all assertion negative probes and runtime validation remain pending."],
	});
	const casesRef = await store.put(cases);
	const base = "qa/ui/assets/u05-full-declaration/revisions/v1";
	const script = await store.putFile(
		`${base}/candidate.spec.ts`,
		await readFile(join(repo, "tests/fixtures/data-space/ui-multifunction-candidate.ts")),
	);
	const historical = await store.putFile(
		`${base}/historical-evidence.json`,
		JSON.stringify({
			purpose: "Historical partial evidence only, not current candidate execution",
			source_archive_sha256: history.evidence.archive_sha256,
			recordings: original,
		}),
	);
	const asset = envelope("asset", "u05-full-declaration", {
		revision: "v1",
		module_ids: ["names"],
		scope_ref: scopeRef,
		inventory_ref: inventoryRef,
		cases_ref: casesRef,
		recording_refs: [],
		files: [script, source.ref, rules, historical],
		bindings: cases.data.cases.map((c) => ({
			case_id: c.case_id,
			script_ref: script,
			test_title: c.title,
			assertion_ids: c.assertions.map((a) => a.assertion_id),
		})),
		dependencies: [{ name: "playwright", version: "1.62.1" }],
		readiness: "design-only",
		content_sha256: "0".repeat(64),
		gaps: [
			...cases.data.gaps,
			"Historical role-specific recordings are partial; original browser workflow tasks are not advanced.",
		],
	});
	asset.data.content_sha256 = assetDigest(asset);
	const assetRef = await store.put(asset);
	const checked = await checkDesign(root, assetRef);
	await store.putFile(`${base}/static-check.json`, JSON.stringify(checked, null, 2));
	assert.deepEqual(checked.issues, [], JSON.stringify(checked.issues));
	assert.equal(checked.coverage.planned.length, 6);
	assert.equal(checked.coverage.covered.length, 6);
	assert.equal(cases.data.cases.flatMap((c) => c.assertions).length, 13);
	result.checks.push(
		"All six frozen features and thirteen declared assertions map to six static tests with source references",
	);
	const runtime = {
		tools: ["read", ...capabilities.map((c) => c.tool)],
		skills: await readdir(join(repo, "node_modules/pi-ui-testing/skills")),
	};
	const workflow = new UiWorkflowService(root, join(output, "private-authority"), runtime);
	let task = await workflow.start({
		task_id: "u05-source-candidate",
		mode: "record",
		discovery: "source",
		scope_ref: scopeRef,
	});
	task = await workflow.checkpoint(task.task_ref, "discover-record", [inventoryRef]);
	task = await workflow.checkpoint(task.task_ref, "case-design", [assetRef]);
	assert.equal(task.next_stage, "design-review");
	await assert.rejects(workflow.checkpoint(task.task_ref, "design-review", [assetRef]), /设计评估/);
	task = await workflow.block(task.task_ref, [
		"Independent native model review is not authorized: existing test model budget is exhausted. Diagnostic probes and browser validation remain pending.",
	]);
	assert.equal(task.task.data.state, "blocked");
	assert.equal(task.task.data.completed_stages.includes("design-review"), false);
	const catalog = await workflow.catalog();
	assert.equal(catalog.assets.find((a) => a.asset_ref.path === assetRef.path).runtime_ready, false);
	result.checks.push(
		"Native source-only handoff reaches independent review but cannot approve or become runtime-ready",
	);
	for (const [name, change, rule] of [
		["missing-binding", (value) => value.data.bindings[0].assertion_ids.pop(), "D6"],
		[
			"changed-dependency",
			(value) => {
				value.data.dependencies[0].version = "0.0.0";
			},
			"D3",
		],
	]) {
		const invalid = structuredClone(asset);
		invalid.data.revision = name;
		change(invalid);
		invalid.data.content_sha256 = assetDigest(invalid);
		const ref = await store.put(invalid),
			report = await checkDesign(root, ref);
		assert.ok(
			report.issues.some((issue) => issue.rule === rule && issue.blocking),
			JSON.stringify(report),
		);
		await store.putFile(
			`qa/ui/assets/u05-full-declaration/revisions/${name}/static-check.json`,
			JSON.stringify(report, null, 2),
		);
	}
	result.checks.push(
		"Missing assertion mapping and changed Playwright dependency are rejected by native static checks",
	);
	for (const ref of original) {
		assert.equal(sha256(await readFile(join(root, ref.path))), ref.sha256);
		assert.equal((await store.load(ref)).data.status, "partial");
	}
	for (const { ref } of originalTasks) assert.equal(sha256(await readFile(join(root, ref.path))), ref.sha256);
	result.originalTaskRefs = originalTasks.map(({ ref }) => ref);
	assert.equal(children.length, 0, JSON.stringify(children));
	result.checks.push(
		"Historical partial recordings and tasks remain byte-identical; candidate preparation launches no subprocess, browser or model",
	);
	result.assetRef = assetRef;
	result.taskRef = task.task_ref;
	result.featureCount = 6;
	result.assertionCount = 13;
	result.staticIssues = checked.issues;
	result.taskState = task.task.data.state;
	result.nextStage = task.next_stage;
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	if (observing) unsubscribe("child_process", spawned);
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
