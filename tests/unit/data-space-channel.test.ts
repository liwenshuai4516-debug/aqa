import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAutomation } from "../../plugins/data-space/automation.mjs";
import { normalizeStore } from "../../plugins/data-space/model.mjs";
import { extensionToolDenial } from "../../server/extension-tool-gate";
import { nativeTestAssetCreated } from "../../server/test-execution-notice";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
function fixture() {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "ds-channel-")));
	roots.push(cwd);
	let s: any = {
		revision: 1,
		systems: [{ id: "s", name: "PMS" }],
		modules: [],
		features: [],
		cases: [],
		envs: [
			{
				id: "e",
				systemId: "s",
				name: "test",
				baseUrl: "http://localhost:18980",
				params: [
					{ key: "tenant", value: "qa", secret: false },
					{ key: "token", value: "private-value", secret: true },
				],
			},
		],
	};
	let runs: any = { revision: 1, runs: [] },
		listener: any;
	const asset: any = {
		engine: "ui",
		workspace: cwd,
		assetRef: { path: "qa/ui/assets/a/manifest.json", sha256: "a".repeat(64) },
		revision: "v1",
		environment: { id: "test", baseUrl: s.envs[0].baseUrl },
		cases: [
			{
				id: "N1",
				title: "Query",
				priority: "P0",
				preconditions: ["authenticated"],
				steps: [{ action: "Search", expect: "Rows match" }],
			},
		],
	};
	const options: any = {
		host: {
			dataDir: cwd,
			testing: {
				inspect: async () => asset,
				list: async () => [],
				read: async () => ({
					...asset,
					runId: "r1",
					rows: [{ caseId: "N1", status: "passed", evidenceComplete: true }],
					evidence: [],
					complete: true,
				}),
			},
			onToolEvent(fn: any) {
				listener = fn;
				return () => {};
			},
			log() {},
			broadcast() {},
		},
		store: () => s,
		runs: () => runs,
		commitStore(next: any) {
			s = next;
		},
		commitRuns(next: any) {
			runs = next;
		},
	};
	const a = createAutomation(options);
	return {
		cwd,
		a,
		asset,
		options,
		store: () => s,
		runs: () => runs,
		emit: (ev: any) => listener({ phase: "end", cwd, ...ev }),
		init: (extra = {}) =>
			a.call(cwd, { action: "initialize", engine: "ui", targetUrl: "http://localhost:18980/pms/contracts", ...extra }),
		intake: (extra = {}) => a.call(cwd, { action: "import", engine: "ui", assetRef: asset.assetRef, ...extra }),
		bind: (caseId?: string) =>
			a.call(cwd, {
				action: "bind",
				caseId: caseId ?? s.cases[0]?.id,
				engine: "ui",
				assetRef: asset.assetRef,
				nativeCaseId: "N1",
				envId: "e",
			}),
	};
}
it("selects an exact project/environment, returns data without secrets, and persists the channel", async () => {
	const f = fixture();
	await f.a.idle();
	const result = await f.init();
	expect(result).toMatchObject({
		ok: true,
		status: "configured",
		channel: { systemId: "s", envId: "e" },
		parameters: { tenant: "qa" },
		privateParameterKeys: ["token"],
		checks: { network: "not-checked" },
	});
	expect(JSON.stringify(result)).not.toContain("private-value");
	expect(readFileSync(join(f.cwd, "data-space/channels.json"), "utf8")).not.toContain("private-value");
	f.a.dispose();
	const next = createAutomation(f.options);
	await next.idle();
	expect(await next.call(f.cwd, { action: "import", engine: "ui", assetRef: f.asset.assetRef })).toMatchObject({
		imported: 1,
	});
	next.dispose();
});

