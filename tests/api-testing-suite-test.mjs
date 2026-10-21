/** P1-1 engineering acceptance: real parser/compiler and Newman templates, no model or business target. */
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import vm from "node:vm";
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtime = resolve(process.argv[2] ?? "tests/scratch/api-testing-p1-1/runtime");
cpSync(join(repo, "plugins/api-testing/suite.mjs"), join(runtime, "suite.mjs"));
const { importContract, designCandidates, compileSuite, saveDraft, hash } = await import(
	pathToFileURL(join(runtime, "suite.mjs")).href
);
const output = mkdtempSync(join(tmpdir(), "api-testing-p1-1-"));
const project = join(output, "project");
mkdirSync(project);
cpSync(join(repo, "tests/fixtures/api-testing-workflow/contract.json"), join(project, "contract.json"));
const source = JSON.parse(readFileSync(join(project, "contract.json")));
const checks = [];
const check = (name) => checks.push({ name, status: "passed" });
const load = (operationIds = ["getRecord"]) =>
	importContract({ projectRoot: project, sourcePath: "contract.json", operationIds });
const positive = {
	id: "record-normal",
	operationId: "getRecord",
	request: { path: { id: "r-1" } },
	status: 200,
	checks: [
		{ kind: "exists", pointer: "/id" },
		{ kind: "type", pointer: "/id", value: "string" },
		{ kind: "enum", pointer: "/status", value: ["active", "closed"] },
	],
};
const rule = {
	id: "missing-record",
	operationId: "getRecord",
	status: 404,
	confirmed: true,
	source: "fixture rules: absent IDs return 404/missing",
	description: "ID absent in isolated dataset returns missing",
};
const report = {
	schemaVersion: 1,
	task: "P1-1",
	startedAt: new Date().toISOString(),
	platform: process.platform,
	node: process.version,
	output,
	checks,
};
try {
	const imported = await load();
	assert(
		imported.resolved.paths["/records/{id}"].get.responses["200"].content["application/json"].schema.properties.example,
	);
	assert(!("example" in imported.source.components.schemas.Record.properties.example));
	check("mature-parser-resolves-internal-ref-and-keeps-property-named-example");
	const compile = (cases = [positive], more = {}) =>
		compileSuite({ imported, cases, baseUrl: "http://127.0.0.1:19180", ...more });
	const outlines = designCandidates(imported);
	assert.equal(outlines.length, 2);
	assert(outlines.every((c) => c.state === "needs-input"));
	assert.throws(() => compile(outlines), /needs confirmed input/);
	assert.throws(() => compile([{ ...positive, request: { path: { id: "" } } }]), /violates/);
	check("candidate-outlines-preserve-missing-input-and-request-boundary-validation");
	const suite = compile();
	const saved = saveDraft(project, "draft-1", suite);
	assert.equal(saved.state, "draft");
	const manifest = JSON.parse(readFileSync(join(saved.path, "manifest.json")));
	for (const [name, digest] of Object.entries(manifest.files))
		assert.equal(hash(readFileSync(join(saved.path, name))), digest);
	assert.equal(JSON.parse(suite.files["review.json"]).verdict, "pending");
	assert.equal(JSON.parse(suite.files["cases.json"])[0].checks[1].basis.kind, "contract");
	check("normal-case-traceability-and-frozen-draft-hashes-with-pending-review");
	assert.throws(() => saveDraft(project, "draft-1", suite), /exists/);
	assert.throws(() => saveDraft(project, "../outside", suite), /outside/);
	const external = join(output, "external");
	mkdirSync(external);
	symlinkSync(external, join(project, "escape"));
	assert.throws(() => saveDraft(project, "escape/draft", suite), /outside/);
	check("publication-refuses-overwrite-and-project-escape-including-symlink");
	const negative = {
		id: "record-absent",
		operationId: "getRecord",
		request: { path: { id: "missing" } },
		status: 404,
		negativeRuleId: rule.id,
		checks: [{ kind: "equals", pointer: "/error", value: "missing" }],
	};
	assert.throws(() => compile([negative]), /confirmed rule/);
	assert.equal(JSON.parse(compile([positive, negative], { rules: [rule] }).files["collection.json"]).item.length, 2);
	check("negative-status-requires-explicit-confirmed-input-behavior");
	for (const changed of [
		{ status: 400 },
		{ checks: [{ kind: "equals", pointer: "/id", value: "invented" }] },
		{ checks: [{ kind: "exists", pointer: "/unknown" }] },
		{ checks: [{ kind: "type", pointer: "/note", value: "string" }] },
		{ checks: [] },
		{ request: { path: {} } },
	])
		assert.throws(() => compile([{ ...positive, ...changed }]));
	check("missing-basis-undeclared-status-field-nullability-and-request-input-blocked");
	assert(imported.unsupported.some((u) => u.keyword === "minLength"));
	assert.throws(() => compile([positive], { requiredKeywords: ["minLength"] }), /critical/);
	check("uncovered-keyword-visible-and-critical-constraint-blocks");
	for (const mutate of [
		(s) => {
			s.openapi = "3.1.0";
		},
		(s) => {
			s.paths["/records/{id}"].get.responses["200"].content["application/json"].schema.$ref =
				"#/components/schemas/Absent";
		},
		(s) => {
			s.components.schemas.Record.properties.id = { $ref: "http://127.0.0.1:1/never-fetch" };
		},
		(s) => {
			s.components.schemas.Record.properties.id = { $ref: "file:///never-read" };
		},
	]) {
		const altered = structuredClone(source);
		mutate(altered);
		writeFileSync(join(project, "contract.json"), JSON.stringify(altered));
		await assert.rejects(load);
	}
	writeFileSync(join(project, "contract.json"), JSON.stringify(source));
	await assert.rejects(() => load(["missing"]), /missing/);
	check("unsupported-format-missing-ref-remote-file-refs-and-operation-blocked");
	const auth = structuredClone(imported);
	auth.resolved.security = [{ bearer: [] }];
	assert.throws(
		() => compileSuite({ imported: auth, cases: [positive], baseUrl: "http://127.0.0.1:19180" }),
		/credential/,
	);
	assert.throws(() => compile([positive], { baseUrl: "http://user:password@127.0.0.1:19180" }), /credentials/);
	check("auth-requires-explicit-adapter-and-inline-url-credentials-rejected");
	const businessRule = {
		id: "id-match",
		operationId: "getRecord",
		status: 200,
		pointer: "/id",
		equals: 'quoted"; globalThis.INJECTED = true; //',
		confirmed: true,
		source: "synthetic explicit business rule",
	};
	const exact = {
		...positive,
		id: "safe-literal",
		checks: [{ kind: "equals", pointer: "/id", value: businessRule.equals, ruleId: businessRule.id }],
	};
	const script = JSON.parse(
		compile([exact], { rules: [businessRule] }).files["collection.json"],
	).item[0].event[0].script.exec.join("\n");
	const context = {
		pm: {
			response: { to: { have: { status: (s) => assert.equal(s, 200) } }, json: () => ({ id: businessRule.equals }) },
			test: (_name, fn) => fn(),
			expect: (value) => ({ to: { deep: { equal: (expected) => assert.deepEqual(value, expected) } } }),
		},
	};
	vm.runInNewContext(script, context);
	assert.equal(context.INJECTED, undefined);
	check("fixed-template-escapes-literals-and-does-not-execute-input-code");
	report.status = "passed-engineering-only";
	report.fixtureDraft = saved.path;
} catch (error) {
	report.status = "failed";
	report.error = String(error.stack);
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	writeFileSync(join(output, "summary.json"), JSON.stringify(report, null, 2));
	console.log(
		JSON.stringify(
			{ status: report.status, checks: checks.length, evidence: join(output, "summary.json"), error: report.error },
			null,
			2,
		),
	);
}
