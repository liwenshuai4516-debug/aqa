/** Prepare diagnostic inputs without executing the unapproved browser candidate. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Script } from "node:vm";
import { Ajv } from "ajv";
import {
	ArtifactStore,
	assetDigest,
	checkDesign,
	diagnosticSpecSchema,
	sha256,
	validateEnvironment,
} from "pi-ui-testing";
import { createProbeServer, probes, probePage } from "./fixtures/data-space/ui-multifunction-probes.mjs";
import { optimizationPage, optimizationScope } from "./fixtures/data-space/ui-optimization-page.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const output = join(repo, "tests/scratch/ui-multifunction-probes", String(Date.now()));
const root = join(output, "project");
await mkdir(root, { recursive: true });
const result = {
	status: "FAIL",
	checks: [],
	modelCalls: 0,
	browserStarts: 0,
	diagnosticCalls: 0,
	formalRunnerCalls: 0,
	httpChecks: [],
};
const servers = [],
	children = [];
const spawned = ({ process }) => children.push(process.spawnargs);
let observing = false;
try {
	const history = JSON.parse(
		await readFile(join(repo, "docs/ui-testing-evidence/optimization-u05-source-candidate.json"), "utf8"),
	);
	const archive = join(repo, history.evidence.archive);
	assert.equal(sha256(await readFile(archive)), history.evidence.archive_sha256);
	await promisify(execFile)("tar", ["-xzf", archive, "-C", root]);
	await symlink(join(repo, "node_modules"), join(root, "node_modules"), "dir");
	subscribe("child_process", spawned);
	observing = true;
	const store = new ArtifactStore(root),
		old = await store.load(history.asset_ref);
	const scope = await store.load(old.data.scope_ref);
	const base = "qa/ui/assets/u05-full-declaration/revisions/v2-probes";
	const frozen = await store.putFile(
		`${base}/ui-optimization-page.mjs`,
		await readFile(join(repo, "tests/fixtures/data-space/ui-optimization-page.mjs")),
	);
	const mutation = await store.putFile(
		`${base}/ui-multifunction-probes.mjs`,
		await readFile(join(repo, "tests/fixtures/data-space/ui-multifunction-probes.mjs")),
	);
	const originalCode = await readFile(join(root, old.data.bindings[0].script_ref.path), "utf8");
	let code = originalCode.replace(
		"test.beforeEach(async ({ page }) => {",
		`test.beforeEach(async ({ page, context }, testInfo) => {
	await context.setExtraHTTPHeaders({ "x-u05-case": testInfo.title.split(" ")[0] });`,
	);
	code = code.replace(
		"const viewer = await browser.newContext();",
		'const viewer = await browser.newContext({ extraHTTPHeaders: { "x-u05-case": "C-permission" } });',
	);
	assert.notEqual(code, originalCode);
	assert.equal(
		code
			.replace(
				/test.beforeEach\(async \(\{ page, context \}, testInfo\) => \{\n\tawait context.setExtraHTTPHeaders\(\{ "x-u05-case": testInfo.title.split\(" "\)\[0\] \}\);/,
				"test.beforeEach(async ({ page }) => {",
			)
			.replace(
				'const viewer = await browser.newContext({ extraHTTPHeaders: { "x-u05-case": "C-permission" } });',
				"const viewer = await browser.newContext();",
			),
		originalCode,
	);
	const script = await store.putFile(`${base}/candidate.spec.ts`, code);
	const files = [frozen, mutation, script],
		spec = { timeout_ms: 30000, probes: [] },
		deployments = [];
	const caseIds = old.data.bindings.map((binding) => binding.case_id);
	const ids = optimizationScope.features.flatMap((feature) =>
		feature.assertions.map((_, i) => `A-${feature.id}-${i + 1}`),
	);
	assert.deepEqual(
		probes.map((probe) => probe.assertionId),
		ids,
	);
	for (const probe of [{ assertionId: "positive" }, ...probes]) {
		const id = probe.assertionId,
			server = createProbeServer(id);
		servers.push(server);
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		const port = server.address().port;
		assert.ok(port >= 8900);
		const url = `http://127.0.0.1:${port}`;
		for (const caseId of [...caseIds, ""]) {
			const response = await fetch(url, { headers: { "x-u05-case": caseId } });
			assert.equal(response.status, 200);
			const html = await response.text();
			assert.equal(html, probePage(id, caseId));
			result.httpChecks.push({ probe: id, caseId, status: response.status, sha256: sha256(html) });
			if (id === "positive" || caseId !== probe.caseId) assert.equal(html, optimizationPage());
			else assert.notEqual(html, optimizationPage());
			new Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
		}
		assert.equal((await fetch(url + "/outside")).status, 404);
		const environment = validateEnvironment({
			schema_version: "1.0",
			environment_id: id === "positive" ? scope.data.environment_id : id,
			deployment_version: id === "positive" ? "u00-1" : `u00-1-${id}`,
			base_url: url,
			role: scope.data.role,
			identity: { selector: "#identity", text: "Role: tester" },
			initial_state: { selector: "[role=status]", text: "Ready" },
			auth: { kind: "none" },
			isolation: "context",
			timeout_ms: 10000,
		});
		const environmentRef = await store.putFile(`${base}/${id}.environment.json`, JSON.stringify(environment));
		const configRef = await store.putFile(
			`${base}/${id}.config.mjs`,
			`export default {testDir:'.',testMatch:'candidate.spec.ts',workers:1,retries:0,timeout:15000,use:{baseURL:${JSON.stringify(url)},headless:true},projects:[{name:'chromium',use:{browserName:'chromium'}}]};`,
		);
		files.push(environmentRef, configRef);
		deployments.push({
			id,
			url,
			case_id: probe.caseId ?? null,
			status: "http-source-checked-browser-unchecked-server-closed-after-preparation",
		});
		if (id === "positive") Object.assign(spec, { environment_ref: environmentRef, config_ref: configRef });
		else
			spec.probes.push({
				id,
				environment_ref: environmentRef,
				config_ref: configRef,
				mutation_refs: [mutation, frozen],
				description: probe.description,
				assertion_ids: [id],
			});
	}
	assert.equal(new Set(deployments.map((d) => d.url)).size, 14);
	result.checks.push(
		"Thirteen declared faults are isolated to their target case; all other cases and preflight receive byte-identical frozen HTML across fourteen distinct local origins",
	);
	const validate = new Ajv({ strict: true, allErrors: true }).compile(diagnosticSpecSchema);
	assert.equal(validate(spec), true, JSON.stringify(validate.errors));
	files.push(await store.putFile(`${base}/diagnostic-plan.json`, JSON.stringify(spec, null, 2)));
	files.push(
		await store.putFile(
			`${base}/deployments.json`,
			JSON.stringify(
				{
					deployments,
					admission:
						"Not ready: servers are closed after preparation; re-establish these exact origins and bytes, perform fresh identity/data checks and independent review before diagnostics. Changed ports/config require a new revision.",
				},
				null,
				2,
			),
		),
	);
	const asset = structuredClone(old);
	const cases = structuredClone(await store.load(old.data.cases_ref));
	cases.id = "u05-source-candidate-probes";
	cases.created_at = new Date().toISOString();
	cases.data.gaps = [
		"Diagnostic sources prepared; independent review, browser validation of positive/negative controls and runtime admission remain pending.",
	];
	asset.data.cases_ref = await store.put(cases);
	asset.data.revision = "v2-probes";
	asset.created_at = new Date().toISOString();
	asset.data.files = [...old.data.files.filter((ref) => ref.path !== old.data.bindings[0].script_ref.path), ...files];
	asset.data.bindings.forEach((binding) => {
		binding.script_ref = script;
	});
	asset.data.gaps = [
		"Diagnostic inputs are prepared but neither independently reviewed nor browser-validated; no runtime admission.",
		"Historical partial browser tasks remain unchanged; servers are stopped after HTTP source checks.",
	];
	asset.data.content_sha256 = assetDigest(asset);
	const assetRef = await store.put(asset),
		checked = await checkDesign(root, assetRef);
	assert.deepEqual(checked.issues, [], JSON.stringify(checked.issues));
	await store.putFile(`${base}/static-check.json`, JSON.stringify(checked));
	result.checks.push(
		"Native schema accepts fourteen environment/config pairs and thirteen assertion probes; candidate static design checks pass with only explicit case-isolation headers added",
	);
	for (const ref of [history.asset_ref, history.task_ref, ...history.original_task_refs])
		assert.equal(sha256(await readFile(join(root, ref.path))), ref.sha256);
	assert.equal(children.length, 0, JSON.stringify(children));
	result.checks.push(
		"Original candidate and tasks remain immutable; no model, browser, diagnostic or formal execution starts",
	);
	Object.assign(result, {
		status: "PASS",
		assetRef,
		diagnosticSpecRef: files.find((ref) => ref.path.endsWith("diagnostic-plan.json")),
		deployments,
		assertions: ids,
	});
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	if (observing) unsubscribe("child_process", spawned);
	for (const server of servers) {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