it("initialization reuses current public dynamic parameters without exposing private values or implying browser readiness", async () => {
	const f = fixture();
	try {
		Object.assign(f.store().envs[0], {
			script: {
				enabled: true,
				steps: [
					{
						url: "/login",
						extract: [
							{ key: "tenant", secret: false },
							{ key: "session", secret: true },
						],
					},
				],
			},
			scriptRun: { ok: true, at: "2026-10-23T00:00:00Z" },
			dynamic: [
				{ key: "tenant", value: "current-tenant", secret: false, expiresAt: "2099-01-01T00:00:00Z" },
				{ key: "session", value: "private-session", secret: true, expiresAt: "2099-01-01T00:00:00Z" },
			],
		});
		const result = await f.init({ mode: "execute" });
		expect(result.parameters).toEqual({ tenant: "current-tenant" });
		expect(result.privateParameterKeys).toEqual(["token", "session"]);
		expect(result.preparation).toMatchObject({
			mode: "execute",
			checkedAt: expect.any(String),
			configuration: { state: "ready" },
			parameters: { state: "ready", dynamic: "reused" },
			network: { state: "unknown" },
			authentication: { state: "unknown" },
			role: { state: "unknown" },
			data: { state: "unknown" },
			privateExecution: { state: "not-ready" },
		});
		expect(JSON.stringify(result)).not.toContain("private-session");
		expect(readFileSync(join(f.cwd, "data-space/channels.json"), "utf8")).not.toContain("current-tenant");
		f.store().envs[0].dynamic[0].value = "latest-tenant";
		expect((await f.init({ mode: "execute" })).parameters.tenant).toBe("latest-tenant");
	} finally {
		f.a.dispose();
	}
});

it("expired or failed dynamic preparation never falls back to the static value of the same key", async () => {
	const f = fixture();
	try {
		Object.assign(f.store().envs[0], {
			script: { enabled: true, steps: [{ url: "/login", extract: [{ key: "tenant", secret: false }] }] },
			dynamic: [{ key: "tenant", value: "expired-tenant", secret: false, expiresAt: "2000-01-01T00:00:00Z" }],
		});
		for (const lastRun of [undefined, { ok: false }]) {
			f.store().envs[0].scriptRun = lastRun;
			const result = await f.init({ mode: "record" });
			expect(result.parameters).toEqual({});
			expect(result.preparation.parameters).toMatchObject({ state: "not-ready", dynamic: "refresh-required" });
			expect(JSON.stringify(result)).not.toContain("expired-tenant");
		}
	} finally {
		f.a.dispose();
	}
});

it("analysis, view and source-only modes do not require environment selection or create channels", async () => {
	const f = fixture();
	try {
		for (const input of [
			{ mode: "analyze" },
			{ mode: "view" },
			{ mode: "new", discovery: "source" },
			{ mode: "record", discovery: "source" },
		]) {
			const result = await f.a.call(f.cwd, { action: "initialize", engine: "ui", ...input });
			expect(result).toMatchObject({
				ok: true,
				status: "not-required",
				preparation: { mode: input.mode, browserRequired: false },
			});
			expect(result.channel).toBeUndefined();
			expect(result.parameters).toBeUndefined();
		}
		expect(() => readFileSync(join(f.cwd, "data-space/channels.json"))).toThrow();
		await f.init();
		const previous = readFileSync(join(f.cwd, "data-space/channels.json"), "utf8");
		await f.a.call(f.cwd, { action: "initialize", engine: "ui", mode: "view" });
		expect(readFileSync(join(f.cwd, "data-space/channels.json"), "utf8")).toBe(previous);
		await expect(f.init({ mode: "unsupported" })).rejects.toThrow(/模式/);
	} finally {
		f.a.dispose();
	}
});

it("secret classification cannot be downgraded by dynamic metadata or reflected public parameters", async () => {
	const f = fixture();
	try {
		f.store().envs[0].params.push({ key: "url", value: "reflected-private-value", secret: false });
		f.store().envs[0].params.push({ key: "redirect", value: "https://example.test/new-private-token", secret: false });
		Object.assign(f.store().envs[0], {
			script: { enabled: true, steps: [{ url: "/login", extract: [{ key: "token", secret: false }] }] },
			dynamic: [{ key: "token", value: "new-private-token", secret: false, expiresAt: "2099-01-01T00:00:00Z" }],
		});
		const result = await f.init();
		expect(result.parameters).toEqual({ tenant: "qa" });
		expect(result.preparation.parameters).toMatchObject({ state: "not-ready", blockedKeys: ["url", "redirect"] });
		expect(result.privateParameterKeys).toContain("token");
		expect(JSON.stringify(result)).not.toContain("new-private-token");
		expect(JSON.stringify(result)).not.toContain("reflected-private-value");
	} finally {
		f.a.dispose();
	}
});

