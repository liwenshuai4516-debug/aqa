/** Dated Data Space reconciliation only; no business writes or retroactive claims about completion time. */
import { Type as T } from "typebox";
import { define, checks, text, finding, noChecks, trustworthy } from "./common.mjs";
export const F03 = define(
	"F03",
	checks({
		spaceId: text,
		projectId: text,
		environmentId: text,
		environmentRevision: text,
		batchRevision: text,
		batchIdentity: text,
		nativeCaseIds: T.Array(text, { minItems: 1, maxItems: 100, uniqueItems: true }),
	}),
	(_contract, view, config) => {
		if (!config.checks.length) return noChecks("F03");
		return config.checks.map((check) => {
			const items = view.evidence.filter(
				(e) =>
					e.data.producer === "data-space-reader-v1" &&
					e.data.kind === "data-space-observation" &&
					e.value?.projectRef?.spaceId === check.spaceId &&
					e.value?.projectRef?.projectId === check.projectId &&
					e.value?.environmentRef?.environmentId === check.environmentId &&
					e.value?.batchRef?.revision === check.batchRevision &&
					e.value?.batchRef?.identity === check.batchIdentity,
			);
			const valid = items.filter(
				(e) =>
					trustworthy(e, view) &&
					e.value.complete === true &&
					Array.isArray(e.value.items) &&
					e.value.environmentRef.revision === check.environmentRevision &&
					Number.isFinite(Date.parse(e.value.observedAt)),
			);
			if (valid.length !== 1)
				return finding(
					check.conditionId,
					"inconclusive",
					items,
					"A unique authorized, complete and dated Data Space observation is required",
					["data-space-receipt-and-readback"],
				);
			const observed = valid[0].value;
			const rows = check.nativeCaseIds.map((id) => observed.items.filter((r) => r.nativeCaseId === id));
			if (rows.some((r) => r.length !== 1))
				return finding(
					check.conditionId,
					"inconclusive",
					items,
					"Selected native cases are not completely enumerated",
					["complete-native-case-enumeration"],
				);
			if (rows.some(([r]) => r.status === "stale"))
				return finding(
					check.conditionId,
					"inconclusive",
					items,
					"The imported case version differs from this frozen batch",
					["matching-intake-version"],
				);
			const good = rows.filter(
				([r]) =>
					r.status === "present" &&
					r.caseId &&
					r.projectId === check.projectId &&
					Number.isInteger(r.intakeRevision) &&
					r.intakeRevision > 0,
			).length;
			return finding(
				check.conditionId,
				good === check.nativeCaseIds.length ? "pass" : "fail",
				items,
				"Count and project ownership reconciled at observation time; task-time completion is not inferred",
				[],
				{
					expected: check.nativeCaseIds.length,
					verified: good,
					observedAt: observed.observedAt,
					projectRef: observed.projectRef,
					environmentRef: observed.environmentRef,
					batchRef: observed.batchRef,
					storeRevision: observed.storeRevision,
				},
			);
		});
	},
);
