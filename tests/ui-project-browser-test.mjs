/** Use the same Playwright runtime as the project's fixtures (no duplicate profile runtime). */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBuild } from "./lib/ensure-build.mjs";
const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "ui-project-browser");
const evidence = join(repo, "tests/scratch/ui-project-browser", String(Date.now()));
const result = spawnSync(
	process.execPath,
	[join(repo, "node_modules/playwright/cli.js"), "test", "--config", "qa/ui/playwright.config.mjs"],
	{
		cwd: repo,
		stdio: "inherit",
		env: { ...process.env, PI_WEB_SMOKE_PREBUILT: "1", PI_UI_FIXTURE_EVIDENCE: evidence },
	},
);
if (result.error) throw result.error;
console.log(`UI fixture browser evidence: ${evidence}`);
process.exitCode = result.status ?? 1;
