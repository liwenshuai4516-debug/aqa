/** Chat links -> actual file_content -> preview. Isolated local model, no paid or business requests. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright-core";
import { CHROME_PATH } from "./lib/chrome.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { launchNativeApp } from "./desktop/native-app.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const desktop = process.argv.includes("--desktop");
ensureBuild(repo, "file-link-preview-test");
const base = mkdtempSync(join(tmpdir(), "pi-file-link-"));
const workspace = join(base, "workspace");
const agentDir = join(base, "agent");
const relative = ".pi/skills/api-test-workflow/SKILL.md";
const outside = join(base, "其他 工作区", "SKILL.md");
for (const path of [join(workspace, ".pi/skills/api-test-workflow"), agentDir, join(base, "其他 工作区")]) {
	mkdirSync(path, { recursive: true });
}
writeFileSync(join(workspace, relative), "# 工作流预览验证\n\n本地 Markdown 内容已加载。\n");
writeFileSync(outside, "# 跨工作区预览验证\n\n绝对路径文件已加载。\n");
const reply = [
	`[测试工作流](./${relative})`,
	`[绝对路径](<${join(workspace, relative)}>)`,
	`[带行号](./${relative}:12:3)`,
	`[中文与空格](<${outside}>)`,
	`[文件 URL](<${pathToFileURL(outside).href}>)`,
	`查看 @${relative}`,
	"[外部文档](https://example.com/design.md)",
].join("\n\n");
let calls = 0;
const model = createServer(async (request, response) => {
	for await (const _chunk of request) {
		/* Drain synthetic input. */
	}
	calls++;
	response.writeHead(200, { "content-type": "text/event-stream" });
	for (const [delta, finish_reason] of [
		[{ role: "assistant", content: reply }, null],
		[{}, "stop"],
	]) {
		response.write(
			`data: ${JSON.stringify({ id: "file-link", object: "chat.completion.chunk", created: 1, model: "preview-test", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
		);
	}
	response.end("data: [DONE]\n\n");
});
let server, browser, native, page;
let logs = "";
const output = join(repo, "tests/scratch/file-link-preview", `${Date.now()}${desktop ? "-desktop" : "-browser"}`);
mkdirSync(output, { recursive: true });
const checks = [];
try {
	await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ local: { type: "api_key", key: "synthetic" } }));
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				local: {
					api: "openai-completions",
					baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
					apiKey: "synthetic",
					models: [{ id: "preview-test", name: "Preview Test", contextWindow: 128000, maxTokens: 4096 }],
				},
			},
		}),
	);
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({ defaultProvider: "local", defaultModel: "preview-test" }),
	);
	const probe = createServer();
	await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
	const port = probe.address().port;
	await new Promise((resolve) => probe.close(resolve));
	assert(port >= 8900);
	const env = {
		...process.env,
		PI_WEB_PORT: String(port),
		PI_WEB_HOST: "127.0.0.1",
		PI_WEB_CWD: workspace,
		PI_WEB_DATA_DIR: join(base, "data"),
		PI_CODING_AGENT_DIR: agentDir,
		PI_WEB_PLUGIN_CATALOG_URL: "off",
		PI_WEB_REMOTE_CATALOG_SYNC: "0",
		PI_WEB_TOKEN: "",
	};
	if (desktop) {
		delete env.ELECTRON_RUN_AS_NODE;
		delete env.PI_WEB_DESKTOP_URL;
		env.PI_DESKTOP_USER_DATA = join(base, "electron");
		const { default: executablePath } = await import("electron");
		native = await launchNativeApp({ executablePath, packaged: false, env });
		page =
			native
				.context()
				.pages()
				.find((p) => p.url().startsWith(`http://127.0.0.1:${port}`)) ?? (await native.firstWindow());
	} else {
		server = spawn(process.execPath, ["dist/server/index.js"], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
		server.stdout.on("data", (chunk) => {
			logs += chunk;
		});
		server.stderr.on("data", (chunk) => {
			logs += chunk;
		});
		let ready = false;
		for (let i = 0; i < 120; i++) {
			try {
				ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok;
			} catch {
				/* Starting. */
			}
			if (ready || server.exitCode !== null) break;
			await sleep(200);
		}
		assert(ready, logs);
		browser = await chromium.launch({ executablePath: CHROME_PATH || undefined });
		page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
		await page.goto(`http://127.0.0.1:${port}`);
	}
	const input = page.locator(".inputbox textarea");
	await input.waitFor();
	await page.waitForFunction(() => location.hash.includes("s="));
	const url = page.url();
	await input.fill("输出文件链接");
	await page.locator(".inputbox .send").click();
	const links = page.locator(".msg-assistant .file-pill");
	await links.first().waitFor({ timeout: 20000 });
	await page.waitForFunction(() => document.querySelectorAll(".msg-assistant .file-pill").length === 6);
	checks.push("six local links render as preview controls");
	for (let i = 0; i < 6; i++) {
		await links.nth(i).click();
		await page.locator(".fp-markdown h1").waitFor({ timeout: 10000 });
		assert.equal(await page.locator(".fp-name").textContent(), "SKILL.md");
		assert.equal(
			await page.locator(".fp-markdown h1").textContent(),
			i === 3 || i === 4 ? "跨工作区预览验证" : "工作流预览验证",
		);
		assert.equal(page.url(), url, "preview must not navigate away from chat");
		if (i === 3) await page.screenshot({ path: join(output, "cross-workspace-preview.png") });
		await page.locator(".fp-close").click();
	}
	checks.push("relative/absolute/line/Unicode/file URL/@ links load actual contents without navigation");
	const external = page.locator('.msg-assistant a[href="https://example.com/design.md"]');
	assert.equal(await external.getAttribute("target"), "_blank");
	assert.equal(await external.getAttribute("rel"), "noreferrer noopener");
	checks.push("external links retain safe browser routing");
	await page.reload();
	await links.first().waitFor({ timeout: 20000 });
	await links.first().click();
	await page.locator(".fp-markdown h1").waitFor();
	assert.equal(await page.locator(".fp-markdown h1").textContent(), "工作流预览验证");
	assert.equal(calls, 1, "preview and reload must not invoke the model again");
	checks.push("history reload retains working previews; local model requests remain one");
	writeFileSync(
		join(output, "result.json"),
		JSON.stringify(
			{ status: "PASS", desktop, checks, localModelCalls: calls, paidModelCalls: 0, businessRequests: 0 },
			null,
			2,
		),
	);
	console.log(
		`PASS (${desktop ? "desktop" : "browser"}): ${checks.length} groups, six paths + history; evidence: ${output}`,
	);
} catch (error) {
	await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
	writeFileSync(
		join(output, "result.json"),
		JSON.stringify(
			{
				status: "FAIL",
				checks,
				localModelCalls: calls,
				error: String(error),
				logs: native?.getLogs() ?? logs,
				pageText: await page
					?.locator("body")
					.innerText()
					.catch(() => ""),
			},
			null,
			2,
		),
	);
	console.error(error);
	process.exitCode = 1;
} finally {
	await native?.close();
	await browser?.close();
	if (server?.exitCode === null) {
		const exited = once(server, "exit");
		server.kill("SIGTERM");
		const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
		await exited;
		clearTimeout(timer);
	}
	await new Promise((resolve) => model.close(resolve));
	rmSync(base, { recursive: true, force: true });
}
