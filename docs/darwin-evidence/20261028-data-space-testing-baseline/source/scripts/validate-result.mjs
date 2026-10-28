/** Offline handoff consistency check; does not verify evidence bytes or write application data. */
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" && v.trim().length > 0;
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const verdicts = ["通过", "失败", "阻塞", "跳过", "取消", "未执行", "不稳定", "未知"];
const syncStates = ["new", "existing", "pending", "unmatched", "stale", "failed"];
const reference = (v) => text(v) || (object(v) && text(v.path) && /^[a-f0-9]{64}$/i.test(v.sha256));

export function validateResult(value) {
	const errors = [],
		warnings = [];
	const check = (ok, path, reason) => {
		if (!ok) errors.push(`${path}: ${reason}`);
	};
	if (!object(value)) return { ok: false, errors: ["$: expected one result object"], warnings };
	for (const field of [
		"format",
		"context",
		"origin",
		"native",
		"results",
		"evidence",
		"evidenceComplete",
		"reportReview",
		"writeback",
		"gaps",
	])
		check(Object.hasOwn(value, field), field, "missing field");
	check(value.format === "data-space-result/v1", "format", "unsupported format");
	const results = Array.isArray(value.results) ? value.results : [];
	const gaps = Array.isArray(value.gaps) ? value.gaps : [];
	check(Array.isArray(value.results), "results", "expected array");
	check(Array.isArray(value.gaps), "gaps", "expected array");
	gaps.forEach((g, i) =>
		check(object(g) && (g.case === null || text(g.case)) && text(g.reason), `gaps[${i}]`, "expected case and reason"),
	);
	const explained = (id) => gaps.some((g) => object(g) && (g.case === null || g.case === id) && text(g.reason));
	const known = (v, path, id = null) =>
		check(text(v) || (v === null && explained(id)), path, "expected identity or null with a gap");
	const context = object(value.context) ? value.context : {};
	check(object(value.context), "context", "expected object");
	known(context.workspace, "context.workspace");
	for (const field of ["project", "environment"]) {
		const identity = context[field];
		if (identity === null) check(explained(null), `context.${field}`, "unknown identity needs a gap");
		else {
			check(object(identity), `context.${field}`, "expected identity object or null");
			known(identity?.id, `context.${field}.id`);
			known(identity?.name, `context.${field}.name`);
		}
	}
	check(["native", "observed", null].includes(value.origin), "origin", "unsupported origin");
	if (value.origin === null) check(results.length === 0, "results", "no results without an observation origin");
	const native = object(value.native) ? value.native : {};
	if (value.origin === "native") {
		check(object(value.native), "native", "native origin needs native references");
		check(["ui", "api"].includes(native.engine), "native.engine", "expected ui/api");
		for (const field of ["assetRef", "runRef"])
			check(
				reference(native[field]) || (native[field] === null && explained(null)),
				`native.${field}`,
				"expected native reference or explained null",
			);
		known(native.runId, "native.runId");
		check(native.parentRunId === null || text(native.parentRunId), "native.parentRunId", "expected parent ID or null");
	} else check(value.native === null, "native", "non-native origin needs null");
	const seen = new Set();
	results.forEach((r, i) => {
		const path = `results[${i}]`;
		if (!object(r)) {
			check(false, path, "expected object");
			return;
		}
		check(text(r.case), `${path}.case`, "expected case identity; unrecorded items belong in gaps");
		check(!seen.has(r.case), `${path}.case`, "duplicate case within one batch");
		seen.add(r.case);
		check(verdicts.includes(r.verdict), `${path}.verdict`, "unsupported verdict");
		check(typeof r.note === "string", `${path}.note`, "expected observed note");
		if (value.origin === "native") {
			check(text(r.nativeCaseId), `${path}.nativeCaseId`, "missing native case ID");
			known(r.featureId, `${path}.featureId`, r.case);
			known(r.caseVersion, `${path}.caseVersion`, r.case);
		}
	});
	check(Array.isArray(value.evidence), "evidence", "expected array");
	(Array.isArray(value.evidence) ? value.evidence : []).forEach((e, i) =>
		check(
			object(e) &&
				text(e.path) &&
				((value.origin !== "native" && e.sha256 === undefined) || /^[a-f0-9]{64}$/i.test(e.sha256)),
			`evidence[${i}]`,
			"expected evidence reference, with digest for native evidence",
		),
	);
	check([true, false, null].includes(value.evidenceComplete), "evidenceComplete", "expected boolean or null");
	if (value.evidenceComplete === true)
		check(value.evidence?.length > 0, "evidenceComplete", "cannot claim complete evidence with no references");
	const writeback = object(value.writeback) ? value.writeback : {};
	check(object(value.writeback), "writeback", "expected object");
	check(["native-sync", "ai-record", "none"].includes(writeback.method), "writeback.method", "unsupported method");
	check(
		["confirmed", "partial", "unknown", "not-requested", "blocked"].includes(writeback.status),
		"writeback.status",
		"unsupported status",
	);
	check(Object.hasOwn(writeback, "receipt"), "writeback.receipt", "missing receipt or explicit null");
	if (writeback.method === "none")
		check(writeback.status !== "confirmed" && writeback.receipt === null, "writeback", "no write cannot be confirmed");
	if (writeback.status === "confirmed")
		check(object(writeback.receipt), "writeback.receipt", "confirmation needs a receipt");
	if (writeback.method === "native-sync" && object(writeback.receipt)) {
		const receipt = writeback.receipt,
			counts = receipt.counts;
		check(value.origin === "native", "writeback.method", "native sync needs native origin");
		check(
			(receipt.parentRunId || null) === native.parentRunId,
			"writeback.receipt.parentRunId",
			"parent batch does not match",
		);
		for (const [field, expected] of [
			["workspace", context.workspace],
			["engine", native.engine],
			["runId", native.runId],
			["runRef", native.runRef],
			["assetRef", native.assetRef],
		])
			check(isDeepStrictEqual(receipt[field], expected), `writeback.receipt.${field}`, "does not match this batch");
		check(
			object(counts) && syncStates.every((s) => count(counts[s])),
			"writeback.receipt.counts",
			"expected all six sync counters",
		);
		if (object(counts)) {
			check(
				count(receipt.total) && syncStates.reduce((sum, s) => sum + (counts[s] ?? NaN), 0) === receipt.total,
				"writeback.receipt.total",
				"sync counters do not equal total",
			);
			check(
				receipt.imported === counts.new && receipt.duplicate === counts.existing,
				"writeback.receipt",
				"imported/duplicate disagree with counters",
			);
			const complete = receipt.total > 0 && counts.new + counts.existing === receipt.total;
			check(receipt.complete === complete, "writeback.receipt.complete", "contradicts sync counters");
		}
		const items = Array.isArray(receipt.items) ? receipt.items : [];
		check(Array.isArray(receipt.items), "writeback.receipt.items", "expected per-case receipts");
		items.forEach((item, i) => {
			if (!object(item)) {
				check(false, `writeback.receipt.items[${i}]`, "expected object");
				return;
			}
			check(syncStates.includes(item.status), `writeback.receipt.items[${i}].status`, "unsupported sync state");
		});
		if (!receipt.itemsTruncated && object(counts)) {
			check(items.length === receipt.total, "writeback.receipt.items", "missing per-case receipts");
			for (const state of syncStates)
				check(
					items.filter((item) => item?.status === state).length === counts[state],
					`writeback.receipt.counts.${state}`,
					"does not match item states",
				);
		} else warnings.push("Receipt item list is truncated; full per-case reconciliation remains unverified.");
		for (const r of results.filter(object)) {
			const item = items.find((item) => object(item) && item.caseId === r.case && item.nativeCaseId === r.nativeCaseId);
			if (!item) {
				check(
					writeback.status !== "confirmed" && explained(r.case),
					`results.${r.case}`,
					"no matching sync item; retain a gap",
				);
				continue;
			}
			if (item.projectId != null)
				check(item.projectId === context.project?.id, `results.${r.case}.projectId`, "cross-project receipt");
			if (item.envId != null)
				check(item.envId === context.environment?.id, `results.${r.case}.envId`, "cross-environment receipt");
			for (const field of ["featureId", "caseVersion"])
				if (item[field] != null)
					check(item[field] === r[field], `results.${r.case}.${field}`, "does not match sync receipt");
			if (item.verdict != null)
				check(item.verdict === r.verdict, `results.${r.case}.verdict`, "does not match host projection");
			if (writeback.status === "confirmed")
				check(
					text(item.projectId) && text(item.envId) && text(context.project?.id) && text(context.environment?.id),
					`results.${r.case}`,
					"confirmation needs known project and environment identities",
				);
			if (writeback.status === "confirmed")
				check(
					["new", "existing"].includes(item.status) && text(item.resultId),
					`results.${r.case}`,
					"not confirmed in native ledger",
				);
		}
		if (writeback.status === "confirmed") {
			check(receipt.complete === true, "writeback.status", "incomplete sync cannot be confirmed");
			check(
				reference(native.assetRef) && reference(native.runRef) && text(native.runId),
				"native",
				"confirmation needs known asset and run references",
			);
		}
	}
	if (value.summary !== undefined) {
		const summary = value.summary;
		check(object(summary), "summary", "expected object");
		if (object(summary)) {
			check(["case", "instance"].includes(summary.unit) && text(summary.scope), "summary", "expected unit and scope");
			check(
				object(summary.counts) && verdicts.every((v) => count(summary.counts[v])) && count(summary.unresolved),
				"summary.counts",
				"expected eight counters and unresolved",
			);
			if (object(summary.counts)) {
				check(
					summary.total === null ||
						(count(summary.total) &&
							verdicts.reduce((sum, v) => sum + (summary.counts[v] ?? NaN), 0) + summary.unresolved === summary.total),
					"summary.total",
					"counters do not equal total",
				);
				if (summary.unit === "case")
					for (const verdict of verdicts)
						check(
							results.filter((r) => r?.verdict === verdict).length === summary.counts[verdict],
							`summary.counts.${verdict}`,
							"does not match delivered cases",
						);
				else
					warnings.push(
						"Instance counts require native instance evidence; this case-level check does not verify them.",
					);
			}
		}
	}
	warnings.push(
		"Consistency only: evidence bytes, independent review, live ownership and model adherence are not verified.",
	);
	return { ok: errors.length === 0, errors, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		if (process.argv.length !== 3) throw new Error("Usage: node validate-result.mjs <delivery.json>");
		const input = JSON.parse(await readFile(process.argv[2], "utf8"));
		const reports = (Array.isArray(input) ? input : [input]).map(validateResult);
		console.log(JSON.stringify({ ok: reports.length > 0 && reports.every((r) => r.ok), reports }, null, 2));
		process.exitCode = reports.length > 0 && reports.every((r) => r.ok) ? 0 : 1;
	} catch {
		console.error("Unable to validate delivery: supply one readable JSON file using the documented format.");
		process.exitCode = 1;
	}
}
