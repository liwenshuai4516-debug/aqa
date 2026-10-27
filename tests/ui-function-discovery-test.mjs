/** U05 controlled discovery through the installed native recording tool and real SDK/MCP.
 * Optional explicitly authorized U00 review; no formal runner or business requests. */
import assert from "node:assert/strict";
import { cp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ArtifactStore, assetDigest, sha256 } from "pi-ui-testing";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { enableUiTesting } from "../scripts/enable-ui-testing.mjs";
import { setupUiFixture } from "./fixtures/data-space/ui-fixture.mjs";
import { optimizationScope } from "./fixtures/data-space/ui-optimization-page.mjs";

const completeCandidate = process.argv.includes("--complete-candidate");
const measured = process.argv.includes("--measure");
const approvedBaseline = process.argv.includes("--review-baseline");
assert.ok(
	!approvedBaseline || (measured && completeCandidate),
	"--review-baseline requires a measured complete candidate",
);
assert.ok(!measured || completeCandidate, "--measure requires --complete-candidate");
const repo = fileURLToPath(new URL("..", import.meta.url));
const initialReviewCalls = approvedBaseline
	? JSON.parse(await readFile(join(repo, "tests/scratch/ui-u00-completion/authorized-review-budget.json"), "utf8"))
			.attempts.length
	: 0;
