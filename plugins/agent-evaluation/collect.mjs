/** Persistent collection for explicitly selected scopes. Host events supplement selected SDK calls with explicit timing provenance.
 * Replays deduplicate against durable source revisions; a checkpoint is published last.
 * No evaluator, runner, model or business write API is available to this module.
 */
import { LIMITS, canonical, digest, jsonStringBytes, requireValue } from "./schema.mjs";
import { piEvidenceAdapter } from "./adapters/pi.mjs";
const refOf = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
const same = (a, b) => digest(a) === digest(b);

export function readEvidenceJson(store, context, ref) {
	// Internal parsing consumes one already-bounded evidence blob. Paging is for the UI transport;
	// re-reading and hashing the entire blob for every 12K page multiplies long-output work.
	const record = store.get(context, ref);
	requireValue(record.kind === "evidence" && record.contentRef, "EVIDENCE_GAP", "Evidence body is unavailable");
	return JSON.parse(store.readBlob(record));
}
export function recordsOf(store, context, kind) {
	let cursor = "",
		rows = [];
	do {
		const page = store.list(context, { kind, cursor, limit: 100 });
		rows.push(...page.items.map((ref) => store.get(context, refOf(ref))));
		cursor = page.nextCursor;
	} while (cursor);
	return rows;
}
function pairGaps(records, store) {
	const calls = new Set(),
		results = new Set(),
		gaps = [];
	// The caller just authorized these records. Prefetch stays within this synchronous pass.
	for (const { record: r, content } of store.readBlobs(
		records.filter((r) => r.data.producer === "pi-evidence-v1" && r.contentRef),
	)) {
		const value = JSON.parse(content);
		const message = value.message ?? value;
		const prefix = `${r.data.attemptRef.id}:${r.data.sourceId}:`;
		if (message.role === "assistant")
			for (const block of message.content ?? [])
				if (block.type === "toolCall" && block.id) calls.add(prefix + block.id);
		if (message.role === "toolResult" && message.toolCallId) results.add(prefix + message.toolCallId);
	}
	for (const id of calls) if (!results.has(id)) gaps.push(`missing-tool-end:${id}`);
	for (const id of results) if (!calls.has(id)) gaps.push(`missing-tool-start:${id}`);
	return gaps;
}

