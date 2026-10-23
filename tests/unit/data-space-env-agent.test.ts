import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../../plugins/data-space/index.mjs";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

it("keeps environment list side-effect free while explicit refresh remains authorized", async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "ds-env-agent-"));
	roots.push(dataDir);
	mkdirSync(join(dataDir, "data-space"));
	writeFileSync(
		join(dataDir, "data-space/store.json"),
		JSON.stringify({
			version: 3,
			revision: 1,
			systems: [{ id: "p", name: "Fixture" }],
			modules: [],
			features: [],
			cases: [],
			envs: [
				{
					id: "e",
					systemId: "p",
					name: "test",
					baseUrl: "https://fixture.invalid",
					params: [{ key: "password", value: "fixture-password", secret: true }],
					script: {
						enabled: true,
						ttlMinutes: 60,
						steps: [
							{
								method: "POST",
								url: "/login",
								body: "{{password}}",
								extract: [{ key: "token", path: "token", secret: true }],
							},
						],
					},
				},
			],
		}),
	);
	const tools = new Map<string, any>();
	let calls = 0,
		fail = false;
	const off = plugin.activate({
		dataDir,
		cwd: dataDir,
		route() {
			return () => {};
		},
		broadcast() {},
		log() {},
		registerAgentTool(t: any) {
			tools.set(t.name, t);
			return () => tools.delete(t.name);
		},
		net: {
			async fetch(url: string, init: any) {
				calls++;
				expect(url).toBe("https://fixture.invalid/login");
				expect(init.body).toBe("fixture-password");
				return fail
					? { ok: true, status: 401, text: "{}" }
					: { ok: true, status: 200, text: '{"token":"fixture-token"}' };
			},
		},
	});
	try {
		const tool = tools.get("data_space_env");
		expect(tool).toBeDefined();
		const beforeQuery = readFileSync(join(dataDir, "data-space/store.json"), "utf8");
		const list = await tool.execute("list", { project: "p", env: "e" });
		expect(calls).toBe(0);
		expect(list).not.toContain("fixture-token");
		expect(list).not.toContain("fixture-password");
		await tool.execute("cached", { project: "p", env: "e" });
		expect(calls).toBe(0);
		expect(readFileSync(join(dataDir, "data-space/store.json"), "utf8")).toBe(beforeQuery);
		const refresh = await tool.execute("refresh", { project: "p", env: "e", action: "refresh" });
		expect(calls).toBe(1);
		expect(refresh).toContain("fixture-token");
		expect(refresh).not.toContain("fixture-password");
		fail = true;
		const failed = await tool.execute("failed", { project: "p", env: "e", action: "refresh" });
		expect(failed).toContain("401");
		expect(failed).not.toContain("fixture-token");
	} finally {
		off();
	}
});
