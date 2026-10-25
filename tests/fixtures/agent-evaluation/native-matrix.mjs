/** Synthetic, never-launched UI plan for native-reader paging; not execution evidence. */
import assert from "node:assert/strict";
import { mkdir, realpath, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactStore, assetDigest, sha256 } from "pi-ui-testing";
import { artifact, scope, cases } from "../data-space/ui-artifacts.mjs";

export async function nativeMatrixFiles(workspace, path = "") {
	const files = [];
	for (const entry of (await readdir(join(workspace, path), { withFileTypes: true })).sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		const name = path ? `${path}/${entry.name}` : entry.name;
		if (entry.isDirectory()) files.push(...(await nativeMatrixFiles(workspace, name)));
		else {
			assert.ok(entry.isFile(), `Unexpected non-file in owned fixture: ${name}`);
			const bytes = await readFile(join(workspace, name));
			files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
		}
	}
	return files;
}

export async function createNativeMatrix(output) {
	const directory = join(output, "synthetic-ui-plan");
	await mkdir(directory);
	const workspace = await realpath(directory),
		store = new ArtifactStore(workspace);
	const requirement = "Synthetic reader/pagination fixture only. No test execution or approved business outcome.\n";
	await writeFile(join(workspace, "requirements.md"), requirement);
	const source = { path: "requirements.md", sha256: sha256(requirement) };
	const declaredScope = scope();
	declaredScope.data.goal = "Inspect 41 unexecuted synthetic instances";
	declaredScope.data.allowed_actions = ["read-owned-fixture"];
	declaredScope.data.sources[0].ref = source;
	declaredScope.data.sources[0].statement = requirement.trim();
	const scopeRef = await store.put(declaredScope),
		rules = await store.putFile(
			"qa/ui/cases/native-matrix/data-rules.json",
			'{"isolation":"synthetic; no execution"}\n',
		);
	const declaredCases = cases(),
		template = declaredCases.data.cases[0];
	declaredCases.id = "native-matrix";
	declaredCases.data.scope_ref = scopeRef;
	declaredCases.data.sources = declaredScope.data.sources;
	declaredCases.data.data_rules_ref = rules;
	declaredCases.data.gaps = [
		"Synthetic fixture: no review, browser, subprocess, executed assertions or execution results",
	];
	declaredCases.data.cases = Array.from({ length: 41 }, (_, i) => {
		const testcase = structuredClone(template),
			assertionId = `A${i + 1}`;
		testcase.case_id = `synthetic-${String(i + 1).padStart(2, "0")}`;
		testcase.title = `Synthetic unexecuted case ${i + 1}`;
		testcase.steps[0].assertion_ids = [assertionId];
		testcase.assertions[0].assertion_id = assertionId;
		return testcase;
	});
	const casesRef = await store.put(declaredCases),
		script = await store.putFile("qa/ui/assets/native-matrix/revisions/v1/readme.txt", requirement);
	const asset = artifact(
		"asset",
		{
			revision: "v1",
			module_ids: ["names"],
			scope_ref: scopeRef,
			cases_ref: casesRef,
			recording_refs: [],
			files: [script],
			dependencies: [],
			readiness: "design-only",
			content_sha256: "0".repeat(64),
			gaps: declaredCases.data.gaps,
		},
		"native-matrix",
	);
	asset.data.content_sha256 = assetDigest(asset);
	const assetRef = await store.put(asset);
	await store.put(
		artifact(
			"task",
			{
				intent: "view",
				scope_ref: scopeRef,
				state: "pending",
				stage: "analyze",
				completed_stages: [],
				input_sha256: sha256(requirement),
				asset_refs: [assetRef],
				run_ids: [],
				output_refs: [],
				blockers: declaredCases.data.gaps,
			},
			"native-matrix-task",
		),
	);
	const reserved = await store.reserveRun(
		artifact(
			"run",
			{
				task_id: "native-matrix-task",
				request_id: "synthetic-unlaunched",
				asset_ref: assetRef,
				environment_id: "test",
				deployment_version: "synthetic-no-deployment",
				role: "read-only fixture",
				plan: declaredCases.data.cases.map((c) => ({
					instance_id: `instance-${c.case_id}`,
					case_id: c.case_id,
					revision: "v1",
					data_row_id: c.data_row_id,
					browser_project: c.browser_project,
				})),
				state: "pending",
				command: [],
				process_token: "never-launched",
				output_refs: [],
			},
			"synthetic-unlaunched-plan",
		),
	);
	assert.equal(reserved.created, true);
	return {
		engine: "ui",
		workspace,
		reference: reserved.ref,
		synthetic: true,
		sourceFiles: await nativeMatrixFiles(workspace),
	};
}
