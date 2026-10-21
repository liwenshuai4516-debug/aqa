/** P1-2 engineering controls with explicit model stubs; not actual model acceptance. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtime = resolve(process.argv[2] ?? "tests/scratch/api-testing-p1-1/runtime");
for (const name of ["suite.mjs", "review.mjs"]) cpSync(join(repo, "plugins/api-testing", name), join(runtime, name));
const { importContract, compileSuite, saveDraft, hash } = await import(pathToFileURL(join(runtime, "suite.mjs")).href);
const { inspectDraft, reviewDraft } = await import(pathToFileURL(join(runtime, "review.mjs")).href);
const output = mkdtempSync(join(tmpdir(), "api-testing-p1-2-"));
const project = join(output, "project");
mkdirSync(project);
cpSync(join(repo, "tests/fixtures/api-testing-workflow/contract.json"), join(project, "source.json"));
const imported = await importContract({ projectRoot: project, sourcePath: "source.json", operationIds: ["getRecord"] });
let serial = 0;
const create = (value = "r-1") =>
	saveDraft(
		project,
		"draft-" + ++serial,
		compileSuite({
			imported,
			baseUrl: "http://127.0.0.1:19180",
			cases: [
				{
					id: "normal",
					operationId: "getRecord",
					request: { path: { id: value } },
					status: 200,
					checks: [{ kind: "type", pointer: "/id", value: "string" }],
				},
			],
		}),
	).path;
const pass = async (req) => ({
	ok: true,
	model: "explicit-test-stub",
	usage: { input: 10, output: 5 },
	text: JSON.stringify({ verdict: "pass", artifactHash: JSON.parse(req.prompt).artifactHash, findings: [] }),
});
const change = async (req) => ({
	ok: true,
	model: "explicit-test-stub",
	text: JSON.stringify({
		verdict: "revise",
		artifactHash: JSON.parse(req.prompt).artifactHash,
		findings: [{ caseId: "normal", code: "FIXTURE_DATA", message: "Use fixture ID r-2" }],
	}),
});
const checks = [],
	runs = [];
const check = (name) => checks.push({ name, status: "passed" });
const report = {
	schemaVersion: 1,
	task: "P1-2",
	environment: "explicit model stubs; no actual provider/model",
	startedAt: new Date().toISOString(),
	checks,
	runs,
	output,
};
const run = async (path, options = {}) => {
	const r = await reviewDraft({ projectRoot: project, bundlePath: path, complete: pass, ...options });
	runs.push(r);
	return r;
};
try {
	const draft = create();
	const inspected = await inspectDraft(project, draft);
	assert.equal(inspected.artifactHash, JSON.parse(readFileSync(join(draft, "manifest.json"))).collectionSha256);
	const approved = await run(draft);
	assert.equal(approved.verdict, "pass");
	assert.equal(approved.budget.calls, 1);
	assert.equal(approved.budget.inputTokens, 10);
	assert.equal(approved.suiteHash, inspected.suiteHash);
	check("deterministic-recompile-and-independent-structured-review-bind-exact-artifact");
	let calls = 0;
	const fixed = create("r-2");
	const corrected = await run(create(), {
		complete: async (req) => (++calls === 1 ? change(req) : pass(req)),
		revise: async ({ findings }) => {
			assert.equal(findings[0].code, "FIXTURE_DATA");
			return fixed;
		},
	});
	assert.equal(corrected.verdict, "pass");
	assert.equal(corrected.attempts.length, 2);
	assert.equal(corrected.budget.calls, 2);
	assert.notEqual(corrected.attempts[0].artifactHash, corrected.attempts[1].artifactHash);
	assert.equal(corrected.budget.inputTokens, "unknown");
	check("semantic-return-correction-and-fresh-hash-pass-with-history-and-unknown-usage");
	const unchanged = create();
	const stopped = await run(unchanged, { complete: change, revise: async () => unchanged });
	assert.equal(stopped.reason, "two-rounds-without-improvement");
	assert.equal(stopped.budget.calls, 2);
	check("two-unchanged-rounds-stop-without-budget-reset");
	const invalid = create();
	const collection = JSON.parse(readFileSync(join(invalid, "collection.json")));
	collection.item[0].event[0].script.exec.push("pm.test('weakened',()=>true);");
	writeFileSync(join(invalid, "collection.json"), JSON.stringify(collection, null, 2) + "\n");
	const manifest = JSON.parse(readFileSync(join(invalid, "manifest.json")));
	manifest.files["collection.json"] = hash(readFileSync(join(invalid, "collection.json")));
	manifest.collectionSha256 = manifest.files["collection.json"];
	writeFileSync(join(invalid, "manifest.json"), JSON.stringify(manifest));
	let invoked = false;
	const rejected = await run(invalid, {
		complete: async () => {
			invoked = true;
			throw new Error("must not call");
		},
	});
	assert.equal(invoked, false);
	assert.equal(rejected.verdict, "revise");
	assert.equal(rejected.attempts[0].findings[0].code, "DETERMINISTIC_CHECK");
	check("tampered-script-even-with-rehashed-manifest-rejected-before-model");
	const blocked = await run(create(), {
		complete: async (req) => ({
			ok: true,
			text: JSON.stringify({
				verdict: "blocked",
				artifactHash: JSON.parse(req.prompt).artifactHash,
				findings: [{ caseId: "normal", code: "NEEDS_RULE", message: "Missing confirmed rule" }],
			}),
		}),
	});
	assert.equal(blocked.reason, "missing-business-facts");
	check("missing-facts-block-instead-of-inventing-business-behavior");
	for (const response of [
		{ ok: true, text: "{invalid" },
		{ ok: true, text: "x".repeat(3000) },
		{ ok: true, text: JSON.stringify({ verdict: "pass", artifactHash: "a".repeat(64), findings: [] }) },
	]) {
		const result = await run(create(), { complete: async () => response });
		assert.equal(result.verdict, "revise");
		assert.equal(result.budget.calls, 1);
	}
	check("invalid-truncated-and-wrong-hash-output-counted-and-not-approved");
	const unavailable = await run(create(), { complete: undefined });
	assert.equal(unavailable.reason, "model-unavailable");
	assert.equal(unavailable.budget.calls, 0);
	const failure = await run(create(), { complete: async () => ({ ok: false, error: "no test model" }) });
	assert.equal(failure.reason, "model-unavailable");
	assert.equal(failure.budget.calls, 1);
	check("absent-and-unavailable-models-exit-without-false-pass");
	const budgeted = await run(create(), { complete: change, revise: async () => create("changed"), maxCalls: 1 });
	assert.equal(budgeted.reason, "model-call-budget");
	assert.equal(budgeted.budget.calls, 1);
	check("call-budget-covers-correction-rounds");
	const controller = new AbortController();
	const canceled = await run(create(), {
		signal: controller.signal,
		complete: async () => {
			controller.abort();
			return new Promise(() => {});
		},
	});
	assert.equal(canceled.reason, "CANCELED");
	assert.equal(canceled.budget.calls, 1);
	check("cancellation-prevents-late-approval");
	const bounded = await run(create(), { timeoutMs: 100 });
	assert.equal(bounded.reason, "overall-time-budget");
	assert.equal(bounded.budget.calls, 0);
	check("insufficient-overall-budget-does-not-start-model");
	const timed = await run(create(), { timeoutMs: 5100, complete: async () => new Promise(() => {}) });
	assert.equal(timed.reason, "MODEL_TIMEOUT");
	assert.equal(timed.budget.calls, 1);
	check("started-model-timeout-exits-without-approval-or-retry");
	report.status = "passed-controls-model-stub-only";
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
