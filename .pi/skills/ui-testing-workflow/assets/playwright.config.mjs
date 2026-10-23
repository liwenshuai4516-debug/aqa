import { join } from "node:path";

export default {
	testDir: join(process.cwd(), "qa/ui"),
	workers: 1,
	retries: 0,
	forbidOnly: true,
	use: {
		headless: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
};
