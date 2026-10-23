import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
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
		intake: () => a.call(cwd, { action: "import", engine: "ui", assetRef: asset.assetRef }),
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
it("automatically imports candidates and native results once without overwriting edits or granting approval", async () => {
	const f = fixture();
	await f.a.idle();
	await f.init();
	f.emit({ testAsset: { engine: "ui", reference: f.asset.assetRef } });
	await f.a.idle();
	expect(f.store().cases).toHaveLength(1);
	expect(f.store().cases[0]).toMatchObject({ status: "草稿", steps: [{ action: "Search", expect: "Rows match" }] });
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
