/** Resume-only offline imports into the existing immutable record graph. No host or runner is accepted. */
import { parseAtif } from "./adapters/atif.mjs";
import { digest, redact, requireValue } from "./schema.mjs";
const ref = (record) => ({ kind: record.kind, id: record.id, revision: record.revision });
const same = (a, b) => digest(a) === digest(b);
export function importAtif(store, context, { contractRef, input, sourceDeclaration }) {
	const identity = store.identity(context, true);
	requireValue(identity.human === true, "PERMISSION_DENIED", "Offline import requires trusted human confirmation");
	const contract = store.get(context, contractRef);
	requireValue(
		contract.kind === "contracts" && contract.data.scope.source === "offline",
		"INVALID_INPUT",
		"An offline contract is required",
	);
	requireValue(
		typeof sourceDeclaration === "string" && sourceDeclaration.trim().length > 0 && sourceDeclaration.length <= 4096,
		"INVALID_INPUT",
		"A bounded source declaration is required",
	);
	const converted = parseAtif(input),
		scope = contract.data.scope;
	requireValue(
		scope.packageDigest === converted.rawSha256 &&
			scope.format === converted.format &&
			scope.converterVersion === converted.converterVersion,
		"VERSION_CONFLICT",
		"Package or converter differs from the frozen contract",
	);
	const selected = converted.trajectories.filter((t) => scope.trajectoryPointers.includes(`#${t.pointer}`));
	requireValue(
		selected.length === scope.trajectoryPointers.length,
		"EVIDENCE_GAP",
		"Selected ATIF documents are missing",
	);
	const selectedPointers = new Set(selected.map((t) => t.pointer));
	const events = converted.events.filter((e) => selectedPointers.has(e.trajectoryPointer));
	const metadata = {
		format: converted.format,
		converterVersion: converted.converterVersion,
		rawSha256: converted.rawSha256,
		rawBytes: converted.rawBytes,
		sourceDeclaration: redact(sourceDeclaration),
		sourceDeclarationDigest: digest(sourceDeclaration),
		origin: "target-reported",
		trajectoryPointers: scope.trajectoryPointers,
		trajectories: selected,
		losses: converted.losses,
		limitations: ["source-is-target-reported", "execution-state-not-observed", "external-references-never-followed"],
	};
	const sourceContent = JSON.stringify(
			redact({
				format: converted.format,
				rawSha256: converted.rawSha256,
				rawBytes: converted.rawBytes,
				selectedDocuments: selected,
			}),
		),
		manifestContent = JSON.stringify(redact(metadata));
	const eventContents = events.map((e) => JSON.stringify(redact(e.value)));
	const bodies = [sourceContent, manifestContent, ...eventContents];
	requireValue(
		converted.rawBytes <= store.limits.evidenceBytes &&
			events.length + 2 <= store.limits.snapshotItems &&
			bodies.every((body) => Buffer.byteLength(body) <= store.limits.evidenceBytes) &&
			bodies.reduce((n, body) => n + Buffer.byteLength(body), 0) <= store.limits.readBytes / 2,
		"LIMIT_EXCEEDED",
		"Converted import exceeds evidence/read budgets",
	);
	const operation = digest([ref(contract), converted.rawSha256, converted.converterVersion]);
	const write = (kind, data, suffix) =>
		store.write(context, { kind, data, requestId: `import-${operation}-${suffix}` });
	// Validate a changed declaration before any further stage writes, even after a partial import.
	const receiptId = `import-${operation}-intent`,
		prior = store.lookupRequest(context, receiptId);
	if (prior)
		requireValue(
			prior.data.configRef === digest(metadata),
			"VERSION_CONFLICT",
			"Import declaration or selection changed; create a new contract revision",
		);
	const target = store.write(context, {
		kind: "targets",
		requestId: receiptId,
		data: {
			kind: "offline",
			clientVersion: "unknown",
			executableIdentity: "unverified-imported-trajectory",
			adapterVersion: converted.converterVersion,
			configRef: digest(metadata),
			capabilities: { history: "partial", execution: "unsupported", independentVerification: "unsupported" },
			isolation: "data-only-import-no-execution",
		},
	});
	const attempt = write(
		"attempts",
		{
			contractRef: ref(contract),
			targetRef: ref(target),
			configDigest: digest(metadata),
			state: "unknown",
			terminationReason: "offline-source-does-not-prove-execution-state",
		},
		"attempt",
	);
	const common = {
		attemptRef: ref(attempt),
		sourceId: `atif:${converted.rawSha256}`,
		producer: "atif-import-v1",
		availability: "available",
		origin: "target-reported",
		observedAt: attempt.createdAt,
		redaction: ["credentials-v1"],
		truncated: false,
	};
	const source = store.writeOriginalEvidence(
		context,
		{
			kind: "evidence",
			requestId: `import-${operation}-source`,
			data: {
				...common,
				kind: "atif-source",
				sourceLocator: `atif:${converted.rawSha256}`,
				sourceRevision: converted.rawSha256,
				content: sourceContent,
			},
		},
		Buffer.from(converted.rawText),
	);
	const eventInputs = events.map((event, i) => ({
		kind: "evidence",
		requestId: `import-${operation}-event-${i}`,
		data: {
			...common,
			kind: "atif-step",
			sourceEventId: `${event.trajectoryPointer}#${event.stepId}`,
			sourceLocator: `atif:${converted.rawSha256}#${event.pointer}`,
			sourceRevision: digest(event.value),
			...(event.value.timestamp ? { occurredAt: event.value.timestamp } : {}),
			content: eventContents[i],
		},
	}));
	const records = [];
	// Bound each physical pack; never copy raw archives into event batches.
	for (let start = 0; start < eventInputs.length;) {
		const batch = [];
		let bytes = 0;
		while (start < eventInputs.length && batch.length < 50) {
			const candidate = eventInputs[start],
				size = Buffer.byteLength(JSON.stringify(candidate));
			if (batch.length && bytes + size > store.limits.readBytes / 2) break;
			batch.push(candidate);
			bytes += size;
			start++;
		}
		records.push(...store.writeEvidenceBatch(context, batch));
	}
	const manifest = write(
		"evidence",
		{
			...common,
			kind: "atif-import-manifest",
			sourceLocator: `atif:${converted.rawSha256}#import`,
			content: manifestContent,
		},
		"manifest",
	);
	const snapshot = write(
		"snapshots",
		{
			contractRef: ref(contract),
			attemptRefs: [ref(attempt)],
			sourceWatermarks: { [common.sourceId]: converted.rawSha256 },
			evidenceRefs: [ref(source), ...records.map(ref), ref(manifest)],
			coverage: "partial",
			gaps: [
				"target-reported-source-not-independently-verified",
				...new Set(converted.losses.map((loss) => loss.reason)),
			],
			sealedAt: manifest.createdAt,
		},
		"snapshot",
	);
	// The final snapshot is the completion receipt. Earlier durable stages can be resumed exactly.
	requireValue(same(snapshot.data.contractRef, ref(contract)), "STORE_CORRUPT", "Imported snapshot contract changed");
	return {
		snapshotRef: ref(snapshot),
		attemptRef: ref(attempt),
		sourceRef: ref(source),
		manifestRef: ref(manifest),
		rawSha256: converted.rawSha256,
		evidenceCount: snapshot.data.evidenceRefs.length,
		coverage: snapshot.data.coverage,
	};
}
