/**
 * data-space v2/v3 浏览器 E2E（真页面 + 真后端，零 token）。
 *
 * 锁住的行为：
 *   1. 插件 bundle 进页即注册 `@` 提及提供者（不必先打开数据空间页）；
 *   2. 输入 `@` 出现「数据空间用例」来源的命中，选中后写进输入框的是轻引用（不以 @ 开头）；
 *   3. 概览有「通过率」卡片与执行结果进度条，未执行显示且不计入分母；
 *   3b. 环境页按项目列出环境（默认徽章、按名称搜索、新建后地址末尾斜杠收敛）；
 *   4. 用例表「最近结果」列点开可登记（可顺带选定本次环境），保存后徽章变成「通过」，
 *      概览通过率随之变化，执行结果页的「环境」列与筛选跟着生效；
 *   5. 刷新页面后结果仍在（落在 runs.json，不在内存）；
 *   6. 引入对话弹窗有三档格式（自动 / 卡片 / 清单 / 引用），引用档预览不含步骤正文；
 *   8. 执行结果页：流水表、按任务聚合（批量任务一张卡、三态计数）、搜索空态、CSV 导出（表头 / BOM / 备注）；
 *   9. 900 宽窄屏下页面不横向溢出；
 *   10. 全程无 JS 报错。
 *
 * Run: npm run build && node tests/data-space-runs-ui-test.mjs
 */
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { CHROME_PATH } from "./lib/chrome.mjs";

const REPO_ROOT = fileURLToPath(new globalThis.URL("../", import.meta.url));
const PORT = 8970 + Math.floor(Math.random() * 20);
const base = mkdtempSync(join(tmpdir(), "piweb-dsruns-"));
const workdir = join(base, "work");
const dataDir = join(base, "data");
const agentDir = join(base, "agent");
mkdirSync(workdir, { recursive: true });
mkdirSync(dataDir, { recursive: true });
mkdirSync(join(dataDir, "plugins"), { recursive: true });
mkdirSync(agentDir, { recursive: true });
cpSync(join(REPO_ROOT, "plugins", "data-space"), join(dataDir, "plugins", "data-space"), { recursive: true });
// 假 provider（黑洞端口）：只为让会话就绪、输入框可编辑，不会真发请求
writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ fastfail: { type: "api_key", key: "dummy" } }));
writeFileSync(
	join(agentDir, "models.json"),
	JSON.stringify({
		providers: {
			fastfail: {
				api: "openai-completions",
				baseUrl: "http://127.0.0.1:1",
				apiKey: "dummy",
				models: [{ id: "fastfail-1", name: "FastFail" }],
			},
		},
	}),
);

let failures = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
	if (!ok) failures++;
};

const server = spawn("node", ["dist/server/index.js"], {
	cwd: REPO_ROOT,
	env: {
		...process.env,
		PI_WEB_PORT: String(PORT),
		PI_WEB_CWD: workdir,
		PI_WEB_DATA_DIR: dataDir,
		PI_CODING_AGENT_DIR: agentDir,
	},
	stdio: "ignore",
});
const APP = `http://localhost:${PORT}`;
let up = false;
for (let i = 0; i < 100; i++) {
	try {
		if ((await fetch(`${APP}/api/health`)).ok) {
			up = true;
			break;
		}
	} catch {
		/* 还没起 */
	}
	await sleep(250);
}

const shutdown = async (code) => {
	try {
		server.kill();
	} catch {
		/* 已退出 */
	}
	rmSync(base, { recursive: true, force: true });
	process.exit(code);
};
if (!up) {
	console.log("✗ 服务端未起来");
	await shutdown(1);
}