it("archives native features by explicit mapping, retains unclassified cases and queries receipts without writes", async () => {
	const f = fixture();
	await f.a.idle();
	f.store().modules.push({ id: "m", systemId: "s", name: "Contracts" });
	f.store().features.push({ id: "query", moduleId: "m", name: "Query" }, { id: "save", moduleId: "m", name: "Save" });
	f.asset.cases = ["query", "save", "unknown"].map((id) => ({
		...f.asset.cases[0],
		id,
		moduleId: "native",
		featureId: id,
	}));
	const input = { engine: "ui", assetRef: f.asset.assetRef, envId: "e" };
	const featureMappings = ["query", "save"].map((id) => ({
		nativeModuleId: "native",
		nativeFeatureId: id,
		featureId: id,
	}));
	const imported = await f.a.call(f.cwd, { ...input, action: "import", featureMappings });
	expect(imported).toMatchObject({ imported: 3, counts: { new: 3, unclassified: 1, stale: 0 } });
	expect(f.store().cases.find((c: any) => c.nativeSource.nativeCaseId === "query").featureId).toBe("query");
	expect(f.store().cases.find((c: any) => c.nativeSource.nativeCaseId === "save").featureId).toBe("save");
	expect(f.store().cases.find((c: any) => c.nativeSource.nativeCaseId === "unknown").tags).toContain("待归类");
	const before = JSON.stringify(f.store());
	const channelBefore = readFileSync(join(f.cwd, "data-space/channels.json"), "utf8");
	const receipt = await f.a.call(f.cwd, { ...input, action: "archive-status" });
	expect(receipt).toMatchObject({
		assetRef: f.asset.assetRef,
		revision: "v1",
		counts: { existing: 3, unclassified: 1 },
	});
	expect(JSON.stringify(f.store())).toBe(before);
	expect(readFileSync(join(f.cwd, "data-space/channels.json"), "utf8")).toBe(channelBefore);
	const repeated = await f.a.call(f.cwd, { ...input, action: "import", featureMappings });
	expect(repeated).toMatchObject({ imported: 0, duplicate: 3 });
	f.store().features.find((x: any) => x.id === "save").moduleId = "deleted";
	expect(await f.a.call(f.cwd, { ...input, action: "archive-status" })).toMatchObject({
		ok: false,
		counts: { stale: 1 },
	});
	expect(f.store().cases).toHaveLength(3);
	f.a.dispose();
});

it("rejects cross-project native mappings before any directory writes and never relocates historical cases", async () => {
	const f = fixture();
	await f.a.idle();
	f.store().systems.push({ id: "s2", name: "PMS" });
	f.store().envs.push({ ...f.store().envs[0], id: "e2", systemId: "s2" });
	f.store().modules.push({ id: "mine", systemId: "s" }, { id: "other", systemId: "s2" });
	f.store().features.push(
		{ id: "f1", moduleId: "mine", name: "Same" },
		{ id: "f2", moduleId: "mine", name: "Same" },
		{ id: "foreign", moduleId: "other", name: "Same" },
	);
	f.asset.cases[0] = { ...f.asset.cases[0], moduleId: "native", featureId: "same" };
	const input = { action: "import", engine: "ui", envId: "e", assetRef: f.asset.assetRef };
	const map = (featureId: string) => [{ nativeModuleId: "native", nativeFeatureId: "same", featureId }];
	const before = JSON.stringify(f.store());
	await expect(f.a.call(f.cwd, { ...input, featureMappings: map("foreign") })).rejects.toThrow("项目");
	expect(JSON.stringify(f.store())).toBe(before);
	await f.a.call(f.cwd, { ...input, featureMappings: map("f1") });
	expect(await f.a.call(f.cwd, { ...input, featureMappings: map("f2") })).toMatchObject({
		ok: false,
		imported: 0,
		counts: { stale: 1 },
	});
	expect(f.store().cases[0].featureId).toBe("f1");
	f.a.dispose();
});

