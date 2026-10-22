// Use the SDK pipeline so recording retains nested calls, hooks and cancellation.
import { join } from "node:path";
import { createMcpExtension } from "@earendil-works/pi-coding-agent";

export default createMcpExtension({
	loadConfig: (ctx) => ({
		servers: [
			{
				name: "ui-playwright-test",
				scope: "extension",
				source: import.meta.url,
				config: {
					command: process.execPath,
					args: [
						join(ctx.cwd, "node_modules/playwright/cli.js"),
						"run-test-mcp-server",
						"--headless",
						"-c",
						join(ctx.cwd, "capabilities/ui-testing/playwright.config.mjs"),
					],
					cwd: ctx.cwd,
					exposure: "direct",
					timeout: 45,
				},
			},
		],
		errors: [],
	}),
});
