/** Add immutable diagnostic inputs to the recorded browser candidate; no browser/model execution. */
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { get, createServer } from "node:http";
import { Script } from "node:vm";
import { Ajv } from "ajv";
import {
	ArtifactStore,
	assetDigest,
	checkDesign,
	sha256,
	validateEnvironment,
	UiWorkflowService,
	capabilities,
} from "pi-ui-testing";
import { optimizationPage } from "./fixtures/data-space/ui-optimization-page.mjs";
import { probes } from "./fixtures/data-space/ui-multifunction-probes.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const root = resolve(process.argv[2]);
const revision = process.argv[3] ?? "v4-diagnostics";
assert.match(revision, /^v[0-9]+-diagnostics$/);
const output = join(root, `browser-${revision}.json`);
const store = new ArtifactStore(root);
const prior = JSON.parse(await readFile(join(root, "review-revision-v2.json"), "utf8"));
const original = JSON.parse(await readFile(join(root, "result.json"), "utf8"));
const old = await store.load(prior.assetRef);
const scope = await store.load(old.data.scope_ref);
const base = `qa/ui/assets/u05-browser-candidate/revisions/${revision}`;
const result = {
	status: "FAIL",
	checks: [],
	httpChecks: [],
	modelCalls: 0,
	browserStarts: 0,
	diagnosticCalls: 0,
	formalRunnerCalls: 0,
};
const servers = [];
let replay;
const readPage = (url, caseId = "") =>
	new Promise((resolve, reject) => {
		const request = get(url, { agent: false, headers: { "x-u05-case": caseId } }, (response) => {
			const chunks = [];
			response.on("data", (chunk) => chunks.push(chunk));
			response.on("error", reject);
			response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
		});
		request.on("error", reject);
		request.setTimeout(5000, () => request.destroy(new Error("Fixture HTTP read timed out")));
	});
