import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AgentService } from "../../server/agent/agent-service-daemon.js";
import { ClientStateStore } from "../../server/client-state.js";

afterEach(() => vi.unstubAllEnvs());

it("makes tools registered before client attachment available in its first SDK session", async () => {
	const root = mkdtempSync(join(tmpdir(), "desktop-first-tools-"));
	mkdirSync(join(root, "agent"));
	vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
	const service = new AgentService(root, new ClientStateStore(join(root, "client-state.json")));
	service.pluginToolsProvider = () => [
		{
			name: "ready_before_attach",
			description: "A tool already registered when the first client connects",
			parameters: { type: "object", properties: {} },
			execute: async () => "ready",
		},
	];
	try {
		const client = await service.attach("first-tools", () => {});
		expect(client.session.getAllTools().map((tool) => tool.name)).toContain("ready_before_attach");
		expect(client.session.getActiveToolNames()).toContain("ready_before_attach");
	} finally {
		await service.disposeAll();
		rmSync(root, { recursive: true, force: true });
	}
}, 15000);
