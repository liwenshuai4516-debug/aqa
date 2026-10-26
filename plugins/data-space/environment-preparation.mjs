/** Selection/parameter receipt only. Browser identity, data and private execution remain native checks. */
import { dynamicFresh, dynamicKeys, redactEnvSecrets, scriptReady } from "./env-script.mjs";

export function preparationMode(input) {
	const mode = input.mode ?? "new";
	if (!["new", "record", "execute", "analyze", "view", "resume", "rerun-failed", "rerun-all"].includes(mode))
		throw new Error("不支持的测试准备模式");
	if (
		input.discovery !== undefined &&
		(!["source", "browser", "both"].includes(input.discovery) || !["new", "record"].includes(mode))
	)
		throw new Error("发现方式仅适用于新建或录制模式");
	const required = !["analyze", "view"].includes(mode) && input.discovery !== "source";
	return {
		mode,
		discovery: input.discovery ?? null,
		channelRequired: required,
		browserRequired: input.engine === "ui" && required,
	};
}

const unknown = (basis = "not-checked") => ({ state: "unknown", basis });

export function environmentPreparation(env, mode, nowMs = Date.now()) {
	const checkedAt = new Date(nowMs).toISOString();
	const unchecked = { network: unknown(), authentication: unknown(), role: unknown(), data: unknown() };
	if (!env)
		return {
			...mode,
			checkedAt,
			configuration: unknown("not-required"),
			parameters: unknown("not-required"),
			...unchecked,
			privateExecution: unknown("not-required"),
		};
	const configured = scriptReady(env.script);
	const expected = configured ? dynamicKeys(env.script) : [];
	const dynamic = configured ? (env.dynamic ?? []) : [];
	const reserved = new Set([...expected, ...dynamic.map((p) => p.key)].map((key) => key.toLowerCase()));
	const privateKeys = [
		...new Set([
			...(env.params ?? []).filter((p) => p.secret).map((p) => p.key),
			...(env.script?.steps ?? []).flatMap((step) =>
				(step.extract ?? []).filter((p) => p.secret !== false).map((p) => p.key),
			),
			...(env.dynamic ?? []).filter((p) => p.secret).map((p) => p.key),
		]),
	];
	const secretNames = new Set(privateKeys.map((key) => key.toLowerCase()));
	const redactionEnv = {
		params: (env.params ?? []).map((p) => ({ ...p, secret: secretNames.has(p.key.toLowerCase()) })),
		dynamic: (env.dynamic ?? []).map((p) => ({ ...p, secret: secretNames.has(p.key.toLowerCase()) })),
	};
	const fresh = configured && dynamicFresh(env, nowMs);
	const entries = new Map(),
		sources = new Map(),
		blockedKeys = [];
	for (const [kind, items] of [
		["static", (env.params ?? []).filter((p) => !reserved.has(p.key.toLowerCase()))],
		["dynamic", fresh ? dynamic : []],
	]) {
		for (const p of items) {
			if (secretNames.has(p.key.toLowerCase())) continue;
			// A public field reflecting a known secret must not become an executable masked value.
			if (redactEnvSecrets(p.value, redactionEnv) !== p.value) {
				blockedKeys.push(p.key);
				continue;
			}
			entries.set(p.key, p.value);
			sources.set(p.key, {
				kind,
				at: kind === "dynamic" ? p.at || null : null,
				expiresAt: kind === "dynamic" ? p.expiresAt || null : null,
			});
		}
	}
	return {
		...mode,
		checkedAt,
		configuration: { state: "ready", basis: "unique-project-environment" },
		parameters: {
			state: (configured && !fresh) || blockedKeys.length ? "not-ready" : "ready",
			dynamic: configured ? (fresh ? "reused" : "refresh-required") : "not-required",
			blockedKeys,
		},
		...unchecked,
		privateExecution: privateKeys.length
			? { state: "not-ready", basis: "explicit-private-execution-preparation-required" }
			: unknown("no-private-parameters"),
		publicParameters: Object.fromEntries(entries),
		parameterSources: Object.fromEntries(sources),
		privateParameterKeys: privateKeys,
	};
}