it("pairs native module and feature IDs and validates mappings without partial intake", async () => {
	const f = fixture();
	await f.a.idle();
	f.store().modules.push({ id: "m", systemId: "s" });
	f.store().features.push({ id: "one", moduleId: "m" }, { id: "two", moduleId: "m" });
	f.asset.cases = ["one", "two"].map((id) => ({ ...f.asset.cases[0], id, moduleId: id, featureId: "shared" }));
	const featureMappings = ["one", "two"].map((id) => ({
		nativeModuleId: id,
		nativeFeatureId: "shared",
		featureId: id,
	}));
	await expect(f.intake({ envId: "e", featureMappings: [...featureMappings, featureMappings[0]] })).rejects.toThrow(
		"重复",
	);
	await expect(
		f.intake({ envId: "e", featureMappings: [{ ...featureMappings[0], nativeModuleId: "missing" }] }),
	).rejects.toThrow("不存在");
	expect(f.store().cases).toHaveLength(0);
	expect(await f.intake({ envId: "e", featureMappings })).toMatchObject({
		classificationComplete: true,
		counts: { new: 2 },
	});
	expect(f.store().cases.map((c: any) => c.featureId)).toEqual(["one", "two"]);
	f.a.dispose();
});
it("counts every archived case even when receipt items are truncated", async () => {
	const f = fixture();
	await f.a.idle();
	f.asset.cases = Array.from({ length: 105 }, (_, i) => ({ ...f.asset.cases[0], id: `N${i}` }));
	const receipt = await f.intake({ envId: "e" });
	expect(receipt).toMatchObject({
		total: 105,
		counts: { new: 105, unclassified: 105 },
		itemsTruncated: true,
		classificationComplete: false,
	});
	expect(receipt.items).toHaveLength(100);
	const before = JSON.stringify(f.store());
	const checked = await f.a.call(f.cwd, {
		action: "archive-status",
		engine: "ui",
		assetRef: f.asset.assetRef,
		envId: "e",
	});
	expect(checked.counts).toMatchObject({ new: 0, existing: 105, pending: 0 });
	expect(JSON.stringify(f.store())).toBe(before);
	f.a.dispose();
});

it("keeps archive-status read-only under plan, delegate, goal review and read-only permissions", () => {
	expect(
		extensionToolDenial(
			"data_space_automation",
			{ action: "archive-status" },
			{
				planMode: true,
				delegateMode: true,
				goalReview: true,
				permission: "read-only",
				uiDisabled: false,
			},
		),
	).toBeUndefined();
	expect(
		extensionToolDenial(
			"data_space_automation",
			{ action: "import" },
			{
				planMode: true,
				delegateMode: true,
				goalReview: true,
				permission: "read-only",
				uiDisabled: false,
			},
		),
	).toBeDefined();
});
it("never guesses among duplicate/default environments or mismatched URL paths", async () => {
	const f = fixture();
	await f.a.idle();
	f.store().envs.push({ ...f.store().envs[0], id: "e2", isDefault: true });
	expect(await f.init()).toMatchObject({ ok: false, status: "ambiguous" });
	expect(await f.init({ envId: "e" })).toMatchObject({ ok: true });
	expect(await f.init({ targetUrl: "http://localhost:18981/pms" })).toMatchObject({ status: "missing-environment" });
	f.store().envs[0].baseUrl = "http://localhost:18980/pms";
	expect(await f.init({ envId: "e", targetUrl: "http://localhost:18980/pms-evil" })).toMatchObject({ ok: false });
	f.a.dispose();
});