export class EvidenceCollector {
	constructor(store, host) {
		this.store = store;
		this.host = host;
		this.watchers = new Set();
		this.closed = false;
	}
	/** @param {any} context
	 * @param {{attemptRef: any, conversationId: string, requestId: string, nativeRefs?: Array<{engine: string, reference: unknown}>, artifactPaths?: string[], liveEvents?: any[], liveTruncated?: boolean, signal?: AbortSignal}} options */
	async collect(
		context,
		{
			attemptRef,
			conversationId,
			requestId,
			nativeRefs = [],
			artifactPaths = [],
			liveEvents = [],
			liveTruncated = false,
			signal,
		},
	) {
		requireValue(!this.closed, "CAPABILITY_UNAVAILABLE", "Collector is stopped");
		signal?.throwIfAborted();
		const store = this.store,
			attempt = store.get(context, attemptRef),
			contract = store.get(context, attempt.data.contractRef);
		requireValue(
			attempt.kind === "attempts" && contract.kind === "contracts" && contract.data.scope.source === "pi",
			"INVALID_INPUT",
			"Attempt and contract required",
		);
		requireValue(
			typeof requestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(requestId),
			"INVALID_INPUT",
			"Invalid collection request ID",
		);
		requireValue(Array.isArray(nativeRefs) && nativeRefs.length <= 20, "LIMIT_EXCEEDED", "Too many native references");
		requireValue(liveEvents.length <= 1000, "LIMIT_EXCEEDED", "Too many live observations");
		requireValue(
			Array.isArray(artifactPaths) &&
				artifactPaths.length <= 20 &&
				new Set(artifactPaths).size === artifactPaths.length,
			"INVALID_INPUT",
			"Select at most 20 distinct artifact paths",
		);
		const checkpointSource = `collection:${attempt.id}`;
		const requestDigest = digest({ attemptRef, conversationId, nativeRefs, artifactPaths, liveEvents, liveTruncated });
		const prior = store.lookupRequest(context, `checkpoint-${digest([attempt.id, requestId])}`);
		if (prior) {
			const body = readEvidenceJson(store, context, refOf(prior));
			requireValue(body.requestDigest === requestDigest, "VERSION_CONFLICT", "Collection request changed");
			return { ...body, checkpointRef: refOf(prior) };
		}
		const existing = recordsOf(store, context, "evidence");
		const evidence = [],
			attempts = [attemptRef],
			gaps = liveTruncated ? ["live-queue-overflow; events missing"] : [],
			watermarks = {};
		const selectedCalls = new Map();
		const writeInput = (data) => ({
			kind: "evidence",
			data,
			requestId: `ev-${digest([attempt.id, data.attemptRef.id, data.sourceId, data.sourceEventId, data.sourceRevision])}`,
		});
		const remember = (data, committed = undefined) => {
			signal?.throwIfAborted();
			const revisions = existing.filter(
				(r) =>
					r.data.attemptRef.id === data.attemptRef.id &&
					r.data.sourceId === data.sourceId &&
					r.data.sourceEventId === data.sourceEventId,
			);
			const match = revisions.find((r) => r.data.sourceRevision === data.sourceRevision);
			if (revisions.some((r) => r.data.sourceRevision !== data.sourceRevision)) {
				gaps.push(`conflicting-source:${data.sourceId}:${data.sourceEventId}`);
				for (const r of revisions) if (!evidence.some((e) => e.id === r.id)) evidence.push(refOf(r));
			}
			const record = match ?? committed ?? store.write(context, writeInput(data));
			if (!match) existing.push(record);
			if (!evidence.some((e) => e.id === record.id)) evidence.push(refOf(record));
			requireValue(
				evidence.length < store.limits.snapshotItems,
				"LIMIT_EXCEEDED",
				"Snapshot evidence budget reached; select a smaller range",
			);
			return record;
		};
		const rememberPage = (data) => {
			// A v1 envelope, reference digest, content descriptor and range-index entry
			// add less than 1KiB plus the exact owner-domain encoding per source item.
			// Raw body bytes cannot exceed their JSON-escaped input. Keep both the
			// store's exact input cap and encodePack's exact physical cap authoritative.
			const overhead = 1024 + Buffer.byteLength(canonical(attempt.domain));
			let pending = [],
				bytes = 26; // Header, footer and index-array delimiters.
			const flush = () => {
				if (!pending.length) return;
				signal?.throwIfAborted();
				const records = store.writeEvidenceBatch(context, pending.map(writeInput));
				pending.forEach((item, i) => remember(item, records[i]));
				pending = [];
				bytes = 26;
			};
			for (const item of data) {
				if (
					existing.some(
						(r) =>
							r.data.attemptRef.id === item.attemptRef.id &&
							r.data.sourceId === item.sourceId &&
							r.data.sourceEventId === item.sourceEventId &&
							r.data.sourceRevision === item.sourceRevision,
					)
				) {
					flush();
					remember(item);
					continue;
				}
				const input = writeInput(item);
				// The empty-body envelope has the same ordering and escaping overhead.
				// Count the original string exactly; the store still serializes and checks it.
				const size =
					(item.content === undefined
						? Buffer.byteLength(canonical(input))
						: Buffer.byteLength(canonical({ ...input, data: { ...item, content: "" } })) +
							jsonStringBytes(item.content) -
							2) + overhead;
				if (bytes + size > store.limits.readBytes) flush();
				if (size + 26 > store.limits.readBytes) {
					remember(item);
					continue;
				}
				pending.push(item);
				bytes += size;
			}
			flush();
		};
		const collectScope = (scope, convId, scopeAttempt) => {
			let cursor;
			let first;
			const visited = new Set();
			do {
				signal?.throwIfAborted();
				const page = piEvidenceAdapter.collect(this.host, context.clientId, scope, convId, cursor);
				requireValue(
					page.principalId === attempt.domain.principalId &&
						page.workspaceId === attempt.domain.workspaceId &&
						page.sessionId === scope.sessionId,
					"PERMISSION_DENIED",
					"Source domain differs from the authorized attempt",
				);
				first ??= page;
				gaps.push(...page.gaps);
				const pageData = [];
				for (const item of page.items) {
					const data = {
						attemptRef: scopeAttempt,
						sourceId: page.sourceId,
						sourceEventId: item.sourceEventId,
						sourceLocator: item.sourceLocator,
						sourceRevision: item.sourceRevision,
						producer: "pi-evidence-v1",
						availability: item.availability,
						origin: "harness-observed",
						kind: item.kind,
						observedAt: page.observedAt,
						occurredAt: item.occurredAt,
						redaction: item.redaction,
						truncated: item.truncated,
					};
					if (item.content !== undefined) data.content = item.content;
					pageData.push(data);
					if (item.content) {
						const message = JSON.parse(item.content).message;
						if (message?.role === "assistant")
							for (const block of message.content ?? [])
								if (block.type === "toolCall" && block.id)
									selectedCalls.set(`${convId}:${block.id}`, {
										attemptRef: scopeAttempt,
										sessionId: page.sessionId,
										toolCallId: block.id,
									});
					}
				}
				rememberPage(pageData);
				// The caller-visible watermark is never committed before its referenced items.
				if (page.items.length) watermarks[page.sourceId] = page.items.at(-1).sourceEventId;
				cursor = page.nextCursor;
				requireValue(!cursor || !visited.has(cursor), "EVIDENCE_GAP", "Source cursor did not advance");
				visited.add(cursor);
			} while (cursor);
			return first;
		};
		const root = collectScope(contract.data.scope, conversationId, attemptRef);
		if (contract.data.scope.childPolicy === "explicit") {
			const knownAttempts = recordsOf(store, context, "attempts");
			for (const sessionId of contract.data.scope.childSessionIds) {
				const child = root.children.find((c) => c.sessionId === sessionId);
				if (!child) continue; // The source page has already recorded the missing selected child.
				const description = this.host.readEvaluationEvidence(context.clientId, {
					conversationId: child.conversationId,
					mode: "describe",
					limit: 1000,
				});
				gaps.push(...description.gaps);
				if (!description.rangeStart || !description.rangeEnd) {
					gaps.push(`empty-selected-child:${sessionId}`);
					continue;
				}
				let childAttempt = knownAttempts.find(
					(a) =>
						a.data.parentAttemptRef?.id === attempt.id &&
						a.data.sourceSessionId === sessionId &&
						same(a.data.contractRef, attempt.data.contractRef),
				);
				if (!childAttempt)
					childAttempt = store.write(context, {
						kind: "attempts",
						data: {
							contractRef: attempt.data.contractRef,
							targetRef: attempt.data.targetRef,
							parentAttemptRef: attemptRef,
							sourceSessionId: sessionId,
							configDigest: attempt.data.configDigest,
							state: "unknown",
							terminationReason: "historical-source-does-not-prove-execution-end",
						},
						requestId: `child-${digest([attempt.id, sessionId])}`,
					});
				attempts.push(refOf(childAttempt));
				collectScope(
					{
						...contract.data.scope,
						sessionId,
						startMessageId: description.rangeStart,
						endMessageId: description.rangeEnd,
						childPolicy: "exclude",
						childSessionIds: [],
					},
					child.conversationId,
					refOf(childAttempt),
				);
			}
		}
		for (const path of artifactPaths) {
			signal?.throwIfAborted();
			const artifact = this.host.readEvaluationArtifact(context.clientId, {
				conversationId,
				sessionId: contract.data.scope.sessionId,
				path,
			});
			const { observedAt, ...bytes } = artifact;
			remember({
				attemptRef,
				sourceId: `artifact:${contract.data.scope.sessionId}`,
				sourceEventId: digest(path),
				sourceLocator: path,
				sourceRevision: digest(bytes),
				producer: "artifact-reader-v1",
				availability: artifact.truncated || artifact.redaction.length ? "partial" : "available",
				origin: "harness-observed",
				kind: "artifact-snapshot",
				observedAt,
				content: JSON.stringify(artifact),
				redaction: artifact.redaction,
				// The metadata envelope is complete; byte truncation stays explicit inside it.
				truncated: false,
			});
			gaps.push(`additional-artifact-read-at-observation-time:${path}`);
		}
		for (const native of nativeRefs) {
			signal?.throwIfAborted();
			const run = await this.host.readEvaluationNative(context.clientId, {
				conversationId,
				sessionId: contract.data.scope.sessionId,
				engine: native.engine,
				reference: native.reference,
			});
			signal?.throwIfAborted();
			remember({
				attemptRef,
				sourceId: `native:${native.engine}`,
				sourceEventId: run.runId,
				sourceLocator: `native:${native.engine}:${run.runId}`,
				sourceRevision: digest(run),
				producer: "native-reader-v1",
				availability: run.complete ? "available" : "partial",
				origin: "harness-observed",
				kind: "native-test-run",
				observedAt: new Date().toISOString(),
				occurredAt: run.at,
				content: JSON.stringify(run),
				redaction: [],
				truncated: false,
			});
			if (!run.complete) gaps.push(`native-run-incomplete:${run.runId}`);
			gaps.push(`additional-read-at-observation-time:${run.runId}`);
		}
		// Only metadata for tool calls present in the authorized SDK selection is admitted.
		// New sources carry a process-local monotonic clock; older durations remain wall-clock observations.
		for (const event of liveEvents) {
			const selected = selectedCalls.get(`${event.conversationId}:${event.toolCallId}`);
			if (!selected || !["tool_start", "tool_end"].includes(event.type)) continue;
			const content = {
				type: event.type,
				toolCallId: event.toolCallId,
				at: Number.isFinite(event.at) ? event.at : null,
				durationMs: Number.isFinite(event.durationMs) && event.durationMs >= 0 ? event.durationMs : null,
				isError: typeof event.isError === "boolean" ? event.isError : null,
				clockEpoch: typeof event.clockEpoch === "string" ? event.clockEpoch : null,
				monotonicAt: Number.isFinite(event.monotonicAt) && event.monotonicAt >= 0 ? event.monotonicAt : null,
				clock:
					typeof event.clockEpoch === "string" && Number.isFinite(event.monotonicAt)
						? "host-monotonic; process-local"
						: "host-wall-clock; clock-adjustment uncertainty",
			};
			remember({
				attemptRef: selected.attemptRef,
				sourceId: `pi-live:${selected.sessionId}`,
				sourceEventId: `${event.toolCallId}:${event.type}`,
				sourceLocator: `pi-live:${selected.sessionId}:${event.toolCallId}`,
				sourceRevision: digest(content),
				producer: "pi-live-v1",
				availability: "partial",
				origin: "harness-observed",
				kind: "tool-observation",
				observedAt: new Date().toISOString(),
				content: JSON.stringify(content),
				redaction: [],
				truncated: false,
			});
		}
		// Retain admitted durable observations across refreshes and process restarts.
		for (const r of existing) {
			if (r.data.producer !== "pi-live-v1" || !attempts.some((a) => a.id === r.data.attemptRef.id)) continue;
			const value = readEvidenceJson(store, context, refOf(r));
			const admitted = [...selectedCalls.values()].some(
				(s) =>
					s.attemptRef.id === r.data.attemptRef.id &&
					s.toolCallId === value.toolCallId &&
					r.data.sourceId === `pi-live:${s.sessionId}`,
			);
			if (!admitted) continue;
			if (!evidence.some((e) => e.id === r.id)) evidence.push(refOf(r));
			gaps.push(
				value.clockEpoch && value.monotonicAt !== null
					? "live-observation-is-partial"
					: "live-observation-is-partial; host-wall-clock-uncertainty",
			);
			if (
				existing.some(
					(other) =>
						other.data.attemptRef.id === r.data.attemptRef.id &&
						other.data.sourceId === r.data.sourceId &&
						other.data.sourceEventId === r.data.sourceEventId &&
						other.data.sourceRevision !== r.data.sourceRevision,
				)
			)
				gaps.push(`conflicting-source:${r.data.sourceId}:${r.data.sourceEventId}`);
			if (
				value.type === "tool_end" &&
				!existing.some(
					(start) =>
						start.data.attemptRef.id === r.data.attemptRef.id &&
						start.data.sourceId === r.data.sourceId &&
						start.data.sourceEventId === `${value.toolCallId}:tool_start`,
				)
			)
				gaps.push(`live-start-not-observed:${r.data.sourceId}:${value.toolCallId}`);
		}
		requireValue(evidence.length < store.limits.snapshotItems, "LIMIT_EXCEEDED", "Snapshot evidence budget reached");
		const paired = pairGaps(store.getMany(context, evidence), store);
		gaps.push(...paired);
		const result = {
			requestDigest,
			attemptRefs: attempts,
			contractRef: attempt.data.contractRef,
			evidenceRefs: evidence,
			sourceWatermarks: watermarks,
			gaps: [...new Set(gaps)],
			coverage: gaps.length ? "partial" : "complete",
			observedAt: new Date().toISOString(),
		};
		signal?.throwIfAborted();
		const checkpointInput = {
			kind: "evidence",
			data: {
				attemptRef,
				sourceId: checkpointSource,
				sourceEventId: requestId,
				sourceLocator: checkpointSource,
				sourceRevision: digest(result),
				producer: "collector-v1",
				availability: "available",
				origin: "harness-observed",
				kind: "collection-checkpoint",
				observedAt: result.observedAt,
				content: JSON.stringify(result),
				redaction: [],
				truncated: false,
			},
			requestId: `checkpoint-${digest([attempt.id, requestId])}`,
		};
		// The final checkpoint is still a separate commit after every source item. A single-item
		// pack preserves body-before-index durability using one atomic file for body and index.
		// Keep the legacy path for tightened read budgets that may not fit a physical pack.
		const checkpoint =
			store.limits.readBytes === LIMITS.readBytes
				? store.writeEvidenceBatch(context, [checkpointInput])[0]
				: store.write(context, checkpointInput);
		return { ...result, checkpointRef: refOf(checkpoint) };
	}
	seal(context, checkpointRef, requestId) {
		requireValue(!this.closed, "CAPABILITY_UNAVAILABLE", "Collector is stopped");
		const record = this.store.get(context, checkpointRef);
		requireValue(
			record.data.producer === "collector-v1" && record.data.kind === "collection-checkpoint",
			"INVALID_INPUT",
			"A durable collection checkpoint is required",
		);
		const body = readEvidenceJson(this.store, context, checkpointRef);
		return this.store.write(context, {
			kind: "snapshots",
			data: {
				contractRef: body.contractRef,
				attemptRefs: body.attemptRefs,
				sourceWatermarks: body.sourceWatermarks,
				evidenceRefs: [...body.evidenceRefs, checkpointRef],
				coverage: body.coverage,
				gaps: body.gaps,
				sealedAt: record.createdAt,
			},
			requestId,
		});
	}
	watch(context, options, onChange = (_change) => {}) {
		requireValue(!this.closed, "CAPABILITY_UNAVAILABLE", "Collector is stopped");
		const controller = new AbortController();
		const queued = [];
		let busy = false,
			pending = false,
			generation = 0,
			liveTruncated = false,
			lastError = null;
		const refresh = async () => {
			if (controller.signal.aborted) return;
			if (busy) {
				pending = true;
				return;
			}
			busy = true;
			const batch = queued.slice();
			try {
				const result = await this.collect(context, {
					...options,
					requestId: `watch-${digest([options.requestId, ++generation, Date.now()])}`,
					signal: controller.signal,
					liveEvents: batch,
					liveTruncated,
				});
				queued.splice(0, batch.length);
				lastError = null;
				if (!controller.signal.aborted) onChange({ result });
			} catch (error) {
				lastError = {
					code: error.code ?? "EVIDENCE_GAP",
					message: "Selected collection failed; the business run is unaffected",
				};
				if (!controller.signal.aborted) {
					try {
						onChange({ error: lastError });
					} catch {}
				}
			} finally {
				busy = false;
				if (pending && !controller.signal.aborted) {
					pending = false;
					void refresh();
				}
			}
		};
		const off = this.host.onRunEvent((event) => {
			if (controller.signal.aborted) return;
			try {
				if (event.conversationId !== options.conversationId) {
					const attempt = this.store.get(context, options.attemptRef);
					const contract = this.store.get(context, attempt.data.contractRef);
					if (contract.data.scope.childPolicy !== "explicit") return;
					const source = this.host.readEvaluationEvidence(context.clientId, {
						conversationId: options.conversationId,
						mode: "describe",
						limit: 1,
					});
					if (
						!source.children.some(
							(c) =>
								c.conversationId === event.conversationId && contract.data.scope.childSessionIds.includes(c.sessionId),
						)
					)
						return;
				}
				if (["tool_start", "tool_end"].includes(event.type)) {
					if (queued.length >= 1000) liveTruncated = true;
					requireValue(!liveTruncated, "LIMIT_EXCEEDED", "Live observation queue is full; restart watch to resume");
					// Never retain truncated arguments/results or arbitrary event payloads.
					queued.push({
						conversationId: event.conversationId,
						type: event.type,
						toolCallId: event.toolCallId,
						at: event.at,
						durationMs: event.durationMs,
						clockEpoch: event.clockEpoch,
						monotonicAt: event.monotonicAt,
						isError: event.isError,
					});
				}
				void refresh();
			} catch (error) {
				lastError = {
					code: error.code ?? "EVIDENCE_GAP",
					message: "Live collection degraded; the business run is unaffected",
				};
				try {
					onChange({ error: lastError });
				} catch {}
			}
		});
		const stop = () => {
			controller.abort();
			off();
			this.watchers.delete(stop);
		};
		this.watchers.add(stop);
		return { stop, refresh, status: () => ({ busy, pending, lastError }) };
	}
	close() {
		this.closed = true;
		for (const stop of this.watchers) stop();
	}
}
