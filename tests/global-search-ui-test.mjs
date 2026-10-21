/**
 * 全局搜索 UI 冒烟（真实 Chrome headless，零 token）：
 * 顶栏「搜索」按钮打开弹窗 → 输入关键词 → 文件分区出现命中；
 * Ctrl+K 可开关弹窗；模型下拉出现搜索框并可过滤。
 */
import { chromium } from "playwright-core";
import { CHROME_PATH } from "./lib/chrome.mjs";
import { portUp } from "./lib/port-utils.mjs";
import { waitForStablePage } from "./lib/page-stability.mjs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const REPO_ROOT = fileURLToPath(new globalThis.URL("../", import.meta.url));
const PORT = 8963;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(name, ok, extra = "") {
	console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
	if (!ok) failures++;
}

const workDir = join(mkdtempSync(join(tmpdir(), "pi-web-gsui-")), "proj");
mkdirSync(join(workDir, "src"), { recursive: true });
writeFileSync(join(workDir, "src", "alpha-util.ts"), "export {};");
writeFileSync(join(workDir, "README.md"), "hi");

const dataDir = mkdtempSync(join(tmpdir(), "pi-web-gsui-data-"));
let server = null;

async function run() {
	server = spawn("node", ["dist/server/index.js"], {
		cwd: REPO_ROOT,
		env: {
			...process.env,
			PI_WEB_PORT: String(PORT),
			PI_WEB_DATA_DIR: dataDir,
			PI_WEB_CWD: workDir,
		},
		stdio: "ignore",
	});
	for (let i = 0; i < 40; i++) {
		await sleep(250);
		if (await portUp(PORT)) break;
	}

	const browser = await chromium.launch({ executablePath: CHROME_PATH });
	const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
	await page.addInitScript(() => localStorage.setItem("pi-web-ui:lang", "zh"));
	page.on("pageerror", (e) => console.log("pageerror:", e.message));
	await page.goto(BASE);
	await page.waitForSelector(".topbar", { timeout: 15000 });
	if (!(await waitForStablePage(page))) throw new Error("Page did not settle after initial build reload");

	// 1) 顶栏搜索按钮存在且点击打开弹窗
	const searchBtn = page.locator(".topbar .chip", { hasText: "搜索" }).first();
	await searchBtn.waitFor();
	check("顶栏有搜索按钮", (await searchBtn.count()) > 0);
	await searchBtn.click();
	await page.waitForSelector(".gs-modal", { timeout: 5000 });
	check("点击按钮打开全局搜索弹窗", true);

	// 2) 输入关键词 → 文件分区命中
	await page.fill(".gs-input-row input", "util");
	await page.waitForSelector(".gs-item", { timeout: 8000 });
	const fileHit = await page.locator(".gs-item-title", { hasText: "alpha-util.ts" }).count();
	check("文件命中显示 alpha-util.ts", fileHit > 0);

	// 3) 点击文件 → 打开文件预览
	await page.locator(".gs-item", { hasText: "alpha-util.ts" }).first().click();
	await page.waitForSelector(".fp-overlay", { timeout: 5000 });
	const previewVisible = await page.locator(".fp-overlay").getByText("alpha-util.ts", { exact: true }).count();
	check("点击后打开文件预览", previewVisible > 0);
	// File hits intentionally retain search results; dismiss that front panel
	// before interacting with the separate preview underneath it.
	await page.locator(".gs-close").click();
	await page.locator(".gs-modal").waitFor({ state: "hidden" });
	await page.locator(".fp-overlay .fp-close").click();
	await page.locator(".fp-overlay").waitFor({ state: "hidden" });
	check("文件预览关闭后恢复主界面", true);

	// 4) Ctrl+K 开关
	await page.keyboard.press("Control+k");
	await page.waitForSelector(".gs-modal", { timeout: 3000 }).catch(() => {});
	check("Ctrl+K 打开弹窗", (await page.locator(".gs-modal").count()) > 0);
	await page.keyboard.press("Control+k");
	await sleep(300);
	check("再次 Ctrl+K 关闭弹窗", (await page.locator(".gs-modal").count()) === 0);

	// 5) 模型下拉搜索框
	await page.locator(".inputbox button:has(.chip-model)").click();
	await page.waitForSelector(".dd-search", { timeout: 3000 }).catch(() => {});
	check("模型下拉出现搜索框", (await page.locator(".dd-search").count()) > 0);
	const modelMenu = page.locator(".dd-menu-model");
	await modelMenu.locator(".dd-model-name").first().waitFor();
	const firstModelName = await modelMenu.locator(".dd-model-name").first().innerText();
	await modelMenu.locator(".dd-search").fill("no-such-model-5ce3f");
	await page.waitForFunction(() => document.querySelectorAll(".dd-menu-model .dd-model-name").length === 0);
	check("无匹配搜索隐藏模型项", (await modelMenu.locator(".dd-model-name").count()) === 0);
	await modelMenu.locator(".dd-search").fill(firstModelName);
	await modelMenu.locator(".dd-model-name").first().waitFor();
	check(
		"搜索模型名恢复匹配项",
		(await modelMenu.locator(".dd-model-name").allTextContents()).every((name) =>
			name.toLowerCase().includes(firstModelName.toLowerCase()),
		),
	);

	await browser.close();
}

try {
	await run();
} catch (err) {
	console.error("FATAL:", err?.message ?? err);
	failures++;
} finally {
	if (server?.pid) process.kill(server.pid, "SIGTERM");
	await sleep(500);
}
process.exit(failures === 0 ? 0 : 1);
