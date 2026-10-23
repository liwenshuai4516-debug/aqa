import { afterEach, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TestAssetReader, type TestFileRef } from "../../server/test-asset-reader";

const roots: string[] = [];
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const bytes = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "draft-reader-")));
	roots.push(root);
	const workspace = join(root, "workspace"),
		data = join(root, "data"),
		other = join(root, "other");
	mkdirSync(workspace);
	mkdirSync(other);
	return { root, workspace, data, other, reader: new TestAssetReader(data) };
}
function write(root: string, path: string, value: unknown): TestFileRef {
	const content = bytes(value);
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), content);
	return { path, sha256: hash(content) };
}
async function uiFixture() {
	const f = fixture();
	const runtime = "pi-ui-testing";
	const { ArtifactStore, assetDigest } = await import(runtime);
	const store = new ArtifactStore(f.workspace);
	const source = write(f.workspace, "requirements.json", { title: "Search returns rows" });
	const sources = [{ source_id: "S1", oracle_type: "requirement", ref: source, statement: "Search returns rows" }];
	const artifact = (kind: string, id: string, data: unknown) => ({
		schema_version: "1.0",
		kind,
		id,
		created_at: "2026-06-01T00:00:00.000Z",
		data,
	});
	const scope = await store.put(
		artifact("scope", "scope1", {
			project_id: "project1",
			environment_id: "test",
			role: "tester",
			goal: "Search",
			base_url: "http://127.0.0.1:18980",
			allowed_actions: ["read"],
			sources,
			budget: { max_review_rounds: 1, max_tool_calls: 10 },
		}),
	);
	const rules = write(f.workspace, "qa/ui/cases/cases1/data-rules.json", { isolation: "synthetic" });
	const cases = await store.put(
		artifact("cases", "cases1", {
			scope_ref: scope,
			sources,
			data_rules_ref: rules,
			gaps: ["Not reviewed or executed"],
			cases: [
				{
					case_id: "C1",
					module_id: "search",
					feature_id: "query",
					scenario_id: "normal",
					title: "Search rows",
					priority: "P0",
					preconditions: ["Authenticated"],
					steps: [{ step_id: "step1", action: "Search", assertion_ids: ["A1"] }],
					assertions: [
						{
							assertion_id: "A1",
							step_id: "step1",
							source_id: "S1",
							oracle_type: "requirement",
							target: "rows",
							comparison: "equals",
							expected: 1,
							observation: "Row count",
							evidence_required: true,
						},
					],
					cleanup: "No writes",
					data_row_id: "row1",
					browser_project: "chromium",
				},
			],
		}),
	);
	const script = write(f.workspace, "qa/ui/assets/asset1/revisions/v1/test.json", { script: "design-only" });
	const asset = artifact("asset", "asset1", {
		revision: "v1",
		module_ids: ["search"],
		scope_ref: scope,
		cases_ref: cases,
		recording_refs: [],
		files: [script],
		dependencies: [],
		readiness: "design-only",
		content_sha256: "0".repeat(64),
		gaps: [],
	});
	(asset.data as any).content_sha256 = assetDigest(asset);
	const assetRef = await store.put(asset);
	return { ...f, cases, scope, source, rules, assetRef, artifact };
}
async function apiFixture() {
	const f = fixture(),
		plugin = join(f.data, "plugins/api-testing");
	mkdirSync(plugin, { recursive: true });
	for (const name of ["suite.mjs", "review.mjs"]) cpSync(resolve("plugins/api-testing", name), join(plugin, name));
	symlinkSync(resolve("plugins/api-testing/node_modules"), join(plugin, "node_modules"), "dir");
	const { importContract, compileSuite, saveDraft } = await import(pathToFileURL(join(plugin, "suite.mjs")).href);
	const review = await import(pathToFileURL(join(plugin, "review.mjs")).href);
	cpSync(resolve("tests/fixtures/api-testing-workflow/contract.json"), join(f.workspace, "source.json"));
	const imported = await importContract({
		projectRoot: f.workspace,
		sourcePath: "source.json",
		operationIds: ["getRecord"],
	});
	const suite = compileSuite({
		imported,
		baseUrl: "http://127.0.0.1:18980",
		cases: [
			{
				id: "C1",
				operationId: "getRecord",
				request: { path: { id: "r-1" } },
				status: 200,
				checks: [{ kind: "type", pointer: "/id", value: "string" }],
			},
		],
	});
	const draft = saveDraft(f.workspace, "draft", suite);
	const ref = { path: "draft/manifest.json", sha256: draft.manifestSha256 };
	return { ...f, ref, draft: draft.path, review };
}

