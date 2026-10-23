import { expect, it } from "vitest";
import { validateResult } from "../../.pi/skills/data-space-testing/scripts/validate-result.mjs";

function delivery(): any {
	const item = {
		caseId: "c1",
		nativeCaseId: "C1",
		projectId: "p1",
		envId: "e1",
		featureId: "f1",
		caseVersion: "v1",
		status: "existing",
		resultId: "r1",
		verdict: "通过",
	};
	const counts = { new: 0, existing: 1, pending: 0, unmatched: 0, stale: 0, failed: 0 };
	return {
		format: "data-space-result/v1",
		context: {
			workspace: "/synthetic",
			project: { id: "p1", name: "Synthetic" },
			environment: { id: "e1", name: "Synthetic" },
		},
		origin: "native",
		native: {
			engine: "ui",
			assetRef: { path: "manifest.json", sha256: "a".repeat(64) },
			runRef: { path: "run.json", sha256: "b".repeat(64) },
			runId: "run1",
			parentRunId: null,
		},
		results: [
			{
				case: "c1",
				nativeCaseId: "C1",
				featureId: "f1",
				caseVersion: "v1",
				verdict: "通过",
				note: "Synthetic evidence",
			},
		],
		evidence: [{ path: "report.json", sha256: "c".repeat(64) }],
		evidenceComplete: true,
		reportReview: null,
		writeback: {
			method: "native-sync",
			status: "confirmed",
			receipt: {
				workspace: "/synthetic",
				engine: "ui",
				assetRef: { path: "manifest.json", sha256: "a".repeat(64) },
				runRef: { path: "run.json", sha256: "b".repeat(64) },
				runId: "run1",
				complete: true,
				imported: 0,
				duplicate: 1,
				total: 1,
				counts,
				items: [item],
				itemsTruncated: false,
			},
		},
		gaps: [],
		summary: {
			unit: "case",
			scope: "本批全部",
			total: 1,
			counts: { 通过: 1, 失败: 0, 阻塞: 0, 跳过: 0, 取消: 0, 未执行: 0, 不稳定: 0, 未知: 0 },
			unresolved: 0,
		},
	};
}
it("accepts a coherent native delivery and stays read-only", () => {
	const input = delivery(),
		before = JSON.stringify(input);
	expect(validateResult(input)).toMatchObject({ ok: true, errors: [] });
	expect(JSON.stringify(input)).toBe(before);
});
it("rejects missing required fields, project/identity mismatches and stale revisions", () => {
	for (const mutate of [
		(d: any) => delete d.context,
		(d: any) => (d.context.project.id = "other"),
		(d: any) => (d.context.environment.id = "other"),
		(d: any) => (d.native.runId = "other"),
		(d: any) => (d.native.parentRunId = "other"),
		(d: any) => (d.native.assetRef.sha256 = "d".repeat(64)),
		(d: any) => (d.results[0].featureId = "other"),
		(d: any) => (d.results[0].caseVersion = "other"),
	]) {
		const d = delivery();
		mutate(d);
		expect(validateResult(d).ok).toBe(false);
	}
});
it("rejects contradictory verdicts, counters, synchronization and evidence claims", () => {
	for (const mutate of [
		(d: any) => (d.results[0].verdict = "失败"),
		(d: any) => (d.summary.counts.通过 = 2),
		(d: any) => (d.writeback.receipt.counts.existing = 0),
		(d: any) => (d.writeback.receipt.items[0].status = "pending"),
		(d: any) => (d.writeback.receipt.complete = false),
		(d: any) => d.results.push({ ...d.results[0] }),
		(d: any) => (d.evidence = []),
		(d: any) => (d.writeback.receipt = null),
	]) {
		const d = delivery();
		mutate(d);
		expect(validateResult(d).ok).toBe(false);
	}
});
it("preserves all eight observed states instead of reducing them to pass/fail", () => {
	for (const verdict of ["通过", "失败", "阻塞", "跳过", "取消", "未执行", "不稳定", "未知"]) {
		const d = delivery();
		d.results[0].verdict = verdict;
		d.writeback.receipt.items[0].verdict = verdict;
		d.summary.counts.通过 = 0;
		d.summary.counts[verdict] = 1;
		expect(validateResult(d).ok).toBe(true);
	}
});
it("accepts explained unknowns and partial sync without allowing false confirmation", () => {
	const d = delivery();
	d.results[0].featureId = null;
	d.results[0].caseVersion = null;
	d.gaps = [{ case: "c1", reason: "Mapping not confirmed" }];
	d.writeback.status = "partial";
	d.writeback.receipt.items = [];
	d.writeback.receipt.itemsTruncated = true;
	expect(validateResult(d).ok).toBe(true);
	d.writeback.status = "confirmed";
	expect(validateResult(d).ok).toBe(false);
});
it("does not confuse whole-run association counters with a delivered project subset", () => {
	const d = delivery(),
		r = d.writeback.receipt;
	r.items.push({ ...r.items[0], caseId: "another", projectId: "another", envId: "another", resultId: "r2" });
	r.total = 2;
	r.counts.existing = 2;
	r.duplicate = 2;
	expect(validateResult(d).ok).toBe(true);
});
it("accepts an explicit no-execution gap report and rejects malformed inputs without throwing", () => {
	const input = {
		format: "data-space-result/v1",
		context: { workspace: null, project: null, environment: null },
		origin: null,
		native: null,
		results: [],
		evidence: [],
		evidenceComplete: null,
		reportReview: null,
		writeback: { method: "none", status: "not-requested", receipt: null },
		gaps: [{ case: null, reason: "Environment unknown; not executed" }],
	};
	expect(validateResult(input).ok).toBe(true);
	for (const malformed of [
		null,
		[],
		false,
		{},
		{ ...input, results: [null], gaps: [null], summary: [] },
		{ ...input, writeback: { method: "native-sync", receipt: { items: [null], counts: {} } } },
	])
		expect(() => validateResult(malformed)).not.toThrow();
});

it("returns diagnostics for malformed nested receipt/result combinations", () => {
	const d = delivery();
	for (const entry of [null, {}, [], false, "unexpected"]) {
		d.results = [entry];
		d.writeback.receipt.items = [entry];
		expect(() => validateResult(d)).not.toThrow();
		expect(validateResult(d).ok).toBe(false);
	}
});

it("does not confirm a native writeback with explained but unknown run references", () => {
	const d = delivery();
	d.gaps = [{ case: null, reason: "Run identity unknown" }];
	d.native.runRef = null;
	d.writeback.receipt.runRef = null;
	expect(validateResult(d).ok).toBe(false);
	d.writeback.status = "unknown";
	expect(validateResult(d).ok).toBe(true);
});

it("normalizes an explicitly empty native parent ID to no parent in the handoff", () => {
	const d = delivery();
	d.writeback.receipt.parentRunId = "";
	expect(validateResult(d).ok).toBe(true);
});

it("keeps native confirmation blocked when project ownership is unknown", () => {
	const d = delivery();
	d.gaps = [{ case: null, reason: "Ownership unknown" }];
	d.context.project.id = null;
	d.writeback.receipt.items[0].projectId = null;
	expect(validateResult(d).ok).toBe(false);
	d.writeback.status = "unknown";
	expect(validateResult(d).ok).toBe(true);
});