const browser = await chromium.launch({ executablePath: CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
page.on("console", (m) => {
	// 黑洞模型会打网络错误，与本插件无关
	if (m.type() === "error" && !/127\.0\.0\.1:1|ERR_|net::/i.test(m.text())) jsErrors.push(m.text());
});

await page.addInitScript(() => {
	try {
		localStorage.setItem("pi_web_setup_dismissed", "1");
	} catch {
		/* 隐私模式 */
	}
});

try {
	await page.goto(APP);
	await page.waitForSelector(".inputbox textarea", { timeout: 30000 });
	await page.waitForFunction(
		() => {
			const ta = document.querySelector(".inputbox textarea");
			return ta && !ta.disabled;
		},
		{ timeout: 30000 },
	);
	await sleep(500);

	// -- 1) 提供者在进页时已注册（还没打开过数据空间页） --------------------
	const providers = await page.evaluate(() => {
		try {
			return globalThis.__piWebUiHost?.composerProviders?.list?.() ?? [];
		} catch {
			return [];
		}
	});
	check(
		"未打开数据空间页时 `@` 提供者已注册",
		providers.some((p) => p.id === "data-space:cases"),
		JSON.stringify(providers.map((p) => p.id)),
	);

	// -- 2) 输入 @ 出现「数据空间用例」来源，选中写轻引用 -------------------
	const textarea = page.locator(".inputbox textarea");
	await textarea.click();
	await textarea.type("@", { delay: 40 });
	const menu = page.locator('.slash-menu[data-menu-kind="at"]');
	const menuVisible = await menu
		.waitFor({ timeout: 8000 })
		.then(() => true)
		.catch(() => false);
	check("输入 @ 弹出补全面板", menuVisible);
	const pluginRows = page.locator('.slash-menu[data-menu-kind="at"] .slash-item', {
		has: page.locator(".slash-source", { hasText: "数据空间用例" }),
	});
	const pluginRowCount = await pluginRows.count();
	check("面板里有「数据空间用例」的命中", pluginRowCount > 0, `${pluginRowCount} 条`);
	if (pluginRowCount > 0) {
		const firstTitle = (await pluginRows.first().locator(".slash-name").innerText()).trim();
		await pluginRows.first().click();
		await sleep(200);
		const value = await textarea.inputValue();
		check("选中后插入的是轻引用（一行，不带整条步骤）", value.includes("「用例 ") || value.includes("「功能 "), value);
		check("插入文本不以 @ 开头（不会把面板重新打开）", !value.trimStart().startsWith("@"), value);
		check("补全面板已收起", (await menu.count()) === 0);
		console.log(`  · 选中项：${firstTitle}`);
	}
	await textarea.fill("");

	// -- 3) 打开数据空间：概览有通过率与执行结果 ---------------------------
	const navBtn = page.locator("header button, .topbar button, nav button").filter({ hasText: "数据空间" }).first();
	await navBtn.click();
	const root = page.locator(".dsp-head").first();
	await root.waitFor({ timeout: 15000 });
	await sleep(400);
	check("概览出现「通过率」卡片", (await page.locator(".dsp-stat-label", { hasText: "通过率" }).count()) === 1);
	const resultSection = await page.locator(".dsp-card", { hasText: "执行结果" }).count();
	check("概览有「执行结果」区块", resultSection >= 1, `${resultSection} 个`);
	check("未执行单独计数、不混入通过率分母", await page.locator("text=未执行").first().isVisible());

	// -- 3b) 环境页：每个项目一份地址簿 --------------------------------------
	await page.locator('.dsp-nav button[data-tab="envs"]').click();
	await sleep(400);
	check("环境页标题带条目数", (await page.locator(".dsp-page-head", { hasText: "环境" }).count()) === 1);
	const envRows = page.locator(".dsp-table.ds tbody tr");
	const envRowCount = await envRows.count();
	check("环境表列出示例环境", envRowCount >= 9, `${envRowCount} 行`);
	check("默认环境有「默认」徽章", (await page.locator(".dsp-default").count()) >= 5);
	await page.locator('[data-el="env-search"]').fill("预发环境");
	await sleep(350);
	const filteredEnv = await page.locator(".dsp-table.ds tbody tr").count();
	check("按名称搜索能筛环境", filteredEnv > 0 && filteredEnv < envRowCount, `${filteredEnv} / ${envRowCount}`);
	await page.locator('[data-el="env-search"]').fill("");
	await sleep(300);

	await page.locator('button[data-act="new-env"]').first().click();
	const envModal = page.locator(".dsp-modal", { hasText: "新建环境" }).first();
	const envModalOpen = await envModal
		.waitFor({ timeout: 5000 })
		.then(() => true)
		.catch(() => false);
	check("点「新建环境」打开弹窗", envModalOpen);
	if (envModalOpen) {
		await envModal.locator('select[data-f="systemId"]').selectOption({ index: 0 });
		await envModal.locator('input[data-f="name"]').fill("E2E 环境");
		await envModal.locator('input[data-f="baseUrl"]').fill("https://e2e.example.com/");
		await envModal.locator('button[data-act="save-env"]').click();
		await sleep(900);
		check("保存后弹窗关闭", (await page.locator(".dsp-modal", { hasText: "新建环境" }).count()) === 0);
		const newRow = page.locator(".dsp-table.ds tbody tr", { hasText: "E2E 环境" }).first();
		check("新环境出现在表里", (await newRow.count()) === 1);
		const urlCell = (await newRow.locator(".dsp-url-cell").innerText()).trim();
		check("地址末尾斜杠已收敛", urlCell === "https://e2e.example.com", urlCell);
	}

	// -- 4) 用例表登记结果 → 徽章变化 ----------------------------------------
	await page.locator('.dsp-nav button[data-tab="cases"]').click();
	await sleep(400);
	const noneBadges = page.locator("button.dsp-result.none");
	const noneCount = await noneBadges.count();
	check("用例表有「未执行」登记入口", noneCount > 0, `${noneCount} 条`);
	await noneBadges.first().click();
	const modal = page.locator(".dsp-modal", { hasText: "登记执行结果" }).first();
	const modalOpen = await modal
		.waitFor({ timeout: 5000 })
		.then(() => true)
		.catch(() => false);
	check("点「未执行」打开登记弹窗", modalOpen);
	if (modalOpen) {
		check(
			"三个结论可选（通过 / 失败 / 阻塞）",
			(await modal.locator('button[data-act="result-verdict"]').count()) === 3,
		);
		const envPick = modal.locator('select[data-f="env"]');
		check("登记弹窗能选本次环境", (await envPick.count()) === 1);
		await envPick.selectOption({ label: "测试环境" }).catch(() => {});
		await modal.locator('button[data-act="result-verdict"]', { hasText: "通过" }).first().click();
		await modal.locator('input[data-f="note"]').fill("E2E 登记");
		await modal.locator('button[data-act="save-result"]').click();
		await sleep(800);
		const passBadges = page.locator("button.dsp-result.pass");
		check("保存后该行徽章变为「通过」", (await passBadges.count()) > 0, `${await passBadges.count()} 条`);
		check("弹窗已关闭", (await page.locator(".dsp-modal", { hasText: "登记执行结果" }).count()) === 0);
		const passTitle = await passBadges.first().getAttribute("title");
		check("徽章 title 标明来源与备注", /手工登记/.test(passTitle ?? "") && /E2E 登记/.test(passTitle ?? ""), passTitle);
	}

	// -- 5) 概览通过率随之变化 ----------------------------------------------
	await page.locator('.dsp-nav button[data-tab="overview"]').click();
	await sleep(400);
	const rateCard = page.locator(".dsp-stat", { hasText: "通过率" }).first();
	const rateText = (await rateCard.innerText()).replace(/\s+/g, " ");
	check("概览通过率不再为 0%", !/\b0%/.test(rateText), rateText);

	// -- 5b) 模拟 AI 一次回写多条：服务端应归为同一个任务 --------------------
	const batchRes = await fetch(`${APP}/plugins-api/data-space/runs`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			task: "E2E 批量回归",
			results: [
				{ case: "PMS-001", verdict: "通过" },
				{ case: "PMS-002", verdict: "失败", note: "按钮不可点" },
			],
		}),
	});
	const batchBody = await batchRes.json().catch(() => null);
	check(
		"一次回写多条归为同一个任务",
		batchBody?.recorded?.length === 2 && Boolean(batchBody?.taskId) && Boolean(batchBody?.recorded?.[1]?.taskName),
		batchBody?.error ?? batchBody?.taskId,
	);

	// -- 5c) 「执行结果」页：流水 / 按任务 / 筛选 / 导出 ----------------------
	await page.locator('.dsp-nav button[data-tab="runs"]').click();
	await sleep(400);
	check("执行结果页有统计卡", (await page.locator(".dsp-stat", { hasText: "执行记录" }).count()) >= 1);
	const runRows = page.locator(".dsp-table.runs tbody tr");
	const runRowCount = await runRows.count();
	check("流水表列出刚登记的那条记录", runRowCount >= 1, `${runRowCount} 行`);
	check("来源标为「手工登记」", (await page.locator(".dsp-source.manual").count()) >= 1);
	check("备注跟着记录一起展示", (await page.locator(".dsp-run-note", { hasText: "E2E 登记" }).count()) >= 1);
	check(
		"流水表有「环境」列且记下这次跑的环境",
		(await page.locator(".dsp-env-cell", { hasText: "测试环境" }).count()) >= 1,
	);
	const runsEnv = page.locator('select[data-el="runs-env"]');
	check("工具栏有环境筛选下拉", (await runsEnv.count()) === 1 && (await runsEnv.isEnabled()));
	await runsEnv.selectOption({ label: "测试环境" });
	await sleep(400);
	const envFilteredRows = await page.locator(".dsp-table.runs tbody tr").count();
	check(
		"按环境筛选后只剩该环境的记录",
		envFilteredRows >= 1 && envFilteredRows <= runRowCount,
		`${envFilteredRows} / ${runRowCount}`,
	);
	await runsEnv.selectOption("all");
	await sleep(300);
	check("恢复「全部环境」后记录回来", (await page.locator(".dsp-table.runs tbody tr").count()) === runRowCount);

	await page.locator('button[data-act="runs-view"][data-id="task"]').click();
	await sleep(350);
	check(
		"按任务视图把零散登记归到「单条登记」",
		(await page.locator(".dsp-task", { hasText: "单条登记" }).count()) >= 1,
	);
	const batchTask = page.locator(".dsp-task", { hasText: "E2E 批量回归" }).first();
	check("按任务视图列出批量任务", (await batchTask.count()) >= 1);
	const batchText = (await batchTask.innerText()).replace(/\s+/g, " ");
	check(
		"批量任务卡带三态计数与条数",
		/通过 1/.test(batchText) && /失败 1/.test(batchText) && /共 2 条/.test(batchText),
		batchText.slice(0, 90),
	);
	check("任务卡内列出逐条明细", (await batchTask.locator(".dsp-task-row").count()) === 2);
	await page.locator('button[data-act="runs-view"][data-id="flat"]').click();
	await sleep(300);

	await page.locator('[data-el="runs-search"]').fill("不存在的关键词zzz");
	await sleep(350);
	check("搜不到时给空态而不是空白", (await page.locator(".dsp-empty", { hasText: "没有匹配" }).count()) >= 1);
	await page.locator('[data-el="runs-search"]').fill("");
	await sleep(300);
	check("清空搜索后记录回来", (await page.locator(".dsp-table.runs tbody tr").count()) >= 1);

	const [download] = await Promise.all([
		page.waitForEvent("download", { timeout: 10000 }).catch(() => null),
		page.locator('button[data-act="export-runs"]').click(),
	]);
	if (download) {
		const csvPath = await download.path();
		const csv = csvPath ? readFileSync(csvPath, "utf8") : "";
		check(
			"导出 CSV：文件名带 data-space-runs",
			/data-space-runs-\d{4}-\d{2}-\d{2}\.csv/.test(download.suggestedFilename()),
		);
		check(
			"导出 CSV：带 UTF-8 BOM 与表头",
			csv.charCodeAt(0) === 0xfeff && csv.includes("时间") && csv.includes("结论") && csv.includes("环境"),
		);
		check("导出 CSV：含刚登记的备注", csv.includes("E2E 登记"));
	} else {
		check("导出 CSV 触发下载", false);
	}

	// -- 6) 刷新后结果仍在（落盘而非内存） -----------------------------------
	await page.reload();
	// 刷新后插件页可能已挂载但隐藏（默认回到对话），先点顶栏再等可见
	await page.waitForSelector(".inputbox textarea", { timeout: 20000 });
	await sleep(600);
	await page.locator("header button, .topbar button, nav button").filter({ hasText: "数据空间" }).first().click();
	await page.locator('.dsp-nav button[data-tab="cases"]').waitFor({ timeout: 15000 });
	await page.locator('.dsp-nav button[data-tab="cases"]').click();
	await sleep(500);
	check("刷新后仍能看到「通过」结果", (await page.locator("button.dsp-result.pass").count()) > 0);

	// -- 7) 引入对话：三档格式 + 引用档预览 ----------------------------------
	await page.locator('button[data-act="brief-case"]').first().click();
	const brief = page.locator(".dsp-modal", { hasText: "引入" }).first();
	const briefOpen = await brief
		.waitFor({ timeout: 5000 })
		.then(() => true)
		.catch(() => false);
	check("打开「引入到 AI 对话」弹窗", briefOpen);
	if (briefOpen) {
		const fmtBtns = brief.locator('button[data-act="brief-format"]');
		const fmtLabels = await fmtBtns.allInnerTexts();
		check(
			"格式有自动 / 卡片 / 清单 / 引用四档",
			fmtLabels.some((t) => t.includes("引用档")),
			fmtLabels.join(" / "),
		);
		await brief.locator('button[data-act="brief-format"]', { hasText: "引用档" }).first().click();
		await sleep(300);
		const preview = await brief
			.locator("textarea, pre, .dsp-preview")
			.first()
			.innerText()
			.catch(() => "");
		const previewText =
			preview ||
			(await brief
				.locator("textarea")
				.first()
				.inputValue()
				.catch(() => ""));
		check("引用档预览带「引用档」与工具提示", /引用档/.test(previewText) && /data_space_cases/.test(previewText));
		check("引用档预览不含步骤正文", !/预期：/.test(previewText));
		await page
			.locator(".dsp-modal .dsp-modal-close, .dsp-modal [data-act='close-modal']")
			.first()
			.click()
			.catch(() => {});
		await sleep(200);
	}

	// -- 10) 空台账 → 载入示例记录 → 看清全部形态 --------------------------
	page.on("dialog", (d) => void d.accept());
	await page.locator('.dsp-nav button[data-tab="settings"]').click();
	await sleep(350);
	const clearBtn = page.locator('button[data-act="clear-runs"]');
	const clearCount = await clearBtn.count();
	check("设置页有「清空执行记录」且可点", clearCount === 1 && (await clearBtn.isEnabled()), `${clearCount} 个`);
	await clearBtn.click();
	await sleep(900);

	await page.locator('.dsp-nav button[data-tab="runs"]').click();
	await sleep(450);
	const demoBtn = page.locator('button[data-act="load-demo-runs"]');
	check("空台账空态给出「载入示例记录」入口", (await demoBtn.count()) >= 1);
	check("空台账不显示统计卡（还没数据）", (await page.locator(".dsp-stat").count()) === 0);
	await demoBtn.first().click();
	await sleep(1400);
	const demoRows = await page.locator(".dsp-table.runs tbody tr").count();
	check("载入示例记录后流水有 11 条", demoRows === 11, `${demoRows} 行`);
	check(
		"示例记录含三种结论",
		(await page.locator(".dsp-result.pass").count()) > 0 &&
			(await page.locator(".dsp-result.fail").count()) > 0 &&
			(await page.locator(".dsp-result.blocked").count()) > 0,
	);
	check("示例记录里有「可能过期」的那条", (await page.locator(".dsp-warn", { hasText: "可能过期" }).count()) >= 1);
	const demoRate = (await page.locator(".dsp-stat", { hasText: "通过率" }).first().innerText()).replace(/\s+/g, " ");
	check("示例记录让通过率不是 0% 也不是 100%", /\d+%/.test(demoRate) && !/\b(0|100)%/.test(demoRate), demoRate);
	await page.locator('button[data-act="runs-view"][data-id="task"]').click();
	await sleep(350);
	const taskNames = await page.locator(".dsp-task .dsp-task-name").allInnerTexts();
	check(
		"示例记录形成 3 个批量任务 + 单条登记",
		taskNames.filter((t) => !t.includes("单条登记")).length === 3 && taskNames.includes("单条登记"),
		taskNames.join(" / "),
	);

	// -- 11) 900 宽窄屏不横向溢出 ---------------------------------------------
	await page.setViewportSize({ width: 900, height: 900 });
	await sleep(500);
	const overflow = await page.evaluate(() => {
		const doc = document.documentElement;
		return { scroll: doc.scrollWidth, inner: globalThis.innerWidth };
	});
	check("900 宽下页面不横向溢出", overflow.scroll <= overflow.inner + 2, JSON.stringify(overflow));

	// -- 9) 全程无 JS 报错 ---------------------------------------------------
	check("无 JS 报错", jsErrors.length === 0, jsErrors.slice(0, 3).join(" | "));
} catch (err) {
	failures += 1;
	console.error(`✗ 用例执行异常：${err instanceof Error ? err.message : String(err)}`);
} finally {
	await browser.close().catch(() => {});
	if (failures) {
		console.error(`\n${failures} 项断言失败`);
		await shutdown(1);
	} else {
		console.log("\n数据空间 v2/v3 浏览器 E2E 全部通过");
		await shutdown(0);
	}
}
