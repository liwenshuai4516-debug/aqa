// Collect with the target runtime; this checks seed selection without executing test bodies.
import { execFile } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { resolvePlaywrightRuntime } from "./playwright-runtime.mjs";
const execute = promisify(execFile);

export async function validateRecordingSeed(cwd, input, childEnv = undefined) {
	if (
		typeof input?.project !== "string" ||
		!input.project.trim() ||
		typeof input?.seedFile !== "string" ||
		!input.seedFile.trim()
	)
		throw new Error("UI 初始化阻塞：需要明确的 project 与 seedFile，不自动创建或猜选 seed。");
	const runtime = resolvePlaywrightRuntime(cwd);
	const filePattern = basename(input.seedFile).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	let report;
	try {
		const { stdout } = await execute(
			process.execPath,
			[
				runtime.cli,
				"test",
				"--list",
				`--reporter=${fileURLToPath(new URL("./recording-preflight-reporter.mjs", import.meta.url))}`,
				"--config",
				runtime.config,
				`--project=${input.project}`,
				"--",
				`(?:^|/)${filePattern}$`,
			],
			{
				cwd,
				...(childEnv ? { env: { ...process.env, ...childEnv } } : {}),
				timeout: 30_000,
				maxBuffer: 2 * 1024 * 1024,
			},
		);
		report = JSON.parse(stdout);
	} catch {
		throw new Error(
			"UI 初始化阻塞：seed 收集失败；核对项目 Playwright 依赖、配置、浏览器 project 和 seed 文件。未执行 seed。",
		);
	}
	if (report.version !== 1 || report.errors) throw new Error("UI 初始化阻塞：seed 收集存在错误，未执行 seed。");
	const project = report.projects?.find((p) => p.name === input.project);
	if (!project?.testDir) throw new Error("UI 初始化阻塞：浏览器 project 不存在或测试配置不兼容。");
	if (project.storageStateConfigured)
		throw new Error("UI 初始化阻塞：录制尚不支持配置 storageState；未执行 seed，私密正式执行入口不受此检查影响。");
	// Match MCP's testDir / configDir / cwd lookup, but refuse multiple distinct files.
	const candidates = [
		...new Set(
			[project.testDir, dirname(runtime.config), cwd]
				.map((root) => resolve(root, input.seedFile))
				.filter((path) => existsSync(path) && statSync(path).isFile())
				.map((path) => realpathSync(path)),
		),
	];
	if (candidates.length !== 1)
		throw new Error(`UI 初始化阻塞：seed 匹配${candidates.length ? "多个文件" : "不到文件"}，请指定唯一文件。`);
	const tests = report.tests.filter(({ file }) => existsSync(file) && realpathSync(file) === candidates[0]).length;
	if (tests !== 1) throw new Error("UI 初始化阻塞：seed 必须收集到单个测试，不执行空或多测试 seed。");
	return { project };
}
