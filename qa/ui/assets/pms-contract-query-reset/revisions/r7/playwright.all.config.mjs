import { defineConfig } from "@playwright/test";
import { CHROME_PATH } from "../../../../../../tests/lib/chrome.mjs";

// Design-only config. The native runner supplies uiEnvironment/uiOwner/uiProjectRoot;
// no auth contents, environment bypass, services or browser start logic here.
export default defineConfig({
	testDir: import.meta.dirname,
	testMatch: "query-reset-all.spec.ts",
	timeout: 45000,
	expect: { timeout: 5000 },
	workers: 1,
	fullyParallel: false,
	retries: 0,
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
	use: { launchOptions: { executablePath: CHROME_PATH || undefined }, headless: true, viewport: { width: 1600, height: 1000 }, trace: "off", screenshot: "off", video: "off" },
});
