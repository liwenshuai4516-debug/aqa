/** U05 controlled discovery through the installed native recording tool and real SDK/MCP.
 * No model decisions, design approval, formal runner or business-environment requests. */
import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ArtifactStore, sha256 } from "pi-ui-testing";
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

const repo = fileURLToPath(new URL("..", import.meta.url));
const output = join(repo, "tests/scratch/ui-function-discovery", String(Date.now()));
await mkdir(output, { recursive: true });
const fixture = await setupUiFixture({ optimization: true });
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
let session,
	recording,
	scopeRef,
	inventory,
	inventoryRef,
	sequence = 0,
	actionCount = 0;
const result = { status: "FAIL", modelCalls: 0, formalRunnerCalls: 0, businessRequests: 0, checks };
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
		return JSON.parse(text(await tool.execute(id, args, new AbortController().signal)));
	};
	const workflow = (request) => invoke(request, "ui_test_workflow");
	const catalog = await workflow({ operation: "catalog" });
	assert.ok(Array.isArray(catalog.output.assets));
	assert.equal(catalog.output.assets.length, 0, "Owned fixture must start without historical assets");
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
	const start = async (role, maxSteps = optimizationScope.budget.actions) => {
		scopeRef = await store.put(
			envelope("scope", "scope-" + role, {
				project_id: "u05-fixture",
				environment_id: "isolated",
				role,
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
				role,
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
	await save("permission", ["tester sees Add"], ["viewer context not observed in tester scope"]);
	await fill("query", "a");
	await click("search");
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
	await save("details", ["about selected", "details expanded"]);
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
	result.scope = { version: optimizationScope.version, declaration: sourceRef, budget: optimizationScope.budget };
} catch (error) {
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
	await rm(dirname(fixture.project), { recursive: true, force: true });
	await writeFile(join(output, "result.json"), JSON.stringify({ ...result, evidence: output }, null, 2) + "\n");
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
