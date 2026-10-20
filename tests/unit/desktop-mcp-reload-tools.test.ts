import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { McpBridge } from "../../server/mcp-bridge.js";

it("notifies a subscribed session before each reload returns so it replaces closed MCP clients", async () => {
	const root = mkdtempSync(join(tmpdir(), "desktop-mcp-reload-"));
	const spec = { command: process.execPath, args: [resolve("tests/fixtures/mcp-echo-server.mjs")] };
	const save = (enabled: boolean) =>
		writeFileSync(join(root, "mcp.json"), JSON.stringify({ servers: { echo: { ...spec, enabled } } }));
	let sessionTools: ReturnType<McpBridge["getTools"]> = [];
	let changes = 0;
	const bridge = new McpBridge(root, () => {}, {
		onToolsChanged: () => {
			sessionTools = bridge.getTools();
			changes++;
		},
	});
	try {
		save(true);
		await bridge.load();
		sessionTools = bridge.getTools();
		const original = sessionTools.find((tool) => tool.name === "pid")!;
		const first = await original.execute("first", {});
		save(false);
		await bridge.reload();
		expect(sessionTools).toHaveLength(0);
		save(true);
		await bridge.reload();
		const current = sessionTools.find((tool) => tool.name === "pid")!;
		expect(current).toBeDefined();
		expect(await current.execute("second", {})).not.toEqual(first);
		expect(changes).toBe(2);
	} finally {
		bridge.dispose();
		rmSync(root, { recursive: true, force: true });
	}
});
