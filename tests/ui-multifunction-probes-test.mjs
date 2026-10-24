/** Prepare diagnostic inputs without executing the unapproved browser candidate. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Script } from "node:vm";
import { createServer, get } from "node:http";
import { Ajv } from "ajv";
import {
	ArtifactStore,
	assetDigest,
	checkDesign,
	diagnosticSpecSchema,
	sha256,
	validateEnvironment,
	UiWorkflowService,
	capabilities,
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
let replay;
const spawned = ({ process }) => children.push(process.spawnargs);
let observing = false;
// Server restart checks require a fresh socket, not a pooled connection to the old listener.
const readPage = (url, headers = {}) =>
	new Promise((resolve, reject) => {
		const request = get(url, { agent: false, headers }, (response) => {
			const chunks = [];
			response.on("data", (chunk) => chunks.push(chunk));
			response.on("error", reject);
			response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
		});
		request.on("error", reject);
		request.setTimeout(5000, () => request.destroy(new Error("Fixture HTTP read timed out")));
	});
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
	const prior = JSON.parse(await readFile(join(repo, "docs/ui-testing-evidence/optimization-u05-probes.json"), "utf8"));
	assert.equal(sha256(await readFile(join(repo, prior.evidence.archive))), prior.evidence.archive_sha256);
	const scope = structuredClone(await store.load(old.data.scope_ref));
	scope.id = "u05-diagnostic-prepared";
	scope.created_at = new Date().toISOString();
	scope.data.environment_id = "u05-synthetic";
	scope.data.goal =
		"Prepare all six u00-1 features and thirteen assertions for independent design review and gated synthetic diagnostics. Preserve original partial browser tasks; this source candidate does not complete them.";
	scope.data.allowed_actions = [
		"Prepare and restore only the declared loopback synthetic copies; no external business target, personal credentials or shared data.",
		"Each test uses a fresh context; localStorage writes stay within the synthetic origin. Close owned contexts and servers for cleanup.",
		"User authorized up to three additional native U05 independent reviews on 2026-10-24. Preparation itself makes no model calls; diagnostics still require trusted design approval.",
		"Diagnostics require design approval; formal execution additionally requires runtime admission and fresh environment/data checks. Record mode does not auto-execute.",
	];
	const base = "qa/ui/assets/u05-full-declaration/revisions/v3-replay";
	const frozen = await store.putFile(
		`${base}/ui-optimization-page.mjs`,
		await readFile(join(repo, "tests/fixtures/data-space/ui-optimization-page.mjs")),
	);
	const mutation = await store.putFile(
		`${base}/ui-multifunction-probes.mjs`,
		await readFile(join(repo, "tests/fixtures/data-space/ui-multifunction-probes.mjs")),
	);
	const launcher = await store.putFile(
		`${base}/ui-probe-replay.mjs`,
		await readFile(join(repo, "tests/fixtures/data-space/ui-probe-replay.mjs")),
	);
	const { startProbeServers } = await import(pathToFileURL(join(root, launcher.path)).href);
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
	const files = [frozen, mutation, launcher, script],
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
			const response = await readPage(url, { "x-u05-case": caseId });
			assert.equal(response.status, 200);
			const html = response.body;
			assert.equal(html, probePage(id, caseId));
			result.httpChecks.push({ probe: id, caseId, status: response.status, sha256: sha256(html) });
			if (id === "positive" || caseId !== probe.caseId) assert.equal(html, optimizationPage());
			else assert.notEqual(html, optimizationPage());
			new Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
		}
		assert.equal((await readPage(url + "/outside")).status, 404);
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
				mutation_refs: [mutation, frozen, launcher],
				description: probe.description,
				assertion_ids: [id],
			});
	}
	assert.equal(new Set(deployments.map((d) => d.url)).size, 14);
	result.checks.push(
		"Thirteen declared faults are isolated to their target case; all other cases and preflight receive byte-identical frozen HTML across fourteen distinct local origins",
	);
	for (const server of servers) {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
	const occupied = createServer((_request, response) => response.end("owned conflict sentinel"));
	await new Promise((resolve) => occupied.listen(Number(new URL(deployments[1].url).port), "127.0.0.1", resolve));
	try {
		await assert.rejects(startProbeServers(deployments), (error) => error.code === "EADDRINUSE");
		assert.equal((await readPage(deployments[1].url)).body, "owned conflict sentinel");
		await assert.rejects(readPage(deployments[0].url), (error) => error.code === "ECONNREFUSED");
	} finally {
		occupied.closeAllConnections();
		await new Promise((resolve) => occupied.close(resolve));
	}
	replay = await startProbeServers(deployments);
	for (const expected of result.httpChecks) {
		const url = deployments.find((entry) => entry.id === expected.probe).url;
		const response = await readPage(url, { "x-u05-case": expected.caseId });
		assert.equal(response.status, expected.status);
		assert.equal(sha256(response.body), expected.sha256);
	}
	await replay.close();
	replay = undefined;
	result.checks.push(
		"All fourteen exact origins restore with identical HTTP bytes; an occupied port rejects without fallback, preserves the listener and closes only partially started owned servers",
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
						"Not ready: servers are closed after preparation. Run node ui-probe-replay.mjs in this revision directory to restore the declared origins; occupied ports fail without fallback. Perform fresh identity/data checks and independent review before diagnostics. Changed ports/config require a new revision.",
				},
				null,
				2,
			),
		),
	);
	const asset = structuredClone(old);
	scope.data.base_url = deployments[0].url;
	const scopeRef = await store.put(scope);
	const inventory = structuredClone(await store.load(old.data.inventory_ref));
	inventory.id = "u05-diagnostic-prepared";
	inventory.created_at = new Date().toISOString();
	inventory.data.scope_ref = scopeRef;
	const inventoryRef = await store.put(inventory);
	asset.data.scope_ref = scopeRef;
	asset.data.inventory_ref = inventoryRef;
	const cases = structuredClone(await store.load(old.data.cases_ref));
	cases.id = "u05-diagnostic-prepared";
	cases.created_at = new Date().toISOString();
	cases.data.scope_ref = scopeRef;
	cases.data.gaps = [
		"Diagnostic sources prepared; independent review, browser validation of positive/negative controls and runtime admission remain pending.",
	];
	asset.data.cases_ref = await store.put(cases);
	asset.data.revision = "v3-replay";
	asset.created_at = new Date().toISOString();
	asset.data.files = [...old.data.files.filter((ref) => ref.path !== old.data.bindings[0].script_ref.path), ...files];
	asset.data.bindings.forEach((binding) => {
		binding.script_ref = script;
	});
	asset.data.gaps = [
		"Diagnostic inputs are prepared but neither independently reviewed nor browser-validated; no runtime admission.",
		"Historical partial browser tasks remain unchanged; servers are stopped after HTTP source checks.",
	];
	asset.data.files.push(
		await store.putFile(
			`${base}/lineage.json`,
			JSON.stringify({
				prior_source_asset: history.asset_ref,
				prior_source_task: history.task_ref,
				prior_probe_archive: prior.evidence.archive,
				prior_probe_archive_sha256: prior.evidence.archive_sha256,
				prior_probe_asset_path: prior.assetRef.path,
				prior_probe_asset_sha256: prior.assetRef.sha256,
				reason:
					"Scope now describes the declared synthetic target and conditional execution gates; exact-origin replay is included. Original tasks and partial evidence stay unchanged.",
				review_budget:
					"No design reviews have been called for these U05 source revisions. User authorized up to three additional native U05 reviews on 2026-10-24; all revisions share that limit. Historical 18/18 usage is preserved.",
			}),
		),
	);
	asset.data.content_sha256 = assetDigest(asset);
	const assetRef = await store.put(asset),
		checked = await checkDesign(root, assetRef);
	assert.deepEqual(checked.issues, [], JSON.stringify(checked.issues));
	await store.putFile(`${base}/static-check.json`, JSON.stringify(checked));
	const runtime = {
		tools: ["read", ...capabilities.map((item) => item.tool)],
		skills: await readdir(join(repo, "node_modules/pi-ui-testing/skills")),
	};
	const workflow = new UiWorkflowService(root, join(output, "private-authority"), runtime);
	let task = await workflow.start({
		task_id: "u05-diagnostic-prepared",
		mode: "record",
		discovery: "source",
		scope_ref: scopeRef,
	});
	task = await workflow.checkpoint(task.task_ref, "discover-record", [inventoryRef]);
	task = await workflow.checkpoint(task.task_ref, "case-design", [assetRef]);
	assert.equal(task.next_stage, "design-review");
	await assert.rejects(workflow.checkpoint(task.task_ref, "design-review", [assetRef]), /设计评估/);
	task = await workflow.block(task.task_ref, [
		"Independent native review is authorized but has not yet run. Original source/partial tasks are not completed or superseded.",
	]);
	assert.equal(task.task.data.state, "blocked");
	assert.equal(
		(await workflow.catalog()).assets.find((entry) => entry.asset_ref.path === assetRef.path).runtime_ready,
		false,
	);
	result.checks.push(
		"Native schema accepts fourteen environment/config pairs and thirteen assertion probes; candidate static design checks pass with only explicit case-isolation headers added",
	);
	result.checks.push(
		"Revised scope, inventory, cases and diagnostic environment agree; native source handoff reaches review, remains blocked and cannot acquire runtime readiness",
	);
	for (const ref of [history.asset_ref, history.task_ref, ...history.original_task_refs])
		assert.equal(sha256(await readFile(join(root, ref.path))), ref.sha256);
	assert.equal(children.length, 0, JSON.stringify(children));
	assert.equal(sha256(await readFile(join(repo, prior.evidence.archive))), prior.evidence.archive_sha256);
	result.checks.push(
		"Original candidate and tasks remain immutable; no model, browser, diagnostic or formal execution starts",
	);
	Object.assign(result, {
		status: "PASS",
		assetRef,
		taskRef: task.task_ref,
		scopeRef,
		diagnosticSpecRef: files.find((ref) => ref.path.endsWith("diagnostic-plan.json")),
		deployments,
		assertions: ids,
	});
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	if (observing) unsubscribe("child_process", spawned);
	await replay?.close();
	for (const server of servers) {
		server.closeAllConnections();
		if (server.listening) await new Promise((resolve) => server.close(resolve));
	}
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
