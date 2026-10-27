/** Durable report-index attempts. Reconciliation never imports cases or runs an Agent. */
import { digest, requireValue } from "./schema.mjs";
import { readEvidenceJson, recordsOf } from "./collect.mjs";
const ref = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
export async function syncProjectReport(service, context, binding, reportRef, projectRef, requestId, queryOnly) {
	const store = service.store,
		report = store.get(context, reportRef);
	requireValue(report.kind === "evaluations", "INVALID_INPUT", "A frozen evaluation report is required");
	requireValue(
		projectRef &&
			Object.keys(projectRef).sort().join(",") === "projectId,spaceId" &&
			[projectRef.spaceId, projectRef.projectId].every((v) => typeof v === "string" && v.length > 0 && v.length <= 256),
		"INVALID_INPUT",
		"Explicit stable project identity required",
	);
	const snapshot = store.get(context, report.data.snapshotRef),
		attemptRef = snapshot.data.attemptRefs[0];
	requireValue(attemptRef, "EVIDENCE_GAP", "Report attempt unavailable");
	const identity = { evaluationId: report.id, reportDigest: report.digest, projectRef },
		operation = digest(identity);
	const prior = recordsOf(store, context, "evidence")
		.filter((r) => r.data.producer === "project-report-sync-v1" && r.data.sourceEventId === operation)
		.sort((a, b) => Number(b.data.sourceRevision) - Number(a.data.sourceRevision))[0];
	const previous = prior ? readEvidenceJson(store, context, ref(prior)) : undefined;
	const call = async (action) => {
		requireValue(
			!service.closed && typeof service.host.evaluationDataSpace === "function",
			"CAPABILITY_UNAVAILABLE",
			"Data Space interface unavailable",
		);
		const result = await service.host.evaluationDataSpace(binding, { ...identity, action });
		requireValue(!service.closed, "CAPABILITY_UNAVAILABLE", "Evaluation plugin stopped");
		return result;
	};
	// UI and tool paths both pass the engine guard before any journal write.
	if (!queryOnly) await call("authorizeIndex");
	let sequence = Number(prior?.data.sourceRevision ?? 0);
	const journalId = (status) => `sync-${digest([operation, requestId, status])}`;
	const save = (status, extra = {}) => {
		const existing = store.lookupRequest(context, journalId(status));
		if (existing) return readEvidenceJson(store, context, ref(existing));
		const content = { ...identity, status, ...extra };
		store.write(context, {
			kind: "evidence",
			requestId: journalId(status),
			data: {
				attemptRef,
				sourceId: "project-report-index",
				sourceRevision: String(++sequence),
				sourceEventId: operation,
				sourceLocator: `evaluation:${report.id}`,
				producer: "project-report-sync-v1",
				kind: "project-report-sync",
				origin: "harness-observed",
				availability: "available",
				observedAt: new Date().toISOString(),
				redaction: [],
				truncated: false,
				content: JSON.stringify(content),
			},
		});
		return content;
	};
	const synced = (state) => {
		const r = state.receipt;
		requireValue(
			state.status === "synced" &&
				r?.evaluationId === identity.evaluationId &&
				r.reportDigest === identity.reportDigest &&
				digest(r.projectRef) === digest(projectRef),
			"EXECUTION_UNKNOWN",
			"Report index receipt identity cannot be confirmed",
		);
		return { ...identity, status: "synced", receipt: r };
	};
	try {
		const state = await call("indexStatus");
		if (state.status === "synced") {
			const result = synced(state);
			if (queryOnly) return result;
			await call("authorizeIndex");
			return previous?.status === "synced" ? result : save("synced", { receipt: result.receipt });
		}
		requireValue(state.status === "missing", "EXECUTION_UNKNOWN", "Report index state cannot be confirmed");
		if (queryOnly)
			return { ...identity, status: previous?.status === "failed" ? "failed" : "pending", remoteStatus: "missing" };
		// Repeating a request reconciles only. A new explicit request can retry a confirmed missing index.
		if (store.lookupRequest(context, journalId("pending")))
			return { ...(previous ?? identity), remoteStatus: "missing" };
		await call("authorizeIndex");
		save("pending");
		const result = synced(await call("syncIndex"));
		await call("authorizeIndex");
		return save("synced", { receipt: result.receipt });
	} catch (error) {
		const result = {
			...identity,
			status: "failed",
			error: {
				code: error.code ?? "IO_ERROR",
				message: "Index synchronization unconfirmed; reconcile before retry; no business action replayed",
			},
		};
		if (queryOnly) return result;
		await call("authorizeIndex");
		return save("failed", { error: result.error });
	}
}
