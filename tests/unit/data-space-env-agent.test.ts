import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../../plugins/data-space/index.mjs";
import { createDataSpaceTools } from "../../plugins/data-space/tools.mjs";
import { dynamicFresh, runEnvScript } from "../../plugins/data-space/env-script.mjs";
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
					note: "Do not expose fixture-password here",
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
		expect(refresh).not.toContain("fixture-token");
		expect(refresh).toContain("私密参数执行链未接入");
		expect(refresh).not.toContain("fixture-password");
		await tool.execute("reuse", { project: "p", env: "e", action: "refresh" });
		expect(calls).toBe(1);
		fail = true;
		const failed = await tool.execute("failed", { project: "p", env: "e", action: "refresh", force: true });
		expect(failed).toContain("401");
		expect(failed).not.toContain("fixture-token");
		const retry = await tool.execute("retry", { project: "p", env: "e", action: "refresh" });
		expect(retry).toContain("上次运行失败");
		expect(calls).toBe(2);
	} finally {
		off();
	}
});

it("does not refresh ambiguous environments, including identical names in different projects", async () => {
	let calls = 0;
	const tool = createDataSpaceTools({
		store: () => ({
			systems: [
				{ id: "p1", name: "Project" },
				{ id: "p2", name: "Project" },
			],
			envs: ["p1", "p2"].map((systemId) => ({
				id: `${systemId}-test`,
				systemId,
				name: "test",
				isDefault: true,
				script: { enabled: true, steps: [{ url: "/login" }] },
			})),
		}),
		refreshEnv: async () => {
			calls++;
			return { ok: true };
		},
	} as never).find((t) => t.name === "data_space_env")!;
	const result = await tool.execute("ambiguous", { action: "refresh", project: "Project", env: "test" });
	expect(result).toContain("环境准备阻塞");
	expect(calls).toBe(0);
});

it("invalidates a still-unexpired cache after a failed forced refresh", () => {
	const env = {
		script: { steps: [{ extract: [{ key: "token" }] }] },
		dynamic: [{ key: "token", value: "synthetic-private", expiresAt: "2099-01-01T00:00:00Z" }],
		scriptRun: { ok: false },
	};
	expect(dynamicFresh(env)).toBe(false);
	expect(dynamicFresh({ ...env, scriptRun: { ok: true } })).toBe(true);
});

it("removes reflected secrets from diagnostics, including partial multi-step results", async () => {
	let calls = 0;
	const result = await runEnvScript({
		env: { baseUrl: "https://fixture.invalid", params: [{ key: "password", value: "private+password", secret: true }] },
		script: {
			enabled: true,
			steps: [{ url: "/login", extract: [{ key: "token", path: "token" }] }, { url: "/session" }],
		},
		fetchText: async () =>
			++calls === 1
				? { ok: true, status: 200, text: '{"token":"partial-private"}' }
				: { ok: false, status: 0, error: "Reflected partial-private and private%2Bpassword" },
	});
	expect(result.ok).toBe(false);
	const diagnostics = JSON.stringify({ error: result.error, steps: result.steps });
	expect(diagnostics).not.toContain("partial-private");
	expect(diagnostics).not.toContain("private%2Bpassword");
	expect(diagnostics).toContain("***");
});
