import { _electron } from "playwright-core";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const configureUI = process.env.PI_DESKTOP_CONFIGURE_UI === "1";
const realProvider = process.env.PI_DESKTOP_REAL_PROVIDER === "deepseek";
let credential = "";
if (realProvider) {
	for await (const chunk of process.stdin) credential += chunk;
	credential = credential.trim();
	assert(credential, "Test credential required on stdin");
}
const providerEvidence = { requests: 0, maxOutputTokens: 128, maxRequestBytes: 30000 };
const fixture = mkdtempSync(join(tmpdir(), "pi-packaged-ui-"));
const workspace = join(fixture, "中文 workspace");
const userData = join(fixture, "desktop");
const agent = join(userData, "agent");
mkdirSync(workspace);
mkdirSync(agent, { recursive: true });
let calls = 0;
const provider = createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	calls++;
	if (realProvider) {
		// Bound one real request; reject tool-loop retries and oversized prompts.
		providerEvidence.receivedRequests = calls;
		providerEvidence.receivedRequestBytes = Buffer.byteLength(body);
		if (calls > 1 || Buffer.byteLength(body) > providerEvidence.maxRequestBytes) {
			providerEvidence.rejectedByBudgetGuard = true;
			res.writeHead(429).end("Acceptance request limit reached");
			return;
		}
		try {
			const payload = JSON.parse(body);
			payload.model = "deepseek-chat";
			payload.max_tokens = 128;
			delete payload.max_completion_tokens;
			providerEvidence.requests++;
			providerEvidence.requestBytes = Buffer.byteLength(body);
			const response = await fetch("https://api.deepseek.com/chat/completions", {
				method: "POST",
				headers: { Authorization: `Bearer ${credential}`, "content-type": "application/json" },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(60000),
			});
			providerEvidence.httpStatus = response.status;
			res.writeHead(response.status, { "content-type": "text/event-stream" });
			let pending = "";
			for await (const chunk of response.body) {
				res.write(chunk);
				pending += Buffer.from(chunk).toString();
				let newline;
				while ((newline = pending.indexOf("\n")) >= 0) {
					const line = pending.slice(0, newline);
					pending = pending.slice(newline + 1);
					if (line.startsWith("data: ") && line !== "data: [DONE]") {
						try {
							const data = JSON.parse(line.slice(6));
							if (data.usage) providerEvidence.usage = data.usage;
						} catch {
							/* partial SSE event */
						}
					}
				}
			}
			res.end();
		} catch {
			res.end();
		}
		return;
	}
	res.writeHead(200, { "content-type": "text/event-stream" });
	for (const [delta, finish_reason] of [
		[{ content: "ATTACHMENTS_OK" }, null],
		[{}, "stop"],
	])
		res.write(
			`data: ${JSON.stringify({ id: "ui-fixture", object: "chat.completion.chunk", model: "ui-fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
		);
	res.end("data: [DONE]\n\n");
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
if (!configureUI) {
	writeFileSync(
		join(agent, "models.json"),
		JSON.stringify({
			providers: {
				fixture: {
					api: "openai-completions",
					baseUrl: `http://127.0.0.1:${provider.address().port}`,
					apiKey: "local-only",
					models: [
						{ id: "ui-fixture", name: "UI Fixture", input: ["text", "image"], contextWindow: 32000, maxTokens: 128 },
					],
				},
			},
		}),
	);
	writeFileSync(join(agent, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "local-only" } }));
}
const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	...(realProvider ? { PI_WEB_TOOL_LAZY_LOADING: "1" } : {}),
};
for (const key of ["ELECTRON_RUN_AS_NODE", "PI_WEB_DATA_DIR", "PI_CODING_AGENT_DIR", "PI_WEB_DESKTOP_URL"])
	delete env[key];
