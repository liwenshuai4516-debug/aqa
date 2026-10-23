/** U05 native SDK/MCP locator checks on a wrapper around the unchanged frozen page. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { optimizationPage } from "./fixtures/data-space/ui-optimization-page.mjs";
import { locatorWrapper } from "./fixtures/data-space/ui-locator-wrapper.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const output = join(repo, "tests/scratch/ui-locator-revalidation", String(Date.now()));
const temporary = await mkdtemp(join(tmpdir(), "u05-locators-"));
const project = join(temporary, "project"),
	agentDir = join(temporary, "agent");
await mkdir(join(project, "tests"), { recursive: true });
await mkdir(agentDir);
await mkdir(output, { recursive: true });
await symlink(join(repo, "node_modules"), join(project, "node_modules"), "dir");
await writeFile(join(project, "package.json"), '{"type":"module"}');
await writeFile(join(agentDir, "auth.json"), "{}");
const frozenPage = optimizationPage(),
	requests = [];
let version = 1,
	session,
	recording,
	inventoryRef,
	scopeRef,
	backend,
	sequence = 0;
const server = createServer((req, res) => {
	const path = new URL(req.url, "http://fixture").pathname;
	const body = ["/frame", "/changed-frame"].includes(path)
		? frozenPage
		: path === "/decoy"
			? "<!doctype html><p>Decoy frame</p>"
			: locatorWrapper(version);
	requests.push({ path, wrapperVersion: version, body_sha256: sha256(body) });
	res.writeHead(200, { "content-type": "text/html" });
	res.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
assert.ok(server.address().port >= 8900);
const url = `http://127.0.0.1:${server.address().port}`;
const store = new ArtifactStore(project),
	checks = [],
	records = [],
	nested = [];
const result = { status: "FAIL", checks, records, modelCalls: 0, formalRunnerCalls: 0, realBusinessRequests: 0 };
const envelope = (kind, id, data) => ({ schema_version: "1.0", kind, id, created_at: new Date().toISOString(), data });
const text = (response) =>
	response.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
try {
	await writeFile(
		join(project, "playwright.config.mjs"),
		`export default {testDir:'./tests',workers:1,timeout:15000,use:{headless:true,baseURL:${JSON.stringify(url)}},projects:[{name:'chromium',use:{browserName:'chromium'}}]};`,
	);
	const pageRef = await store.putFile(
		"qa/ui/scopes/locator-source/frozen.mjs",
		await readFile(join(repo, "tests/fixtures/data-space/ui-optimization-page.mjs")),
	);
	const wrapperRef = await store.putFile(
		"qa/ui/scopes/locator-source/wrapper.mjs",
		await readFile(join(repo, "tests/fixtures/data-space/ui-locator-wrapper.mjs")),
	);
	result.campaignRef = await store.putFile(
		"qa/ui/scopes/locator-source/campaign.json",
		JSON.stringify(
			{
				branches: [
					{ id: "ambiguous", wrapperVersion: 1, expected: "strict rejection, stopped recording, cleanup only" },
					{
						id: "frame-v1",
						wrapperVersion: 1,
						changesTo: 2,
						expected: "scoped region and frame query work; wrapper change invalidates saved frame locator",
					},
					{
						id: "frame-v2",
						wrapperVersion: 2,
						expected: "independent fresh context observes v2 and validates regenerated locator",
					},
				],
				perBranchBudget: { actions: 60, milliseconds: 120000 },
				completion:
					"Engineering branches preserve partial evidence; none completes the original six-feature browser workflow.",
			},
			null,
			2,
		),
	);
	await enableUiTesting(repo, agentDir);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(agentDir, "models-cache.json"),
		refreshOnCreate: false,
	});
	const services = await createAgentSessionServices({
		cwd: project,
		agentDir,
		modelRuntime,
		settingsManager: SettingsManager.create(project, agentDir, { projectTrusted: true }),
		resourceLoaderOptions: {
			skillsOverride: (base) => ({ ...base, skills: base.skills.filter((s) => s.name.startsWith("ui-")) }),
			extensionFactories: [
				(pi) =>
					pi.on("tool_call", (event) => {
						nested.push({ name: event.toolName, parent: event.parentToolCallId });
					}),
			],
		},
	});
	assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
	({ session } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.create(project, join(agentDir, "sessions")),
	}));
	await session.bindExtensions({});
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		backend = session
			.getAllTools()
			.find((tool) => tool.name.startsWith("mcp__") && tool.name.endsWith("generator_setup_page"))
			?.name.slice(0, -"generator_setup_page".length);
		if (backend) break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.ok(backend, "Actual test MCP must connect");
	const invoke = async (request) => {
		const tool = session.agent.state.tools.find((tool) => tool.name === "ui_discover_record");
		const id = "locator-" + sequence++,
			args = { request };
		session.agent.state.messages = [
			{ role: "assistant", content: [{ type: "toolCall", id, name: tool.name, arguments: args }] },
		];
		return JSON.parse(text(await tool.execute(id, args, new AbortController().signal)));
	};
	const action = async (tool, input = {}, expectedError = false) => {
		const response = await invoke({
			operation: "action",
			session_ref: recording,
			operation_id: "action-" + sequence,
			tool,
			input,
			intent: "U05 declared locator validation: " + tool,
		});
		if (!expectedError) assert.equal(response.status, "completed", JSON.stringify(response));
		return response;
	};
	const snapshot = async () => text((await action("browser_snapshot")).output);
	const generate = async (target) => {
		const response = await action("browser_generate_locator", { target, element: "Observed unique target" });
		const value = text(response.output)
			.split("\n")
			.find((line) => /^(getBy|locator\(|frameLocator\()/.test(line));
		assert.ok(value, JSON.stringify(response));
		assert.doesNotMatch(value, /aria-ref=|\.nth\(|\.first\(/, "Do not hide an unexplained ambiguous locator");
		return value;
	};
	const start = async (id, goal) => {
		scopeRef = await store.put(
			envelope("scope", id, {
				project_id: "u05-fixture",
				environment_id: "isolated-wrapper-v" + version,
				role: "tester",
				base_url: url,
				goal,
				allowed_actions: [
					"Declared wrapper and frozen embedded page; owned context only. Expected negative locator errors stop their recording.",
				],
				sources: [
					{
						source_id: "frozen",
						oracle_type: "declaration",
						ref: pageRef,
						statement: "Frozen u00-1 inner page remains unchanged.",
					},
					{
						source_id: "wrapper",
						oracle_type: "declaration",
						ref: wrapperRef,
						statement:
							"Two named regions have Search buttons; the named Names frame embeds u00-1. Version 2 changes the frame wrapper and adds a decoy.",
					},
				],
				budget: { max_review_rounds: 3, max_tool_calls: 60 },
			}),
		);
		const inventory = envelope("inventory", id, {
			scope_ref: scopeRef,
			features: [
				{
					module_id: "names",
					feature_id: "locator-robustness",
					name: "Observed query targets",
					entry: "/",
					role: "tester",
					actions: [goal],
					scenarios: [{ scenario_id: id, title: goal }],
					coverage: "discovered",
					discovery: "source",
					source_refs: [pageRef, wrapperRef],
					source_locations: [{ ref: wrapperRef, symbol: "locatorWrapper", line: 2 }],
					priority: "P0",
					states: [],
					gaps: ["This focused locator branch does not complete the six-feature browser candidate."],
				},
			],
			unexplored: ["Original six-feature browser task and its partial gaps remain in their own unchanged evidence."],
		});
		const saved = await invoke({ operation: "inventory", inventory });
		assert.equal(saved.status, "completed", JSON.stringify(saved));
		inventoryRef = saved.artifact_refs[0];
		const initial = await store.putFile(
			`qa/ui/recordings/${id}/initial.json`,
			JSON.stringify({ version, role: "tester", isolated: true }),
		);
		const data = await store.putFile(
			`qa/ui/recordings/${id}/data.json`,
			JSON.stringify({
				inputs: ["Gamma"],
				cleanup: "Close owned context and isolated fixture server; no external business writes.",
			}),
		);
		const seedPath = `tests/${id}.seed.spec.ts`;
		const seed = `import {test,expect} from '@playwright/test';
test('seed',async({page})=>{await page.goto('/');await expect(page.getByRole('heading')).toHaveText('Locator wrapper v${version}');await expect(page.getByRole('region',{name:'Toolbar'}).getByRole('button',{name:'Search',exact:true})).toHaveCount(1);await expect(page.getByRole('region',{name:'Backup'}).getByRole('button',{name:'Search',exact:true})).toHaveCount(1);const frame=page.getByTestId('${version === 1 ? "names-frame" : "renamed-names-frame"}').contentFrame();await expect(frame.locator('#identity')).toHaveText('Role: tester');await expect(frame.getByRole('status')).toHaveText('Ready');await expect(frame.getByRole('textbox',{name:'Query',exact:true})).toHaveCount(1);});`;
		await writeFile(join(project, seedPath), seed);
		const started = await invoke({
			operation: "start",
			configuration: {
				id,
				scope_ref: scopeRef,
				inventory_ref: inventoryRef,
				initial_state_ref: initial,
				data_rules_ref: data,
				seed_ref: { path: seedPath, sha256: sha256(seed) },
				output_file: `tests/${id}.recorded.spec.ts`,
				backend,
				project: "chromium",
				max_steps: 60,
				max_duration_ms: 120000,
				max_no_progress: 3,
				test_data: ["Gamma"],
			},
		});
		assert.equal(started.status, "completed", JSON.stringify(started));
		recording = started.artifact_refs[0];
		await action("generator_setup_page", { project: "chromium", seedFile: seedPath, plan: goal });
	};
	const finish = async (gaps) => {
		const before = await invoke({ operation: "status", session_ref: recording });
		await action("browser_close", { intent: "Close owned context after positive or expected negative branch" });
		const ended = await invoke({
			operation: "finish",
			session_ref: recording,
			inventory_ref: inventoryRef,
			initial_state: "Owned context on declared wrapper and unchanged u00-1 inner page",
			completion: {
				initial_state_rebuildable: true,
				replaceable_data: true,
				stable_locators: false,
				assertion_sources: true,
				cleanup_owned: true,
			},
			goal_reached: false,
			gaps,
		});
		assert.equal(ended.status, "completed", JSON.stringify(ended));
		const ref = ended.artifact_refs[0];
		assert.equal((await store.load(ref)).data.status, "partial");
		records.push({ recording, partial: ref, stopped: before.output.stopped, actions: before.output.events.length });
		recording = undefined;
	};
	await start(
		"ambiguous",
		"Negative control: unscoped Search must fail strictly before dispatching a click; preserve the stopped recording.",
	);
	const ambiguous = await action(
		"browser_click",
		{
			target: "getByRole('button', { name: 'Search', exact: true })",
			element: "Ambiguous top-level Search",
			intent: "Negative strictness check on two declared top-level buttons",
		},
		true,
	);
	assert.equal(ambiguous.status, "blocked", JSON.stringify(ambiguous));
	assert.match(JSON.stringify(ambiguous), /strict mode violation/);
	assert.match(JSON.stringify(ambiguous), /resolved to 2 elements/);
	const callsBefore = nested.length;
	const stopped = await action("browser_snapshot", {}, true);
	assert.equal(stopped.status, "blocked");
	assert.equal(nested.length, callsBefore, "Stopped native recording must reject before another MCP action");
	await finish(["Expected strict ambiguity rejection; no generated script or complete feature coverage."]);
	checks.push(
		"Unscoped repeated buttons fail strictly; native recording stops and blocks later MCP actions while cleanup remains available",
	);
	await start(
		"frame-v1",
		"Positive v1 frame query and semantic region locator; then explicit wrapper change must invalidate the saved frame locator.",
	);
	let body = await snapshot();
	assert.match(body, /region "Toolbar"/);
	assert.match(body, /region "Backup"/);
	const toolbar = await generate(
		"getByRole('region', { name: 'Toolbar' }).getByRole('button', { name: 'Search', exact: true })",
	);
	await action("browser_click", { target: toolbar, element: "Toolbar Search", intent: "Strict semantic region match" });
	body = await snapshot();
	assert.match(body.split('region "Toolbar"')[1].split('region "Backup"')[0], /status[^\n]*: "1"/);
	assert.match(body.split('region "Backup"')[1].split("iframe")[0], /status[^\n]*: "0"/);
	const queryRef = body
		.split("\n")
		.find((line) => line.includes('textbox "Query"'))
		?.match(/\[ref=([^\]]+)\]/)?.[1];
	assert.ok(queryRef, body);
	const query = await generate(queryRef);
	assert.match(query, /contentFrame|frameLocator|enter-frame/);
	await action("browser_type", {
		target: query,
		element: "Frame Query",
		text: "Gamma",
		intent: "Query only inside the observed Names frame",
	});
	body = await snapshot();
	const searchRef = body
		.split("\n")
		.find((line) => line.includes('button "Search"') && /\[ref=f\d+e/.test(line))
		?.match(/\[ref=([^\]]+)\]/)?.[1];
	assert.ok(searchRef, body);
	const search = await generate(searchRef);
	await action("browser_click", {
		target: search,
		element: "Frame Search",
		intent: "Apply observed query inside the frame",
	});
	body = await snapshot();
	assert.match(body, /listitem[^\n]*: Gamma/);
	assert.doesNotMatch(body, /listitem[^\n]*: Alpha/);
	result.v1Locators = { toolbar, query, search };
	checks.push(
		"Named region and actual generated frame locators pass strict interaction and filter only the frozen inner Names list",
	);
	version = 2;
	await action("browser_navigate", { url, intent: "Explicit wrapper v2 change; inner frozen page unchanged" });
	body = await snapshot();
	assert.match(body, /Locator wrapper v2/);
	const stale = await action(
		"browser_type",
		{
			target: query,
			element: "Previously verified v1 Query",
			text: "Gamma",
			intent: "Negative stale-frame check after declared wrapper change",
		},
		true,
	);
	assert.equal(stale.status, "blocked", JSON.stringify(stale));
	assert.match(JSON.stringify(stale), /does not match any elements/);
	await finish(["Old frame locator invalid after wrapper change; this recording remains stopped and partial."]);
	checks.push(
		"Wrapper change invalidates the formerly working frame locator and retains the original stopped evidence",
	);
	await start(
		"frame-v2",
		"Separately preregistered v2 branch: observe new frame and regenerate locator; do not replay the stopped v1 recording.",
	);
	body = await snapshot();
	const freshRef = body
		.split("\n")
		.find((line) => line.includes('textbox "Query"'))
		?.match(/\[ref=([^\]]+)\]/)?.[1];
	assert.ok(freshRef, body);
	const fresh = await generate(freshRef);
	assert.notEqual(fresh, query);
	await action("browser_type", {
		target: fresh,
		element: "Current v2 Query",
		text: "Gamma",
		intent: "Validate regenerated locator in current wrapper",
	});
	body = await snapshot();
	assert.match(body, /textbox "Query"[^\n]*: Gamma/);
	result.v2Locator = fresh;
	await finish(["Focused locator evidence only; no full multi-feature script, design approval or formal run."]);
	checks.push(
		"New version is observed in its own declared branch, regenerated locator works, and partial boundaries remain explicit",
	);
	const frameRequests = requests.filter((r) => ["/frame", "/changed-frame"].includes(r.path));
	assert.ok(frameRequests.length >= 3);
	assert.ok(frameRequests.some((r) => r.wrapperVersion === 1) && frameRequests.some((r) => r.wrapperVersion === 2));
	assert.ok(frameRequests.every((r) => r.body_sha256 === sha256(frozenPage)));
	assert.ok(records.every((r) => r.actions <= 60));
	result.frozenPageSha256 = sha256(frozenPage);
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	if (session) {
		await session.extensionRunner?.emit({ type: "session_shutdown", reason: "shutdown" }).catch(() => {});
		session.dispose();
	}
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
	try {
		for (const path of ["qa", "tests", "playwright.config.mjs"])
			await cp(join(project, path), join(output, path), { recursive: true });
	} catch (error) {
		result.status = "FAIL";
		result.evidenceError = error.message;
		process.exitCode = 1;
	}
	await writeFile(join(output, "requests.json"), JSON.stringify(requests, null, 2));
	await writeFile(join(output, "nested-calls.json"), JSON.stringify(nested, null, 2));
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	await rm(temporary, { recursive: true, force: true });
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
