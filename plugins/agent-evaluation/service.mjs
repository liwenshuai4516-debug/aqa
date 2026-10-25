/** Product operations over the existing store/collector/engine. Identities are supplied by transport code. */
import { Type as T } from "typebox";
import { Check } from "typebox/value";
import { EvaluationStore } from "./store.mjs";
import { EvidenceCollector } from "./collect.mjs";
import { EvaluationEngine } from "./evaluate.mjs";
import { AtifUploads } from "./upload.mjs";
import { importAtif } from "./import.mjs";
import { createInternalRegistry, internalProfile } from "./profiles/internal.mjs";
import { validateConfigSchema } from "./registry.mjs";
import { Ref, digest, requireValue } from "./schema.mjs";
const ref = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
const string = T.String({ minLength: 1, maxLength: 16384 });
export const queryActions = [
	"describe",
	"list",
	"get",
	"readEvidence",
	"locateEvidence",
	"inspectNativeRun",
	"export",
	"status",
];
export const toolActions = [
	...queryActions,
	"createContract",
	"reviseContract",
	"createAttempt",
	"collect",
	"seal",
	"evaluate",
	"cancel",
];
export const requestSchema = T.Object(
	{
		action: T.Union(
			[
				...toolActions,
				"review",
				"watchStart",
				"watchStatus",
				"watchStop",
				"validateConfiguration",
				"uploadStart",
				"uploadChunk",
				"uploadPreview",
				"uploadDiscard",
				"createImportContract",
				"importAtif",
				"readOriginal",
			].map((value) => T.Literal(value)),
		),
		requestId: T.String({ pattern: "^[A-Za-z0-9_-]{1,128}$" }),
		conversationId: T.Optional(string),
		sessionId: T.Optional(string),
		ref: T.Optional(Ref),
		previousRef: T.Optional(Ref),
		data: T.Optional(T.Record(T.String(), T.Unknown())),
		configs: T.Optional(T.Record(T.String(), T.Unknown())),
		kind: T.Optional(string),
		evidenceView: T.Optional(T.Union([T.Literal("raw"), T.Literal("artifact-text"), T.Literal("native-run")])),
		jobId: T.Optional(string),
		watchId: T.Optional(string),
		cursor: T.Optional(T.String({ maxLength: 256 })),
		offset: T.Optional(T.Integer({ minimum: 0 })),
		limit: T.Optional(T.Integer({ minimum: 1, maximum: 100 })),
		artifactPaths: T.Optional(T.Array(string, { maxItems: 20, uniqueItems: true })),
		nativeRefs: T.Optional(
			T.Array(
				T.Object(
					{ engine: T.Union([T.Literal("api"), T.Literal("ui")]), reference: T.Unknown() },
					{ additionalProperties: false },
				),
				{ maxItems: 20 },
			),
		),
	},
	{ additionalProperties: false },
);
export const errorResult = (error, stage) => ({
	code: error.code ?? "INVALID_INPUT",
	stage,
	retryable: error.retryable === true,
	missingConditions: error.missingConditions ?? [],
	message: error.message ?? String(error),
});
function pageText(text, offset = 0) {
	requireValue(offset <= text.length, "INVALID_INPUT", "Text offset is outside the record");
	const end = Math.min(text.length, offset + 4096);
	return { text: text.slice(offset, end), nextOffset: end < text.length ? end : null, totalChars: text.length };
}
function publicRecord(record, offset = 0, limit = 20) {
	const { domain: _domain, request: _request, digest: sourceDigest, ...value } = record;
	const data = { ...value.data },
		pages = {};
	for (const [field, rows] of Object.entries(data))
		if (Array.isArray(rows)) {
			data[field] = rows.slice(offset, offset + limit);
			pages[field] = { total: rows.length, offset, nextOffset: offset + limit < rows.length ? offset + limit : null };
		}
	return { ...value, sourceDigest, projection: true, data, pages };
}
export class EvaluationService {
	constructor(host) {
		this.host = host;
		this.identities = new WeakMap();
		this.registry = createInternalRegistry();
		this.closed = false;
		this.pending = new Set();
		this.controllers = new Map();
		this.watches = new Map();
		this.uploads = new AtifUploads();
	}
	initialize() {
		requireValue(!this.closed, "CAPABILITY_UNAVAILABLE", "Evaluation plugin is stopped");
		if (this.store) return;
		this.store = new EvaluationStore({
			dataDir: this.host.dataDir,
			authorize: (context) => (this.closed ? undefined : this.identities.get(context)),
		});
		this.collector = new EvidenceCollector(this.store, this.host);
		this.engine = new EvaluationEngine(this.store, this.registry);
	}
	authorize(trusted, request) {
		requireValue(
			trusted && ["ui", "tool"].includes(trusted.channel) && typeof trusted.clientId === "string",
			"PERMISSION_DENIED",
			"A trusted sender is required",
		);
		requireValue(
			trusted.channel !== "tool" || toolActions.includes(request.action),
			"PERMISSION_DENIED",
			"Agent tools cannot submit human reviews or use UI-only controls",
		);
		let conversationId = trusted.conversationId ?? request.conversationId;
		if (trusted.conversationId && request.conversationId)
			requireValue(
				trusted.conversationId === request.conversationId,
				"PERMISSION_DENIED",
				"Tool conversation cannot be substituted",
			);
		if (!conversationId) {
			const current = this.host.getActiveConversation({ clientId: trusted.clientId });
			requireValue(current?.clientId === trusted.clientId, "PERMISSION_DENIED", "Open an owned conversation first");
			conversationId = current.conversationId;
		}
		const source = this.host.readEvaluationEvidence(trusted.clientId, {
			conversationId,
			mode: "describe",
			limit: request.action === "describe" ? (request.limit ?? 50) : 1,
		});
		requireValue(
			source.principalId === trusted.clientId && source.conversationId === conversationId,
			"PERMISSION_DENIED",
			"Source identity differs from the trusted sender",
		);
		requireValue(
			!request.sessionId || request.sessionId === source.sessionId,
			"VERSION_CONFLICT",
			"Selected session changed; select the source again",
		);
		const context = Object.freeze({ clientId: trusted.clientId });
		this.identities.set(context, {
			domain: { principalId: source.principalId, workspaceId: source.workspaceId },
			sessionIds: [source.sessionId, ...source.children.map((c) => c.sessionId)],
			allowWrite: true,
			human: trusted.channel === "ui",
		});
		return { context, source, conversationId };
	}
	async dispatch(trusted, request, signal) {
		requireValue(!this.closed, "CAPABILITY_UNAVAILABLE", "Evaluation plugin is stopped");
		requireValue(Check(requestSchema, request), "INVALID_INPUT", "Invalid evaluation request");
		requireValue(
			Buffer.byteLength(JSON.stringify(request)) <= 128 * 1024,
			"LIMIT_EXCEEDED",
			"Evaluation input exceeds 128 KiB",
		);
		signal?.throwIfAborted();
		const { context, source, conversationId } = this.authorize(trusted, request);
		if (request.action === "describe")
			return {
				...source,
				rules: this.registry.profile("internal", "1").rules.map((r) => ({ id: r.id, version: r.version })),
			};
		this.initialize();
		const store = this.store,
			requestId = request.requestId;
		const write = (kind, data, suffix = "", previousRef) =>
			store.write(context, {
				kind,
				data,
				requestId: `op-${digest([requestId, suffix])}`,
				...(previousRef ? { previousRef } : {}),
			});
		switch (request.action) {
			case "uploadStart":
				return this.uploads.start(trusted.clientId, source, requestId, request.data);
			case "uploadChunk":
				return this.uploads.chunk(trusted.clientId, source, request.data);
			case "uploadPreview":
				return this.uploads.preview(trusted.clientId, source, request.data?.uploadId, request.offset);
			case "uploadDiscard": {
				this.uploads.discardOwned(trusted.clientId, source, request.data?.uploadId);
				return { discarded: true };
			}
			case "createImportContract": {
				const { converted } = this.uploads.parse(trusted.clientId, source, request.data?.uploadId);
				const data = request.data?.contract,
					pointers = request.data?.trajectoryPointers;
				requireValue(
					request.data?.confirmed === true &&
						data &&
						!Object.hasOwn(data, "scope") &&
						Array.isArray(pointers) &&
						pointers.length > 0 &&
						new Set(pointers).size === pointers.length &&
						pointers.every((p) => converted.trajectories.some((t) => `#${t.pointer}` === p)),
					"INVALID_INPUT",
					"Confirm a contract and explicit document selection; host scope cannot be supplied",
				);
				return ref(
					write(
						"contracts",
						{
							...data,
							scope: {
								source: "offline",
								sessionId: source.sessionId,
								packageDigest: converted.rawSha256,
								format: converted.format,
								converterVersion: converted.converterVersion,
								trajectoryPointers: pointers,
							},
						},
						"import-contract",
					),
				);
			}
			case "importAtif": {
				requireValue(request.data?.confirmed === true, "PERMISSION_DENIED", "Human source confirmation is required");
				const { entry } = this.uploads.parse(trusted.clientId, source, request.data?.uploadId);
				requireValue(
					store.get(context, request.ref).data.scope?.sessionId === source.sessionId,
					"PERMISSION_DENIED",
					"Import contract requires the current host anchor",
				);
				return importAtif(store, context, {
					contractRef: request.ref,
					input: entry.bytes,
					sourceDeclaration: request.data?.sourceDeclaration,
				});
			}
			case "readOriginal": {
				const text = store.readOriginal(context, request.ref);
				return {
					...pageText(text, request.offset),
					originalDigest: store.get(context, request.ref).originalRef.sha256,
					unredacted: true,
				};
			}

			case "validateConfiguration": {
				const original = store.get(context, request.ref);
				requireValue(original.kind === "evaluations", "INVALID_INPUT", "A report is required for configuration");
				const snapshot = store.get(context, original.data.snapshotRef);
				const contract = store.get(context, original.data.contractRef);
				const configs = request.configs ?? {};
				const profile = internalProfile(configs);
				requireValue(
					Object.keys(configs).every((id) => profile.rules.some((r) => r.id === id)),
					"INVALID_INPUT",
					"Unknown rule configuration",
				);
				const conditions = [...contract.data.conditions, ...contract.data.constraints];
				for (const rule of profile.rules) {
					this.registry.validateConfig(this.registry.evaluator(rule.id, rule.version), rule.config);
					const seen = new Set();
					for (const check of rule.config.checks ?? []) {
						requireValue(
							!seen.has(check.conditionId) &&
								conditions.some(
									(c) => c.id === check.conditionId && [rule.id, `${rule.id}@${rule.version}`].includes(c.ruleRef),
								),
							"INVALID_INPUT",
							`${rule.id}: select a unique condition bound to this rule`,
						);
						seen.add(check.conditionId);
						if (rule.id === "F01" && check.jsonSchema) validateConfigSchema(check.jsonSchema);
						if (rule.id === "F05")
							requireValue(
								[check.claimEvidenceId, check.basisEvidenceId].every((id) =>
									snapshot.data.evidenceRefs.some((e) => e.id === id),
								),
								"EVIDENCE_GAP",
								"Claim and basis must belong to the selected snapshot",
							);
					}
				}
				return { valid: true, versions: profile.rules.map(({ id, version }) => ({ id, version })) };
			}

			case "watchStart": {
				requireValue(trusted.channel === "ui", "PERMISSION_DENIED", "Observation requires the UI channel");
				const previous = this.watches.get(trusted.clientId);
				if (previous?.requestId === requestId) {
					requireValue(
						previous.watchId === request.watchId &&
							digest(previous.input) ===
								digest({ ref: request.ref, artifactPaths: request.artifactPaths ?? [], conversationId }),
						"VERSION_CONFLICT",
						"Observation request changed",
					);
					store.get(context, previous.input.ref);
					return this.watchStatus(previous);
				}
				requireValue(
					!previous || previous.stopped,
					"IN_PROGRESS",
					"Stop the current observation before starting another",
				);
				requireValue(
					this.watches.has(trusted.clientId) || this.watches.size < 1000,
					"LIMIT_EXCEEDED",
					"Observation owner budget reached",
				);
				const attempt = store.get(context, request.ref);
				requireValue(attempt.kind === "attempts", "INVALID_INPUT", "Observation attempt required");
				const contract = store.get(context, attempt.data.contractRef);
				requireValue(
					contract.data.scope.source === "pi" &&
						contract.data.scope.sessionId === source.sessionId &&
						(!attempt.data.sourceSessionId || attempt.data.sourceSessionId === source.sessionId),
					"PERMISSION_DENIED",
					"Observation selection differs from the open source",
				);
				requireValue(typeof request.watchId === "string", "INVALID_INPUT", "Observation identity required");
				const entry = {
					watchId: request.watchId,
					requestId,
					input: { ref: request.ref, artifactPaths: request.artifactPaths ?? [], conversationId },
					stopped: false,
					latest: null,
					error: null,
					handle: null,
				};
				entry.handle = this.collector.watch(
					context,
					{ attemptRef: request.ref, conversationId, requestId, artifactPaths: entry.input.artifactPaths },
					(change) => {
						if (entry.stopped || this.closed) return;
						if (change.result) {
							const result = change.result;
							entry.latest = {
								checkpointRef: result.checkpointRef,
								coverage: result.coverage,
								evidenceCount: result.evidenceRefs.length,
								gapCount: result.gaps.length,
								observedAt: result.observedAt,
							};
							entry.error = null;
						} else entry.error = change.error;
					},
				);
				this.watches.set(trusted.clientId, entry);
				this.renewWatch(entry);
				await entry.handle.refresh();
				return this.watchStatus(entry);
			}
			case "watchStatus":
			case "watchStop": {
				const entry = this.watches.get(trusted.clientId);
				requireValue(
					entry && entry.watchId === request.watchId && entry.input.conversationId === conversationId,
					"PERMISSION_DENIED",
					"Observation unavailable for this sender and source",
				);
				store.get(context, entry.input.ref);
				if (request.action === "watchStop") this.stopWatch(entry);
				else if (!entry.stopped) this.renewWatch(entry);
				return this.watchStatus(entry);
			}
			case "list": {
				if (request.ref) store.get(context, request.ref);
				const page = store.list(context, {
					kind: request.kind ?? "evaluations",
					cursor: request.cursor ?? "",
					limit: request.limit ?? 50,
				});
				return {
					...page,
					items: page.items
						.filter(
							(item) =>
								!request.ref ||
								digest(store.get(context, ref(item)).data.evaluationRef ?? null) === digest(request.ref),
						)
						.map((item) => {
							const record = store.get(context, ref(item)),
								data = record.data;
							const contract = data.contractRef ? store.get(context, data.contractRef).data : undefined;
							const snapshot = data.snapshotRef ? store.get(context, data.snapshotRef).data : undefined;
							const attempt = snapshot?.attemptRefs?.[0] ? store.get(context, snapshot.attemptRefs[0]).data : undefined;
							const target = attempt ? store.get(context, attempt.targetRef).data : undefined;
							return {
								...item,
								objectivePreview: (data.objective ?? contract?.objective)?.slice(0, 160),
								sourceVersion: target?.clientVersion,
								executionState: attempt?.state,
								evidenceCoverage: snapshot?.coverage,
								taskRange: contract?.scope,
								state: data.state,
								assessmentStage: data.assessmentStage,
								summary: data.summary
									? {
											deliveryVerdict: data.summary.deliveryVerdict,
											goal: data.summary.goal,
											behavior: data.summary.behavior,
											counts: data.summary.counts,
										}
									: undefined,
								scope: data.scope,
								...(item.kind === "reviews" ? { review: data, reviewer: record.reviewer } : {}),
								contractRef: data.contractRef,
								snapshotRef: data.snapshotRef,
								profileVersion: data.profileVersion,
								job: data.job,
							};
						}),
				};
			}
			case "get":
				return publicRecord(store.get(context, request.ref), request.offset, request.limit);
			case "locateEvidence": {
				const record = store.get(context, request.ref),
					data = record.data;
				requireValue(
					record.kind === "evidence" &&
						data.kind === "message" &&
						data.producer === "pi-evidence-v1" &&
						data.sourceId === `pi:${source.sessionId}` &&
						typeof data.sourceEventId === "string",
					"EVIDENCE_GAP",
					"Open the evidence’s source session or inspect its sealed content; this source cannot be located here",
				);
				const target = this.host.readEvaluationEvidence(context.clientId, {
					mode: "locate",
					conversationId,
					sessionId: source.sessionId,
					locateEventId: data.sourceEventId,
				});
				requireValue(
					target.messageId && target.sessionId === source.sessionId && target.conversationId === conversationId,
					"EVIDENCE_GAP",
					"Source message is not available in the selected conversation",
				);
				return { conversationId, sessionId: target.sessionId, messageId: target.messageId };
			}
			case "inspectNativeRun": {
				const record = store.get(context, request.ref),
					data = record.data;
				requireValue(
					record.kind === "evidence" &&
						record.contentRef &&
						data.kind === "native-test-run" &&
						data.producer === "native-reader-v1",
					"INVALID_INPUT",
					"Select native run evidence",
				);
				let body;
				try {
					body = JSON.parse(store.readBlob(record));
				} catch (error) {
					if (error.code) throw error;
					requireValue(
						false,
						"EVIDENCE_GAP",
						"Inspect sealed evidence or collect a new observation: native reference is unavailable",
					);
				}
				requireValue(
					body &&
						["api", "ui"].includes(body.engine) &&
						typeof body.runId === "string" &&
						data.sourceId === `native:${body.engine}` &&
						data.sourceEventId === body.runId &&
						data.sourceLocator === `native:${body.engine}:${body.runId}` &&
						digest(body) === data.sourceRevision,
					"EVIDENCE_GAP",
					"Inspect sealed evidence or collect a new observation: native source identity cannot be verified",
				);
				const reference =
					body.engine === "api"
						? body.runId
						: body.evidence?.find((item) => item.path === `qa/ui/runs/${body.runId}/manifest.json`);
				requireValue(reference, "EVIDENCE_GAP", "Inspect sealed evidence: original run reference is missing");
				let run;
				try {
					run = await this.host.readEvaluationNative(context.clientId, {
						conversationId,
						sessionId: source.sessionId,
						engine: body.engine,
						reference,
					});
				} catch {
					requireValue(
						false,
						"EVIDENCE_GAP",
						"Original run is missing or cannot be verified. Inspect sealed evidence or collect a new observation",
					);
				}
				signal?.throwIfAborted();
				requireValue(!this.closed, "CAPABILITY_UNAVAILABLE", "Evaluation plugin is stopped");
				const fresh = this.authorize(trusted, { ...request, sessionId: source.sessionId });
				store.get(fresh.context, request.ref);
				requireValue(
					digest(run) === data.sourceRevision,
					"VERSION_CONFLICT",
					"Original run differs from sealed evidence. Inspect sealed evidence or collect a new observation",
				);
				const offset = request.offset ?? 0,
					rows = run.rows;
				requireValue(
					Array.isArray(rows) && offset <= rows.length,
					"INVALID_INPUT",
					"Run row offset is outside the record",
				);
				// Bound text as well as row count; original sealed bytes remain available separately.
				const text = (value) => String(value ?? "").slice(0, 96);
				return {
					engine: run.engine,
					runId: text(run.runId),
					at: text(run.at),
					complete: run.complete === true,
					review: text(run.review),
					sourceDigest: data.sourceRevision,
					rows: rows.slice(offset, offset + 20).map((row) => ({
						caseId: text(row.caseId),
						instanceId: text(row.instanceId),
						status: text(row.status),
						evidenceComplete: row.evidenceComplete === true,
					})),
					total: rows.length,
					offset,
					nextOffset: offset + 20 < rows.length ? offset + 20 : null,
				};
			}
			case "readEvidence": {
				const view = request.evidenceView ?? "raw";
				if (view === "raw")
					return store.readEvidence(context, request.ref, { offset: request.offset ?? 0, maxChars: 4096 });
				// Only decode the authorized, digest-checked sealed body. Never reopen a source path or run.
				const record = store.get(context, request.ref),
					data = record.data;
				requireValue(record.kind === "evidence" && record.contentRef, "EVIDENCE_GAP", "Evidence body is unavailable");
				requireValue(
					view === "artifact-text"
						? data.kind === "artifact-snapshot" && data.producer === "artifact-reader-v1"
						: data.kind === "native-test-run" && data.producer === "native-reader-v1",
					"INVALID_INPUT",
					"This evidence does not support the selected view",
				);
				let body;
				try {
					body = JSON.parse(store.readBlob(record));
				} catch (error) {
					if (error.code) throw error;
					requireValue(false, "EVIDENCE_GAP", "Sealed evidence is not valid JSON");
				}
				requireValue(
					body && typeof body === "object" && !Array.isArray(body),
					"EVIDENCE_GAP",
					"Sealed evidence has no structured body",
				);
				let text, unavailable;
				if (view === "artifact-text") {
					requireValue(
						body.path === data.sourceLocator,
						"EVIDENCE_GAP",
						"Sealed artifact path does not match its source",
					);
					unavailable = !body.exists
						? "file-missing"
						: typeof body.text !== "string"
							? body.truncated
								? "file-truncated"
								: "file-nontext"
							: undefined;
					text = unavailable ? "" : body.text;
				} else {
					requireValue(
						["api", "ui"].includes(body.engine) &&
							typeof body.runId === "string" &&
							data.sourceLocator === `native:${body.engine}:${body.runId}`,
						"EVIDENCE_GAP",
						"Sealed run does not match its source",
					);
					text = JSON.stringify(body, null, 2);
				}
				return { ...pageText(text, request.offset), view, unavailable, contentDigest: record.contentRef.sha256 };
			}
			case "export": {
				const bundle = store.export(context, request.ref);
				return { ...pageText(JSON.stringify(bundle, null, 2), request.offset), manifestDigest: bundle.manifestDigest };
			}
			case "createContract":
			case "reviseContract": {
				const data = request.data;
				requireValue(
					data && data.scope?.source === "pi" && data.scope.sessionId === source.sessionId,
					"PERMISSION_DENIED",
					"Contract requires the selected source session",
				);
				// Only human confirmation can promote a model-proposed condition to a mandatory requirement.
				if (trusted.channel === "tool")
					requireValue(
						[...(data.conditions ?? []), ...(data.constraints ?? [])].every(
							(c) => c.sourceType === "proposed" && c.required === false,
						),
						"PERMISSION_DENIED",
						"Agent conditions must remain proposals until confirmed in the UI",
					);
				const selected = this.host.readEvaluationEvidence(context.clientId, {
					conversationId,
					mode: "collect",
					sessionId: source.sessionId,
					startMessageId: data.scope.startMessageId,
					endMessageId: data.scope.endMessageId,
					childSessionIds: data.scope.childSessionIds,
					limit: 1,
				});
				requireValue(
					selected.rangeStart === data.scope.startMessageId && selected.rangeEnd === data.scope.endMessageId,
					"EVIDENCE_GAP",
					"Selected message boundaries cannot be verified",
				);
				requireValue(
					request.action !== "reviseContract" || request.previousRef,
					"INVALID_INPUT",
					"Revision requires the preceding contract reference",
				);
				return ref(
					write("contracts", data, "contract", request.action === "reviseContract" ? request.previousRef : undefined),
				);
			}
			case "createAttempt": {
				const contract = store.get(context, request.ref);
				requireValue(
					contract.kind === "contracts" &&
						contract.data.scope.source === "pi" &&
						contract.data.scope.sessionId === source.sessionId,
					"INVALID_INPUT",
					"A contract reference is required",
				);
				const target = write(
					"targets",
					{
						kind: "pi",
						clientVersion: source.clientVersion ?? "unknown",
						executableIdentity: "host-owned-pi-sdk-session",
						adapterVersion: "1",
						configRef: `session:${source.sessionId}`,
						capabilities: { history: "partial", live: "partial", usage: "partial" },
						isolation: "read-only-observation-of-selected-host-session",
					},
					"target",
				);
				return ref(
					write(
						"attempts",
						{
							contractRef: ref(contract),
							targetRef: ref(target),
							sourceSessionId: source.sessionId,
							configDigest: digest({ contract: contract.digest, target: target.digest }),
							state: "unknown",
							terminationReason: "historical-observation-does-not-prove-execution-end",
						},
						"attempt",
					),
				);
			}
			case "collect": {
				const controller = new AbortController();
				this.controllers.set(controller, trusted.clientId);
				try {
					const collected = await this.collector.collect(context, {
						attemptRef: request.ref,
						conversationId,
						requestId,
						artifactPaths: request.artifactPaths ?? [],
						nativeRefs: request.nativeRefs ?? [],
						signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
					});
					return {
						checkpointRef: collected.checkpointRef,
						coverage: collected.coverage,
						evidenceCount: collected.evidenceRefs.length,
						gapCount: collected.gaps.length,
						gaps: collected.gaps.slice(0, 100),
					};
				} finally {
					this.controllers.delete(controller);
				}
			}
			case "seal":
				return ref(this.collector.seal(context, request.ref, requestId));
			case "evaluate": {
				let snapshotRef = request.ref,
					profile;
				const known = this.registry.profile("internal", "1").rules.map((r) => r.id);
				if (request.ref?.kind === "evaluations") {
					requireValue(
						request.configs === undefined,
						"INVALID_INPUT",
						"Original report scoring cannot override configs",
					);
					const original = store.get(context, request.ref),
						configuration = original.data.configuration;
					requireValue(configuration, "EVIDENCE_GAP", "Original rule configuration is unavailable");
					requireValue(
						digest(configuration) === original.data.configDigest,
						"STORE_CORRUPT",
						"Original rule configuration digest differs",
					);
					requireValue(
						configuration.profileVersion === "1" &&
							(configuration.profileId === "internal" || /^internal-[a-f0-9]{55}$/.test(configuration.profileId)) &&
							configuration.rules.length === known.length &&
							known.every((id) => configuration.rules.some((r) => r.id === id)),
						"CAPABILITY_UNAVAILABLE",
						"Only complete internal profiles can be restored for exact re-scoring",
					);
					profile = {
						...internalProfile(),
						id: configuration.profileId,
						version: configuration.profileVersion,
						rules: configuration.rules,
						required: configuration.rules.map(({ id, version }) => ({ id, version })),
					};
					snapshotRef = original.data.snapshotRef;
				} else {
					const configs = request.configs ?? {};
					requireValue(
						Object.keys(configs).every((id) => known.includes(id)),
						"INVALID_INPUT",
						"Unknown rule configuration",
					);
					profile = internalProfile(configs, { id: `internal-${digest(configs).slice(0, 55)}` });
				}
				const key = `${profile.id}@${profile.version}`;
				if (!this.profiles) this.profiles = new Set();
				if (key !== "internal@1" && !this.profiles.has(key)) {
					requireValue(
						this.profiles.size < 1000,
						"LIMIT_EXCEEDED",
						"Profile limit reached; reload the plugin before adding new configurations",
					);
					this.registry.registerProfile(profile);
					this.profiles.add(key);
				} else
					requireValue(
						digest(this.registry.profile(profile.id, profile.version).rules) === digest(profile.rules),
						"VERSION_CONFLICT",
						"Stored profile configuration conflicts with registered version",
					);
				const job = this.engine.start(context, {
					snapshotRef,
					profileId: profile.id,
					profileVersion: profile.version,
					requestId,
				});
				this.pending.add(job.done);
				job.done.catch(() => {}).finally(() => this.pending.delete(job.done));
				return { jobId: job.jobId, state: job.state };
			}
			case "status":
				return this.engine.status(context, request.jobId);
			case "cancel":
				return this.engine.cancel(context, request.jobId);
			case "review": {
				requireValue(trusted.channel === "ui", "PERMISSION_DENIED", "Human review requires the UI channel");
				return ref(write("reviews", request.data, "review"));
			}
		}
	}
	watchStatus(entry) {
		return {
			watchId: entry.watchId,
			state: entry.stopped ? "stopped" : "observing",
			...entry.handle.status(),
			latest: entry.latest,
			error: entry.error,
		};
	}
	stopWatch(entry) {
		if (entry.stopped) return;
		entry.stopped = true;
		clearTimeout(entry.timer);
		entry.handle.stop();
	}
	renewWatch(entry) {
		clearTimeout(entry.timer);
		entry.timer = setTimeout(() => this.stopWatch(entry), 60000);
		entry.timer.unref?.();
	}
	stopClient(clientId) {
		if (this.closed) return;
		const watch = this.watches.get(clientId);
		if (watch) this.stopWatch(watch);
		for (const [controller, owner] of this.controllers) if (owner === clientId) controller.abort();
		this.uploads.stopClient(clientId);
		this.engine?.stopClient(clientId);
	}
	close() {
		if (this.closed) return;
		this.uploads.close();
		for (const entry of this.watches.values()) this.stopWatch(entry);
		for (const controller of this.controllers.keys()) controller.abort();
		this.collector?.close();
		// Persist cancellation requests before invalidating identities and releasing the writer lock.
		this.engine?.close();
		this.closed = true;
		this.store?.close();
	}
}