it("reads a run once within a sync, but verifies it again on the next request", async () => {
	const f = fixture();
	await f.a.idle();
	await f.init();
	await f.intake();
	await f.bind();
	const originalRead = f.options.host.testing.read;
	let reads = 0;
	f.options.host.testing.read = async (...args: any[]) => {
		reads++;
		return originalRead(...args);
	};
	expect((await f.a.sync(f.cwd, "ui", "r1")).ok).toBe(true);
	expect(reads).toBe(1);
	expect(f.runs().runs).toHaveLength(1);
	expect((await f.a.sync(f.cwd, "ui", "r1")).duplicate).toBe(1);
	expect(reads).toBe(2);
	f.options.host.testing.read = async () => {
		throw new Error("Evidence changed");
	};
	await expect(f.a.sync(f.cwd, "ui", "r1")).rejects.toThrow("Evidence changed");
	expect(f.runs().runs).toHaveLength(1);
	f.a.dispose();
});

it("continues recovery in an independent workspace after a directory listing fails", async () => {
	const f = fixture();
	await f.a.idle();
	await f.init();
	await f.intake();
	await f.bind();
	f.a.dispose();
	const missing = join(f.cwd, "missing");
	f.store().cases.unshift({
		...f.store().cases[0],
		id: "missing-case",
		automation: { ...f.store().cases[0].automation, workspace: missing },
	});
	const scanned: string[] = [];
	f.options.host.testing.list = async (_engine: string, workspace: string) => {
		scanned.push(workspace);
		if (workspace === missing) throw new Error("Missing workspace");
		return ["r1"];
	};
	const recovered = createAutomation(f.options);
	try {
		await recovered.idle();
		expect(scanned).toEqual([missing, f.cwd]);
		expect(f.runs().runs).toHaveLength(1);
		expect(recovered.status().error).toContain("Missing workspace");
	} finally {
		recovered.dispose();
	}
});
it("does not archive generated assets until the user asks for import", async () => {
	const f = fixture();
	await f.a.idle();
	await f.init();
	f.emit({ testAsset: { engine: "ui", reference: f.asset.assetRef } });
	await f.a.idle();
	expect(f.store().cases).toHaveLength(0);
	expect(await f.intake()).toMatchObject({
		imported: 1,
		project: { id: "s", name: "PMS" },
		env: { id: "e" },
		featureName: "UI用例",
	});
	expect(f.store().cases[0]).toMatchObject({ status: "草稿", steps: [{ action: "Search", expect: "Rows match" }] });
	// 入库只写草稿：不自动绑定，重复导入不增行也不覆盖人工编辑。
	expect(f.store().cases[0].automation).toBeNull();
	expect(await f.intake()).toMatchObject({ imported: 0, duplicate: 1 });
	f.store().cases[0].title = "User edit";
	expect(await f.intake()).toMatchObject({ imported: 0, duplicate: 1 });
	expect(f.store().cases[0].title).toBe("User edit");
	expect(f.store().modules).toMatchObject([{ systemId: "s", name: "测试用例" }]);
	expect(f.store().features).toMatchObject([{ name: "UI用例" }]);
	const previous = f.store();
	const normalized = normalizeStore(
		{ ...previous, cases: [{ ...previous.cases[0], nativeSource: { key: "forged" }, automation: null }] },
		previous,
	);
	expect(normalized.cases[0].nativeSource).toEqual(previous.cases[0].nativeSource);
	f.a.dispose();
});
it("imports native results once without granting approval", async () => {
	const f = fixture();
	await f.a.idle();
	await f.init();
	await f.intake();
	await f.bind();
	f.emit({ testRun: { engine: "ui", reference: "r1" } });
	await f.a.idle();
	expect(f.runs().runs).toHaveLength(1);
	await f.a.sync(f.cwd, "ui", "r1");
	expect(f.runs().runs).toHaveLength(1);
	f.store().cases[0].title = "User edit";
	expect(await f.intake()).toMatchObject({ imported: 0, duplicate: 1 });
	expect(f.store().cases[0].title).toBe("User edit");
	expect((await f.a.sync(f.cwd, "ui", "r1")).ok).toBe(false);
	const previous = f.store();
	const normalized = normalizeStore(
		{ ...previous, cases: [{ ...previous.cases[0], nativeSource: { key: "forged" }, automation: null }] },
		previous,
	);
	expect(normalized.cases[0].nativeSource).toEqual(previous.cases[0].nativeSource);
	f.a.dispose();
});
it("blocks changed/deleted environments, preserves asset versions and disconnects new intake", async () => {
	const f = fixture();
	await f.a.idle();
	await f.init();
	await f.intake();
	f.asset.assetRef = { ...f.asset.assetRef, sha256: "b".repeat(64) };
	f.asset.revision = "v2";
	await f.intake();
	expect(f.store().cases).toHaveLength(2);
	f.store().envs[0].baseUrl = "http://localhost:18981";
	await expect(f.intake()).rejects.toThrow("环境已变更");
	await f.a.call(f.cwd, { action: "disconnect", engine: "ui", envId: "e" });
	expect(await f.intake()).toMatchObject({ unmatched: true });
	f.a.dispose();
	await expect(f.init()).rejects.toThrow("停用");
});
it("rejects cross-project destination and respects restricted tool modes", async () => {
	const f = fixture();
	await f.a.idle();
	await expect(f.init({ featureId: "foreign" })).rejects.toThrow("不属于");
	for (const action of ["initialize", "import", "disconnect"]) {
		const state = {
			planMode: true,
			delegateMode: false,
			goalReview: false,
			permission: "read-only",
			uiDisabled: false,
		};
		expect(extensionToolDenial("data_space_automation", { action }, state)).toBeDefined();
	}
	f.a.dispose();
});
it("imports by explicit envId without a channel and blocks mismatched addresses", async () => {
	const f = fixture();
	await f.a.idle();
	expect(await f.intake({ envId: "e" })).toMatchObject({
		imported: 1,
		project: { id: "s", name: "PMS" },
		env: { id: "e" },
	});
	await expect(f.intake({ envId: "missing" })).rejects.toThrow("不存在");
	f.store().envs[0].baseUrl = "http://localhost:18999";
	await expect(f.intake({ envId: "e" })).rejects.toThrow("不一致");
	f.a.dispose();
});
it("persists verified lineage and intake order without rewriting metadata on duplicate import", async () => {
	const f = fixture();
	await f.a.idle();
	f.asset.lineageId = "asset-family";
	await f.intake({ envId: "e" });
	const first = structuredClone(f.store().cases[0].nativeSource);
	expect(first).toMatchObject({
		workspace: f.cwd,
		engine: "ui",
		projectId: "s",
		envId: "e",
		lineageId: "asset-family",
		revision: "v1",
		intakeRevision: 2,
	});
	await f.intake({ envId: "e" });
	expect(f.store().cases[0].nativeSource).toEqual(first);
	f.asset.assetRef = { ...f.asset.assetRef, sha256: "d".repeat(64) };
	f.asset.revision = "older-label";
	await f.intake({ envId: "e" });
	expect(f.store().cases[1].nativeSource.intakeRevision).toBeGreaterThan(first.intakeRevision);
	expect(f.store().cases[0].nativeSource).toEqual(first);
	f.a.dispose();
});

