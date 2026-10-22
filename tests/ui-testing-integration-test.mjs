/** Exercise package discovery and the real SDK/MCP binding without model or business requests. */
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { cp, copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { ArtifactStore } from "pi-ui-testing";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { enableUiTesting } from "../scripts/enable-ui-testing.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "ui-testing-integration-"));
const project = join(temporary, "project");
const target = join(temporary, "target");
const agentDir = join(temporary, "agent");
const checks = [];
const packageSkills = realpathSync(join(repo, "node_modules/pi-ui-testing/skills"));
let session;
try {
	await mkdir(join(project, ".pi"), { recursive: true });
	await mkdir(agentDir);
	await writeFile(join(project, "package.json"), '{"type":"module"}\n');
	await symlink(join(repo, "node_modules"), join(project, "node_modules"), "junction");
	await mkdir(target);
	await symlink(join(repo, "node_modules"), join(target, "node_modules"), "junction");
	await cp(join(repo, ".pi/skills/ui-testing-workflow"), join(project, ".pi/skills/ui-testing-workflow"), {
		recursive: true,
	});
	for (const name of ["mcp-extension.mjs", "playwright.config.mjs"]) {
		await copyFile(
			join(repo, ".pi/skills/ui-testing-workflow/assets", name),
			join(project, ".pi/skills/ui-testing-workflow/assets", name),
		);
	}
	await mkdir(join(target, "qa/ui"), { recursive: true });
	await writeFile(
		join(target, "qa/ui/seed.spec.ts"),
		"import { test } from '@playwright/test';\ntest('integration seed', async ({ page }) => { await page.setContent('<button>Capability smoke</button>'); });\n",
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
	const setup = await invoke("integration_native_call", {
		tool: backend + "generator_setup_page",
		input: {
			project: "chromium",
			seedFile: "qa/ui/seed.spec.ts",
			plan: "Open a local synthetic page to check capability wiring.",
		},
	});
	assert.equal(setup.details.isError, false, JSON.stringify(setup.content));
	checks.push("test MCP opens a real Chromium page from an isolated synthetic seed");
	const snapshot = await invoke("integration_native_call", { tool: backend + "browser_snapshot" });
	assert.equal(snapshot.details.isError, false, JSON.stringify(snapshot.content));
	assert.match(JSON.stringify(snapshot.content), /Capability smoke/);
	assert.ok(
		nestedCalls.some((call) => call.name === backend + "browser_snapshot" && call.parent === "integration-call"),
	);
	checks.push("real nested MCP call retains parent call identity through SDK hooks");
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
	if (session) {
		await session.extensionRunner?.emit({ type: "session_shutdown", reason: "shutdown" });
		session.dispose();
	}
	await rm(temporary, { recursive: true, force: true });
}
