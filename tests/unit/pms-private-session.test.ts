import { describe, expect, it } from "vitest";
import { readFile, stat, access } from "node:fs/promises";
import { preparePmsSession } from "../lib/pms-private-session.mjs";
import { authState } from "pi-ui-testing";

const secret = "synthetic-pms-token-must-stay-private";
function fixture() {
	return {
		revision: 8,
		systems: [{ id: "project" }],
		envs: [
			{
				id: "environment",
				systemId: "project",
				name: "test",
				baseUrl: "https://pms.invalid",
				params: [
					{ key: "账号", value: "synthetic-admin" },
					{ key: "口令", value: "synthetic-password" },
				],
				script: {
					enabled: true,
					steps: [
						{
							method: "POST",
							url: "/api/base-service/login",
							body: '{"username":"{{账号}}","password":"{{口令}}"}',
							extract: [{ key: "token", path: "data.token", secret: true }],
						},
					],
				},
			},
		],
	};
}
const login = { code: 200, data: { token: secret, username: "synthetic-admin", tenants: [{ id: "tenant" }] } };
const permission = {
	code: 200,
	data: [{ parentCode: "pms", code: "pms", buttons: ["contract:create"], menus: [{ url: "/OperationContract" }] }],
};

describe("PMS private environment adapter", () => {
	it("provides a native private reference, preserves store, and disposes credentials", async () => {
		const store = fixture(),
			before = JSON.stringify(store),
			calls: string[] = [];
		const session = await preparePmsSession({
			store,
			systemId: "project",
			envId: "environment",
			refresh: true,
			fetchImpl: async (url, init) => {
				calls.push(String(url));
				expect(init?.redirect).toBe("error");
				if (calls.length === 2) expect(init?.headers).toMatchObject({ token: secret });
				return new Response(JSON.stringify(calls.length === 1 ? login : permission));
			},
		});
		const path = process.env[session.auth.reference]!;
		try {
			expect(await authState({ auth: session.auth } as never)).toBe(path);
			expect((await stat(path)).mode & 0o777).toBe(0o600);
			const state = JSON.parse(await readFile(path, "utf8"));
			expect(state.origins[0].origin).toBe("https://pms.invalid");
			expect(state.origins[0].localStorage).toContainEqual({ name: "token", value: secret });
			expect(JSON.stringify(session.receipt)).not.toContain(secret);
			expect(JSON.stringify(session.receipt)).not.toContain(path);
			expect(session.receipt).toMatchObject({
				authentication: "browser-not-checked",
				role: "unknown",
				dataSpaceWrites: 0,
			});
			expect(JSON.stringify(store)).toBe(before);
			expect(calls).toEqual([
				"https://pms.invalid/api/base-service/login",
				"https://pms.invalid/api/base-service/permission",
			]);
		} finally {
			await session.dispose();
		}
		expect(process.env[session.auth.reference]).toBeUndefined();
		await expect(access(path)).rejects.toThrow();
	});

	it("rejects mismatched project, missing explicit refresh and foreign script before network", async () => {
		let calls = 0;
		const args = {
			store: fixture(),
			systemId: "project",
			envId: "environment",
			refresh: true,
			fetchImpl: async () => {
				calls++;
				throw new Error(secret);
			},
		};
		await expect(preparePmsSession({ ...args, systemId: "other" })).rejects.toMatchObject({
			code: "project-environment-mismatch",
		});
		await expect(preparePmsSession({ ...args, refresh: false })).rejects.toMatchObject({
			code: "explicit-refresh-required",
		});
		args.store.envs[0].script.steps[0].url = "https://other.invalid/api/base-service/login";
		await expect(preparePmsSession(args)).rejects.toThrow();
		expect(calls).toBe(0);
	});

	it.each([
		{ ...login, data: { ...login.data, username: "other-account" } },
		{ ...login, data: { ...login.data, token: "a".repeat(501) } },
		{ ...login, data: { ...login.data, verify: true } },
		{ ...login, data: { ...login.data, tenants: [] } },
		{ ...login, data: { ...login.data, tenants: [{ id: "a" }, { id: "b" }] } },
		{ code: 401, data: { ...login.data } },
	])("blocks unsupported login outcomes without guessing a tenant", async (response) => {
		let calls = 0;
		await expect(
			preparePmsSession({
				store: fixture(),
				systemId: "project",
				envId: "environment",
				refresh: true,
				fetchImpl: async () => {
					calls++;
					return new Response(JSON.stringify(response));
				},
			}),
		).rejects.toMatchObject({ code: "login-or-single-tenant-not-ready" });
		expect(calls).toBe(1);
	});

	it("never returns credential-bearing upstream errors", async () => {
		await expect(
			preparePmsSession({
				store: fixture(),
				systemId: "project",
				envId: "environment",
				refresh: true,
				fetchImpl: async () => {
					throw new Error(secret);
				},
			}),
		).rejects.toThrow(/^PMS private preparation blocked: login-or-single-tenant-not-ready$/);
	});

	it("blocks missing PMS permissions without publishing the private server response", async () => {
		let calls = 0;
		await expect(
			preparePmsSession({
				store: fixture(),
				systemId: "project",
				envId: "environment",
				refresh: true,
				fetchImpl: async () => new Response(JSON.stringify(++calls === 1 ? login : { code: 200, data: [] })),
			}),
		).rejects.toMatchObject({ code: "pms-client-not-found" });
		expect(calls).toBe(2);
	});
});
