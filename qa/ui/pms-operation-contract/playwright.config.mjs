import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
export default defineConfig({
	testDir: fileURLToPath(new URL(".", import.meta.url)),
	testMatch: "seed*.spec.ts",
	workers: 1,
	retries: 0,
	timeout: 60000,
	outputDir: process.env.PI_UI_PRIVATE_EVIDENCE_DIR
		? `${process.env.PI_UI_PRIVATE_EVIDENCE_DIR}/output/runner`
		: "../../../tests/scratch/pms-operation-contract-collection",
	use: {
		trace: "off",
		screenshot: "off",
		video: "off",
		headless: true,
		launchOptions: { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
	},
	projects: [{ name: "chromium" }],
});
