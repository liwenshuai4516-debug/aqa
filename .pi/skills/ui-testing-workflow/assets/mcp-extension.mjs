// Use the SDK pipeline so recording retains nested calls, hooks and cancellation.
import { resolvePlaywrightRuntime } from "./playwright-runtime.mjs";
import { createMcpExtension } from "@earendil-works/pi-coding-agent";

export default createMcpExtension({
	loadConfig: (ctx) => {
		const runtime = resolvePlaywrightRuntime(ctx.cwd);
		return {
			servers: [
				{
					name: "ui-playwright-test",
					scope: "extension",
					source: import.meta.url,
					config: {
						command: process.execPath,
						args: [runtime.cli, "run-test-mcp-server", "--headless", "-c", runtime.config],
						cwd: ctx.cwd,
						exposure: "direct",
						timeout: 45,
					},
				},
			],
			errors: [],
		};
	},
});
