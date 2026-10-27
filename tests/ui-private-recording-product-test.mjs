/** Actual product extension + SDK + Chromium. Synthetic identity only; no model or business run. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { ArtifactStore, RecordingService, authState, sha256 } from "pi-ui-testing";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { enableUiTesting } from "../scripts/enable-ui-testing.mjs";
import { createPrivateBrowserStates } from "../plugins/data-space/private-browser-state.mjs";
import { CHROME_PATH } from "./lib/chrome.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "ui-private-recording-product");
const mode = process.argv.find((arg) => arg.startsWith("--mode="))?.slice(7) ?? "normal";
const gated = ["helper-readonly", "helper-plan", "helper-delegate", "helper-disabled"].includes(mode);
const lifecycle = ["reload", "reconnect"].includes(mode);
assert.ok(
	lifecycle ||
		gated ||
		["normal", "ephemeral", "corrupt", "cancel", "budget", "existing", "symlink", "unsupported"].includes(mode),
);
const output = join(
	repo,
	`tests/scratch/ui-optimization-u00/recording-product-${lifecycle ? "lifecycle" : "actions"}`,
	`${Date.now()}-${mode}`,
);
await mkdir(output, { recursive: true });
const root = await realpath(await mkdtemp(join(tmpdir(), "ui-private-product-")));
const workspace = join(root, "workspace"),
	agentDir = join(root, "agent"),
	sessionDir = join(agentDir, "sessions");
const secret = "synthetic-initial+/" + randomBytes(24).toString("base64");
const rotated = "synthetic-runtime+/" + randomBytes(24).toString("base64");
const forms = (value) => [
	value,
	encodeURI(value),
	encodeURIComponent(value),
	JSON.stringify(value).slice(1, -1),
	Buffer.from(value).toString("base64"),
	Buffer.from(value).toString("base64url"),
];
const variants = [...forms(secret), ...forms(rotated)];
const contains = (value) => variants.some((variant) => value.includes(variant));
const mediaCount = (value) =>
	!value || typeof value !== "object"
		? 0
		: (["image", "audio", "resource", "resource_link"].includes(value.type) ? 1 : 0) +
			Object.values(value).reduce((n, item) => n + mediaCount(item), 0);
const result = {
	mode,
	status: "blocked",
	modelCalls: 0,
	formalRuns: 0,
	businessWrites: 0,
	fixtureRequests: 0,
	events: [],
	tools: [],
	findings: [],
};
const tempOutputs = new Set();
let session,
	manager,
	server,
	privateRoot,
	mirror,
	controller,
	writerPending = false,
	injected = false;
async function waitFor(check, label) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out: ${label}`);
}
async function inspect(value) {
	if (!value || typeof value !== "object") return;
	for (const [key, item] of Object.entries(value)) {
		if (key === "fullOutputPath" && typeof item === "string") {
			tempOutputs.add(item);
			const bytes = await readFile(item);
			result.findings.push({
				surface: "sdk-full-output",
				bytes: bytes.length,
				containsSecret: contains(bytes.toString()),
			});
		} else if (item && typeof item === "object") await inspect(item);
	}
}
try {
	for (const path of [workspace, agentDir, join(workspace, "tests"), join(root, "data")])
		await mkdir(path, { recursive: true, mode: 0o700 });
	await mkdir(join(workspace, "node_modules/@playwright"), { recursive: true });
	for (const name of ["@playwright/test", "playwright", "playwright-core", "pi-ui-testing"])
		await symlink(join(repo, "tools/e2e/node_modules", name), join(workspace, "node_modules", name), "dir");
	await writeFile(join(workspace, "package.json"), '{"type":"module"}');
	await writeFile(join(agentDir, "auth.json"), "{}");
	server = createServer((request, response) => {
		result.fixtureRequests++;
		response.setHeader("Content-Type", "text/html");
		if (mode === "ephemeral") {
			response.setHeader(
				"Set-Cookie",
				request.url === "/clear"
					? "qa_rotated=; Path=/; HttpOnly; Max-Age=0"
					: `qa_rotated=${rotated}; Path=/; HttpOnly; SameSite=Lax`,
			);
		}
		response.end(
			`<script>localStorage.setItem('runtime-token',${JSON.stringify(JSON.stringify({ auth: { tokens: [{ value: rotated }] } }))});sessionStorage.setItem('runtime-session',${JSON.stringify(rotated)});</script><h1>Privacy fixture</h1>` +
				Array.from(
					{ length: 1800 },
					(_, i) => `<p>marker ${i} ${forms(secret).join(" ")} ${forms(rotated).join(" ")}</p>`,
				).join(""),
		);
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(18984, "127.0.0.1", resolve);
	});
	manager = createPrivateBrowserStates({
		dataDir: join(root, "data"),
		store: () => ({
			revision: 1,
			systems: [{ id: "s" }],
			envs: [
				{
					id: "e",
					systemId: "s",
					baseUrl: "http://127.0.0.1:18984",
					params: [
						{ key: "token", value: JSON.stringify({ session: { credentials: [{ token: secret }] } }), secret: true },
					],
				},
			],
		}),
	});
	const managed = await manager.prepare(workspace, {
		engine: "ui",
		mode: "execute",
		systemId: "s",
		envId: "e",
		targetUrl: "http://127.0.0.1:18984/",
		privateBindings: [{ parameterKey: "token", storageKey: "token" }],
	});
	const environment = {
		schema_version: "1.0",
		environment_id: "synthetic-private-fixture",
		deployment_version: "product-capture-v1",
		role: "synthetic-managed-context",
		identity: { selector: "h1", text: "Privacy fixture" },
		initial_state: { selector: "h1", text: "Privacy fixture" },
		auth: managed.auth,
		base_url: "http://127.0.0.1:18984/",
		isolation: "context",
		timeout_ms: 1000,
	};
	const parentPath = await authState(environment, workspace),
		parentBytes = await readFile(parentPath);
	await writeFile(
		join(workspace, "playwright.config.mjs"),
		`export default {testDir:'./tests',timeout:30000,workers:1,outputDir:process.env.PI_UI_PRIVATE_EVIDENCE_DIR+'/output/runner',use:{trace:'off',headless:true,baseURL:'http://127.0.0.1:18984',launchOptions:${JSON.stringify(CHROME_PATH ? { executablePath: CHROME_PATH } : {})}},projects:[{name:'chromium'}]};`,
	);
	await writeFile(
		join(workspace, "tests/seed.spec.ts"),
		`import {test,expect} from '${mode === "unsupported" ? "@playwright/test" : "pi-ui-testing/recording-fixtures"}';test.use({uiEnvironment:${JSON.stringify(environment)},uiOwner:{task_id:'product-capture',kind:'recording',id:'product-capture'},uiProjectRoot:process.cwd()});test('private seed',async({page})=>{const value=await page.evaluate(()=>JSON.parse(localStorage.getItem('token')).session.credentials[0].token);expect(await page.locator('body').innerText()).toContain(value);await page.evaluate(()=>{localStorage.removeItem('runtime-token');sessionStorage.removeItem('runtime-session');});${mode === "ephemeral" ? "await page.evaluate(()=>fetch('/clear'));expect((await page.context().cookies()).some(c=>c.name==='qa_rotated')).toBeFalsy();" : ""}});`,
	);
	await enableUiTesting(repo, agentDir);
	const { createExtensionToolGate } = await import("../dist/server/extension-tool-gate.js");
	const guard = {
		planMode: false,
		delegateMode: false,
		goalReview: false,
		permission: "workspace-write-never",
		uiDisabled: false,
	};
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(agentDir, "models-cache.json"),
		refreshOnCreate: false,
	});
	for (const method of ["stream", "streamSimple", "complete", "completeSimple"])
		runtime[method] = () => {
			result.modelCalls++;
			throw Error("Model calls forbidden");
		};
	const services = await createAgentSessionServices({
		cwd: workspace,
		agentDir,
		modelRuntime: runtime,
		settingsManager: SettingsManager.create(workspace, agentDir, { projectTrusted: true }),
		resourceLoaderOptions: {
			extensionFactories: [
				{ name: "host-guard", hidden: true, factory: createExtensionToolGate(() => guard) },
				(pi) => {
					pi.on("tool_call", async (event) => {
						result.events.push({
							type: "call",
							id: event.toolCallId,
							parent: event.parentToolCallId,
							name: event.toolName,
						});
						if (gated && writerPending && event.toolName.endsWith("__generator_write_test")) {
							if (mode === "helper-readonly") guard.permission = "read-only";
							if (mode === "helper-plan") guard.planMode = true;
							if (mode === "helper-delegate") guard.delegateMode = true;
							if (mode === "helper-disabled") guard.uiDisabled = true;
						}
						if (
							event.toolName.endsWith("__browser_run_code_unsafe") &&
							writerPending &&
							!injected &&
							["corrupt", "cancel"].includes(mode)
						) {
							injected = true;
							assert.ok(
								result.events.some(
									(item) => item.id === event.parentToolCallId && item.name.endsWith("__generator_write_test"),
								),
							);
							if (mode === "corrupt")
								await writeFile(
									join(privateRoot, "output/recording/storage-events.ndjson"),
									"invalid-owned-event-log\n",
									{ mode: 0o600 },
								);
							else controller.abort();
						}
					});
					pi.on("tool_result", async (event) => {
						await inspect(event);
						result.events.push({
							type: "result",
							id: event.toolCallId,
							parent: event.parentToolCallId,
							name: event.toolName,
							isError: event.isError,
						});
					});
					pi.registerTool({
						name: "product_probe_call",
						label: "Product recording probe",
						description: "Exercise the real nested SDK pipeline using isolated synthetic data.",
						parameters: Type.Object({ tool: Type.String(), input: Type.Record(Type.String(), Type.Unknown()) }),
						execute: async (_id, args, signal, _update, ctx) => {
							const outcome = await ctx.executeTool(args.tool, args.input, { signal });
							return { ...outcome.result, details: { isError: outcome.isError } };
						},
					});
				},
			],
		},
	});
	assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
	({ session } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.create(workspace, sessionDir),
	}));
	await session.bindExtensions(
		lifecycle
			? {
					onError: () => {
						result.extensionErrors = (result.extensionErrors ?? 0) + 1;
					},
				}
			: {},
	);
	const prefix = "mcp__ui_playwright_test__";
	await waitFor(
		() => session.agent.state.tools.some((tool) => tool.name === prefix + "generator_setup_page"),
		"anonymous MCP",
	);
	let sequence = 0;
	const call = async (tool, input, signal) => {
		const wrapper = session.agent.state.tools.find((item) => item.name === "product_probe_call"),
			id = `probe-${++sequence}`,
			args = { tool, input };
		session.agent.state.messages = [
			{ role: "assistant", content: [{ type: "toolCall", id, name: wrapper.name, arguments: args }] },
		];
		return wrapper.execute(id, args, signal ?? new AbortController().signal);
	};
	const invoke = async (request) => {
		const outcome = await call("ui_discover_record", { request }, controller?.signal);
		const reply = JSON.parse(
			outcome.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n"),
		);
		assert.equal(contains(JSON.stringify(reply)), false, "Secret in public native response");
		assert.equal(mediaCount(reply), 0);
		await inspect(reply);
		return reply;
	};
	const store = new ArtifactStore(workspace),
		envelope = (kind, id, data) => ({ schema_version: "1.0", kind, id, created_at: new Date().toISOString(), data });
	const source = await store.putFile(
		"qa/ui/scopes/product/source.md",
		"Synthetic fixture displays Privacy fixture heading. No business data or mutations.",
	);
	const scope = await store.put(
		envelope("scope", "product", {
			project_id: "synthetic",
			environment_id: environment.environment_id,
			role: environment.role,
			goal: "Observe synthetic private heading without disclosing supported private values",
			base_url: environment.base_url,
			allowed_actions: [
				"Read-only synthetic navigation, observation, native draft and close; fixed private capture; controlled owned evidence/abort/path rejection probes only",
			],
			sources: [
				{ source_id: "S1", oracle_type: "declaration", ref: source, statement: "Privacy fixture heading is visible" },
			],
			budget: { max_review_rounds: 3, max_tool_calls: 9 },
		}),
	);
	const inventoryData = {
		scope_ref: scope,
		features: [
			{
				module_id: "privacy",
				feature_id: "heading",
				name: "Privacy heading",
				entry: "/",
				role: environment.role,
				actions: ["Observe heading"],
				scenarios: [{ scenario_id: "heading", title: "Heading is visible" }],
				coverage: "discovered",
				discovery: "source",
				source_refs: [source],
				source_locations: [{ ref: source, line: 1, symbol: "heading" }],
				priority: "P0",
				states: [],
				gaps: ["Not yet observed"],
			},
		],
		unexplored: ["Real PMS business behavior", "Other roles"],
	};
	let reply = await invoke({
			operation: "inventory",
			inventory: envelope("inventory", "product-initial", inventoryData),
		}),
		inventoryRef = reply.artifact_refs[0];
	const environmentRef = await store.putFile("qa/ui/scopes/product/environment.json", JSON.stringify(environment));
	const inputRefs = await Promise.all(
		["package.json", "playwright.config.mjs", "tests/seed.spec.ts"].map(async (path) => ({
			path,
			sha256: sha256(await readFile(join(workspace, path))),
		})),
	);
	const outputFile = mode === "symlink" ? "tests/publish/generated.spec.ts" : "tests/generated.spec.ts";
	reply = await invoke({
		operation: "start",
		configuration: {
			id: "product-capture",
			scope_ref: scope,
			inventory_ref: inventoryRef,
			initial_state_ref: source,
			data_rules_ref: source,
			seed_ref: inputRefs[2],
			backend: prefix,
			project: "chromium",
			output_file: outputFile,
			max_steps: 4,
			max_duration_ms: 120000,
			max_no_progress: 3,
			test_data: [],
			private_recording: { environment_ref: environmentRef, input_refs: inputRefs, capture: "chromium-single-page-v1" },
		},
	});
	const sessionRef = reply.artifact_refs[0];
	if (mode === "unsupported") {
		assert.equal(reply.status, "blocked", JSON.stringify(reply));
		assert.equal(result.fixtureRequests, 0, "Unsupported seed must not run browser body");
		result.unsupportedSeedBlockedBeforeBrowser = true;
	} else {
		assert.equal(reply.status, "completed", JSON.stringify(reply));
		assert.equal(reply.output.recording, "private-capture-prepared");
		result.preparation = reply.output.private_preparation;
		await waitFor(async () => {
			const paths = await readdir(sessionDir, { recursive: true });
			for (const path of paths.filter((path) => /handshake-\d+\.json$/.test(path))) {
				const message = JSON.parse(await readFile(join(sessionDir, path), "utf8"));
				if (message.result?.tools?.some((tool) => tool.name === "generator_setup_page")) {
					privateRoot = dirname(join(sessionDir, path));
					return true;
				}
			}
			return false;
		}, "private tools/list");
		const paths = await readdir(privateRoot, { recursive: true });
		mirror = dirname(
			join(
				privateRoot,
				paths.find((path) => /recording-[^/]+\/work\/package\.json$/.test(path)),
			),
		);
		assert.equal((await lstat(join(privateRoot, "output"))).mode & 0o777, 0o700);
		const direct = await call(prefix + "browser_run_code_unsafe", {
			code: "async(page)=>{return 1}",
			intent: "Must be denied outside native action",
		});
		assert.equal(direct.details.isError, true);
		result.unrelatedNestedDenied = true;
		const action = async (tool, input = {}, expectBlocked = false) => {
			const response = await invoke({
				operation: "action",
				session_ref: sessionRef,
				operation_id: `step-${++sequence}`,
				tool,
				input: tool === "browser_close" ? { ...input, intent: "Close owned synthetic context" } : input,
				intent: "Observe only owned synthetic fixture and preserve evidence",
			});
			result.tools.push({
				tool,
				status: response.status,
				containsSecret: contains(JSON.stringify(response)),
				mediaBlocks: mediaCount(response),
			});
			assert.equal(response.status, expectBlocked ? "blocked" : "completed", JSON.stringify(response));
			return response;
		};
		await action("generator_setup_page", {
			seedFile: "tests/seed.spec.ts",
			project: "chromium",
			plan: "Observe synthetic heading; no business writes",
		});
		const snapshot = await action("browser_snapshot");
		assert.match(JSON.stringify(snapshot), /Privacy fixture/);
		Object.assign(inventoryData.features[0], {
			coverage: "explored",
			discovery: "browser",
			source_refs: [source, ...snapshot.artifact_refs],
			states: ["Heading visible in owned private context"],
			gaps: [],
		});
		reply = await invoke({
			operation: "inventory",
			inventory: envelope("inventory", "product-observed", inventoryData),
		});
		inventoryRef = reply.artifact_refs[0];
		await action("generator_read_log");
		let beforeInterruption, interruptionEvent, requestsBeforeInterruption;
		if (lifecycle) {
			requestsBeforeInterruption = result.fixtureRequests;
			beforeInterruption = await new RecordingService(workspace).status(sessionRef);
			await writeFile(join(output, "before-interruption.json"), JSON.stringify(beforeInterruption, null, 2));
			result.beforeInterruptionSteps = beforeInterruption.events.length;
			await cp(join(workspace, "qa"), join(output, "qa-before-interruption"), { recursive: true });
			if (mode === "reload") {
				await session.reload();
				await waitFor(
					() => session.agent.state.tools.some((tool) => tool.name === prefix + "generator_setup_page"),
					"reloaded MCP",
				);
				result.reloaded = true;
			} else {
				const command = session.extensionRunner.getCommand("mcp");
				assert.ok(command);
				const ctx = session.extensionRunner.createCommandContext(),
					notices = [];
				await command.handler("reconnect ui-playwright-test", {
					...ctx,
					ui: { ...ctx.ui, notify: (text, type) => notices.push({ text, type }) },
				});
				assert.ok(notices.some((n) => n.type === "error"));
				result.reconnectNotices = notices;
			}
			interruptionEvent = result.events.length;
		}
		const generated =
			"import {test,expect} from '@playwright/test';test('heading',async({page})=>{await page.goto('/');await expect(page.getByRole('heading',{name:'Privacy fixture'})).toBeVisible();});\n";
		if (mode === "existing") await writeFile(join(workspace, outputFile), "existing draft preserved\n");
		if (mode === "symlink") {
			await mkdir(join(root, "outside"));
			await symlink(join(root, "outside"), join(workspace, "tests/publish"), "dir");
		}
		if (mode === "budget") await action("browser_snapshot");
		writerPending = true;
		controller = new AbortController();
		await action(
			"generator_write_test",
			{ fileName: outputFile, code: generated },
			!["normal", "ephemeral"].includes(mode),
		);
		writerPending = false;
		controller = undefined;
		Object.assign(guard, {
			permission: "workspace-write-never",
			planMode: false,
			delegateMode: false,
			uiDisabled: false,
		});
		if (gated || ["corrupt", "cancel"].includes(mode)) {
			if (!gated) assert.equal(injected, true);
			assert.equal(await readFile(join(mirror, outputFile), "utf8"), generated);
			assert.equal(existsSync(join(workspace, outputFile)), false);
			result.privateWriterRetainedPublicAbsent = true;
		} else if (["normal", "ephemeral"].includes(mode)) {
			assert.ok((await readFile(join(mirror, outputFile))).equals(await readFile(join(workspace, outputFile))));
			assert.equal((await lstat(join(workspace, outputFile))).mode & 0o777, 0o600);
			result.byteIdenticalExclusivePublication = true;
		} else {
			assert.equal(existsSync(join(mirror, outputFile)), false);
			if (mode === "existing")
				assert.equal(await readFile(join(workspace, outputFile), "utf8"), "existing draft preserved\n");
			else assert.equal(existsSync(join(workspace, outputFile)), false);
			assert.equal(existsSync(join(root, "outside/generated.spec.ts")), false);
			result.rejectedBeforeNativeWriter = true;
		}
		await action("browser_close", {}, lifecycle);
		if (lifecycle) {
			const current = await invoke({ operation: "status", session_ref: sessionRef });
			assert.equal(current.status, "completed");
			const afterInterruption = current.output;
			await writeFile(join(output, "after-interruption.json"), JSON.stringify(afterInterruption, null, 2));
			assert.deepEqual(afterInterruption.events.slice(0, beforeInterruption.events.length), beforeInterruption.events);
			if (mode === "reload") {
				assert.deepEqual(afterInterruption, JSON.parse(JSON.stringify(beforeInterruption)));
				assert.ok(result.events.slice(interruptionEvent).every((e) => !e.name.startsWith(prefix)));
			} else {
				assert.ok(afterInterruption.events.slice(beforeInterruption.events.length).every((e) => e.response.isError));
			}
			result.oldEvidenceUnchanged = true;
			result.afterInterruptionSteps = afterInterruption.events.length;
			assert.equal(result.fixtureRequests, requestsBeforeInterruption);
			result.interruptionTriggeredNoNavigation = true;
			assert.equal(existsSync(join(workspace, outputFile)), false);
		}
		const helpers = result.events.filter(
			(event) =>
				event.type === "call" &&
				event.name.endsWith("__browser_run_code_unsafe") &&
				result.events.some(
					(parent) => parent.type === "call" && parent.id === event.parent && parent.name.startsWith(prefix),
				),
		);
		assert.equal(
			helpers.length,
			mode === "budget" ? 4 : lifecycle || gated || ["existing", "symlink"].includes(mode) ? 3 : 4,
		);
		assert.ok(
			helpers.every((helper) =>
				result.events.some((event) => event.id === helper.parent && event.name.startsWith(prefix)),
			),
		);
		result.fixedCaptureCalls = helpers.length;
		result.mcpCalls = result.events.filter(
			(event) => event.type === "call" && event.name.startsWith(prefix) && event.parent !== undefined,
		).length;
		const privateFiles = await readdir(privateRoot, { recursive: true });
		const raw = await Promise.all(
			privateFiles
				.filter((path) => /handshake-\d+\.json$/.test(path))
				.map((path) => readFile(join(privateRoot, path), "utf8")),
		);
		assert.ok(variants.every((variant) => raw.some((text) => text.includes(variant))));
		result.rawProtocolRetainedPrivately = true;
	}
	const success = ["normal", "ephemeral"].includes(mode);
	reply = await invoke({
		operation: "finish",
		session_ref: sessionRef,
		inventory_ref: inventoryRef,
		initial_state: "Host recreates synthetic managed token in an independent context",
		goal_reached: success,
		gaps: success ? [] : [`product-${mode}-blocked`],
		completion: {
			initial_state_rebuildable: true,
			replaceable_data: true,
			stable_locators: true,
			assertion_sources: true,
			cleanup_owned: mode !== "unsupported" && !lifecycle,
		},
	});
	assert.equal(reply.status, "completed", JSON.stringify(reply));
	const final = await store.load(reply.artifact_refs[0]);
	assert.equal(final.data.status, success ? "complete" : "partial", JSON.stringify(final.data.gaps));
	assert.equal(final.data.script_refs.length, success ? 1 : 0);
	if (success) assert.deepEqual(final.data.gaps, []);
	else assert.ok(final.data.gaps.includes(`product-${mode}-blocked`));
	result.recordingStatus = final.data.status;
	result.recordingRef = reply.artifact_refs[0];
	result.finishGaps = final.data.gaps;
	assert.ok((await readFile(parentPath)).equals(parentBytes));
	result.parentStateUnchanged = true;
	if (privateRoot) {
		const paths = await readdir(privateRoot, { recursive: true });
		assert.equal(
			paths.some((path) => /recording-[^/]+\/state\.json$/.test(path)),
			false,
		);
		result.derivedStateRevoked = true;
	}
	async function scan(path, label) {
		for (const entry of await readdir(path, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) continue;
			const file = join(path, entry.name),
				relative = label + "/" + entry.name;
			if (entry.isDirectory()) await scan(file, relative);
			else {
				const bytes = await readFile(file);
				if (contains(bytes.toString()))
					result.findings.push({ surface: "workspace", path: relative, containsSecret: true });
				if (/\.(png|jpg|zip)$/.test(file)) result.findings.push({ surface: "workspace-media", path: relative });
			}
		}
	}
	await scan(workspace, "workspace");
	assert.equal(
		result.findings.some((item) => item.containsSecret || item.surface === "workspace-media"),
		false,
	);
	await cp(join(workspace, "qa"), join(output, "qa"), { recursive: true });
	if (success) await cp(join(workspace, "tests/generated.spec.ts"), join(output, "generated.spec.ts"));
	result.status = "PASS";
} catch (error) {
	result.error = { name: error.name, message: String(error.message).split(root).join("[OWNED-TEMP]") };
	process.exitCode = 1;
} finally {
	if (lifecycle && result.status !== "PASS" && existsSync(join(workspace, "tests/generated.spec.ts"))) {
		const bytes = await readFile(join(workspace, "tests/generated.spec.ts"));
		result.unexpectedPublicDraftExists = true;
		if (!contains(bytes.toString())) await writeFile(join(output, "unexpected-public-draft.spec.ts"), bytes);
	}
	if (session) {
		await session.extensionRunner?.emit({ type: "session_shutdown", reason: "shutdown" }).catch(() => {});
		session.dispose();
	}
	manager?.dispose();
	if (server) await new Promise((resolve) => server.close(resolve));
	for (const path of tempOutputs) await rm(path, { force: true });
	await rm(root, { recursive: true, force: true });
	result.ownedTemporaryDataRemoved = true;
	await cp(fileURLToPath(import.meta.url), join(output, "harness.mjs"));
	const serialized = JSON.stringify(result, null, 2);
	assert.equal(contains(serialized), false, "Reduced result must not contain synthetic private values");
	await writeFile(join(output, "result.json"), serialized + "\n");
	console.log(JSON.stringify({ output, ...result }, null, 2));
}
