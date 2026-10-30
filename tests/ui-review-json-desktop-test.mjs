/** Actual isolated Electron -> SDK tool -> native registerDesignTools -> separate Agent.
 * Local synthetic NON-PMS provider only. Never builds; requires PI_WEB_SMOKE_PREBUILT=1.
 * All runtime writes/evidence stay in .workbuddy/tmp/ui-review-json-desktop/<run>.
 * This checks transport/validation integration, not the semantic quality of a real model.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile, writeFile, symlink, realpath, cp, rm } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { ArtifactStore, assetDigest, DesignReviewService, sha256 } from "pi-ui-testing";
import { artifact, scope, cases } from "./fixtures/data-space/ui-artifacts.mjs";
import { validCode, decision } from "./fixtures/data-space/ui-design-fixture.mjs";
import { enableUiTesting } from "../scripts/enable-ui-testing.mjs";
import { ensureBuild, PREBUILT_ENV } from "./lib/ensure-build.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
import { waitUntil } from "../qa/ui/project-environment.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
assert.equal(
	process.env[PREBUILT_ENV],
	"1",
	"Never build here: ask main agent for prebuilt dist, then set PI_WEB_SMOKE_PREBUILT=1",
);
ensureBuild(repo, "ui-review-json-desktop");
const output = join(repo, ".workbuddy/tmp/ui-review-json-desktop", `${Date.now()}-${process.pid}`);
const workspace = join(output, "workspace"),
	userData = join(output, "desktop");
const agentDir = join(userData, "agent"),
	dataDir = join(userData, "data");
const json = (v) => JSON.stringify(v, null, 2) + "\n";
const result = {
	status: "FAIL",
	authorization: "SYNTHETIC_NON_PMS",
	integration: "actual-isolated-Electron-native-SDK",
	checks: [],
	providerRequests: 0,
	reviewerRequests: 0,
	outerRequests: 0,
	paidModelCalls: 0,
	businessRequests: 0,
	personalCredentialsRead: false,
	unexecuted: [
		"paid/remote model quality",
		"personal desktop installation",
		"Windows/Linux/macOS x64",
		"formal UI runtime diagnostics and regression",
	],
};
let app,
	page,
	provider,
	pending,
	marker = 0,
	activeReview,
	sessionFile;
const receipts = [],
	requests = [],
	reviewerInputs = [],
	rawResponses = [];
const progress = (text) => console.log(`[ui-review-json-desktop] ${text}`);
await mkdir(agentDir, { recursive: true });
await mkdir(dataDir, { recursive: true });
await mkdir(workspace, { recursive: true });
await writeFile(join(output, ".cleanup-keep"), "Retain actual Electron JSON-review evidence.\n");
try {
	const runtime = dirname(fileURLToPath(import.meta.resolve("pi-ui-testing")));
	const packageInfo = JSON.parse(await readFile(join(runtime, "../package.json"), "utf8"));
	assert.equal(packageInfo.version, "0.1.31");
	assert.equal(runtime, await realpath(join(repo, "tools/e2e/node_modules/pi-ui-testing/dist")));
	result.package = {
		version: packageInfo.version,
		runtime,
		helperSha256: sha256(await readFile(join(runtime, "review-response.js"))),
		nativeToolSha256: sha256(await readFile(join(runtime, "design-extension.js"))),
	};
	// Reuse the existing source/case/script fixtures, but create an independent task and workspace.
	await symlink(join(repo, "node_modules"), join(workspace, "node_modules"), "dir");
	await writeFile(join(workspace, "package.json"), '{"type":"module"}\n');
	const store = new ArtifactStore(workspace);
	const requirement =
		"R1: Saved Name persists after reload. Start with a fresh non-persistent browser context, empty localStorage and no imported storageState. Enter a generated Name, click Save, then reload. The saved list contains exactly that original generated Name. Close the owned context for cleanup. Synthetic NON-PMS fixture; no external data.";
	await writeFile(join(workspace, "requirements.md"), requirement);
	const sourceRef = { path: "requirements.md", sha256: sha256(requirement) };
	const selectedScope = scope();
	selectedScope.id = "json-desktop-non-pms-scope";
	selectedScope.data.project_id = "json-desktop-non-pms";
	selectedScope.data.sources[0].ref = sourceRef;
	selectedScope.data.goal =
		"Valid generated Name persistence only; boundary/invalid input outside this source-only design task.";
	const scopeRef = await store.put(selectedScope);
	const inventoryRef = await store.put(
		artifact(
			"inventory",
			{
				scope_ref: scopeRef,
				features: [
					{
						module_id: "names",
						feature_id: "save",
						name: "Names",
						entry: "/",
						role: "tester",
						actions: ["Save Name", "Reload"],
						scenarios: [{ scenario_id: "valid-name", title: "Persistence" }],
						coverage: "discovered",
						source_refs: [sourceRef],
						source_locations: [{ ref: sourceRef, symbol: "R1", line: 1 }],
						discovery: "source",
						priority: "P0",
						states: ["initial", "saved", "reloaded"],
						gaps: [],
					},
				],
				unexplored: ["Input validation and runtime behavior are outside this source-only integration fixture."],
			},
			"json-desktop-inventory",
		),
	);
	const dataRules = await store.putFile(
		"qa/ui/cases/json-desktop/data-rules.json",
		json({ name: "qa-${uuid}", isolation: "fresh browser context", cleanup: "close owned context" }),
	);
	const c = cases();
	c.id = "json-desktop-cases";
	c.data.scope_ref = scopeRef;
	c.data.sources = selectedScope.data.sources;
	c.data.data_rules_ref = dataRules;
	c.data.gaps = ["Boundary/invalid-input scenarios are outside selected scope."];
	c.data.cases[0].preconditions = ["Fresh non-persistent context, empty localStorage, no imported storageState."];
	c.data.cases[0].assertions[0].expected = { from: "generated input key" };
	const casesRef = await store.put(c);
	const scriptRef = await store.putFile("qa/ui/assets/json-desktop/revisions/v1/name.spec.ts", validCode);
	const asset = artifact(
		"asset",
		{
			revision: "v1",
			module_ids: ["names"],
			scope_ref: scopeRef,
			inventory_ref: inventoryRef,
			cases_ref: casesRef,
			recording_refs: [],
			files: [scriptRef, dataRules],
			bindings: [{ case_id: "C1", script_ref: scriptRef, test_title: "C1 Name persists", assertion_ids: ["A1"] }],
			dependencies: [{ name: "playwright", version: "1.62.1" }],
			readiness: "design-only",
			content_sha256: "0".repeat(64),
			gaps: [],
		},
		"json-desktop",
	);
	asset.data.content_sha256 = assetDigest(asset);
	const assetRef = await store.put(asset);
	const taskRef = await store.put(
		artifact(
			"task",
			{
				intent: "record",
				scope_ref: scopeRef,
				state: "running",
				stage: "design-review",
				completed_stages: ["discover-record", "case-design"],
				input_sha256: sha256("synthetic non-pms JSON desktop review"),
				asset_refs: [assetRef],
				run_ids: [],
				output_refs: [assetRef],
				blockers: [],
			},
			"json-desktop-non-pms-task",
		),
	);
	Object.assign(result, { taskRef, assetRef, scopeRef });
	await enableUiTesting(repo, agentDir);
	const registration = await readFile(join(agentDir, "settings.json"));
	await enableUiTesting(repo, agentDir);
	assert.deepEqual(await readFile(join(agentDir, "settings.json")), registration);
	assert.ok(
		JSON.parse(registration).extensions.some(
			(e) => (typeof e === "string" ? e : e.source) === join(runtime, "extension.js"),
		),
	);
	await writeFile(join(output, "isolated-registration.json"), registration);

	provider = createServer(async (req, res) => {
		try {
			assert.equal(req.method, "POST");
			assert.match(req.url, /\/chat\/completions$/);
			let raw = "";
			for await (const chunk of req) raw += chunk;
			const body = JSON.parse(raw);
			assert.equal(body.model, "json-desktop");
			assert.ok(++result.providerRequests <= 11, "Unexpected model turn; no uncontrolled retries");
			const reviewer = body.response_format?.type === "json_object";
			requests.push({ role: reviewer ? "reviewer" : "outer", body });
			await writeFile(join(output, "provider-requests.json"), json(requests));
			let delta, finish;
			if (reviewer) {
				assert.equal(body.response_format.type, "json_object");
				assert.equal(Object.hasOwn(body, "tools"), false, "Independent reviewer has no tools field");
				assert.equal(body.tool_choice, undefined);
				assert.deepEqual(
					body.messages.map((m) => m.role),
					["system", "user"],
					"Fresh Agent contains only rules and frozen facts",
				);
				assert.ok(activeReview, "Unrequested reviewer call");
				const factsText = body.messages[1].content;
				const facts = JSON.parse(
					typeof factsText === "string" ? factsText : factsText.map((c) => c.text ?? "").join(""),
				);
				assert.equal(
					facts.static_check.issues.some((i) => i.blocking),
					false,
					json(facts.static_check),
				);
				assert.ok(facts.context_id && !reviewerInputs.some((f) => f.context_id === facts.context_id));
				assert.ok(
					!JSON.stringify(body.messages).includes("OUTER_ONLY_NON_PMS_CANARY"),
					"Outer conversation does not enter reviewer",
				);
				for (const file of facts.evidence) {
					const bytes = await readFile(join(workspace, file.ref.path));
					assert.equal(sha256(bytes), file.ref.sha256);
					assert.equal(file.content, bytes.toString("utf8"));
					for (const anchor of file.anchors)
						assert.ok(file.content.includes(anchor.quote), `Real anchor ${anchor.anchor_id}`);
				}
				reviewerInputs.push(facts);
				result.reviewerRequests++;
				let response;
				if (activeReview === "empty") response = "";
				else if (activeReview === "invalid") response = '{"decision":"approved","broken":';
				else {
					const approved = decision(facts);
					for (const check of approved.checks) {
						const original = check.evidence[0];
						const file = facts.evidence.find((f) => f.ref.path === original.ref.path);
						assert.ok(file?.anchors.length);
						check.evidence = [{ anchor_id: file.anchors[0].anchor_id }];
					}
					response = JSON.stringify(approved);
				}
				rawResponses.push({ mode: activeReview, raw: response });
				await writeFile(join(output, `reviewer-${result.reviewerRequests}-input.json`), json(facts));
				await writeFile(join(output, "reviewer-responses.json"), json(rawResponses));
				delta = { content: response };
				finish = "stop";
			} else {
				result.outerRequests++;
				if (pending) {
					assert.ok(
						body.tools?.some((t) => t.function?.name === "ui_design_review"),
						"Native tool is registered in actual SDK",
					);
					const call = pending;
					pending = undefined;
					delta = {
						tool_calls: [
							{
								index: 0,
								id: `json_${marker}`,
								type: "function",
								function: { name: "ui_design_review", arguments: JSON.stringify(call) },
							},
						],
					};
					finish = "tool_calls";
				} else {
					const last = [...body.messages].reverse().find((m) => m.role === "tool");
					assert.ok(last, "Outer SDK receives native tool result");
					receipts.push(
						JSON.parse(
							typeof last.content === "string" ? last.content : last.content.map((c) => c.text ?? "").join(""),
						),
					);
					delta = { content: `JSON_DESKTOP_DONE_${marker}` };
					finish = "stop";
				}
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			for (const [value, reason] of [
				[delta, null],
				[{}, finish],
			])
				res.write(
					`data: ${JSON.stringify({ id: `local-json-${result.providerRequests}`, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: value, finish_reason: reason }] })}\n\n`,
				);
			res.end("data: [DONE]\n\n");
		} catch (error) {
			result.providerError = error.stack;
			res.writeHead(500);
			res.end("Synthetic provider assertion failed");
		}
	});
	provider.listen(0, "127.0.0.1");
	await once(provider, "listening");
	assert.ok(provider.address().port >= 8900);
	await writeFile(join(agentDir, "auth.json"), json({ fixture: { type: "api_key", key: "local-only" } }));
	await writeFile(
		join(agentDir, "models.json"),
		json({
			providers: {
				fixture: {
					api: "openai-completions",
					apiKey: "local-only",
					baseUrl: `http://127.0.0.1:${provider.address().port}`,
					models: [
						{ id: "json-desktop", name: "Synthetic NON-PMS JSON reviewer", contextWindow: 128000, maxTokens: 4096 },
					],
				},
			},
		}),
	);
	const reservation = createServer().listen(0, "127.0.0.1");
	await once(reservation, "listening");
	const port = reservation.address().port;
	assert.ok(port >= 8900);
	await new Promise((resolve) => reservation.close(resolve));
	const env = {};
	for (const key of ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "DISPLAY", "SYSTEMROOT", "WINDIR", "ComSpec"])
		if (process.env[key]) env[key] = process.env[key];
	await mkdir(join(output, "home"));
	await mkdir(join(output, "tmp"));
	Object.assign(env, {
		HOME: join(output, "home"),
		TMPDIR: join(output, "tmp"),
		TMP: join(output, "tmp"),
		TEMP: join(output, "tmp"),
		PI_DESKTOP_USER_DATA: userData,
		PI_CODING_AGENT_DIR: agentDir,
		PI_WEB_DATA_DIR: dataDir,
		PI_WEB_CWD: workspace,
		PI_WEB_PORT: String(port),
		PI_WEB_PLUGIN_CATALOG_URL: "off",
		PI_WEB_SDK: "bundled",
		PI_WEB_TOOL_LAZY_LOADING: "0",
	});
	result.environment = {
		platform: process.platform,
		arch: process.arch,
		port,
		providerPort: provider.address().port,
		workspace,
		agentDir,
		dataDir,
		envKeys: Object.keys(env).sort(),
		prebuilt: true,
	};
	progress("launch real Electron using prebuilt dist and isolated HOME/dataDir/agentDir");
	app = await launchNativeApp({ executablePath: electron, packaged: false, env });
	page = await app.firstWindow();
	page.setDefaultTimeout(30000);
	await app.context().addInitScript(() => {
		const Original = window.WebSocket;
		window.__jsonFrames = [];
		window.WebSocket = class extends Original {
			constructor(...args) {
				super(...args);
				window.__jsonSocket = this;
				this.addEventListener("message", (e) => {
					try {
						window.__jsonFrames.push(JSON.parse(e.data));
					} catch {}
				});
			}
		};
	});
	await page.reload();
	await page.waitForSelector(".app");
	await waitUntil(
		() => page.evaluate(() => window.__jsonFrames.some((m) => m.type === "ready")),
		"isolated desktop ready",
		45000,
	);
	assert.equal(Number(new URL(await page.evaluate(() => window.__jsonSocket.url)).port), port);
	const send = (m) => page.evaluate((message) => window.__jsonSocket.send(JSON.stringify(message)), m);
	const frames = () => page.evaluate(() => window.__jsonFrames);
	await send({ type: "set_model", modelId: "fixture/json-desktop" });
	await waitUntil(
		async () => (await frames()).some((m) => m.state?.model?.id === "json-desktop"),
		"synthetic model selected",
		30000,
	);
	const tool = async (mode, requestId) => {
		activeReview = mode;
		pending = { task_ref: taskRef, asset_ref: assetRef, request_id: requestId };
		marker++;
		progress(`actual SDK ui_design_review: ${mode}`);
		const before = receipts.length;
		await send({
			type: "prompt",
			text: `OUTER_ONLY_NON_PMS_CANARY synthetic JSON transport check ${marker}; use the provided native tool, keep all gates.`,
		});
		await waitUntil(
			async () => {
				assert.equal(result.providerError, undefined);
				return page.getByText(`JSON_DESKTOP_DONE_${marker}`, { exact: true }).isVisible();
			},
			"native tool result delivered to Electron",
			45000,
		);
		assert.equal(result.providerError, undefined);
		assert.equal(receipts.length, before + 1);
		await writeFile(join(output, "native-tool-receipts.json"), json(receipts));
		return receipts.at(-1);
	};
	for (const mode of ["empty", "invalid"]) {
		const receipt = await tool(mode, `json-desktop-${mode}`);
		assert.equal(receipt.status, "blocked", json(receipt));
		assert.equal(receipt.errors[0].category, "review-rejected");
		assert.match(receipt.errors[0].message, /不是有效 JSON/);
		const rawRef = receipt.artifact_refs.find((r) => r.path.endsWith("/raw.json"));
		assert.ok(rawRef, "Rejected original response retained");
		assert.equal(sha256(await readFile(join(workspace, rawRef.path))), rawRef.sha256);
		assert.equal(JSON.parse(await readFile(join(workspace, rawRef.path), "utf8")).response, rawResponses.at(-1).raw);
		result.checks.push(`${mode} response rejected by actual native SDK tool; raw/input/static evidence retained`);
	}
	const accepted = await tool("valid", "json-desktop-valid");
	assert.equal(accepted.status, "completed", json(accepted));
	assert.equal(accepted.output.decision, "approved");
	assert.equal(accepted.output.round, 3);
	assert.equal(accepted.output.runtime_ready, false);
	assert.equal(result.reviewerRequests, 3);
	const review = await store.load(accepted.output.review_ref);
	assert.equal(review.data.reviewer.isolation, "separate-agent");
	assert.equal(review.data.reviewer.model_provider, "fixture");
	assert.equal(review.data.reviewer.model_id, "json-desktop");
	for (const [i, check] of review.data.checks.entries()) {
		const anchorId = JSON.parse(rawResponses[2].raw).checks[i].evidence[0].anchor_id;
		const original = reviewerInputs[2].evidence.find((f) => f.anchors.some((a) => a.anchor_id === anchorId));
		const quote = original.anchors.find((a) => a.anchor_id === anchorId).quote;
		assert.deepEqual(check.evidence, [{ ref: original.ref, quote }]);
	}
	await send({ type: "get_state" });
	await waitUntil(
		async () => {
			const c = (await frames()).filter((m) => m.type === "conversations").at(-1);
			sessionFile = c?.conversations.find((v) => v.id === c.activeId)?.sessionFile;
			return Boolean(sessionFile);
		},
		"actual SDK session file",
		30000,
	);
	const localSession = relative(agentDir, sessionFile);
	assert.ok(localSession && !localSession.startsWith("..") && !isAbsolute(localSession));
	const authority = join(dirname(sessionFile), "ui-review-authority");
	const service = new DesignReviewService(workspace, authority);
	await service.gate(assetRef, accepted.output.review_ref, false);
	await assert.rejects(service.gate(assetRef, accepted.output.review_ref), /运行就绪/);
	result.checks.push(
		"valid anchored JSON approved at round 3; fresh reviewer has no tools or outer history; all anchors restore real file refs/quotes",
		"actual SDK private authority accepts design but runtime gate still rejects",
	);

	// Reuse actual settings/slash/reload regression mechanics; no model calls for these actions.
	progress("verify skill disable/enable and reload persistence in actual Electron");
	const setupClose = page.locator(".setup-modal .modal-close");
	if (await setupClose.isVisible()) await setupClose.click();
	const input = page.locator("textarea").first();
	const openSettings = async () => {
		await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
		await page.locator('.settings-tab[data-tab="skills"]').click();
	};
	const closeSettings = () => page.locator(".set-close-btn").click();
	const skillRow = () =>
		page
			.locator(".settings-modal .set-row")
			.filter({ has: page.locator('.set-row-name [title="ui-testing-workflow"]') });
	const slash = () =>
		page.locator(".slash-item").filter({ has: page.locator('.slash-name[title="/skill:ui-testing-workflow"]') });
	const reload = async () => {
		const start = (await frames()).length;
		await input.fill("/reload");
		await input.press("Escape");
		await input.press("Enter");
		await waitUntil(
			async () =>
				(await frames()).slice(start).some((m) => m.type === "notice" && /已重新加载|Reloaded extensions/.test(m.text)),
			"native SDK reload",
			45000,
		);
	};
	const beforeReload = result.providerRequests;
	await openSettings();
	assert.equal(await skillRow().getByRole("switch").getAttribute("aria-checked"), "true");
	await page.screenshot({ path: join(output, "01-skill-enabled.png") });
	await skillRow().getByRole("switch").click();
	await closeSettings();
	await reload();
	await openSettings();
	assert.equal(await skillRow().getByRole("switch").getAttribute("aria-checked"), "false");
	await page.screenshot({ path: join(output, "02-skill-disabled-after-reload.png") });
	await closeSettings();
	await input.fill("/ui");
	assert.equal(await slash().count(), 0);
	await input.fill("");
	await openSettings();
	await skillRow().getByRole("switch").click();
	await closeSettings();
	await reload();
	await openSettings();
	assert.equal(await skillRow().getByRole("switch").getAttribute("aria-checked"), "true");
	await closeSettings();
	await input.fill("/ui");
	await slash().waitFor();
	await slash().click();
	assert.equal(await input.inputValue(), "/skill:ui-testing-workflow ");
	await input.fill("");
	assert.equal(result.providerRequests, beforeReload, "Reload never replays reviewer/model calls");
	const replay = await tool("valid", "json-desktop-valid");
	assert.deepEqual(replay.output.review_ref, accepted.output.review_ref);
	assert.equal(result.reviewerRequests, 3, "Idempotent review survives real SDK reload; no extra Agent call");
	assert.equal(result.outerRequests, 8);
	assert.equal(result.providerRequests, 11);
	await service.gate(assetRef, accepted.output.review_ref, false);
	await assert.rejects(service.gate(assetRef, accepted.output.review_ref), /运行就绪/);
	result.checks.push(
		"Electron skill disable/enable survives /reload; /ui hides/restores and completes original skill",
		"native ui_design_review remains callable after reload; same request returns original approval without reviewer replay",
	);
	await page.screenshot({ path: join(output, "03-approved-runtime-not-ready.png") });
	await cp(authority, join(output, "native-authority"), { recursive: true });
	await cp(sessionFile, join(output, "sdk-session.jsonl"));
	await writeFile(join(output, "renderer-frames.json"), json(await frames()));
	result.accepted = accepted;
	result.status = "PASS";
	progress("PASS: Electron + SDK JSON request, rejection paths, native authority, runtime gate and reload");
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
	console.error(error);
	if (page) {
		await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
		await writeFile(
			join(output, "failure-renderer-frames.json"),
			json(await page.evaluate(() => window.__jsonFrames).catch(() => [])),
		);
	}
	if (sessionFile) await cp(sessionFile, join(output, "sdk-session-failure.jsonl")).catch(() => {});
} finally {
	if (app) {
		await writeFile(join(output, "electron.log"), app.getLogs());
		await app.close().catch((e) => {
			result.cleanupError = e.stack;
			result.status = "FAIL";
			process.exitCode = 1;
		});
	}
	if (provider) {
		provider.closeAllConnections();
		await new Promise((resolve) => provider.close(resolve));
	}
	const electronClosed = !app || app.process().exitCode !== null;
	// Preserve failure data if Electron did not close; never remove a live app's data.
	if (electronClosed) {
		await rm(userData, { recursive: true, force: true });
		await rm(join(output, "home"), { recursive: true, force: true });
		await rm(join(output, "tmp"), { recursive: true, force: true });
	}
	await rm(join(workspace, "node_modules"), { force: true });
	result.cleanup = {
		electronClosed,
		providerClosed: !provider?.listening,
		isolatedAppDataRemoved: electronClosed,
		evidenceRetained: true,
	};
	await writeFile(join(output, "result.json"), json(result));
	console.log(json({ ...result, output }));
}