try {
	assert.equal(prior.status, "PASS");
	const frozenRef = scope.data.sources[0].ref;
	assert.equal(
		sha256(await readFile(join(repo, "tests/fixtures/data-space/ui-optimization-page.mjs"))),
		frozenRef.sha256,
	);
	const files = [];
	const save = async (name, content) => {
		const ref = await store.putFile(`${base}/${name}`, content);
		files.push(ref);
		return ref;
	};
	const frozen = await save("ui-optimization-page.mjs", await readFile(join(root, frozenRef.path)));
	const mutation = await save(
		"ui-multifunction-probes.mjs",
		await readFile(join(repo, "tests/fixtures/data-space/ui-multifunction-probes.mjs")),
	);
	const extended = await save(
		"ui-browser-probes.mjs",
		`import { createServer } from "node:http";
import { optimizationPage } from "./ui-optimization-page.mjs";
import { probes, probePage } from "./ui-multifunction-probes.mjs";
export const browserProbes = [...probes.map(probe => ({...probe, id: probe.assertionId})), {
 assertionId: "A-edit-1", id: "A-edit-1-memory", caseId: "C-edit",
 description: "Cancel incorrectly appends only to memory; reload would hide the defect",
 before: "$('#cancel').onclick=()=>$('dialog').close()",
 after: "$('#cancel').onclick=()=>{names.push($('[name=name]').value);$('dialog').close()}"
}];
export function browserProbePage(id, caseId) {
 if (id !== "A-edit-1-memory") return probePage(id, caseId);
 const probe=browserProbes.at(-1), original=optimizationPage();
 if (caseId !== probe.caseId) return original;
 if (original.split(probe.before).length !== 2) throw new Error("Memory mutation source changed");
 return original.replace(probe.before, probe.after);
}
export function createProbeServer(id) {
 if (id !== "positive" && !browserProbes.some(p => (p.id ?? p.assertionId) === id)) throw new Error("Unknown probe");
 return createServer((request, response) => {
  if (request.method !== "GET" || new URL(request.url, "http://fixture").pathname !== "/") {
   response.writeHead(404).end(); return;
  }
  response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  response.end(browserProbePage(id, request.headers["x-u05-case"]));
 });
}
`,
	);
	const launcherCode = (await readFile(join(repo, "tests/fixtures/data-space/ui-probe-replay.mjs"), "utf8")).replace(
		'from "./ui-multifunction-probes.mjs"',
		'from "./ui-browser-probes.mjs"',
	);
	const launcher = await save("ui-probe-replay.mjs", launcherCode);
	const { browserProbes, browserProbePage, createProbeServer } = await import(
		pathToFileURL(join(root, extended.path)).href
	);
	const { startProbeServers } = await import(pathToFileURL(join(root, launcher.path)).href);
	assert.equal(browserProbes.length, 14);
	assert.deepEqual(
		browserProbes.slice(0, 13).map(({ id, ...probe }) => probe),
		probes,
	);
	const code = await readFile(join(root, old.data.bindings[0].script_ref.path), "utf8");
	const scriptRef = await save("candidate.spec.ts", code);
	assert.equal(scriptRef.sha256, old.data.bindings[0].script_ref.sha256);
	const fixtureOld = old.data.files.find((f) => f.path.endsWith("/origin.fixture.ts"));
	const fixtureBefore = await readFile(join(root, fixtureOld.path), "utf8");
	let fixture = fixtureBefore.replace(
		"baseURL: async ({ baseURL }, use) => {",
		"baseURL: async ({ baseURL }, use, testInfo) => {",
	);
	fixture = fixture.replace(
		"signal: AbortSignal.timeout(10000)",
		'signal: AbortSignal.timeout(10000), headers: { "x-u05-case": testInfo.title.split(" ")[0] }',
	);
	assert.notEqual(fixture, fixtureBefore);
	assert.equal(
		fixture
			.replace("baseURL: async ({ baseURL }, use, testInfo) => {", "baseURL: async ({ baseURL }, use) => {")
			.replace(', headers: { "x-u05-case": testInfo.title.split(" ")[0] }', ""),
		fixtureBefore,
	);
	await save("origin.fixture.ts", fixture);
	const helper = old.data.files.find((f) => f.path.endsWith("/u05-replay-inputs.ts"));
	await save("u05-replay-inputs.ts", await readFile(join(root, helper.path)));
	const rules = JSON.parse(
		await readFile(join(root, old.data.files.find((f) => f.path.endsWith("/data-rules.json")).path), "utf8"),
	);
	rules.diagnosticTransport =
		"Fixture fetch sends x-u05-case from the static test title to select the isolated target-case fault. This is transport routing, not authentication; viewer and tester share that test's HTML on separate contexts. Assertions and expected values are byte-identical to v2.";
	const rulesRef = await save("data-rules.json", JSON.stringify(rules, null, 2));
	const ids = old.data.bindings.flatMap((b) => b.assertion_ids);
	assert.deepEqual([...new Set(browserProbes.map((p) => p.assertionId))], ids);
	const spec = { timeout_ms: 30000, probes: [] },
		deployments = [];
	for (const probe of [{ id: "positive" }, ...browserProbes]) {
		const id = probe.id ?? probe.assertionId;
		const server = createProbeServer(id);
		servers.push(server);
		// The positive target preserves the frozen scope URL; occupied ports must fail, never fall back.
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(id === "positive" ? Number(new URL(scope.data.base_url).port) : 0, "127.0.0.1", () => {
				server.off("error", reject);
				resolve();
			});
		});
		const port = server.address().port;
		assert.ok(port >= 8900);
		const url = `http://127.0.0.1:${port}`;
		if (id === "positive") assert.equal(url, scope.data.base_url);
		for (const caseId of ["", ...old.data.bindings.map((b) => b.case_id)]) {
			const response = await readPage(url, caseId);
			assert.equal(response.status, 200);
			assert.equal(response.body, browserProbePage(id, caseId));
			if (id === "positive" || caseId !== probe.caseId) assert.equal(response.body, optimizationPage());
			else assert.notEqual(response.body, optimizationPage());
			new Script(response.body.match(/<script>([\s\S]*?)<\/script>/)[1]);
			result.httpChecks.push({ id, caseId, sha256: sha256(response.body) });
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
		const environmentRef = await save(`${id}.environment.json`, JSON.stringify(environment));
		const configRef = await save(
			`${id}.config.mjs`,
			`export default {testDir:'.',testMatch:'candidate.spec.ts',workers:1,retries:0,timeout:15000,use:{baseURL:${JSON.stringify(url)},headless:true},projects:[{name:'chromium',use:{browserName:'chromium'}}]};`,
		);
		deployments.push({
			id,
			url,
			case_id: probe.caseId ?? null,
			assertion_id: probe.assertionId ?? null,
			status: "http-source-checked-browser-unchecked-stopped-after-preparation",
		});
		if (id === "positive") Object.assign(spec, { environment_ref: environmentRef, config_ref: configRef });
		else
			spec.probes.push({
				id,
				environment_ref: environmentRef,
				config_ref: configRef,
				mutation_refs: [frozen, mutation, extended, launcher],
				description: probe.description,
				assertion_ids: [probe.assertionId],
			});
	}
	assert.equal(new Set(deployments.map((d) => d.url)).size, 15);
	result.checks.push(
		"All 13 assertion IDs covered by 14 isolated faults, including cancel-memory; 105 HTTP source responses compile and non-target cases remain frozen bytes",
	);
	for (const server of servers) {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
	const conflict = createServer((_request, response) => response.end("owned conflict sentinel"));
	await new Promise((resolve) => conflict.listen(Number(new URL(deployments[1].url).port), "127.0.0.1", resolve));
	try {
		await assert.rejects(startProbeServers(deployments), (error) => error.code === "EADDRINUSE");
		assert.equal((await readPage(deployments[1].url)).body, "owned conflict sentinel");
		await assert.rejects(readPage(deployments[0].url), (error) => error.code === "ECONNREFUSED");
	} finally {
		conflict.closeAllConnections();
		await new Promise((resolve) => conflict.close(resolve));
	}
	replay = await startProbeServers(deployments);
	for (const entry of result.httpChecks)
		assert.equal(
			sha256((await readPage(deployments.find((d) => d.id === entry.id).url, entry.caseId)).body),
			entry.sha256,
		);
	await replay.close();
	replay = undefined;
	result.checks.push(
		"Exact-origin replay preserves all 105 responses; occupied origin rejects, preserves its listener and closes only owned partial listeners",
	);
	const definitions = new Map();
	const installed = dirname(fileURLToPath(import.meta.resolve("pi-ui-testing")));
	const { registerDesignTools } = await import(pathToFileURL(join(installed, "design-extension.js")).href);
	registerDesignTools({ registerTool: (tool) => definitions.set(tool.name, tool) });
	const schemaResult = await definitions
		.get("ui_design_diagnose")
		.execute("u05-browser-diagnostic-schema", { request: { operation: "schema" } }, undefined, undefined, {
			cwd: root,
		});
	assert.equal(schemaResult.details.status, "completed");
	const schema = JSON.parse(schemaResult.content[0].text).output;
	const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
	assert.equal(validate(spec), true, JSON.stringify(validate.errors));
	const specRef = await save("diagnostic-plan.json", JSON.stringify(spec, null, 2));
	await save(
		"deployments.json",
		JSON.stringify(
			{
				deployments,
				admission:
					"Stopped after preparation. Restore only exact origins with ui-probe-replay.mjs; port conflict rejects. Independent review, fresh identity/data checks and trusted design approval required before diagnostics; no formal readiness.",
			},
			null,
			2,
		),
	);
	await save(
		"lineage.json",
		JSON.stringify(
			{
				prior_asset_ref: prior.assetRef,
				original_task_path: original.taskRef.path,
				unchanged_scope_ref: old.data.scope_ref,
				unchanged_inventory_ref: old.data.inventory_ref,
				unchanged_recording_refs: old.data.recording_refs,
				scope:
					"Same six cases/thirteen assertion bodies. Add diagnostic sources and target-case HTTP routing only. v2 unregistered raw approvals are not inherited. No new task, budget reset, model call or browser execution.",
			},
			null,
			2,
		),
	);
	const cases = structuredClone(await store.load(old.data.cases_ref));
	cases.id = `u05-browser-candidate-${revision}`;
	cases.created_at = new Date().toISOString();
	cases.data.data_rules_ref = rulesRef;
	const casesRef = await store.put(cases);
	const asset = structuredClone(old);
	asset.created_at = new Date().toISOString();
	asset.data.revision = revision;
	asset.data.cases_ref = casesRef;
	asset.data.files = [...files, ...old.data.files.filter((f) => !f.path.includes("/revisions/v2/"))];
	asset.data.bindings = asset.data.bindings.map((b) => ({ ...b, script_ref: scriptRef }));
	asset.data.gaps = [
		...old.data.gaps,
		"14 probes/13 assertions are HTTP/static preparation only; no trusted review, diagnostic observation or runtime admission. All owned servers stopped.",
	];
	asset.data.content_sha256 = assetDigest(asset);
	const assetRef = await store.put(asset),
		checked = await checkDesign(root, assetRef);
	assert.deepEqual(checked.issues, [], JSON.stringify(checked.issues));
	const again = await checkDesign(root, assetRef);
	assert.deepEqual(again, checked);
	assert.equal((await store.load(prior.assetRef)).data.content_sha256, old.data.content_sha256);
	const workflow = new UiWorkflowService(root, join(root, "ui-review-authority"), {
		tools: ["read", ...capabilities.map((c) => c.tool)],
		skills: await readdir(join(installed, "../skills")),
	});
	const current = await workflow.find("u05-tester");
	assert.equal(current.task.data.state, "blocked");
	const blocked = await workflow.block(current.task_ref, [
		`浏览器${revision}已准备14错误探针/13断言与原范围一致的环境；仅HTTP及静态检查，无浏览器观察。`,
		"付费评审9/9授权已用完，新修订无可信独立批准；原v2响应未登记，不继承为批准。诊断、正式执行及真实环境验收仍未执行。",
	]);
	result.checks.push(
		"Native schema and twice-read static design pass; v2 script bytes, original scope/inventory/recordings and original blocked task identity retained",
	);
	Object.assign(result, {
		status: "PASS",
		assetRef,
		priorAssetRef: prior.assetRef,
		taskRef: blocked.task_ref,
		diagnosticSpecRef: specRef,
		deployments,
		staticCheck: checked,
		schemaResult,
		assertions: ids,
		reviewStatus: "NOT REVIEWED / NOT APPROVED",
		runtime_ready: false,
	});
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	await replay?.close();
	for (const server of servers) {
		server.closeAllConnections();
		if (server.listening) await new Promise((resolve) => server.close(resolve));
	}
	await writeFile(output, JSON.stringify(result, null, 2), { flag: "wx" });
	console.log(JSON.stringify(result, null, 2));
}