it("reads independent native UI cases without approval, execution or asset registration", async () => {
	const f = await uiFixture();
	const result = await f.reader.inspect("ui", f.workspace, f.cases);
	expect(result.cases[0]).toMatchObject({ moduleId: "search", featureId: "query" });
	expect(result).toMatchObject({
		executable: false,
		revision: f.cases.sha256,
		assetRef: f.cases,
		workspace: f.workspace,
		environment: { id: "test", baseUrl: "http://127.0.0.1:18980" },
		cases: [
			{
				id: "C1",
				title: "Search rows",
				priority: "P0",
				preconditions: ["Authenticated"],
				steps: [{ action: "Search", expect: "rows equals 1" }],
			},
		],
	});
	expect(await f.reader.list("ui", f.workspace)).toEqual([]);
	expect(await f.reader.inspect("ui", f.workspace, f.assetRef)).toMatchObject({ executable: true, revision: "v1" });
});

it.each(["manifest", "scope", "source", "rules"])(
	"rejects UI %s tampering using native hash/source checks",
	async (target) => {
		const f = await uiFixture();
		const ref =
			target === "manifest" ? f.cases : target === "scope" ? f.scope : target === "source" ? f.source : f.rules;
		writeFileSync(
			join(f.workspace, ref.path),
			Buffer.concat([readFileSync(join(f.workspace, ref.path)), Buffer.from(" ")]),
		);
		await expect(f.reader.inspect("ui", f.workspace, f.cases)).rejects.toThrow(/摘要/);
	},
);

it("rejects UI wrong workspace, traversal, external symlink and mismatched artifact identity", async () => {
	const f = await uiFixture();
	await expect(f.reader.inspect("ui", f.other, f.cases)).rejects.toThrow();
	await expect(
		f.reader.inspect("ui", f.workspace, { ...f.cases, path: "qa/ui/cases/../../../requirements.json/manifest.json" }),
	).rejects.toThrow();
	mkdirSync(join(f.other, "qa/ui"), { recursive: true });
	symlinkSync(join(f.workspace, "qa/ui/cases"), join(f.other, "qa/ui/cases"), "dir");
	await expect(f.reader.inspect("ui", f.other, f.cases)).rejects.toThrow(/边界/);
	const wrong = write(
		f.workspace,
		"qa/ui/cases/wrong/manifest.json",
		JSON.parse(readFileSync(join(f.workspace, f.scope.path), "utf8")),
	);
	await expect(f.reader.inspect("ui", f.workspace, wrong)).rejects.toThrow(/身份/);
});

it("reads compiler-produced unreviewed API draft with verified revision and no runs", async () => {
	const f = await apiFixture();
	expect(JSON.parse(readFileSync(join(f.draft, "manifest.json"), "utf8")).state).toBe("draft");
	const result = await f.reader.inspect("api", f.workspace, f.ref);
	expect(result).toMatchObject({
		executable: false,
		revision: f.ref.sha256,
		assetRef: f.ref,
		workspace: f.workspace,
		environment: { id: "", baseUrl: "http://127.0.0.1:18980" },
		cases: [{ id: "C1", title: "getRecord", steps: [{ action: "调用 getRecord（请求数据见原生资产）" }] }],
	});
	expect(await f.reader.list("api", f.workspace)).toEqual([]);
});