const output = join(
	repo,
	completeCandidate ? "tests/scratch/ui-browser-candidate" : "tests/scratch/ui-function-discovery",
	String(Date.now()),
);
await mkdir(output, { recursive: true });
let measurement;
if (measured) {
	const helper = join(repo, "tests/lib/ui-discovery-measure.mjs");
	await cp(fileURLToPath(import.meta.url), join(output, "harness.mjs"));
	await cp(helper, join(output, "observer.mjs"));
	await writeFile(
		join(output, "measurement-plan.json"),
		JSON.stringify(
			{
				created_at: new Date().toISOString(),
				harness_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
				observer_sha256: sha256(await readFile(helper)),
				scope: optimizationScope,
				start:
					"Empty owned project; fixture and SDK/MCP setup included in total; catalog-empty milestone separates setup",
				endpoint: approvedBaseline
					? "Empty owned project to independently approved fresh six-case/thirteen-assertion candidate; preserve any rejected attempt separately"
					: "Native ui_case_design candidate returns zero static issues for six cases/thirteen sourced assertions; unapproved v1 synthesis, not approved v4",
				acceptance: approvedBaseline
					? "Frozen six-feature scope, real SDK/MCP recording, explicitly authorized independent design approval; no diagnostic or formal run"
					: "Original frozen scope and 60-action budget; real SDK/MCP recording; no model, diagnostic or formal-run calls; review gate stays blocked",
				metrics:
					"Sequential host tool invocation elapsed time and async FS API counts; nested hook tool names; direct child starts only. Observer overhead included; setup-warmed dependency/OS caches, not a cold sample.",
				unmeasured: [
					"Nested MCP/runner browser launch and internal API counts",
					...(approvedBaseline ? [] : ["Model generation/review wait", "Independently approved endpoint"]),
					"Diagnostic preparation and runtime admission",
					"Before/after comparison",
					"Electron business chain",
				],
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	const { measureDiscovery } = await import("./lib/ui-discovery-measure.mjs");
	measurement = measureDiscovery();
}
const fixture = await setupUiFixture({ optimization: true });
// macOS /var -> /private/var: MCP workspace root must match the canonical config testDir.
fixture.project = await realpath(fixture.project);
const store = new ArtifactStore(fixture.project);
const envelope = (kind, id, data) => ({ schema_version: "1.0", kind, id, created_at: new Date().toISOString(), data });
const text = (result) =>
	result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
const checks = [],
	nested = [],
	observed = new Map(),
	locators = new Map();
let cleanupFailure,
	recordingFinished = false,
	session,
	recording,
	scopeRef,
	inventory,
	inventoryRef,
	sequence = 0,
	actionCount = 0;
const result = {
	status: "FAIL",
	mode: completeCandidate ? "complete-browser-candidate" : "partial-and-budget",
	modelCalls: 0,
	formalRunnerCalls: 0,
	businessRequests: 0,
	checks,
};
try {
	await mkdir(join(fixture.project, "tests"));
	await writeFile(join(fixture.agentDir, "auth.json"), "{}");
	await enableUiTesting(repo, fixture.agentDir);
	await writeFile(
		join(fixture.project, "playwright.config.mjs"),
		`export default {testDir:'./tests',timeout:15000,workers:1,use:{headless:true,baseURL:${JSON.stringify(fixture.url)}},projects:[{name:'chromium',use:{browserName:'chromium'}}]};`,
	);
	const pageSource = await readFile(join(repo, "tests/fixtures/data-space/ui-optimization-page.mjs"));
	const sourceRef = await store.putFile("qa/ui/scopes/declaration/fixture.mjs", pageSource);
	const source = {
		source_id: "u00-declaration",
		oracle_type: "declaration",
		ref: sourceRef,
		statement: JSON.stringify(optimizationScope),
	};
	const runtime = await ModelRuntime.create({
		authPath: join(fixture.agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(fixture.agentDir, "models-cache.json"),
		refreshOnCreate: false,
	});
	// Controlled SDK/MCP verification must never turn into a paid model request.
	for (const method of ["stream", "streamSimple", "complete", "completeSimple"])
		runtime[method] = () => {
			result.modelCalls++;
			throw new Error("Model invocation is outside this engineering recording check");
		};
	const services = await createAgentSessionServices({
		cwd: fixture.project,
		agentDir: fixture.agentDir,
		modelRuntime: runtime,
		settingsManager: SettingsManager.create(fixture.project, fixture.agentDir, { projectTrusted: true }),
		resourceLoaderOptions: {
			skillsOverride: (base) => ({ ...base, skills: base.skills.filter((s) => s.name.startsWith("ui-")) }),
			extensionFactories: [
				(pi) => {
					pi.on("tool_call", (event) => {
						nested.push({ name: event.toolName, parent: event.parentToolCallId });
					});
				},
			],
		},
	});
	assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
	({ session } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.create(fixture.project, join(fixture.agentDir, "sessions")),
	}));
	await session.bindExtensions({});
	let backend;
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		backend = session
			.getAllTools()
			.find((t) => t.name.startsWith("mcp__") && t.name.endsWith("generator_setup_page"))
			?.name.slice(0, -"generator_setup_page".length);
		if (backend) break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.ok(backend, "MCP connection deadline exceeded");
	const invoke = async (request, name = "ui_discover_record") => {
		const tool = session.agent.state.tools.find((t) => t.name === name);
		assert.ok(tool, "Missing installed tool: " + name);
		const id = "controlled-" + sequence++,
			args = { request };
		// Exercise actual extension execution and SDK nested hooks, without a model/provider request.
		session.agent.state.messages = [
			{ role: "assistant", content: [{ type: "toolCall", id, name: tool.name, arguments: args }] },
		];
		const execute = async () => JSON.parse(text(await tool.execute(id, args, new AbortController().signal)));
		return measurement ? measurement.invoke(name, request.operation, execute) : execute();
	};
	const workflow = (request) => invoke(request, "ui_test_workflow");
	const catalog = await workflow({ operation: "catalog" });
	assert.ok(Array.isArray(catalog.output.assets));
	assert.equal(catalog.output.assets.length, 0, "Owned fixture must start without historical assets");
	measurement?.mark("empty-catalog-sdk-mcp-ready");
	const call = async (tool, input = {}, allowBlocked = false) => {
		const response = await invoke({
			operation: "action",
			session_ref: recording,
			operation_id: "action-" + actionCount++,
			tool,
			input,
			intent: "Controlled U05 " + tool,
		});
		if (!allowBlocked) assert.equal(response.status, "completed", JSON.stringify(response));
		return response;
	};
	const snapshot = async (feature) => {
		const response = await call("browser_snapshot");
		const body = text(response.output);
		if (feature) {
			const refs = observed.get(feature) || [];
			refs.push(response.artifact_refs[0]);
			observed.set(feature, refs);
		}
		return body;
	};
	const locator = async (key, body, label) => {
		const line = body.split("\n").find((line) => line.includes(label) && line.includes("[ref="));
		const target = line?.match(/\[ref=([^\]]+)\]/)?.[1];
		assert.ok(target, body + "\nMissing " + label);
		const response = await call("browser_generate_locator", { target, element: label });
		const generated = text(response.output)
			.split("\n")
			.find((line) => line.startsWith("getBy"));
		assert.ok(generated, JSON.stringify(response));
		locators.set(key, generated);
		return generated;
	};
	const click = (key) =>
		call("browser_click", { target: locators.get(key), element: key, intent: "Exercise declared " + key });
	const fill = (key, value) =>
		call("browser_type", {
			target: locators.get(key),
			element: key,
			text: value,
			intent: "Enter declared fixture input",
		});
	const save = async (feature, states, gaps = []) => {
		const draftCount = inventory.data.draft_refs?.length || 0;
		const next = structuredClone(inventory);
		next.id = "inventory-" + sequence++;
		const entry = next.data.features.find((f) => f.feature_id === feature);
		entry.source_refs.push(...(observed.get(feature) || []));
		entry.discovery = "both";
		entry.coverage = gaps.length ? "blocked" : "explored";
		entry.states = states;
		entry.gaps = gaps;
		const evidence = {
			feature,
			scenario: entry.scenarios[0].scenario_id,
			states,
			source: sourceRef,
			expected: optimizationScope.features.find((f) => f.id === feature).assertions,
			observations: observed.get(feature),
			locators: Object.fromEntries(locators),
			gaps,
		};
		const saved = await invoke({
			operation: "inventory",
			inventory: next,
			drafts: [{ name: feature + ".md", content: JSON.stringify(evidence, null, 2) }],
		});
		assert.equal(saved.status, "completed", JSON.stringify(saved));
		inventoryRef = saved.artifact_refs[0];
		inventory = await store.load(inventoryRef);
		assert.equal(inventory.data.draft_refs.length, draftCount + 1);
		const draft = await readFile(join(fixture.project, inventory.data.draft_refs.at(-1).path), "utf8");
		assert.equal(JSON.parse(draft).feature, feature);
		assert.doesNotMatch(JSON.stringify(JSON.parse(draft).locators), /\[ref=|aria-ref=/);
		return inventoryRef;
	};
	cleanupFailure = async () => {
		if (!recording || recordingFinished) return;
		await call("browser_close", { intent: "Cleanup owned context after failed recording branch" }, true);
		result.failedPartial = await invoke({
			operation: "finish",
			session_ref: recording,
			inventory_ref: inventoryRef,
			initial_state: "Failed controlled recording branch; inspect saved seed and events",
			completion: {
				initial_state_rebuildable: true,
				replaceable_data: true,
				stable_locators: false,
				assertion_sources: true,
				cleanup_owned: true,
			},
			goal_reached: false,
			gaps: ["Recording branch failed; retain error and observations, no further business actions"],
		});
	};
	const start = async (role, maxSteps = optimizationScope.budget.actions) => {
		scopeRef = await store.put(
			envelope("scope", "scope-" + role, {
				project_id: "u05-fixture",
				environment_id: "isolated",
				role: completeCandidate ? "tester and viewer in separate contexts" : role,
				goal: optimizationScope.budget.completion,
				base_url: fixture.url,
				allowed_actions: ["Declared fixture UI; own context localStorage only"],
				sources: [source],
				budget: { max_review_rounds: 3, max_tool_calls: optimizationScope.budget.actions },
			}),
		);
		inventory = envelope("inventory", "inventory-" + role, {
			scope_ref: scopeRef,
			features: optimizationScope.features.map((f) => ({
				module_id: "names",
				feature_id: f.id,
				name: f.id,
				entry: "/",
				role: completeCandidate ? "tester and viewer in separate contexts" : role,
				actions: f.assertions,
				scenarios: [{ scenario_id: f.id + "-declared", title: f.assertions.join("; ") }],
				coverage: "discovered",
				discovery: "source",
				source_refs: [sourceRef],
				source_locations: [{ ref: sourceRef, symbol: "optimizationScope", line: 2 }],
				priority: "P0",
				states: [],
				gaps: ["Browser states not observed"],
			})),
			unexplored: ["Other products and undeclared roles"],
		});
		const saved = await invoke({ operation: "inventory", inventory });
		assert.equal(saved.status, "completed", JSON.stringify(saved));
		inventoryRef = saved.artifact_refs[0];
		const initial = await store.putFile(
			"qa/ui/recordings/" + role + "/initial.json",
			JSON.stringify({ role, state: "new context; declared initial names", scope: optimizationScope }),
		);
		const rules = await store.putFile(
			"qa/ui/recordings/" + role + "/data.json",
			JSON.stringify({ cleanup: optimizationScope.cleanup, sideEffects: optimizationScope.sideEffects }),
		);
		const seedPath = "tests/" + role + ".seed.spec.ts";
		const seedContent = `import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
${
	completeCandidate
		? `let u05ViewerContext,u05ViewerObservation;
test.beforeAll(async({browser})=>{
 u05ViewerContext=await browser.newContext();
 try{
  const viewerPage=await u05ViewerContext.newPage();
  await viewerPage.goto(${JSON.stringify(fixture.url + "/?role=viewer")});
  await expect(viewerPage.locator('#identity')).toHaveText('Role: viewer');
  await expect(viewerPage.getByRole('status')).toHaveText('Ready');
  await expect(viewerPage.getByRole('button',{name:'Add',exact:true})).toHaveCount(0);
  await expect(viewerPage.locator('#add')).toHaveCount(1);
  await expect(viewerPage.locator('#add')).toBeHidden();
  u05ViewerObservation={role:'viewer',identity:await viewerPage.locator('#identity').textContent(),accessibleAdd:await viewerPage.getByRole('button',{name:'Add',exact:true}).count(),domAdd:await viewerPage.locator('#add').count(),hidden:await viewerPage.locator('#add').isHidden()};
 }finally{await u05ViewerContext.close();}
});`
		: ""
}
test('seed',async({page})=>{
 await page.addInitScript(()=>{
  const states: {status:string,rows:string[]}[]=[];
  (window as any).__u05StatusObservations=states;
  new MutationObserver(()=>{
   const status=document.querySelector('[role=status]')?.textContent;
   if(status && status!==states.at(-1)?.status)
    states.push({status,rows:Array.from(document.querySelectorAll('li'),li=>li.textContent||'')});
  }).observe(document,{subtree:true,childList:true,characterData:true});
 });
 await page.goto('/?role=${role}');
 await expect(page.locator('#identity')).toHaveText('Role: ${role}');
 await expect(page.getByRole('status')).toHaveText('Ready');
 const states=await page.evaluate(()=>(window as any).__u05StatusObservations);
 expect(states).toEqual([{status:'Loading',rows:[]},{status:'Ready',rows:${JSON.stringify(optimizationScope.initialNames.slice(0, 2))}}]);
 await writeFile('qa/ui/recordings/${role}/loading-observation.json',JSON.stringify({role:${JSON.stringify(role)},states}));
 ${
		completeCandidate
			? `expect(page.context()).not.toBe(u05ViewerContext);
 await writeFile('qa/ui/recordings/${role}/viewer-observation.json',JSON.stringify({...u05ViewerObservation,separateContext:page.context()!==u05ViewerContext}));`
			: ""
 }
});`;
		await writeFile(join(fixture.project, seedPath), seedContent);
		const seed = { path: seedPath, sha256: sha256(seedContent) };
		const started = await invoke({
			operation: "start",
			configuration: {
				id: role,
				scope_ref: scopeRef,
				inventory_ref: inventoryRef,
				initial_state_ref: initial,
				data_rules_ref: rules,
				seed_ref: seed,
				output_file: "tests/" + role + ".recorded.spec.ts",
				backend,
				project: "chromium",
				max_steps: maxSteps,
				max_duration_ms: optimizationScope.budget.milliseconds,
				max_no_progress: 3,
				test_data: ["a", "Gamma", "Missing", "U05-owned-item"],
			},
		});
		assert.equal(started.status, "completed", JSON.stringify(started));
		recording = started.artifact_refs[0];
		recordingFinished = false;
		await call("generator_setup_page", {
			seedFile: seedPath,
			project: "chromium",
			plan: "Explore only frozen u00-1 features for " + role,
		});
		const loadingPath = "qa/ui/recordings/" + role + "/loading-observation.json";
		const loading = await readFile(join(fixture.project, loadingPath));
		assert.deepEqual(JSON.parse(loading).states, [
			{ status: "Loading", rows: [] },
			{ status: "Ready", rows: optimizationScope.initialNames.slice(0, 2) },
		]);
		observed.set("states", [{ path: loadingPath, sha256: sha256(loading) }]);
	};
	await start("tester");
	const task = await workflow({
		operation: "start",
		input: { task_id: "u05-tester", mode: "record", discovery: "both", scope_ref: scopeRef },
	});
	assert.equal(task.status, "completed", JSON.stringify(task));
	let body = await snapshot("search");
	assert.match(body, /Role: tester/);
	for (const feature of optimizationScope.features)
		assert.ok(inventory.data.features.some((f) => f.feature_id === feature.id));
	await locator("query", body, 'textbox "Query"');
	await fill("query", "Gamma");
	await locator("search", body, 'button "Search"');
	await click("search");
	body = await snapshot("search");
	assert.match(body, /listitem(?: \[ref=[^\]]+\])?: Gamma/);
	assert.doesNotMatch(body, /listitem(?: \[ref=[^\]]+\])?: Alpha/);
	const firstDraft = await save("search", ["query matches Gamma"], ["Reset not observed yet"]);
	assert.equal(inventory.data.features.filter((f) => f.coverage === "discovered").length, 5);
	assert.equal(
		await readFile(join(fixture.project, "tests/tester.recorded.spec.ts")).catch((e) =>
			e.code === "ENOENT" ? null : Promise.reject(e),
		),
		null,
	);
	assert.ok((await store.load(firstDraft)).data.draft_refs.length);
	checks.push("first feature draft persists before exploring the remaining five features or writing a final script");
	await locator("reset", body, 'button "Reset"');
	await click("reset");
	body = await snapshot("search");
	assert.match(body, /listitem(?: \[ref=[^\]]+\])?: Alpha/);
	assert.match(body, /listitem(?: \[ref=[^\]]+\])?: Beta/);
	assert.equal((body.match(/- listitem\b/g) || []).length, 2);
	await save("search", ["filtered", "reset"]);
	await locator("add", body, 'button "Add"');
	await click("add");
	body = await snapshot("edit");
	assert.match(body, /- dialog/);
	await locator("name", body, 'textbox "Name"');
	await fill("name", "U05-owned-item");
	await locator("cancel", body, 'button "Cancel"');
	await click("cancel");
	body = await snapshot("edit");
	assert.doesNotMatch(body, /- dialog/);
	await click("add");
	body = await snapshot("edit");
	await fill("name", "U05-owned-item");
	await locator("save", body, 'button "Save"');
	await click("save");
	await call("browser_navigate", {
		url: fixture.url + "/?role=tester",
		intent: "Reload same role and origin to check persistence",
	});
	body = await snapshot("edit");
	await fill("query", "U05-owned-item");
	await click("search");
	body = await snapshot("edit");
	assert.match(body, /listitem(?: \[ref=[^\]]+\])?: U05-owned-item/);
	assert.equal(
		(body.match(/- listitem\b/g) || []).length,
		1,
		"Cancelled input must not become a second persisted name",
	);
	await save("edit", ["dialog open", "filled then cancelled", "saved once", "one persisted name after reload"]);
	await click("reset");
	body = await snapshot("permission");
	assert.match(body, /button "Add"/);
	if (completeCandidate) {
		const path = "qa/ui/recordings/tester/viewer-observation.json";
		const bytes = await readFile(join(fixture.project, path));
		assert.deepEqual(JSON.parse(bytes), {
			role: "viewer",
			identity: "Role: viewer",
			accessibleAdd: 0,
			domAdd: 1,
			hidden: true,
			separateContext: true,
		});
		observed.set("permission", [...observed.get("permission"), { path, sha256: sha256(bytes) }]);
		await save("permission", ["tester sees Add", "seed confirms viewer Add hidden in a separate closed context"]);
	} else await save("permission", ["tester sees Add"], ["viewer context not observed in tester scope"]);
	await fill("query", "a");
	await click("search");
	if (completeCandidate) {
		body = await snapshot("paging");
		assert.match(body, /listitem(?: \[ref=[^\]]+\])?: Alpha/);
		assert.match(body, /listitem(?: \[ref=[^\]]+\])?: Beta/);
		assert.equal((body.match(/- listitem\b/g) || []).length, 2);
		assert.match(body, /button "Previous" \[disabled\]/);
	}
	await locator("next", body, 'button "Next"');
	await click("next");
	body = await snapshot("paging");
	assert.match(body, /listitem(?: \[ref=[^\]]+\])?: Gamma/);
	assert.equal(
		(body.match(/- listitem\b/g) || []).length,
		1,
		"Active query must exclude the saved nonmatching item on the last page",
	);
	assert.match(body, /textbox "Query"[^\n]*: a/);
	assert.match(body, /button "Next" \[disabled\]/);
	await locator("previous", body, 'button "Previous"');
	await click("previous");
	body = await snapshot("paging");
	assert.match(body, /listitem(?: \[ref=[^\]]+\])?: Alpha/);
	assert.match(body, /textbox "Query"[^\n]*: a/);
	assert.match(body, /button "Previous" \[disabled\]/);
	await save("paging", ["first page", "last page", "query retained across next and previous", "both page boundaries"]);
	await locator("about", body, 'tab "About"');
	await click("about");
	body = await snapshot("details");
	assert.match(body, /tab "About"[^\n]*\[selected\]/);
	assert.doesNotMatch(body, /Fixture version u00-1/);
	await locator("details", body, 'generic "Details"');
	await click("details");
	body = await snapshot("details");
	assert.match(body, /Fixture version u00-1/);
	if (completeCandidate) {
		await click("details");
		body = await snapshot("details");
		assert.doesNotMatch(body, /Fixture version u00-1/);
	}
	await save(
		"details",
		completeCandidate
			? ["about selected", "details expanded", "details collapsed"]
			: ["about selected", "details expanded"],
	);
	await locator("list", body, 'tab "List"');
	await click("list");
	await fill("query", "Missing");
	await click("search");
	body = await snapshot("states");
	assert.match(body, /status(?: \[ref=[^\]]+\])?: Empty/);
	assert.doesNotMatch(body, /listitem(?: \[ref=[^\]]+\])?:/);
	await locator("error", body, 'button "Simulate error"');
	await click("error");
	body = await snapshot("states");
	assert.match(body, /Error loading names/);
	await save("states", ["loading with no rows precedes ready data in seed", "empty", "error"]);
	checks.push(
		"seed observes loading before data; filtered paging excludes the saved item; cancelled input adds no duplicate persisted row",
	);
	const testerRecording = recording;
	const testerStatus = await invoke({ operation: "status", session_ref: recording });
	const testerEvents = testerStatus.output.events;
	assert.equal(testerEvents.filter((e) => e.request.tool === "generator_setup_page").length, 1);
	assert.equal(testerEvents.filter((e) => e.request.tool === "browser_navigate").length, 1);
	assert.equal(
		testerEvents.filter((e) => e.request.tool === "browser_type" && e.request.input.target === locators.get("query"))
			.length,
		4,
	);
	assert.ok(testerEvents.length <= optimizationScope.budget.actions);
	assert.ok(nested.some((e) => e.name === backend + "browser_generate_locator" && e.parent));
	const testerInventory = inventoryRef;
	const first = await store.load(firstDraft);
	assert.deepEqual(first.data.features.find((f) => f.feature_id === "search").gaps, ["Reset not observed yet"]);
	assert.deepEqual(inventory.data.features.find((f) => f.feature_id === "search").gaps, []);
	assert.deepEqual(
		inventory.data.features.map((f) => f.feature_id),
		optimizationScope.features.map((f) => f.id),
	);
	assert.ok(inventory.data.features.every((f) => f.source_refs.length > 1 && f.states.length));
	checks.push(
		"each feature keeps stable IDs and source/state references; newer drafts preserve immutable earlier gaps",
	);

	if (completeCandidate) {
		const nativeLog = await call("generator_read_log");
		assert.match(text(nativeLog.output), /getByRole|getByLabel/);
		const helper = "export const replayInputs = {gamma:'Gamma',query:'a',missing:'Missing',owned:'U05-owned-item'};\n";
		await writeFile(join(fixture.project, "tests/u05-replay-inputs.ts"), helper);
		// The immutable recording draft keeps the same local import as the generated test.
		await store.putFile("qa/ui/recordings/tester/u05-replay-inputs.ts", helper);
		const originalCode = await readFile(join(repo, "tests/fixtures/data-space/ui-multifunction-candidate.ts"), "utf8");
		let code = 'import {replayInputs} from "./u05-replay-inputs.ts";\n' + originalCode;
		for (const [value, key] of [
			["Gamma", "gamma"],
			["a", "query"],
			["Missing", "missing"],
			["U05-owned-item", "owned"],
		]) {
			assert.ok(code.includes(JSON.stringify(value)));
			code = code.replaceAll(JSON.stringify(value), "replayInputs." + key);
		}
		if (approvedBaseline) {
			// D4: check cancellation before reload can discard an erroneous in-memory write.
			const reload = '\t\tawait expect(page.getByRole("dialog")).toBeHidden();\n\t\tawait page.reload();';
			assert.ok(code.includes(reload));
			code = code.replace(
				reload,
				`\t\tawait expect(page.getByRole("dialog")).toBeHidden();
		await page.getByLabel("Query", { exact: true }).fill(ownedName);
		await page.getByRole("button", { name: "Search", exact: true }).click();
		await expect(page.getByRole("status")).toHaveText("Empty");
		await expect(page.getByRole("listitem")).toHaveCount(0);
		await page.reload();`,
			);
			// D8: the frozen contract requires a distinct origin for every test.
			code = code.replace(
				'import { test, expect } from "playwright/test";',
				`import { test as baseTest, expect } from "playwright/test";
import { createServer } from "node:http";
import { optimizationPage } from "./u00-fixture.mjs";
let nextPort = 18900;
const test = baseTest.extend<{ isolatedOrigin: string }>({
	isolatedOrigin: async ({}, use) => {
		const server = createServer((_req, res) => {
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(optimizationPage());
		});
		// Monotonic ports keep origins distinct; occupied ports belong to other services.
		while (nextPort < 19000) {
			const port = nextPort++;
			try {
				await new Promise<void>((ok, reject) => {
					server.once("error", reject);
					server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); ok(); });
				});
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
			}
		}
		if (!server.listening) throw new Error("No unused isolated test port in 18900..18999");
		try {
			const port = (server.address() as import("node:net").AddressInfo).port;
			await use("http://127.0.0.1:" + port);
		} finally {
			server.closeAllConnections();
			await new Promise<void>((ok, reject) => server.close(error => error ? reject(error) : ok()));
		}
	},
});`,
			);
			code = code.replace(
				'test.beforeEach(async ({ page }) => {\n\tawait page.goto("/?role=tester");',
				'test.beforeEach(async ({ page, isolatedOrigin }) => {\n\tawait page.goto(isolatedOrigin + "/?role=tester");',
			);
			const declaration = await readFile(join(repo, "tests/fixtures/data-space/ui-optimization-page.mjs"));
			await writeFile(join(fixture.project, "tests/u00-fixture.mjs"), declaration);
			await store.putFile("qa/ui/recordings/tester/u00-fixture.mjs", declaration);
		}
		await call("generator_write_test", { fileName: "tests/tester.recorded.spec.ts", code });
		await call("browser_close", {
			intent: "Close owned tester context after recording; viewer seed context already closed",
		});
		const finished = await invoke({
			operation: "finish",
			session_ref: recording,
			inventory_ref: inventoryRef,
			initial_state: "New tester and separate viewer contexts, frozen Alpha/Beta/Gamma; own localStorage only",
			completion: {
				initial_state_rebuildable: true,
				replaceable_data: true,
				stable_locators: true,
				assertion_sources: true,
				cleanup_owned: true,
			},
			goal_reached: true,
			gaps: [],
		});
		assert.equal(finished.status, "completed", JSON.stringify(finished));
		const recordingRef = finished.artifact_refs[0];
		recordingFinished = true;
		const saved = await store.load(recordingRef);
		assert.equal(saved.data.status, "complete", JSON.stringify(saved.data.gaps));
		assert.deepEqual(saved.data.gaps, []);
		assert.equal(saved.data.script_refs.length, 1);
		assert.equal(await readFile(join(fixture.project, saved.data.script_refs[0].path), "utf8"), code);
		const finalStatus = await invoke({ operation: "status", session_ref: recording });
		assert.ok(finalStatus.output.events.length <= optimizationScope.budget.actions);
		assert.ok(inventory.data.features.every((f) => f.gaps.length === 0));
		let progress = await workflow({
			operation: "checkpoint",
			task_ref: task.artifact_refs[0],
			stage: "discover-record",
			output_refs: [inventoryRef, recordingRef],
		});
		assert.equal(progress.status, "completed", JSON.stringify(progress));
		assert.equal(progress.output.next_stage, "case-design");
		checks.push(
			"Full six-feature recording saves synthesized parameterized script and native log within the original 60-action budget; browser handoff reaches case design",
		);

		const history = JSON.parse(
			await readFile(join(repo, "docs/ui-testing-evidence/optimization-u05-source-candidate.json"), "utf8"),
		);
		const archive = join(repo, history.evidence.archive);
		assert.equal(sha256(await readFile(archive)), history.evidence.archive_sha256);
		const extract = async (path) => JSON.parse((await promisify(execFile)("tar", ["-xOf", archive, path])).stdout);
		const old = await extract(history.asset_ref.path);
		const cases = await extract(old.data.cases_ref.path);
		cases.id = "u05-browser-candidate";
		cases.created_at = new Date().toISOString();
		cases.data.scope_ref = scopeRef;
		cases.data.sources = [source];
		const base = "qa/ui/assets/u05-browser-candidate/revisions/v1";
		const dataRules = await store.putFile(
			`${base}/data-rules.json`,
			JSON.stringify({
				inputs: optimizationScope.initialNames,
				sideEffects: optimizationScope.sideEffects,
				cleanup: optimizationScope.cleanup,
				replayData: "replayInputs in immutable helper",
				recording_ref: recordingRef,
			}),
		);
		cases.data.data_rules_ref = dataRules;
		cases.data.gaps = [
			"Candidate synthesis is not execution: seed/browser observations support discovery; all thirteen script assertions require independent review and diagnostics.",
		];
		for (const c of cases.data.cases)
			for (const a of c.assertions)
				a.observation =
					"Read the role-specific seed/browser evidence and generated source; this assertion in the synthesized replay candidate is not yet diagnosed.";
		const casesRef = await store.put(cases);
		const scriptRef = await store.putFile(`${base}/candidate.spec.ts`, code);
		const helperRef = await store.putFile(`${base}/u05-replay-inputs.ts`, helper);
		const originFixture = approvedBaseline
			? [await store.putFile(`${base}/u00-fixture.mjs`, await readFile(join(fixture.project, "tests/u00-fixture.mjs")))]
			: [];
		const provenance = await store.putFile(
			`${base}/lineage.json`,
			JSON.stringify({
				prior_source_asset: history.asset_ref,
				source_archive_sha256: history.evidence.archive_sha256,
				role_evidence:
					"Viewer identity and hidden Add from separate seed context; tester six-feature interactions from real MCP journal. Do not claim viewer MCP interactions.",
				synthesis:
					"Replay assertions are sourced from the frozen declaration; generated candidate includes additional explicit checks, not a byte-for-byte MCP-exported action log.",
				budget: approvedBaseline
					? "Separate U00 authorization call_30b1ef1f5a9e48b2957656a335890924, at most 3 calls and USD 1; historical U05 budget unchanged."
					: "New recording evidence does not renew exhausted U05 native review authorization; share existing 3-round ledger. Historical partials remain unchanged.",
			}),
		);
		const asset = envelope("asset", "u05-browser-candidate", {
			...old.data,
			revision: "v1",
			scope_ref: scopeRef,
			inventory_ref: inventoryRef,
			cases_ref: casesRef,
			recording_refs: [recordingRef],
			files: [scriptRef, helperRef, ...originFixture, sourceRef, dataRules, provenance],
			bindings: old.data.bindings.map((b) => ({ ...b, script_ref: scriptRef })),
			readiness: "design-only",
			gaps: cases.data.gaps,
		});
		asset.data.content_sha256 = assetDigest(asset);
		const candidate = await invoke({ operation: "candidate", asset }, "ui_case_design");
		assert.equal(candidate.status, "completed", JSON.stringify(candidate));
		assert.deepEqual(candidate.output.issues, [], JSON.stringify(candidate.output));
		measurement?.mark("six-feature-static-candidate-endpoint");
		const assetRef = candidate.artifact_refs[0];
		progress = await workflow({
			operation: "checkpoint",
			task_ref: progress.output.task_ref,
			stage: "case-design",
			output_refs: [assetRef],
		});
		assert.equal(progress.status, "completed", JSON.stringify(progress));
		assert.equal(progress.output.next_stage, "design-review");
		if (approvedBaseline) {
			const { reviewBaseline } = await import("./lib/ui-baseline-design-review.mjs");
			const reviewed = await reviewBaseline({
				root: fixture.project,
				sessionDir: session.sessionManager.getSessionDir(),
				taskRef: progress.output.task_ref,
				assetRef,
				output,
				measurement,
			});
			result.modelCalls = 1;
			result.independentReviewRef = reviewed.response.artifact_refs[0];
			result.providerElapsedMs = reviewed.providerElapsedMs;
		}
		const gate = await workflow({
			operation: "checkpoint",
			task_ref: progress.output.task_ref,
			stage: "design-review",
			output_refs: [assetRef],
		});
		assert.equal(gate.status, "blocked");
		const blocked = await workflow({
			operation: "block",
			task_ref: progress.output.task_ref,
			reasons: [
				approvedBaseline
					? "Independent design approved; U00 measurement endpoint reached. Diagnostics and formal execution are outside this first-generation sample; runtime remains unready."
					: "This new synthesis has no independent design approval or diagnostic proof. Controlled discovery ends at candidate; it does not inherit another revision's approval or renew shared paid-review authorization.",
			],
		});
		assert.equal(blocked.status, "blocked", JSON.stringify(blocked));
		const directory = await workflow({ operation: "catalog" });
		assert.equal(directory.output.assets.find((a) => a.asset_ref.path === assetRef.path).runtime_ready, false);
		assert.equal(sha256(await readFile(archive)), history.evidence.archive_sha256);
		checks.push(
			approvedBaseline
				? "Fresh six-feature candidate independently approved; runtime admission remains blocked without diagnostics"
				: "Real browser recording maps all six cases/thirteen sourced assertions into statically valid candidate; approval gate remains blocked, no model/diagnostic/formal run",
		);
		Object.assign(result, {
			status: "PASS",
			recordingRef,
			inventoryRef,
			assetRef,
			taskRef: blocked.output.task_ref,
			scopeRef,
			actions: finalStatus.output.events.length,
			counts: Object.fromEntries(
				[...new Set(finalStatus.output.events.map((e) => e.request.tool))].map((tool) => [
					tool,
					finalStatus.output.events.filter((e) => e.request.tool === tool).length,
				]),
			),
			staticIssues: candidate.output.issues,
			featureCount: 6,
			assertionCount: 13,
			sourceArchiveSha256: history.evidence.archive_sha256,
		});
	} else {
		await call("browser_close", { intent: "Close owned tester context and discard localStorage" });
		const partial = await invoke({
			operation: "finish",
			session_ref: recording,
			inventory_ref: inventoryRef,
			initial_state: "isolated tester context; frozen initial names",
			completion: {
				initial_state_rebuildable: true,
				replaceable_data: true,
				stable_locators: true,
				assertion_sources: true,
				cleanup_owned: true,
			},
			goal_reached: false,
			gaps: [
				...inventory.data.features.flatMap((f) => f.gaps.map((gap) => f.feature_id + ": " + gap)),
				"Final script/design review not complete",
			],
		});
		assert.equal(partial.status, "completed", JSON.stringify(partial));
		const partialRef = partial.artifact_refs[0];
		recordingFinished = true;
		assert.equal((await store.load(partialRef)).data.status, "partial");
		const beforeCheckpoint = nested.length;
		const checkpoint = await workflow({
			operation: "checkpoint",
			task_ref: task.artifact_refs[0],
			stage: "discover-record",
			output_refs: [partialRef],
		});
		assert.equal(checkpoint.status, "blocked", JSON.stringify(checkpoint));
		assert.match(JSON.stringify(checkpoint.errors), /完整/);
		const taskStatus = await workflow({ operation: "status", task_id: "u05-tester" });
		assert.equal(taskStatus.output.task.data.stage, "discover-record");
		assert.deepEqual(taskStatus.output.task.data.completed_stages, []);
		assert.equal(nested.length, beforeCheckpoint);
		result.partialCheckpoint = checkpoint;
		checks.push("partial recording cannot advance the workflow to case design; no additional MCP action is dispatched");
		checks.push(
			"six frozen features retain state evidence or explicit gaps, same tester recording reuses Query across reload and uses only one setup/one navigation",
		);
		observed.clear();
		locators.clear();
		await start("viewer", 2);
		body = await snapshot("permission");
		assert.match(body, /Role: viewer/);
		assert.doesNotMatch(body, /button "Add"/);
		const wrong = structuredClone(inventory);
		wrong.id = "wrong-role";
		wrong.data.features[0].role = "tester";
		const refused = await invoke({ operation: "inventory", inventory: wrong });
		assert.equal(refused.status, "blocked");
		await save("permission", ["viewer Add hidden"], ["Tester observation remains in the original tester scope"]);
		const before = nested.length;
		const budget = await call(
			"browser_click",
			{ target: "getByRole('button', { name: 'Reset', exact: true })", intent: "Must be denied before execution" },
			true,
		);
		assert.equal(budget.status, "blocked");
		assert.match(JSON.stringify(budget), /step-budget/);
		assert.equal(nested.length, before);
		result.budgetRejection = budget;
		await call("browser_close", { intent: "Cleanup remains allowed after the declared action budget" });
		const viewerStatus = await invoke({ operation: "status", session_ref: recording });
		assert.equal(viewerStatus.output.events.filter((e) => e.request.tool !== "browser_close").length, 2);
		assert.equal(viewerStatus.output.events.filter((e) => e.request.tool === "browser_close").length, 1);
		assert.equal(
			viewerStatus.output.events.some((e) => e.request.tool === "browser_click"),
			false,
		);
		const stopped = await invoke({
			operation: "finish",
			session_ref: recording,
			inventory_ref: inventoryRef,
			initial_state: "fresh viewer context",
			completion: {
				initial_state_rebuildable: true,
				replaceable_data: true,
				stable_locators: false,
				assertion_sources: true,
				cleanup_owned: true,
			},
			goal_reached: false,
			gaps: ["step-budget", "Remaining features not explored in viewer scope"],
		});
		assert.equal(stopped.status, "completed", JSON.stringify(stopped));
		recordingFinished = true;
		assert.equal((await store.load(stopped.artifact_refs[0])).data.status, "partial");
		assert.ok((await store.load(stopped.artifact_refs[0])).data.gaps.includes("step-budget"));
		assert.equal((await store.load(partialRef)).data.status, "partial");
		assert.deepEqual((await store.load(inventoryRef)).data.unexplored, ["Other products and undeclared roles"]);
		assert.equal(inventory.data.features.filter((f) => f.coverage === "discovered").length, 5);
		assert.ok(inventory.data.features.filter((f) => f.coverage === "discovered").every((f) => f.gaps.length));
		assert.equal(
			(await store.load(testerInventory)).data.features.find((f) => f.feature_id === "permission").role,
			"tester",
		);
		checks.push(
			"viewer uses a distinct context/scope, wrong-role inventory is rejected, exhausted budget sends zero extra MCP actions while cleanup and partial handoff remain possible",
		);
		result.status = "PASS";
		result.tester = {
			session: testerRecording,
			partial: partialRef,
			inventory: testerInventory,
			firstDraft,
			actions: testerEvents.length,
			counts: Object.fromEntries(
				[...new Set(testerEvents.map((e) => e.request.tool))].map((tool) => [
					tool,
					testerEvents.filter((e) => e.request.tool === tool).length,
				]),
			),
		};
		result.viewer = {
			partial: stopped.artifact_refs[0],
			inventory: inventoryRef,
			actions: viewerStatus.output.events.length,
		};
	}
	result.scope = { version: optimizationScope.version, declaration: sourceRef, budget: optimizationScope.budget };
} catch (error) {
	await cleanupFailure?.().catch((cleanupError) => {
		result.cleanupError = cleanupError.message;
	});
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	if (session) {
		await session.extensionRunner?.emit({ type: "session_shutdown", reason: "shutdown" }).catch(() => {});
		session.dispose();
	}
	try {
		await cp(join(fixture.project, "qa"), join(output, "qa"), { recursive: true });
		await cp(join(fixture.project, "tests"), join(output, "tests"), { recursive: true });
		await cp(join(fixture.project, "playwright.config.mjs"), join(output, "playwright.config.mjs"));
		await writeFile(join(output, "nested-calls.json"), JSON.stringify(nested, null, 2) + "\n");
	} catch (error) {
		result.status = "FAIL";
		result.evidenceError = error.stack;
		process.exitCode = 1;
	}
	await fixture.close();
	if (approvedBaseline) {
		result.modelCalls =
			JSON.parse(await readFile(join(repo, "tests/scratch/ui-u00-completion/authorized-review-budget.json"), "utf8"))
				.attempts.length - initialReviewCalls;
		result.originalRoot = fixture.project;
		await writeFile(
			join(dirname(fixture.project), ".cleanup-keep"),
			"U00 original synthetic review authority and evidence; retain for continuation.\n",
		);
	} else await rm(dirname(fixture.project), { recursive: true, force: true });
	if (measurement)
		await writeFile(join(output, "measurement.json"), JSON.stringify(measurement.stop(), null, 2) + "\n");
	await writeFile(join(output, "result.json"), JSON.stringify({ ...result, evidence: output }, null, 2) + "\n");
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
