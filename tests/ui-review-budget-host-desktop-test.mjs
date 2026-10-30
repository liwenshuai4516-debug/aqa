/** Actual Electron + SDK host regression. Synthetic authorization, explicitly NON-PMS.
 * Uses only a local OpenAI fixture, never a paid model or real reviewer. Requires prebuilt dist.
 * Removes owned app/provider/temp; retains native authority, SDK and renderer evidence in scratch.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, cp } from "node:fs/promises";
import { dirname, join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { DesignReviewService, sha256 } from "pi-ui-testing";
import { setup } from "./fixtures/data-space/ui-design-fixture.mjs";
import { enableUiTesting } from "../scripts/enable-ui-testing.mjs";
import { ensureBuild, PREBUILT_ENV } from "./lib/ensure-build.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";
import { waitUntil } from "../qa/ui/project-environment.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
assert.equal(
	process.env[PREBUILT_ENV],
	"1",
	"Ask the main session to build, then run with PI_WEB_SMOKE_PREBUILT=1. This test never builds.",
);
ensureBuild(repo, "ui-review-budget-host-desktop");
const output = join(repo, "tests/scratch/ui-review-budget-host-desktop", String(Date.now()));
await mkdir(output, { recursive: true });
const cleanup = [];
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const result = {
	status: "FAIL",
	authorization: "SYNTHETIC_NON_PMS",
	checks: [],
	providerRequests: 0,
	paidModelCalls: 0,
	realReviewerCalls: 0,
	businessRequests: 0,
	controlledReviewErrors: 0,
	originalUserSessionLoaded: false,
	originalUserSessionRequiresReload: true,
};
let app, page, provider, temporary, f, sessionFile, authority;
try {
	temporary = await mkdtemp(join(tmpdir(), "ui-review-budget-host-desktop-"));
	f = await setup({ after: (fn) => cleanup.push(fn) });
	Object.assign(f, await f.make("r6"));
	const task = await f.store.load(f.taskRef);
	task.id = "synthetic-non-pms-budget-host";
	task.data.output_refs = [f.assetRef];
	task.data.asset_refs = [f.assetRef];
	const taskRef = await f.store.put(task);
	const frozenTask = await readFile(join(f.root, taskRef.path));
	const frozenAsset = await readFile(join(f.root, f.assetRef.path));
	assert.equal((await f.store.load(task.data.scope_ref)).data.budget.max_review_rounds, 3);
	const authorization = `为原任务 ${task.id} 追加1轮独立设计评审；保留全部历史与预算记录，请先接通受信任宿主的预算续授能力，再对r6续评。`;
	const userData = join(temporary, "desktop"),
		agentDir = join(userData, "agent"),
		dataDir = join(userData, "data");
	await mkdir(agentDir, { recursive: true });
	await mkdir(dataDir, { recursive: true });
	await enableUiTesting(repo, agentDir);
	const registration = await readFile(join(agentDir, "settings.json"));
	await enableUiTesting(repo, agentDir);
	assert.deepEqual(await readFile(join(agentDir, "settings.json")), registration);
	await writeFile(join(agentDir, "auth.json"), json({ fixture: { type: "api_key", key: "local-only" } }));
	provider = createServer(async (req, res) => {
		try {
			let body = "";
			for await (const chunk of req) body += chunk;
			const request = JSON.parse(body);
			assert.equal(request.model, "review-budget-host");
			assert.match(req.url, /\/chat\/completions$/);
			assert.ok(++result.providerRequests <= 3, "Unexpected extra SDK model turn");
			// Ordinary text only: no tool_calls or reviewer-shaped JSON.
			res.writeHead(200, { "content-type": "text/event-stream" });
			for (const [delta, finish_reason] of [
				[{ content: "CONTROLLED_NO_REVIEW" }, null],
				[{}, "stop"],
			])
				res.write(
					`data: ${JSON.stringify({ id: `local-${result.providerRequests}`, object: "chat.completion.chunk", model: request.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
				);
			res.end("data: [DONE]\n\n");
		} catch (error) {
			result.providerError = error.message;
			res.writeHead(500);
			res.end("controlled provider rejected request");
		}
	});
	provider.listen(0, "127.0.0.1");
	await once(provider, "listening");
	assert.ok(provider.address().port >= 8900);
	await writeFile(
		join(agentDir, "models.json"),
		json({
			providers: {
				fixture: {
					api: "openai-completions",
					apiKey: "local-only",
					baseUrl: `http://127.0.0.1:${provider.address().port}`,
					models: [
						{
							id: "review-budget-host",
							name: "Synthetic NON-PMS controlled provider",
							contextWindow: 64000,
							maxTokens: 128,
						},
					],
				},
			},
		}),
	);
	// Fresh allowlist removes ALL personal provider/auth/proxy/PI/NODE env; HOME is isolated too.
	const env = {};
	for (const key of ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "DISPLAY", "SYSTEMROOT", "WINDIR", "ComSpec"])
		if (process.env[key]) env[key] = process.env[key];
	await mkdir(join(temporary, "home"));
	await mkdir(join(temporary, "tmp"));
	const reservation = createServer().listen(0, "127.0.0.1");
	await once(reservation, "listening");
	const port = reservation.address().port;
	assert.ok(port >= 8900);
	await new Promise((resolve) => reservation.close(resolve));
	Object.assign(env, {
		HOME: join(temporary, "home"),
		TMPDIR: join(temporary, "tmp"),
		TMP: join(temporary, "tmp"),
		TEMP: join(temporary, "tmp"),
		PI_DESKTOP_USER_DATA: userData,
		PI_CODING_AGENT_DIR: agentDir,
		PI_WEB_DATA_DIR: dataDir,
		PI_WEB_CWD: f.root,
		PI_WEB_PORT: String(port),
		PI_WEB_PLUGIN_CATALOG_URL: "off",
		PI_WEB_SDK: "bundled",
		PI_WEB_TOOL_LAZY_LOADING: "0",
	});
	Object.assign(result, {
		taskRef,
		assetRef: f.assetRef,
		scopeRef: task.data.scope_ref,
		authorizationText: authorization,
		environment: {
			platform: process.platform,
			arch: process.arch,
			port,
			workspace: f.root,
			agentDir,
			dataDir,
			userData,
			providerPort: provider.address().port,
			envKeys: Object.keys(env).sort(),
		},
	});
	app = await launchNativeApp({ executablePath: electron, packaged: false, env });
	page = await app.firstWindow();
	await app.context().addInitScript(() => {
		const Original = window.WebSocket;
		window.__budgetFrames = [];
		window.__budgetSent = [];
		window.WebSocket = class extends Original {
			constructor(...args) {
				super(...args);
				window.__budgetSocket = this;
				this.addEventListener("message", (event) => {
					try {
						window.__budgetFrames.push(JSON.parse(event.data));
					} catch {}
				});
			}
			send(value) {
				try {
					window.__budgetSent.push(JSON.parse(value));
				} catch {}
				return super.send(value);
			}
		};
	});
	await page.reload();
	await page.waitForSelector(".app");
	await waitUntil(
		() => page.evaluate(() => window.__budgetFrames.some((m) => m.type === "ready")),
		"isolated desktop ready",
		60000,
	);
	assert.equal(
		Number(new URL(await page.evaluate(() => window.__budgetSocket.url)).port),
		port,
		"Use only this isolated renderer socket, never owner 8790",
	);
	const send = (message) => page.evaluate((m) => window.__budgetSocket.send(JSON.stringify(m)), message);
	const frames = () => page.evaluate(() => window.__budgetFrames);
	const input = page.locator("textarea").first();
	const setupClose = page.locator(".setup-modal .modal-close");
	if (await setupClose.isVisible()) await setupClose.click();
	await input.waitFor({ state: "visible" });
	const submit = async (text) => {
		await input.fill(text);
		await input.press("Escape");
		await input.press("Enter");
	};
	const reload = async () => {
		const start = (await frames()).length;
		await submit("/reload");
		await waitUntil(
			async () =>
				(await frames()).slice(start).some((m) => m.type === "notice" && /已重新加载|Reloaded extensions/.test(m.text)),
			"native SDK reload",
			60000,
		);
	};
	const settled = async (atLeast) => {
		await waitUntil(
			async () => {
				const state = (await frames()).filter((m) => m.type === "snapshot").at(-1)?.state;
				return (
					result.providerRequests >= atLeast &&
					state?.isStreaming === false &&
					JSON.stringify(state.messages).includes("CONTROLLED_NO_REVIEW")
				);
			},
			"ordinary controlled SDK turn",
			60000,
		);
		assert.equal(result.providerError, undefined);
	};
	const openSettings = async (tab) => {
		await page.getByRole("button", { name: /^(设置|Settings)$/ }).click();
		await page.locator(`.settings-tab[data-tab="${tab}"]`).click();
	};
	const closeSettings = () => page.locator(".set-close-btn").click();
	const skillRow = () =>
		page
			.locator(".settings-modal .set-row")
			.filter({ has: page.locator('.set-row-name [title="ui-testing-workflow"]') });
	const slash = (name) => page.locator(".slash-item").filter({ has: page.locator(`.slash-name[title="/${name}"]`) });
	const commandPresent = async (present) => {
		await input.fill("/ui-review-budget");
		if (present) await slash("ui-review-budget").waitFor();
		else assert.equal(await slash("ui-review-budget").count(), 0);
		await input.fill("");
	};
	await openSettings("skills");
	await skillRow().waitFor();
	assert.equal(await skillRow().getByRole("switch").getAttribute("aria-checked"), "true");
	await page.screenshot({ path: join(output, "01-ui-skill-settings.png") });
	await closeSettings();
	await input.fill("/ui");
	await slash("skill:ui-testing-workflow").waitFor();
	await slash("skill:ui-testing-workflow").click();
	assert.equal(await input.inputValue(), "/skill:ui-testing-workflow ");
	await input.fill("");
	await commandPresent(true);
	result.checks.push(
		"Actual Electron settings manages the original UI skill; /ui completes it and /ui-review-budget is discovered",
	);
	await send({ type: "set_model", modelId: "fixture/review-budget-host" });
	await waitUntil(
		async () => (await frames()).some((m) => m.state?.model?.id === "review-budget-host"),
		"local-only model selected",
	);
	await submit("隔离 Electron 初始化；本测试中的后续授权是合成用户授权，明确非PMS。只回复普通文本。");
	await settled(1);
	await send({ type: "get_state" });
	await waitUntil(async () => {
		const m = (await frames()).filter((m) => m.type === "conversations").at(-1);
		sessionFile = m?.conversations.find((c) => c.id === m.activeId)?.sessionFile;
		return Boolean(sessionFile);
	}, "actual SDK sessionFile");
	const localSession = relative(agentDir, sessionFile);
	assert.ok(
		localSession && !localSession.startsWith("..") && !isAbsolute(localSession),
		"Actual SDK session must be within isolated agentDir",
	);
	authority = join(dirname(sessionFile), "ui-review-authority");
	Object.assign(result, { sessionFile, authority });
	const service = new DesignReviewService(f.root, authority);
	for (let i = 1; i <= 3; i++)
		await assert.rejects(
			service.assess(taskRef, f.assetRef, `synthetic-controlled-error-${i}`, async () => {
				result.controlledReviewErrors++;
				throw new Error("SYNTHETIC_NON_PMS_CONTROLLED_REVIEW_ERROR");
			}),
			/评估调用失败/,
		);
	assert.equal(result.controlledReviewErrors, 3);
	const loops = await readdir(join(authority, "loops"));
	assert.equal(loops.length, 1);
	const loopDir = join(authority, "loops", loops[0]);
	const before = await Promise.all([1, 2, 3].map((i) => readFile(join(loopDir, `attempt-${i}.json`))));
	for (const bytes of before) assert.equal(JSON.parse(bytes).state, "error");
	let forbiddenReviewCalls = 0;
	await assert.rejects(
		service.assess(taskRef, f.assetRef, "synthetic-exhausted", async () => {
			forbiddenReviewCalls++;
			throw new Error("must not call");
		}),
		/预算已耗尽/,
	);
	assert.equal(forbiddenReviewCalls, 0);
	await cp(authority, join(output, "authority-before"), { recursive: true });
	result.checks.push(
		"Native DesignReviewService writes three controlled error attempts in the actual isolated SDK sessionDir and rejects round four before renewal",
	);
	await submit(authorization);
	await settled(2);
	// before_agent_start precedes persistence in the bundled SDK; native session_start continues on /reload.
	await reload();
	await waitUntil(
		async () => (await readdir(loopDir)).filter((name) => name.startsWith("grant-")).length === 1,
		"trusted SDK host grants once",
		30000,
	);
	await settled(3);
	assert.equal(result.providerRequests, 3, "Only bootstrap, user authorization and one host continuation");
	const grants = (await readdir(loopDir)).filter((name) => name.startsWith("grant-"));
	assert.equal(grants.length, 1);
	const grantBytes = await readFile(join(loopDir, grants[0]));
	const grant = JSON.parse(grantBytes);
	assert.equal(grant.previous_limit, 3);
	assert.equal(grant.total_limit, 4);
	assert.equal(grant.used_rounds, 3);
	assert.equal(grant.additional_rounds, 1);
	assert.deepEqual(grant.asset_ref, f.assetRef);
	assert.deepEqual(grant.task_ref, taskRef);
	const verifyHistory = async () => {
		assert.equal((await readdir(loopDir)).filter((name) => name.startsWith("attempt-")).length, 3);
		assert.equal((await readdir(loopDir)).filter((name) => name.startsWith("grant-")).length, 1);
		for (let i = 1; i <= 3; i++) assert.deepEqual(await readFile(join(loopDir, `attempt-${i}.json`)), before[i - 1]);
		assert.deepEqual(await readFile(join(loopDir, grants[0])), grantBytes);
		assert.deepEqual(await readFile(join(f.root, taskRef.path)), frozenTask);
		assert.deepEqual(await readFile(join(f.root, f.assetRef.path)), frozenAsset);
	};
	const sdkEntries = async () =>
		(await readFile(sessionFile, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
	const receipts = (await sdkEntries()).filter(
		(entry) => entry.type === "custom" && entry.customType === "ui-review-budget-host-receipt",
	);
	assert.equal(receipts.length, 1);
	assert.equal(receipts[0].data.authorization_id, grant.authorization_id);
	const userEntry = (await sdkEntries()).find((entry) => entry.id === receipts[0].data.user_entry_id);
	assert.equal(userEntry?.message?.role, "user");
	assert.ok(JSON.stringify(userEntry.message.content).includes(authorization));
	await verifyHistory();
	result.grant = grant;
	result.checks.push(
		"Renderer Chinese synthetic NON-PMS instruction reaches trusted SDK host: native limit 3 to 4, one receipt/grant, unchanged task/asset/three attempt bytes, no real review",
	);
	await page.screenshot({ path: join(output, "02-native-host-renewal.png") });
	const callsAfterGrant = result.providerRequests;
	await reload();
	await reload();
	assert.equal(result.providerRequests, callsAfterGrant, "Repeated native reload must not invoke the model");
	await verifyHistory();
	result.checks.push(
		"Repeated original SDK reload preserves exactly one grant and three attempts without another provider request",
	);
	// Normal protocol on the isolated renderer socket; never owner cookie/config access.
	await send({ type: "get_settings" });
	await waitUntil(async () => (await frames()).some((m) => m.type === "settings_state"), "native settings inventory");
	const settings = (await frames()).filter((m) => m.type === "settings_state").at(-1).settings;
	const hostExtension = settings.extensions.find((extension) =>
		extension.path.endsWith("/ui-testing-workflow/assets/mcp-extension.mjs"),
	);
	assert.ok(hostExtension && !hostExtension.error, "Canonical MCP extension loads");
	const disabledExtensions = settings.disabledExtensions ?? [];
	await send({ type: "set_settings", disabledExtensions: [...disabledExtensions, hostExtension.id] });
	await send({ type: "extensions_reload" });
	await reload();
	await commandPresent(false);
	await reload();
	await commandPresent(false);
	await openSettings("skills");
	await skillRow().waitFor();
	assert.equal(
		await skillRow().getByRole("switch").isDisabled(),
		true,
		"Existing UI capability guard locks the skill while its extension is disabled",
	);
	await closeSettings();
	await send({ type: "set_settings", disabledExtensions });
	await send({ type: "extensions_reload" });
	await reload();
	await commandPresent(true);
	await reload();
	await commandPresent(true);
	await openSettings("skills");
	assert.equal(await skillRow().getByRole("switch").isDisabled(), false);
	await skillRow().getByRole("switch").click();
	await closeSettings();
	await reload();
	await openSettings("skills");
	assert.equal(await skillRow().getByRole("switch").getAttribute("aria-checked"), "false");
	await page.screenshot({ path: join(output, "03-disabled-skill-persisted.png") });
	await closeSettings();
	await input.fill("/ui");
	assert.equal(await slash("skill:ui-testing-workflow").count(), 0);
	await input.fill("");
	await openSettings("skills");
	await skillRow().getByRole("switch").click();
	await closeSettings();
	await reload();
	await openSettings("skills");
	assert.equal(await skillRow().getByRole("switch").getAttribute("aria-checked"), "true");
	await closeSettings();
	await input.fill("/ui");
	await slash("skill:ui-testing-workflow").waitFor();
	await input.fill("");
	await commandPresent(true);
	assert.equal(result.providerRequests, callsAfterGrant, "Settings and reload must not retrigger a model turn");
	await verifyHistory();
	assert.equal(
		(await sdkEntries()).filter(
			(entry) => entry.type === "custom" && entry.customType === "ui-review-budget-host-receipt",
		).length,
		1,
	);
	result.businessRequests = f.fixture.state.browserRequests;
	assert.equal(result.businessRequests, 0);
	result.checks.push(
		"Canonical extension disable/enable persists across reload and removes/restores command; original UI skill remains manageable after restore and its own toggle/menu state persists",
	);
	await cp(authority, join(output, "authority-after"), { recursive: true });
	await writeFile(join(output, "sdk-session.jsonl"), await readFile(sessionFile));
	await writeFile(
		join(output, "fixture-refs.json"),
		json({
			taskRef,
			assetRef: f.assetRef,
			scopeRef: task.data.scope_ref,
			taskSha256: sha256(frozenTask),
			attemptSha256: before.map((bytes) => sha256(bytes)),
		}),
	);
	await writeFile(
		join(output, "renderer-protocol.json"),
		json(
			await page.evaluate(() => ({
				sent: window.__budgetSent,
				notices: window.__budgetFrames.filter((m) => m.type === "notice"),
			})),
		),
	);
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
	await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
	if (page)
		await writeFile(
			join(output, "failure-protocol.json"),
			json(
				await page
					.evaluate(() => ({
						sent: window.__budgetSent,
						notices: window.__budgetFrames?.filter((m) =>
							["notice", "settings_state", "slash_commands", "conversations"].includes(m.type),
						),
					}))
					.catch(() => ({})),
			),
		);
	if (authority) await cp(authority, join(output, "authority-failure"), { recursive: true }).catch(() => {});
	if (sessionFile) await cp(sessionFile, join(output, "sdk-session-failure.jsonl")).catch(() => {});
} finally {
	if (app) {
		await writeFile(join(output, "electron.log"), app.getLogs());
		await app.close().catch((error) => {
			result.cleanupError = error.message;
			process.exitCode = 1;
			result.status = "FAIL";
		});
	}
	if (provider) {
		provider.closeAllConnections();
		await new Promise((resolve) => provider.close(resolve));
	}
	if (f) {
		await cp(join(f.root, "qa"), join(output, "fixture/qa"), { recursive: true }).catch(() => {});
		await cp(join(f.root, "requirements.md"), join(output, "fixture/requirements.md")).catch(() => {});
	}
	for (const fn of cleanup.reverse())
		await fn().catch((error) => {
			result.cleanupError = error.message;
			process.exitCode = 1;
			result.status = "FAIL";
		});
	if (f) await rm(dirname(f.root), { recursive: true, force: true });
	if (temporary) await rm(temporary, { recursive: true, force: true });
	result.cleanup = {
		electronClosed: !app || app.process().exitCode !== null,
		providerClosed: !provider?.listening,
		isolatedTempRemoved: true,
		scratchEvidenceRetained: true,
	};
	await writeFile(join(output, "result.json"), json(result));
	console.log(json({ ...result, output }));
}
