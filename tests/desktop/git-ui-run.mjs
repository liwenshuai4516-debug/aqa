// Actual package Git UI with a disposable repository and real Git assertions.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";
import { waitForStablePage } from "../lib/page-stability.mjs";

const executablePath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve evidence");
const fixture = mkdtempSync("/tmp/pi-git-ui-");
const userData = join(fixture, "desktop");
const workspace = join(fixture, "中文 workspace");
const agent = join(userData, "agent");
mkdirSync(workspace);
mkdirSync(agent, { recursive: true });
writeFileSync(join(agent, "auth.json"), "{}");
writeFileSync(join(agent, "models.json"), '{"providers":{}}');
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of Object.keys(env))
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_)/.test(key) ||
		[
			"ELECTRON_RUN_AS_NODE",
			"NODE_OPTIONS",
			"PI_WEB_DATA_DIR",
			"PI_CODING_AGENT_DIR",
			"PI_CODING_AGENT_SESSION_DIR",
			"PI_WEB_DESKTOP_URL",
			"PI_WEB_PORT",
		].includes(key)
	)
		delete env[key];
const result = { fixture, executablePath, status: "FAIL", checks: [], realModelRequests: 0 };
let app, page;
const check = (text, ok) => {
	assert(ok, text);
	result.checks.push(text);
};
async function launch() {
	app = await launchNativeApp({ executablePath, packaged: true, env });
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	assert(await waitForStablePage(page));
	await page.getByRole("tab", { name: "Git", exact: true }).click();
	await page.waitForSelector(".scm-view");
}
const git = (...args) =>
	execFileSync("/usr/bin/git", ["-c", "core.quotepath=false", ...args], {
		cwd: workspace,
		env,
		encoding: "utf8",
	}).trim();
git("init", "-b", "main");
git("config", "user.name", "Desktop Acceptance");
git("config", "user.email", "desktop-test@example.invalid");
git("config", "commit.gpgsign", "false");
git("config", "core.hooksPath", "/dev/null");
const tracked = "中文源文件.txt";
const loose = "未跟踪.txt";
writeFileSync(join(workspace, tracked), "BEFORE\n");
git("add", "--", tracked);
git("commit", "-m", "desktop initial");
const initialCommit = git("rev-parse", "HEAD");
writeFileSync(join(workspace, tracked), "AFTER_UI_COMMIT\n");
writeFileSync(join(workspace, loose), "KEEP_UNTRACKED\n");
async function until(fn) {
	const end = Date.now() + 15000;
	while (!(await fn())) {
		assert(Date.now() < end, "Git UI condition timeout");
		await new Promise((r) => setTimeout(r, 100));
	}
}
const fileRow = () => page.locator(".scm-file").filter({ has: page.locator(".scm-file-path", { hasText: tracked }) });
try {
	await launch();
	await fileRow().waitFor();
	check("Actual package Git view discovers changed Chinese filename", await fileRow().isVisible());
	check("Untracked file is displayed separately", await page.locator(".scm-file-path", { hasText: loose }).isVisible());
	await fileRow().click();
	await until(async () => (await page.locator(".scm-diff-pre").innerText()).includes("AFTER_UI_COMMIT"));
	check(
		"Original Git UI renders real removed and added file content",
		(await page.locator(".scm-diff-pre").innerText()).includes("BEFORE"),
	);
	await page.screenshot({ path: output.replace(/\.json$/, "-diff.png") });
	await fileRow().getByRole("button", { name: "+", exact: true }).click();
	await until(() => git("diff", "--cached", "--name-only") === tracked);
	check(
		"Stage UI updates actual Git index for exactly the selected file",
		git("diff", "--cached", "--name-only") === tracked,
	);
	check(
		"Original Git action switches to real terminal output",
		(await page.getByRole("tab", { name: /^(终端|Terminal)$/ }).getAttribute("aria-selected")) === "true",
	);
	await page.getByRole("tab", { name: "Git", exact: true }).click();
	await fileRow().hover();
	await fileRow().getByRole("button", { name: "−", exact: true }).click();
	await until(() => git("diff", "--cached", "--name-only") === "");
	await page.getByRole("tab", { name: "Git", exact: true }).click();
	check(
		"Unstage UI restores empty actual index and preserves worktree",
		readFileSync(join(workspace, tracked), "utf8") === "AFTER_UI_COMMIT\n",
	);
	await fileRow().hover();
	await fileRow().getByRole("button", { name: "+", exact: true }).click();
	await until(() => git("diff", "--cached", "--name-only") === tracked);
	await page.getByRole("tab", { name: "Git", exact: true }).click();
	const message = "desktop UI 中文提交";
	await page.locator(".scm-commit-input").fill(message);
	await page.locator(".scm-header .btn.primary").click();
	await until(() => git("rev-parse", "HEAD") !== initialCommit);
	check("Commit button creates actual commit with exact message", git("log", "-1", "--format=%s") === message);
	check(
		"Only staged file is committed and index is clean",
		git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD") === tracked &&
			git("diff", "--cached", "--name-only") === "",
	);
	check(
		"Committed blob matches intended bytes",
		execFileSync("/usr/bin/git", ["show", `HEAD:${tracked}`], { cwd: workspace, env }).equals(
			Buffer.from("AFTER_UI_COMMIT\n"),
		),
	);
	check(
		"Untracked file remains uncommitted and unchanged",
		git("ls-files", "--others", "--exclude-standard") === loose &&
			readFileSync(join(workspace, loose), "utf8") === "KEEP_UNTRACKED\n",
	);
	await page.getByRole("tab", { name: "Git", exact: true }).click();
	await page
		.locator(".scm-view-tabs")
		.getByRole("tab", { name: /^(提交树|Commit tree)$/ })
		.click();
	await page.locator(".scm-commit-subject", { hasText: message }).waitFor();
	check("Original history view displays newly created commit", true);
	await page
		.locator(".scm-commit")
		.filter({ has: page.locator(".scm-commit-subject", { hasText: message }) })
		.click();
	await until(async () => (await page.locator(".scm-diff-pre").innerText()).includes("AFTER_UI_COMMIT"));
	check(
		"History selection loads real committed diff",
		(await page.locator(".scm-diff-pre").innerText()).includes("BEFORE"),
	);
	await page.locator(".scm-history-filter").fill("NO_SUCH_DESKTOP_COMMIT");
	await until(async () => (await page.locator(".scm-commit").count()) === 0);
	await page.locator(".scm-history-filter").fill("中文提交");
	await page.locator(".scm-commit-subject", { hasText: message }).waitFor();
	check(
		"History filter hides nonmatches and restores matching commit",
		(await page.locator(".scm-commit").count()) === 1,
	);
	await page.screenshot({ path: output.replace(/\.json$/, "-history.png") });
	result.initialCommit = initialCommit;
	result.finalCommit = git("rev-parse", "HEAD");
	result.finalStatus = git("status", "--porcelain");
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	await page?.screenshot({ path: output.replace(/\.json$/, "-failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	await app?.close().catch((error) => {
		result.cleanupError = error.message;
		process.exitCode = 1;
	});
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}
