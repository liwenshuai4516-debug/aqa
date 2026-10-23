// Use the SDK pipeline so recording retains nested calls, hooks and cancellation.
import { resolvePlaywrightRuntime } from "./playwright-runtime.mjs";
import { validateRecordingSeed } from "./recording-preflight.mjs";
import { createMcpExtension } from "@earendil-works/pi-coding-agent";

const mcp = createMcpExtension({
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

export default async function (pi) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "mcp__ui_playwright_test__generator_setup_page") return;
		try {
			await validateRecordingSeed(ctx.cwd, event.input);
		} catch (error) {
			return { block: true, reason: error.message };
		}
	});
	return mcp(pi);
}
