import { fileURLToPath } from "node:url";
import { CHROME_PATH } from "../../../../../../tests/lib/chrome.mjs";
// Static preparation only. No webServer, globalSetup, shell, network or browser hooks.
export default {
	testDir: fileURLToPath(new URL(".", import.meta.url)),
	testMatch: "query-reset-p0.spec.ts",
	timeout: 45000,
	expect: { timeout: 5000 },
	workers: 1,
	fullyParallel: false,
	retries: 0,
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
	use: {
		headless: true,
		launchOptions: { executablePath: CHROME_PATH || undefined },
		viewport: { width: 1600, height: 1000 },
		trace: "off",
		screenshot: "off",
		video: "off",
	},
};