it.each(["manifest.json", "cases.json", "source.json", "collection.json"])("rejects API %s tampering", async (name) => {
	const f = await apiFixture(),
		path = join(f.draft, name);
	writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from(" ")]));
	await expect(f.reader.inspect("api", f.workspace, f.ref)).rejects.toThrow(/hash|digest/i);
});

it("rejects API collection tampering even with updated manifest and reference hashes", async () => {
	const f = await apiFixture();
	const collection = JSON.parse(readFileSync(join(f.draft, "collection.json"), "utf8"));
	collection.item[0].event[0].script.exec.push("pm.test('weakened',()=>true);");
	writeFileSync(join(f.draft, "collection.json"), bytes(collection));
	const manifest = JSON.parse(readFileSync(join(f.draft, "manifest.json"), "utf8"));
	manifest.files["collection.json"] = hash(readFileSync(join(f.draft, "collection.json")));
	manifest.collectionSha256 = manifest.files["collection.json"];
	const ref = write(f.workspace, f.ref.path, manifest);
	await expect(f.reader.inspect("api", f.workspace, ref)).rejects.toThrow(/recompilation/);
});

it("rejects API traversal, absolute paths, wrong workspace and external symlinks", async () => {
	const f = await apiFixture();
	for (const path of [
		"../workspace/draft/manifest.json",
		join(f.draft, "manifest.json"),
		"draft/./manifest.json",
		"draft//manifest.json",
		"draft/../draft/manifest.json",
	]) {
		await expect(f.reader.inspect("api", f.workspace, { ...f.ref, path })).rejects.toThrow(/path/);
	}
	await expect(f.reader.inspect("api", f.other, f.ref)).rejects.toThrow();
	symlinkSync(f.draft, join(f.other, "draft"), "dir");
	await expect(f.reader.inspect("api", f.other, f.ref)).rejects.toThrow(/escapes/);
	rmSync(join(f.draft, "cases.json"));
	writeFileSync(join(f.other, "cases.json"), "[]");
	symlinkSync(join(f.other, "cases.json"), join(f.draft, "cases.json"));
	await expect(f.reader.inspect("api", f.workspace, f.ref)).rejects.toThrow(/escapes/);
});

it("does not treat API draft digest as a frozen asset or accept draft refs as run ids", async () => {
	const f = await apiFixture();
	await expect(f.reader.inspect("api", f.workspace, f.ref.sha256)).rejects.toThrow();
	await expect(f.reader.read("api", f.workspace, f.ref)).rejects.toThrow(/run id/);
	const ui = await uiFixture();
	await expect(ui.reader.read("ui", ui.workspace, ui.cases)).rejects.toThrow(/artifact reference/);
});

it("rejects forged API run using a draft ref even when native draft inspection succeeds", async () => {
	const f = await apiFixture(),
		runId = "11111111-1111-1111-1111-111111111111";
	write(f.data, `api-testing/assets/${hash(f.workspace)}/runs/${runId}/run.json`, {
		runId,
		projectRoot: f.workspace,
		status: "unknown",
		assetRef: f.ref,
	});
	await expect(f.reader.read("api", f.workspace, runId)).rejects.toThrow(/draft|frozen|executable/i);
});

it("rejects forged UI run using cases as asset_ref", async () => {
	const f = await uiFixture();
	const ref = write(
		f.workspace,
		"qa/ui/runs/run1/manifest.json",
		f.artifact("run", "run1", {
			task_id: "task1",
			request_id: "request1",
			asset_ref: f.cases,
			environment_id: "test",
			deployment_version: "test",
			role: "tester",
			plan: [{ instance_id: "I1", case_id: "C1", revision: "v1", data_row_id: "row1", browser_project: "chromium" }],
			state: "unknown",
			command: [],
			process_token: "process1",
			output_refs: [],
		}),
	);
	await expect(f.reader.read("ui", f.workspace, ref)).rejects.toThrow(/draft|frozen|executable/i);
});
