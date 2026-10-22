// Use the SDK pipeline so recording retains nested calls, hooks and cancellation.
import { fileURLToPath } from "node:url";
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
						fileURLToPath(new URL("../../../../node_modules/playwright/cli.js", import.meta.url)),
						"run-test-mcp-server",
						"--headless",
						"-c",
						fileURLToPath(new URL("./playwright.config.mjs", import.meta.url)),
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
