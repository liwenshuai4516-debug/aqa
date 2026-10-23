// Resolve config and CLI from one target workspace to avoid two Playwright runtimes.
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolvePlaywrightRuntime(cwd) {
	const workspace = realpathSync(cwd);
	const require = createRequire(join(workspace, "package.json"));
	let cli;
	try {
		const testPackage = require.resolve("@playwright/test/package.json");
		cli = join(dirname(createRequire(testPackage).resolve("playwright/package.json")), "cli.js");
		if (!existsSync(cli)) throw new Error("Playwright CLI missing");
	} catch {
		throw new Error(
			"UI 初始化失败：当前工作区缺少可用的 @playwright/test；请安装项目测试依赖后重载。未回退到宿主依赖。",
		);
	}
	const configs = ["ts", "js", "mts", "mjs", "cts", "cjs"]
		.map((ext) => join(workspace, `playwright.config.${ext}`))
		.filter(existsSync);
	if (configs.length > 1) throw new Error("UI 初始化失败：工作区有多个 Playwright 配置，请保留一个明确入口。");
	return {
		cli,
		config: configs[0] ?? fileURLToPath(new URL("./playwright.config.mjs", import.meta.url)),
		fallback: configs.length === 0,
	};
}
