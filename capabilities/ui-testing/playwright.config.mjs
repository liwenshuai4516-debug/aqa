import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "../../qa/ui",
	workers: 1,
	retries: 0,
	forbidOnly: true,
	use: {
		headless: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
