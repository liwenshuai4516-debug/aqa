import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_PATH } from "../../tests/lib/chrome.mjs";

const evidence =
	process.env.PI_UI_FIXTURE_EVIDENCE ??
	fileURLToPath(new URL(`../../tests/scratch/ui-project-browser/${Date.now()}/`, import.meta.url));
export default defineConfig({
	testDir: fileURLToPath(new URL(".", import.meta.url)),
	testMatch: "isolated-project.spec.ts",
	workers: 1,
	retries: 0,
	forbidOnly: true,
	outputDir: join(evidence, "artifacts"),
	reporter: [["list"], ["json", { outputFile: join(evidence, "report.json") }]],
	use: {
		headless: true,
		launchOptions: { executablePath: CHROME_PATH || undefined },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
});