it("keeps one destination per project and engine across renames", async () => {
	const f = fixture();
	await f.a.idle();
	await f.init();
	await f.intake({ moduleName: "自动化回归", featureName: "PMS UI" });
	const feature = f.store().features[0];
	expect(f.store().modules).toMatchObject([{ name: "自动化回归" }]);
	expect(feature).toMatchObject({ name: "PMS UI" });
	// 用户重命名目录：后续导入按记住的目录 ID 继续写入，不按旧名称重建
	feature.name = "已重命名功能";
	f.store().modules[0].name = "已重命名模块";
	f.asset.assetRef = { ...f.asset.assetRef, sha256: "c".repeat(64) };
	f.asset.revision = "v2";
	await f.intake();
	expect(f.store().features).toHaveLength(1);
	expect(f.store().modules).toHaveLength(1);
	expect(f.store().cases.every((c: any) => c.featureId === feature.id)).toBe(true);
	expect(readFileSync(join(f.cwd, "data-space/channels.json"), "utf8")).toContain(feature.id);
	f.a.dispose();
});
it("blocks a deleted destination and refuses cross-project features", async () => {
	const f = fixture();
	await f.a.idle();
	await f.init();
	await f.intake();
	const feature = f.store().features[0],
		module = f.store().modules[0];
	f.store().features = [];
	await expect(f.intake()).rejects.toThrow("已被删除或移动");
	f.store().features = [{ ...feature }];
	f.store().systems.push({ id: "s2", name: "Other" });
	f.store().modules.push({ ...module, id: "m2", systemId: "s2" });
	f.store().features.push({ ...feature, id: "f2", moduleId: "m2" });
	await expect(f.intake({ featureId: "f2" })).rejects.toThrow("不属于所选项目");
	expect(await f.intake({ featureId: feature.id })).toMatchObject({ imported: 0, duplicate: 1 });
	f.a.dispose();
});
it("refuses to bind a draft native asset", async () => {
	const f = fixture();
	await f.a.idle();
	await f.init();
	await f.intake();
	f.asset.executable = false;
	await expect(f.bind()).rejects.toThrow("草稿");
	f.asset.executable = true;
	expect(await f.bind()).toMatchObject({ ok: true, binding: { envId: "e", nativeCaseId: "N1" } });
	f.a.dispose();
});
it("still reads version 1 channel files", async () => {
	const f = fixture();
	await f.a.idle();
	await f.init();
	const saved = JSON.parse(readFileSync(join(f.cwd, "data-space/channels.json"), "utf8"));
	f.a.dispose();
	writeFileSync(join(f.cwd, "data-space/channels.json"), JSON.stringify({ version: 1, channels: saved.channels }));
	const next = createAutomation(f.options);
	await next.idle();
	expect(await next.call(f.cwd, { action: "import", engine: "ui", assetRef: f.asset.assetRef })).toMatchObject({
		imported: 1,
		featureName: "UI用例",
	});
	next.dispose();
});
it("emits creation notices only for successful asset-producing calls", () => {
	const result = {
		details: {
			status: "completed",
			artifact_refs: [{ path: "qa/ui/assets/a/revisions/v1/manifest.json", sha256: "a".repeat(64) }],
		},
	};
	expect(nativeTestAssetCreated("ui_case_design", { request: { operation: "candidate" } }, result, false)?.engine).toBe(
		"ui",
	);
	expect(nativeTestAssetCreated("ui_case_design", { request: { operation: "check" } }, result, false)).toBeUndefined();
	expect(
		nativeTestAssetCreated("ui_case_design", { request: { operation: "candidate" } }, result, true),
	).toBeUndefined();
});
it("archives, binds, routes and syncs a UI page inside the explicitly selected environment", async () => {
	const f = fixture();
	await f.a.idle();
	f.store().envs[0].baseUrl = "http://localhost:18980/pms";
	f.asset.environment.baseUrl = "http://localhost:18980/pms/OperationContract";
	expect(await f.intake({ envId: "e" })).toMatchObject({ imported: 1 });
	await f.bind();
	expect(await f.a.call(f.cwd, { action: "route", caseId: f.store().cases[0].id })).toMatchObject({ ok: true });
	expect(await f.a.sync(f.cwd, "ui", "r1")).toMatchObject({ imported: 1, complete: true });
	f.a.dispose();
});
it.each([
	"http://localhost:18981/pms/contracts",
	"https://localhost:18980/pms/contracts",
	"http://other.test:18980/pms/contracts",
	"http://localhost:18980/pms-other/contracts",
	"http://localhost:18980/admin",
])("rejects a native UI target outside the selected origin/path: %s", async (target) => {
	const f = fixture();
	await f.a.idle();
	f.store().envs[0].baseUrl = "http://localhost:18980/pms";
	f.asset.environment.baseUrl = target;
	await expect(f.intake({ envId: "e" })).rejects.toThrow("地址与原生用例目标不一致");
	expect(f.store().cases).toHaveLength(0);
	f.a.dispose();
});
