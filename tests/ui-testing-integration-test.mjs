/** Exercise package discovery and the real SDK/MCP binding without model or business requests. */
import assert from "node:assert/strict";
import { existsSync, realpathSync } from "node:fs";
import { cp, copyFile, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { ArtifactStore, sha256 } from "pi-ui-testing";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { enableUiTesting } from "../scripts/enable-ui-testing.mjs";
import { createPrivateBrowserStates } from "../plugins/data-space/private-browser-state.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "ui-testing-integration");
const { createExtensionToolGate } = await import("../dist/server/extension-tool-gate.js");
const temporary = await mkdtemp(join(tmpdir(), "ui-testing-integration-"));
const project = join(temporary, "project");
const target = join(temporary, "target");
const agentDir = join(temporary, "agent");
const checks = [];
const packageSkills = realpathSync(join(repo, "node_modules/pi-ui-testing/skills"));
let session;
let privateStates;
const guardState = {
	planMode: false,
	delegateMode: false,
	goalReview: false,
	permission: "workspace-write-never",
	uiDisabled: false,
};
try {
	await mkdir(join(project, ".pi"), { recursive: true });
	await mkdir(agentDir);
	await writeFile(join(project, "package.json"), '{"type":"module"}\n');
	await symlink(join(repo, "node_modules"), join(project, "node_modules"), "junction");
	await mkdir(target);
	await mkdir(join(target, "node_modules/@playwright"), { recursive: true });
	for (const name of ["@playwright/test", "playwright", "playwright-core"])
		await cp(realpathSync(join(repo, "node_modules", name)), join(target, "node_modules", name), { recursive: true });
	await writeFile(
		join(target, "playwright.config.mjs"),
		"export default { testDir: './tests', use: { baseURL: 'http://127.0.0.1:18981' }, projects: [{ name: 'chromium', use: { browserName: 'chromium' } }] };\n",
	);
	await cp(join(repo, ".pi/skills/ui-testing-workflow"), join(project, ".pi/skills/ui-testing-workflow"), {
		recursive: true,
	});
	for (const name of ["mcp-extension.mjs", "playwright.config.mjs", "playwright-runtime.mjs"]) {
		await copyFile(
			join(repo, ".pi/skills/ui-testing-workflow/assets", name),
			join(project, ".pi/skills/ui-testing-workflow/assets", name),
		);
	}
	await mkdir(join(target, "tests"), { recursive: true });
	await writeFile(
		join(target, "tests/seed.spec.ts"),
		`import { test } from '@playwright/test';\ntest('integration seed', async ({ page }) => { await import('node:fs/promises').then(fs => fs.writeFile(${JSON.stringify(join(target, "seed-executed"))}, 'owned fixture')); await page.route('http://127.0.0.1:18981/**', r => r.fulfill({contentType: 'text/html', body: '<button>Capability smoke</button>'})); await page.goto('/synthetic'); });\n`,
	);
	await writeFile(join(project, ".pi/settings.json"), '{"theme":"light"}\n');
	const settingsPath = await enableUiTesting(project);
	const first = await readFile(settingsPath, "utf8");
	await enableUiTesting(project);
	assert.equal(await readFile(settingsPath, "utf8"), first);
	assert.equal(JSON.parse(first).theme, "light");
	checks.push("project registration preserves settings and is idempotent");
	await writeFile(join(agentDir, "settings.json"), '{"theme":"light"}\n');
	const appSettings = await enableUiTesting(project, agentDir);
	const appFirst = await readFile(appSettings, "utf8");
	await enableUiTesting(project, agentDir);
	assert.equal(await readFile(appSettings, "utf8"), appFirst);
	assert.equal(JSON.parse(appFirst).theme, "light");
	checks.push("app registration preserves settings and is idempotent");

	const nestedCalls = [];
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(agentDir, "models-cache.json"),
		refreshOnCreate: false,
	});
	const services = await createAgentSessionServices({
		cwd: target,
		agentDir,
		modelRuntime,
		settingsManager: SettingsManager.create(target, agentDir, { projectTrusted: true }),
		resourceLoaderOptions: {
			// Isolate discovery from user-wide ~/.agents skills; retain all fixture/package names for the exact assertion.
			skillsOverride: (base) => ({
				...base,
				skills: base.skills.filter((skill) => {
					const path = realpathSync(skill.filePath);
					return path.startsWith(realpathSync(temporary) + sep) || path.startsWith(packageSkills + sep);
				}),
			}),
			extensionFactories: [
				{ name: "host-guard", hidden: true, factory: createExtensionToolGate(() => guardState) },
				(pi) => {
					pi.on("tool_call", (event) => {
						nestedCalls.push({ name: event.toolName, parent: event.parentToolCallId });
					});
					pi.registerTool({
						name: "integration_native_call",
						label: "Integration probe",
						description: "Exercise the native nested tool pipeline in an isolated test.",
						parameters: Type.Object({
							tool: Type.String(),
							input: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
						}),
						execute: async (_id, args, signal, _update, ctx) => {
							const outcome = await ctx.executeTool(args.tool, args.input ?? {}, { signal });
							return { ...outcome.result, details: { isError: outcome.isError } };
						},
					});
				},
			],
		},
	});
	assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
	const skills = services.resourceLoader
		.getSkills()
		.skills.map((skill) => skill.name)
		.sort();
	assert.deepEqual(
		skills,
		[
			"ui-artifact-check",
			"ui-case-design",
			"ui-design-review",
			"ui-discover-record",
			"ui-result-analysis",
			"ui-result-review",
			"ui-test-run",
			"ui-test-workflow",
			"ui-testing-workflow",
		].sort(),
	);
	checks.push("eight original skills and named entry discovered from app config in a different workspace");
	({ session } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.create(target, join(agentDir, "sessions")),
	}));
	await session.bindExtensions({});
	const expected = [
		"ui_asset_maintain",
		"ui_case_design",
		"ui_design_diagnose",
		"ui_design_review",
		"ui_discover_record",
		"ui_result_analysis",
		"ui_result_review",
		"ui_test_run",
		"ui_test_workflow",
		"ui_validate_artifact",
	].sort();
	assert.deepEqual(
		session
			.getAllTools()
			.map((tool) => tool.name)
			.filter((name) => name.startsWith("ui_"))
			.sort(),
		expected,
	);
	checks.push("all ten original workflow tools registered in a real SDK session");
	const discoveryTool = session.getAllTools().find((tool) => tool.name === "ui_discover_record");
	const actionSchema = discoveryTool.parameters.properties.request.anyOf.find(
		(schema) => schema.properties.operation.const === "action",
	);
	assert.ok(actionSchema.properties.tool.enum.includes("browser_generate_locator"));
	checks.push("installed native recording schema accepts optional MCP locator generation");
	const invoke = (name, args, signal = new AbortController().signal) => {
		const tool = session.agent.state.tools.find((entry) => entry.name === name);
		assert.ok(tool, `Active tool missing: ${name}`);
		return tool.execute("integration-call", args, signal);
	};
	const catalog = JSON.parse((await invoke("ui_test_workflow", { request: { operation: "catalog" } })).content[0].text);
	assert.equal(catalog.status, "completed");
	assert.equal(catalog.output.assets.length, 0);
	checks.push("bound workflow catalog executes against the isolated project");
	const scope = JSON.parse(await readFile(join(repo, "node_modules/pi-ui-testing/examples/scope.valid.json"), "utf8"));
	const scopeRef = await new ArtifactStore(target).put(scope);
	const started = JSON.parse(
		(
			await invoke("ui_test_workflow", {
				request: {
					operation: "start",
					input: {
						task_id: "integration-source-discovery",
						mode: "record",
						discovery: "source",
						scope_ref: scopeRef,
					},
				},
			})
		).content[0].text,
	);
	assert.equal(started.status, "completed", JSON.stringify(started));
	checks.push("source workflow start validates the real skill catalog and SDK version");
	const required = [
		"generator_setup_page",
		"generator_read_log",
		"generator_write_test",
		"browser_snapshot",
		"browser_type",
		"browser_click",
		"browser_close",
	];
	const deadline = Date.now() + 30_000;
	let backend;
	while (Date.now() < deadline) {
		const names = session.getAllTools().map((tool) => tool.name);
		backend = names
			.find((name) => name.startsWith("mcp__") && name.endsWith("generator_setup_page"))
			?.slice(0, -"generator_setup_page".length);
		if (backend && required.every((name) => names.includes(backend + name))) break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.ok(backend, "Native Playwright test MCP did not connect");
	assert.ok(required.every((name) => session.getAllTools().some((tool) => tool.name === backend + name)));
	checks.push("real Playwright test MCP exposes all seven required recording tools");
	// A controlled dispatch message exercises SDK plumbing; it is not model evidence.
	session.agent.state.messages = [
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "integration-call",
					name: "integration_native_call",
					arguments: { tool: backend + "browser_close" },
				},
			],
		},
	];
	// MCP itself otherwise selects the first existing candidate silently.
	await copyFile(join(target, "tests/seed.spec.ts"), join(target, "seed.spec.ts"));
	const ambiguousSeed = await invoke("integration_native_call", {
		tool: backend + "generator_setup_page",
		input: { project: "chromium", seedFile: "seed.spec.ts", plan: "Reject ambiguous seed before execution." },
	});
	await rm(join(target, "seed.spec.ts"));
	assert.equal(ambiguousSeed.details.isError, true, JSON.stringify(ambiguousSeed.content));
	assert.match(JSON.stringify(ambiguousSeed.content), /多个/);
	checks.push("ambiguous seed paths are blocked by the host before MCP setup");
	for (const input of [
		{ project: "chromium", seedFile: "tests/missing.spec.ts" },
		{ project: "missing-project", seedFile: "tests/seed.spec.ts" },
	]) {
		const denied = await invoke("integration_native_call", {
			tool: backend + "generator_setup_page",
			input: { ...input, plan: "Reject invalid initialization before seed execution." },
		});
		assert.equal(denied.details.isError, true, JSON.stringify(denied.content));
		assert.match(JSON.stringify(denied.content), /UI 初始化阻塞/);
	}
	const seedCode = await readFile(join(target, "tests/seed.spec.ts"), "utf8");
	await writeFile(join(target, "tests/seed.spec.ts"), seedCode + "\ntest('extra seed', async () => {});\n");
	const multiSeed = await invoke("integration_native_call", {
		tool: backend + "generator_setup_page",
		input: { project: "chromium", seedFile: "tests/seed.spec.ts", plan: "Reject multi-test seed." },
	});
	assert.equal(multiSeed.details.isError, true, JSON.stringify(multiSeed.content));
	assert.match(JSON.stringify(multiSeed.content), /单个/);
	assert.equal(existsSync(join(target, "seed-executed")), false, "Rejected setup must not run seed body");
	await writeFile(join(target, "tests/seed.spec.ts"), seedCode);
	checks.push("missing seed/project and multi-test seed stop before seed-body side effects");
	const configPath = join(target, "playwright.config.mjs");
	const anonymousConfig = await readFile(configPath, "utf8");
	const privateData = join(temporary, "private-data");
	await mkdir(privateData, { mode: 0o700 });
	privateStates = createPrivateBrowserStates({
		dataDir: privateData,
		store: () => ({
			revision: 1,
			systems: [{ id: "synthetic" }],
			envs: [
				{
					id: "test",
					systemId: "synthetic",
					baseUrl: "http://127.0.0.1:18981",
					params: [{ key: "token", value: "synthetic-only" }],
				},
			],
		}),
	});
	const prepared = await privateStates.prepare(target, {
		engine: "ui",
		mode: "execute",
		systemId: "synthetic",
		envId: "test",
		targetUrl: "http://127.0.0.1:18981/synthetic",
		privateBindings: [{ parameterKey: "token", storageKey: "token" }],
	});
	assert.equal(prepared.preparation.recording, "unsupported");
	await writeFile(
		configPath,
		anonymousConfig.replace("use: {", `use: { storageState: process.env[${JSON.stringify(prepared.auth.reference)}],`),
	);
	const privateSetup = await invoke("integration_native_call", {
		tool: backend + "generator_setup_page",
		input: {
			project: "chromium",
			seedFile: "tests/seed.spec.ts",
			plan: "Reject unsupported managed private recording before executing seed.",
		},
	});
	assert.equal(privateSetup.details.isError, true, JSON.stringify(privateSetup.content));
	assert.match(JSON.stringify(privateSetup.content), /storageState/);
	assert.equal(existsSync(join(target, "seed-executed")), false);
	const privateStore = new ArtifactStore(target);
	const source = await privateStore.putFile(
		"qa/ui/scopes/private-binding/source.md",
		"Observe only the synthetic capability heading.",
	);
	const envelope = (kind, data) => ({
		schema_version: "1.0",
		kind,
		id: "private-binding",
		created_at: new Date().toISOString(),
		data,
	});
	const privateScope = await privateStore.put(
		envelope("scope", {
			project_id: "synthetic",
			environment_id: "test",
			role: "synthetic",
			goal: "Observe synthetic heading",
			base_url: "http://127.0.0.1:18981/",
			allowed_actions: ["Observe synthetic fixture only"],
			sources: [
				{ source_id: "S1", oracle_type: "declaration", ref: source, statement: "Capability heading is visible" },
			],
			budget: { max_review_rounds: 3, max_tool_calls: 10 },
		}),
	);
	const privateInventory = await privateStore.put(
		envelope("inventory", { scope_ref: privateScope, features: [], unexplored: ["Real business behavior"] }),
	);
	const environmentRef = await privateStore.putFile(
		"qa/ui/scopes/private-binding/environment.json",
		JSON.stringify({
			schema_version: "1.0",
			environment_id: "test",
			deployment_version: "synthetic",
			role: "synthetic",
			base_url: "http://127.0.0.1:18981/",
			identity: { selector: "h1", text: "Fixture" },
			initial_state: { selector: "h1", text: "Fixture" },
			isolation: "context",
			timeout_ms: 1000,
			auth: prepared.auth,
		}),
	);
	const seedRef = { path: "tests/seed.spec.ts", sha256: sha256(await readFile(join(target, "tests/seed.spec.ts"))) };
	const configRef = { path: "playwright.config.mjs", sha256: sha256(await readFile(configPath)) };
	// SDK result hooks run through executeTool; directly invoking a definition skips that part of the pipeline.
	const invokeRecording = (input) => invoke("integration_native_call", { tool: "ui_discover_record", input });
	const privateConfiguration = {
		id: "private-binding",
		scope_ref: privateScope,
		inventory_ref: privateInventory,
		initial_state_ref: source,
		data_rules_ref: source,
		seed_ref: seedRef,
		output_file: "tests/private-binding.spec.ts",
		backend,
		project: "chromium",
		max_steps: 4,
		max_duration_ms: 60000,
		max_no_progress: 3,
		test_data: [],
		private_recording: {
			environment_ref: environmentRef,
			input_refs: [configRef, seedRef],
			capture: "chromium-single-page-v1",
		},
	};
	const insufficientBudget = JSON.parse(
		(
			await invokeRecording({
				request: { operation: "start", configuration: { ...privateConfiguration, max_steps: 5 } },
			})
		).content[0].text,
	);
	assert.equal(insufficientBudget.status, "blocked", JSON.stringify(insufficientBudget));
	assert.match(JSON.stringify(insufficientBudget), /采集协议/);
	assert.equal(existsSync(join(target, "qa/ui/recordings/private-binding/session.json")), false);
	assert.equal(existsSync(join(target, "seed-executed")), false);
	checks.push("capture helpers and cleanup must fit the frozen scope budget before session creation");
	const privateStart = JSON.parse(
		(
			await invokeRecording({
				request: {
					operation: "start",
					configuration: {
						...privateConfiguration,
						private_recording: { environment_ref: environmentRef, input_refs: [configRef, seedRef] },
					},
				},
			})
		).content[0].text,
	);
	assert.equal(privateStart.status, "completed", JSON.stringify(privateStart));
	const receipt = privateStart.output.private_preparation;
	assert.equal(privateStart.output.recording, "blocked-capture-not-connected");
	assert.deepEqual(receipt.inputs, [configRef, seedRef, environmentRef, privateStart.artifact_refs[0]]);
	assert.equal(receipt.capture, undefined);
	assert.equal(JSON.stringify(receipt).includes("synthetic-only"), false);
	const sessionDirectory = join(agentDir, "sessions");
	const privateDeadline = Date.now() + 30000;
	let handshakeFiles = [];
	while (Date.now() < privateDeadline) {
		handshakeFiles = (await readdir(sessionDirectory, { recursive: true })).filter((path) =>
			/handshake-\d+\.json$/.test(path),
		);
		if (handshakeFiles.length >= 2) break;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	assert.ok(handshakeFiles.length >= 2, "Product private MCP handshake did not complete");
	const replies = await Promise.all(
		handshakeFiles.map(async (path) => JSON.parse(await readFile(join(sessionDirectory, path), "utf8"))),
	);
	assert.ok(replies.some((message) => message.result?.tools?.some((tool) => tool.name === "generator_setup_page")));
	const derivedStates = (await readdir(sessionDirectory, { recursive: true })).filter((path) =>
		/recording-[^/]+\/state\.json$/.test(path),
	);
	assert.equal(derivedStates.length, 1);
	const privateOutput = join(sessionDirectory, derivedStates[0], "../../output");
	assert.equal(existsSync(privateOutput), false);
	assert.equal(existsSync(join(privateOutput, "recording")), false, "Handshake must not start private capture");
	const privateAction = JSON.parse(
		(
			await invokeRecording({
				request: {
					operation: "action",
					session_ref: privateStart.artifact_refs[0],
					operation_id: "private-setup",
					tool: "generator_setup_page",
					input: { project: "chromium", seedFile: seedRef.path, plan: "Must remain blocked" },
					intent: "Verify private browser calls stay blocked until capture is connected",
				},
			})
		).content[0].text,
	);
	assert.equal(privateAction.status, "blocked");
	assert.match(JSON.stringify(privateAction), /捕获与发布尚未接通/);
	const privateFinish = JSON.parse(
		(
			await invokeRecording({
				request: {
					operation: "finish",
					session_ref: privateStart.artifact_refs[0],
					inventory_ref: privateInventory,
					initial_state: "No browser started",
					goal_reached: false,
					gaps: ["Product private capture is not connected"],
					completion: {
						initial_state_rebuildable: false,
						replaceable_data: false,
						stable_locators: false,
						assertion_sources: false,
						cleanup_owned: false,
					},
				},
			})
		).content[0].text,
	);
	assert.equal(privateFinish.status, "completed", JSON.stringify(privateFinish));
	assert.equal((await privateStore.load(privateFinish.artifact_refs[0])).data.status, "partial");
	assert.equal(existsSync(join(target, "seed-executed")), false);
	for (const state of derivedStates) assert.equal(existsSync(join(sessionDirectory, state)), false);
	checks.push(
		"product private session automatically prepares and handshakes through MCP; browser action is blocked, finish stays partial and revokes authentication",
	);
	privateStates.dispose();
	await writeFile(configPath, anonymousConfig);
	const restoredDeadline = Date.now() + 30000;
	while (
		!required.every((name) => session.agent.state.tools.some((tool) => tool.name === backend + name)) &&
		Date.now() < restoredDeadline
	)
		await new Promise((resolve) => setTimeout(resolve, 50));
	assert.ok(
		required.every((name) => session.agent.state.tools.some((tool) => tool.name === backend + name)),
		"Anonymous MCP did not become callable after private finish",
	);
	checks.push("real execution-only data-space reference is rejected by SDK recording hook before seed execution");
	const setup = await invoke("integration_native_call", {
		tool: backend + "generator_setup_page",
		input: {
			project: "chromium",
			seedFile: "tests/seed.spec.ts",
			plan: "Open a local synthetic page to check capability wiring.",
		},
	});
	assert.equal(setup.details.isError, false, JSON.stringify(setup.content));
	assert.equal(existsSync(join(target, "seed-executed")), true);
	checks.push(
		"test MCP uses independent workspace dependencies, custom testDir and baseURL to open a real Chromium seed",
	);
	const snapshot = await invoke("integration_native_call", { tool: backend + "browser_snapshot" });
	assert.equal(snapshot.details.isError, false, JSON.stringify(snapshot.content));
	assert.match(JSON.stringify(snapshot.content), /Capability smoke/);
	assert.ok(
		nestedCalls.some((call) => call.name === backend + "browser_snapshot" && call.parent === "integration-call"),
	);
	checks.push("real nested MCP call retains parent call identity through SDK hooks");
	const targetRef = snapshot.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.match(/button "Capability smoke".*?\[ref=([^\]]+)\]/)?.[1];
	assert.ok(targetRef, JSON.stringify(snapshot.content));
	const locatorResult = await invoke("integration_native_call", {
		tool: backend + "browser_generate_locator",
		input: { element: "Capability smoke button", target: targetRef },
	});
	assert.equal(locatorResult.details.isError, false, JSON.stringify(locatorResult.content));
	const locator = locatorResult.content
		.filter((part) => part.type === "text")
		.flatMap((part) => part.text.split("\n"))
		.find((line) => line.startsWith("getBy"));
	assert.ok(locator, JSON.stringify(locatorResult.content));
	const clicked = await invoke("integration_native_call", {
		tool: backend + "browser_click",
		input: {
			element: "Capability smoke button",
			target: locator,
			intent: "Validate generated locator by strict click",
		},
	});
	assert.equal(clicked.details.isError, false, JSON.stringify(clicked.content));
	checks.push("installed MCP generates an observed locator consumed by a real strict browser click");
	const cancelled = new AbortController();
	cancelled.abort();
	let stopped = false;
	try {
		const result = await invoke("integration_native_call", { tool: backend + "browser_snapshot" }, cancelled.signal);
		stopped = result.details.isError && /abort|cancel/i.test(JSON.stringify(result.content));
	} catch (error) {
		stopped = /abort|cancel/i.test(String(error));
	}
	assert.ok(stopped, "Cancelled call must not succeed");
	checks.push("cancelled nested MCP request does not report success");
	const closed = await invoke("integration_native_call", {
		tool: backend + "browser_close",
		input: { intent: "Close the isolated capability check page" },
	});
	assert.equal(closed.details.isError, false, JSON.stringify(closed.content));
	// Real package executors, same SDK nested pipeline as recording. Restricted
	// requests must be rejected before a candidate file or browser action exists.
	for (const [field, value] of [
		["planMode", true],
		["delegateMode", true],
		["goalReview", true],
		["permission", "read-only"],
	]) {
		const old = guardState[field];
		guardState[field] = value;
		const denied = await invoke("integration_native_call", {
			tool: "ui_case_design",
			input: {
				request: {
					operation: "save-file",
					asset_id: "guard-probe",
					revision: "r1",
					name: "candidate.spec.ts",
					content: "must not be saved",
				},
			},
		});
		assert.equal(denied.details.isError, true, JSON.stringify(denied));
		assert.match(JSON.stringify(denied.content), /被拒|只读|计划模式|审查/);
		const browserDenied = await invoke("integration_native_call", { tool: backend + "browser_close", input: {} });
		assert.equal(browserDenied.details.isError, true);
		const query = await invoke("integration_native_call", {
			tool: "ui_test_workflow",
			input: { request: { operation: "catalog" } },
		});
		assert.equal(query.details.isError, false, JSON.stringify(query));
		checks.push(`real package write/browser denied but catalog allowed: ${field}`);
		guardState[field] = old;
	}
	assert.equal(
		await readFile(join(target, "qa/ui/assets/guard-probe/revisions/r1/candidate.spec.ts"), "utf8").catch((e) => {
			if (e.code === "ENOENT") return null;
			throw e;
		}),
		null,
	);
	guardState.uiDisabled = true;
	assert.equal(
		(
			await invoke("integration_native_call", {
				tool: "ui_test_workflow",
				input: { request: { operation: "catalog" } },
			})
		).details.isError,
		true,
	);
	guardState.uiDisabled = false;
	checks.push("UI disable is enforced on nested calls without reload");
	console.log(
		JSON.stringify(
			{
				status: "passed",
				checks,
				actualModelCalls: 0,
				businessRequests: 0,
				notExecuted: ["independent model reviews", "business recording, diagnostics and formal regression"],
			},
			null,
			2,
		),
	);
} finally {
	privateStates?.dispose();
	if (session) {
		await session.extensionRunner?.emit({ type: "session_shutdown", reason: "shutdown" });
		session.dispose();
	}
	await rm(temporary, { recursive: true, force: true });
}