const result = {
	fixture,
	platform: process.platform,
	architecture: process.arch,
	provider: realProvider
		? "DeepSeek deepseek-chat through credential-only bounded proxy"
		: "local SSE fixture; no real model calls",
	checks: [],
};
let app;
try {
	app = await _electron.launch({
		executablePath: resolve(
			process.argv[2] ?? "release/mac-arm64/Pi Agent Desktop.app/Contents/MacOS/Pi Agent Desktop",
		),
		args: ["-r", resolve("node_modules/playwright-core/lib/server/electron/loader.js")],
		env,
		timeout: 60000,
	});
	const page = await app.firstWindow({ timeout: 45000 });
	await page.waitForSelector(".app");
	await page.waitForLoadState("networkidle");

	if (configureUI) {
		await page.getByRole("button", { name: "设置", exact: true }).click();
		await page.locator(".settings-tab", { hasText: "模型与服务商" }).click();
		await page.getByRole("button", { name: "打开管理面板", exact: true }).click();
		const studio = page.locator(".model-studio-modal");
		await studio.getByRole("button", { name: "添加自定义服务商", exact: true }).click();
		await studio.getByPlaceholder("例如 deepseek", { exact: true }).fill("fixture");
		await studio
			.getByPlaceholder("https://api.deepseek.com/v1", { exact: true })
			.fill(`http://127.0.0.1:${provider.address().port}`);
		await studio.locator('input[type="password"]').fill("local-only");
		await studio.locator(".form-grid select").selectOption("openai-completions");
		await studio.locator(".id-group input").fill("ui-fixture");
		await studio.locator(".name-group input").fill("UI Fixture");
		await studio.getByRole("button", { name: "保存", exact: true }).click();
		await page.waitForTimeout(500);
		assert(existsSync(join(agent, "models.json")), "UI saved model configuration");
		await studio.waitFor({ state: "hidden" });
		await page.keyboard.press("Escape");
		const settings = page.locator(".settings-modal");
		if (await settings.isVisible()) await page.keyboard.press("Escape");
		await page.locator(".chip-model").click();
		await page.locator(".dd-model-name", { hasText: "UI Fixture" }).click();
		result.checks.push({
			id: "A03",
			status: "PASS",
			check:
				"original model manager UI saves custom provider, password and model to isolated agent directory; model selected in composer",
		});
	}
	await page.getByRole("button", { name: "UI Fixture", exact: true }).waitFor({ timeout: 30000 });
	if (realProvider) {
		await page.locator(".inputbox textarea").fill("Reply with exactly DESKTOP_ACCEPTANCE_OK. Do not use tools.");
		await page.locator(".inputbox textarea").press("Enter");
		await page.getByText("DESKTOP_ACCEPTANCE_OK", { exact: true }).waitFor({ timeout: 60000 });
		assert.equal(providerEvidence.requests, 1);
		assert.equal(providerEvidence.httpStatus, 200);
		result.checks.push({
			id: "A01/A03",
			status: "PASS",
			check:
				"packaged UI sends prompt through original service and bundled SDK to real DeepSeek; streamed reply renders",
			...providerEvidence,
		});
	} else {
		await page.getByRole("button", { name: "设置", exact: true }).click();
		await page.locator(".settings-tab", { hasText: "声音与语音" }).click();
		const sound = page.locator(".sound-menu").filter({ has: page.locator(".dd-header", { hasText: "声音提示" }) });
		assert.equal(await sound.locator(".sound-row").count(), 6);
		const master = sound.locator(".sound-master input[type=checkbox]");
		const start = sound.locator(".sound-row", { hasText: "回复开始" }).locator("input[type=checkbox]");
		await master.uncheck();
		assert(await start.isDisabled());
		await master.check();
		await start.check();
		await sound.locator("input[type=range]").fill("30");
		await page.waitForFunction(() => JSON.parse(localStorage.getItem("pi-web-sounds")).volume === 30);
		const audioSession = await page.context().newCDPSession(page);
		await audioSession.send("WebAudio.enable");
		const audio = [];
		audioSession.on("WebAudio.audioNodeCreated", (event) => audio.push(event.node.nodeType));
		await sound.locator(".sound-row", { hasText: "回复开始" }).locator(".sound-preview").click();
		await page.waitForTimeout(300);
		assert(
			audio.some((type) => type.includes("Oscillator")),
			"Preview creates actual WebAudio oscillator: " + JSON.stringify(audio),
		);
		result.checks.push({
			id: "A14",
			status: "PASS",
			check:
				"settings sound panel, master gating, event toggle, volume persistence and real WebAudio preview synthesis",
			audioNodes: audio,
		});
		await page.reload();
		await page.waitForLoadState("networkidle");
		await page.getByRole("button", { name: "设置", exact: true }).click();
		await page.locator(".settings-tab", { hasText: "声音与语音" }).click();
		assert(await start.isChecked());
		assert.equal(await sound.locator("input[type=range]").inputValue(), "30");
		result.checks.push({ id: "A11/A14", status: "PASS", check: "sound settings restored after real renderer reload" });
		await page.keyboard.press("Escape");
		await page.locator(".inputbox textarea").fill("检查附件，仅回复 OK");
		await page.locator('.inputbox input[type="file"]').setInputFiles([
			{ name: "中文 文件.txt", mimeType: "text/plain", buffer: Buffer.from("中文 UTF-8 file") },
			{ name: "data.bin", mimeType: "application/octet-stream", buffer: Buffer.from([0, 1, 255]) },
			{
				name: "logo.svg",
				mimeType: "image/svg+xml",
				buffer: Buffer.from(
					'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
				),
			},
		]);
		await page.waitForFunction(() => document.querySelectorAll(".attach-chip.file").length === 3);
		assert.equal(await page.locator(".attach-chip.image").count(), 0);
		await page.locator(".inputbox textarea").evaluate((textarea) => {
			const transfer = new DataTransfer();
			transfer.items.add(
				new File(
					[
						Uint8Array.from(
							atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
							(c) => c.charCodeAt(0),
						),
					],
					"粘贴.png",
					{ type: "image/png" },
				),
			);
			textarea.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
		});
		await page.waitForSelector(".attach-chip.image");
		await page.locator(".inputbox textarea").press("Enter");
		await page.waitForSelector(".attachcard");
		await page.getByText("ATTACHMENTS_OK", { exact: true }).waitFor({ timeout: 30000 });
		assert.equal(calls, 1);
		assert((await page.locator(".attachcard").allTextContents()).join(" ").includes("中文 文件.txt"));
		result.checks.push({
			id: "A01/A05",
			status: "PASS",
			check:
				"real packaged UI selects text/binary/SVG, pastes PNG, renders attachment cards and streams one fixture response",
		});
		await page.screenshot({ path: `docs/desktop-delivery/evidence/${configureUI ? "model-config-ui" : "packaged-ui"}.png` });
	}
} catch (error) {
	result.error = error.stack;
	if (configureUI) {
		const page = app?.context().pages()[0];
		if (page)
			result.visibleButtons = await page
				.locator("button")
				.evaluateAll((elements) => elements.filter((e) => e.getBoundingClientRect().width).map((e) => e.innerText))
				.catch(() => []);
	}
	process.exitCode = 1;
} finally {
	await app?.close().catch(() => {});
	await new Promise((r) => provider.close(r));
	credential = "";
	if (realProvider) result.providerEvidence = providerEvidence;
	writeFileSync(
		`docs/desktop-delivery/evidence/${realProvider ? "deepseek-ui" : configureUI ? "model-config-ui" : "packaged-ui"}.json`,
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result, null, 2));
}
