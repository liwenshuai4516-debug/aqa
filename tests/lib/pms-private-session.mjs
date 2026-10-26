/** Target-specific environment preparation, not a login tool or business test runner.
 * Reuses the selected Data Space script and native storage-state-env contract.
 * No store writes, browser capture, model calls or inferred role readiness.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEnvScript, normalizeEnvScript, resolveScriptUrl } from "../../plugins/data-space/env-script.mjs";

const blocked = (code) => Object.assign(new Error(`PMS private preparation blocked: ${code}`), { code });

export async function preparePmsSession({ store, systemId, envId, refresh, fetchImpl = fetch }) {
	if (refresh !== true) throw blocked("explicit-refresh-required");
	const project = store.systems.find((p) => p.id === systemId);
	const env = store.envs.find((e) => e.id === envId && e.systemId === systemId);
	if (!project || !env) throw blocked("project-environment-mismatch");
	let base;
	try {
		base = new URL(env.baseUrl);
	} catch {
		throw blocked("invalid-base-url");
	}
	if (!/^https?:$/.test(base.protocol) || base.username || base.password || base.search || base.hash)
		throw blocked("invalid-base-url");
	const script = normalizeEnvScript(env.script);
	const step = script.steps[0];
	const expectedAccount = env.params?.find((p) => p.key === "账号")?.value;
	if (typeof expectedAccount !== "string" || !expectedAccount) throw blocked("configured-account-required");
	if (
		!script.enabled ||
		script.allowForeignHost ||
		script.steps.length !== 1 ||
		step.method !== "POST" ||
		resolveScriptUrl(base.href, step.url) !== `${base.origin}/api/base-service/login` ||
		!step.extract.some((e) => e.key === "token" && e.path === "data.token" && e.secret)
	)
		throw blocked("unsupported-login-contract");

	// This adapter supports only the public deployed PMS contract, never arbitrary script destinations.
	const endpoints = new Set(["/api/base-service/login", "/api/base-service/permission"]);
	async function request(url, init) {
		const parsed = new URL(url);
		if (parsed.origin !== base.origin || !endpoints.has(parsed.pathname) || parsed.search || parsed.hash)
			throw blocked("request-outside-selected-environment");
		try {
			const response = await fetchImpl(parsed.href, {
				...init,
				redirect: "error",
				signal: AbortSignal.timeout(15000),
			});
			if (!response.ok) throw blocked("http-request-failed");
			const reader = response.body.getReader();
			const chunks = [];
			let size = 0;
			try {
				for (;;) {
					const { done, value } = await reader.read();
					if (done) break;
					size += value.length;
					if (size > 512 * 1024) throw blocked("response-too-large");
					chunks.push(value);
				}
			} finally {
				await reader.cancel();
			}
			return Buffer.concat(chunks).toString("utf8");
		} catch {
			// Do not expose response bodies, credentials, request URLs or transport errors.
			throw blocked("private-http-request-failed");
		}
	}
	let login;
	const result = await runEnvScript({
		env,
		script,
		fetchText: async (url, init) => {
			const text = await request(url, init);
			try {
				login = JSON.parse(text);
			} catch {
				throw blocked("invalid-login-response");
			}
			return { ok: true, status: 200, text };
		},
	});
	const account = login?.data;
	if (
		!result.ok ||
		login?.code !== 200 ||
		account?.verify ||
		typeof account?.token !== "string" ||
		!account.token ||
		result.values.find((v) => v.key === "token")?.value !== account.token ||
		typeof account.username !== "string" ||
		account.username !== expectedAccount ||
		!Array.isArray(account.tenants) ||
		account.tenants.length !== 1
	)
		throw blocked("login-or-single-tenant-not-ready");
	let permission;
	try {
		permission = JSON.parse(
			await request(`${base.origin}/api/base-service/permission`, {
				method: "GET",
				headers: { token: account.token, "x-parent-client-code": "pms", "x-client-code": "pms" },
			}),
		);
	} catch {
		throw blocked("permission-not-ready");
	}
	if (permission?.code !== 200 || !Array.isArray(permission.data)) throw blocked("permission-not-ready");
	const clients = permission.data.filter((c) => c.parentCode === "pms" || c.systemSetting === 1);
	if (!clients.some((c) => c.parentCode === "pms")) throw blocked("pms-client-not-found");
	const resources = {},
		menus = [];
	const prefixMenus = (items, prefix) =>
		items.map((item) => ({
			...item,
			...(item.url ? { url: `/${prefix}${item.url}` } : {}),
			...(item.children ? { children: prefixMenus(item.children, prefix) } : {}),
		}));
	for (const client of clients) {
		if (!Array.isArray(client.buttons) || !Array.isArray(client.menus)) throw blocked("permission-contract-invalid");
		resources[client.parentCode] = client.buttons;
		menus.push(...prefixMenus(client.menus, client.parentCode));
	}
	const entries = {
		// The deployed reader accepts raw strings. Keep raw token as an explicit secret for native evidence isolation.
		token: account.token,
		account: JSON.stringify({
			name: account.name,
			username: account.username,
			avatarImgUrl: account.avatarImgUrl,
			id: account.id,
		}),
		pms_tenant: JSON.stringify(account.tenants[0]),
		pms_tenants: JSON.stringify(account.tenants),
		"authorized-resource": JSON.stringify(resources),
		pms_menu: JSON.stringify(menus),
		client: JSON.stringify(clients.map(({ menus: _menus, buttons: _buttons, ...c }) => c)),
	};
	const systemClient = clients.find((c) => c.systemSetting);
	if (systemClient) {
		const { parentCode, code, name, url, systemSetting, icon } = systemClient;
		entries["x-system-client"] = JSON.stringify({ parentCode, code, name, url, systemSetting, icon });
	}
	const reference = `PI_UI_PMS_${randomUUID().replaceAll("-", "").toUpperCase()}`;
	const directory = await mkdtemp(join(tmpdir(), "aqa-pms-private-"));
	try {
		await writeFile(
			join(directory, "state.json"),
			JSON.stringify({
				cookies: [],
				origins: [
					{ origin: base.origin, localStorage: Object.entries(entries).map(([name, value]) => ({ name, value })) },
				],
			}),
			{ mode: 0o600, flag: "wx" },
		);
		process.env[reference] = join(directory, "state.json");
	} catch {
		await rm(directory, { recursive: true, force: true });
		throw blocked("private-state-write-failed");
	}
	return {
		auth: { kind: "storage-state-env", reference },
		receipt: {
			systemId,
			envId,
			revision: store.revision,
			configuration: "matched",
			privateState: "prepared-ephemeral",
			refresh: "explicit-fresh-login",
			authentication: "browser-not-checked",
			role: "unknown",
			data: "unknown",
			tenantCount: 1,
			clientCount: clients.length,
			dataSpaceWrites: 0,
		},
		async dispose() {
			delete process.env[reference];
			await rm(directory, { recursive: true, force: true });
		},
	};
}
