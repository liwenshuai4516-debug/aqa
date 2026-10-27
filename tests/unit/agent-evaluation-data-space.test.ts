import { afterEach, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataSpaceFixture } from "../fixtures/agent-evaluation/data-space.mjs";
import { engineFixture, ref } from "../fixtures/agent-evaluation/engine.mjs";
import { F03 } from "../../plugins/agent-evaluation/evaluators/data-space.mjs";
import { syncProjectReport } from "../../plugins/agent-evaluation/project-sync.mjs";
import { recordsOf } from "../../plugins/agent-evaluation/collect.mjs";
import { extensionToolEffect } from "../../server/extension-tool-policy";
const cleanup: Array<() => void> = [];
afterEach(() => {
	vi.restoreAllMocks();
	cleanup
		.splice(0)
		.reverse()
		.forEach((fn) => fn());
});
async function fixture() {
	const f = await dataSpaceFixture();
	cleanup.push(f.cleanup);
	return f;
}
function scorer(o: any, origin = "harness-observed") {
	const c = {
		conditionId: "intake",
		spaceId: o.projectRef.spaceId,
		projectId: o.projectRef.projectId,
		environmentId: o.environmentRef.environmentId,
		environmentRevision: o.environmentRef.revision,
		batchRevision: o.batchRef.revision,
		batchIdentity: o.batchRef.identity,
		nativeCaseIds: o.items.map((r: any) => r.nativeCaseId),
	};
	const f = engineFixture({
		rules: [F03],
		conditions: [{ id: "intake", ruleRef: "F03@1" }],
		configs: { F03: { checks: [c] } },
		evidence: [{ kind: "data-space-observation", value: o, origin, data: { producer: "data-space-reader-v1" } }],
	});
	cleanup.push(f.cleanup);
	return f;
}
it("AC32 reconciles all 75 first/repeated intakes through original receipts without re-importing on scoring", async () => {
	const f = await fixture();
	const before = await f.observe();
	expect(before.items).toHaveLength(75);
	expect(before.items.every((r: any) => r.status === "missing")).toBe(true);
	expect(await f.intake()).toMatchObject({ imported: 75, total: 75 });
	const ids = f.state().cases.map((r: any) => r.id);
	const o = await f.observe();
	expect(o.items.every((r: any) => r.status === "present")).toBe(true);
	const s = scorer(o),
		count = f.commits();
	const first = await s.engine.evaluate(s.context, s.args);
	expect(first.data.findings[0]).toMatchObject({ verdict: "pass", metrics: { expected: 75, verified: 75 } });
	expect((await s.engine.evaluate(s.context, { ...s.args, requestId: "rescore" })).data.findings[0].verdict).toBe(
		"pass",
	);
	expect(f.commits()).toBe(count);
	expect(await f.intake()).toMatchObject({ imported: 0, total: 75, duplicate: 75 });
	expect(f.state().cases.map((r: any) => r.id)).toEqual(ids);
});
it("AC32 detects partial failure, wrong ownership and missing readback; declarations do not pass", async () => {
	const f = await fixture();
	await f.intake();
	const originals = structuredClone(f.state().cases);
	f.state().cases.splice(50);
	let o = await f.observe();
	let s = scorer(o);
	expect((await s.engine.evaluate(s.context, s.args)).data.findings[0]).toMatchObject({
		verdict: "fail",
		metrics: { verified: 50 },
	});
	f.state().cases.splice(0, 50, ...originals);
	const module = f.state().modules[0];
	module.systemId = "p2";
	o = await f.observe();
	s = scorer(o);
	expect((await s.engine.evaluate(s.context, s.args)).data.findings[0]).toMatchObject({
		verdict: "fail",
		metrics: { verified: 0 },
	});
	module.systemId = "p1";
	o = await f.observe();
	s = scorer(o, "target-reported");
	expect((await s.engine.evaluate(s.context, s.args)).data.findings[0].verdict).toBe("inconclusive");
	vi.spyOn(f.host.testing, "inspect").mockRejectedValue(new Error("Readback missing"));
	await expect(f.observe()).rejects.toThrow(/Readback missing/);
});
it("AC32 receipt loss reconciles existing intake; stale versions and other batch identities remain unknown", async () => {
	const f = await fixture();
	await f.intake(); // response deliberately discarded
	f.restart();
	expect((await f.observe()).items.every((r: any) => r.status === "present")).toBe(true);
	expect(f.state().cases).toHaveLength(75);
	f.asset.revision = "batch-v2";
	const o = await f.observe(),
		s = scorer(o);
	expect((await s.engine.evaluate(s.context, s.args)).data.findings[0].verdict).toBe("inconclusive");
	const good = structuredClone(o);
	good.items.forEach((r: any) => (r.status = "present"));
	const other = scorer(good);

	const item = other.items[0];
	expect(item.data.producer).toBe("data-space-reader-v1");
	const checks = {
		checks: [
			{
				conditionId: "x",
				spaceId: o.projectRef.spaceId,
				projectId: o.projectRef.projectId,
				environmentId: o.environmentRef.environmentId,
				environmentRevision: o.environmentRef.revision,
				batchRevision: o.batchRef.revision,
				batchIdentity: "another",
				nativeCaseIds: ["N1"],
			},
		],
	};
	expect(
		F03.evaluate({}, { evidence: [{ ref: ref(item), data: item.data, value: o }], conflicting: [] }, checks)[0].verdict,
	).toBe("inconclusive");
});
it("AC33 keeps project identity across rename and report indexes idempotent across restart and receipt loss", async () => {
	const f = await fixture();
	await f.intake();
	const o = await f.observe(),
		s = scorer(o),
		report = await s.engine.evaluate(s.context, s.args);
	let writes = 0,
		drop = true,
		denied = false;
	const service: any = {
		store: s.store,
		closed: false,
		host: {
			evaluationDataSpace: async (_b: any, q: any) => {
				if (denied) throw Object.assign(new Error("Read only"), { code: "PERMISSION_DENIED" });
				if (q.action === "authorizeIndex") return { authorized: true };
				const r = await f.call(q);
				if (q.action === "syncIndex") {
					writes++;
					if (drop) {
						drop = false;
						throw new Error("Dropped receipt");
					}
				}
				return r;
			},
		},
	};
	const sync = (id: string, query = false) =>
		syncProjectReport(service, s.context, {}, ref(report), o.projectRef, id, query);
	const before = f.commits();
	expect(await sync("lost")).toMatchObject({ status: "failed" });
	expect(writes).toBe(1);
	const count = recordsOf(s.store, s.context, "evidence").length;
	f.restart();
	expect(await sync("query", true)).toMatchObject({ status: "synced" });
	expect(recordsOf(s.store, s.context, "evidence")).toHaveLength(count);
	expect(await sync("lost")).toMatchObject({ status: "synced" });
	expect(await sync("lost")).toMatchObject({ status: "synced" });
	expect(writes).toBe(1);
	f.state().systems[0].name = "Renamed project";
	expect((await f.call({ action: "describe" })).projects[0].projectRef).toEqual(o.projectRef);
	expect(await sync("rename", true)).toMatchObject({ status: "synced" });
	denied = true;
	const recordCount = recordsOf(s.store, s.context, "evidence").length;
	await expect(sync("denied")).rejects.toThrow(/Read only/);
	expect(recordsOf(s.store, s.context, "evidence")).toHaveLength(recordCount);
	expect(await sync("unavailable", true)).toMatchObject({ status: "failed", error: { code: "PERMISSION_DENIED" } });
	expect(f.commits()).toBe(before);
	expect(f.runs().runs).toHaveLength(0);
});
it("AC33 rejects conflicting or corrupt report indexes without replacing originals; queries are read only", async () => {
	const f = await fixture();
	const q = {
		action: "syncIndex",
		projectRef: f.query.projectRef,
		evaluationId: "report",
		reportDigest: "a".repeat(64),
	};
	const result = await f.call(q),
		path = join(f.directory, "data-space/evaluation-index.json"),
		original = readFileSync(path, "utf8");
	expect(await f.call(q)).toEqual(result);
	await expect(f.call({ ...q, reportDigest: "b".repeat(64) })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
	await f.call({ ...q, action: "indexStatus" });
	await f.call({ action: "describe" });
	expect(readFileSync(path, "utf8")).toBe(original);
	writeFileSync(path, '{"version":999}');
	await expect(f.call(q)).rejects.toMatchObject({ code: "STORE_CORRUPT" });
	expect(readFileSync(path, "utf8")).toBe('{"version":999}');
	expect(extensionToolEffect("agent_evaluation", { action: "projectReportStatus" })).toBe("query");
	expect(extensionToolEffect("agent_evaluation", { action: "syncProjectReport" })).toBe("asset-write");
});

it("requires a new explicit retry after a confirmed missing failed index and never replays business writes", async () => {
	const f = await fixture();
	await f.intake();
	const o = await f.observe(),
		s = scorer(o),
		report = await s.engine.evaluate(s.context, s.args);
	let writes = 0,
		fail = true;
	const service: any = {
		store: s.store,
		closed: false,
		host: {
			evaluationDataSpace: async (_b: any, q: any) => {
				if (q.action === "authorizeIndex") return { authorized: true };
				if (q.action === "syncIndex") {
					writes++;
					if (fail) throw Object.assign(new Error("Disk write failed"), { code: "IO_ERROR" });
				}
				return f.call(q);
			},
		},
	};
	const sync = (id: string, query = false) =>
		syncProjectReport(service, s.context, {}, ref(report), o.projectRef, id, query);
	const before = f.commits();
	expect(await sync("write-failed")).toMatchObject({ status: "failed", error: { code: "IO_ERROR" } });
	expect(await sync("write-failed")).toMatchObject({ status: "failed", remoteStatus: "missing" });
	expect(writes).toBe(1);
	fail = false;
	expect(await sync("explicit-retry")).toMatchObject({ status: "synced" });
	expect(writes).toBe(2);
	expect(f.commits()).toBe(before);
	f.state().systems.splice(0, 1);
	expect(await sync("deleted-source", true)).toMatchObject({ status: "failed", error: { code: "PERMISSION_DENIED" } });
});

it("binds environment revisions and optional run references without writing native results", async () => {
	const f = await fixture();
	await f.intake();
	const before = f.commits(),
		o = await f.call({ ...f.query, action: "observe", runRef: "r1" });
	expect(o.run).toMatchObject({ runId: "r1", runRef: "r1", complete: false });
	expect(f.commits()).toBe(before);
	expect(f.runs().runs).toHaveLength(0);
	await expect(
		f.call({ ...f.query, action: "observe", environmentRef: { ...f.query.environmentRef, revision: "old" } }),
	).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
	const environment = f.state().envs[0];
	environment.params = [{ key: "tenant", value: "isolated-tenant", secret: false }];
	environment.updatedAt = "2026-10-27T10:00:00.000Z";
	await expect(f.observe()).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
	const changed = await f.call({ action: "describe" });
	expect(changed.projects[0].environments[0].revision).not.toBe(o.environmentRef.revision);
	expect(JSON.stringify(changed)).not.toContain("isolated-tenant");
	f.state().envs[0].systemId = "p2";
	await expect(f.observe()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});
