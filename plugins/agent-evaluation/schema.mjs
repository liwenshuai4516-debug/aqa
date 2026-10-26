/** Versioned evaluation records. Runtime validation only; wire types belong in server/protocol.ts. */
import { Type as T } from "typebox";
import { Compile } from "typebox/compile";
import { createHash } from "node:crypto";

export const VERSION = 1;
export const LIMITS = Object.freeze({
	capacityBytes: 256 * 1024 ** 2,
	records: 10000,
	recordBytes: 2 * 1024 ** 2,
	evidenceBytes: 1024 ** 2,
	page: 100,
	snapshotItems: 1000,
	readBytes: 8 * 1024 ** 2,
	readItems: 1000,
	readMs: 2000,
});
export class EvaluationError extends Error {
	constructor(code, message, stage = "store", retryable = false) {
		super(message);
		this.name = "EvaluationError";
		this.code = code;
		this.stage = stage;
		this.retryable = retryable;
		this.missingConditions = [];
	}
}
export function requireValue(ok, code, message) {
	if (!ok) throw new EvaluationError(code, message);
}
export function canonical(value) {
	if (!value || typeof value !== "object") return JSON.stringify(value);
	// Join once at the root so a nested evidence body is not copied at every level.
	const parts = [];
	const append = (entry, objectValue = false) => {
		if (Array.isArray(entry)) {
			parts.push("[");
			const length = entry.length;
			for (let i = 0; i < length; i++) {
				if (i) parts.push(",");
				if (i in entry) append(entry[i]);
			}
			parts.push("]");
		} else if (entry && typeof entry === "object") {
			parts.push("{");
			const keys = Object.keys(entry).sort();
			keys.forEach((key, i) => {
				if (i) parts.push(",");
				parts.push(JSON.stringify(key), ":");
				append(entry[key], true);
			});
			parts.push("}");
		} else {
			const encoded = JSON.stringify(entry);
			// Preserve the legacy object interpolation versus array join semantics for undefined.
			parts.push(objectValue ? String(encoded) : encoded);
		}
	};
	append(value);
	return parts.join("");
}
export const digest = (value) => createHash("sha256").update(canonical(value)).digest("hex");
/** Exact JSON string bytes without allocating an escaped copy of a long body. */
export function jsonStringBytes(text) {
	let bytes = Buffer.byteLength(text) + 2;
	for (const match of text.matchAll(/["\\\u0000-\u001f]/g)) {
		const character = match[0];
		bytes += character.charCodeAt(0) < 32 && !"\b\t\n\f\r".includes(character) ? 5 : 1;
	}
	// UTF-8 replaces lone surrogates with three bytes; JSON emits six-byte \uXXXX.
	// A valid pair stays as four UTF-8 bytes and needs no adjustment.
	for (const match of text.matchAll(/[\ud800-\udfff]/g)) {
		const code = match[0].charCodeAt(0),
			neighbor = text.charCodeAt(match.index + (code < 0xdc00 ? 1 : -1)),
			paired = code < 0xdc00 ? neighbor >= 0xdc00 && neighbor <= 0xdfff : neighbor >= 0xd800 && neighbor <= 0xdbff;
		if (!paired) bytes += 3;
	}
	return bytes;
}
const str = T.String({ minLength: 1, maxLength: 16384 });
const uuid = T.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" });
const hash = T.String({ pattern: "^[a-f0-9]{64}$" });
const integer = T.Integer({ minimum: 1 });
const choice = (...values) => T.Union(values.map((v) => T.Literal(v)));
const obj = (fields) => T.Object(fields, { additionalProperties: false });
const list = (item, maxItems = 1000) => T.Array(item, { maxItems });
const optional = T.Optional;
export const KINDS = ["contracts", "targets", "attempts", "evidence", "snapshots", "evaluations", "reviews"];
export const Ref = obj({ kind: choice(...KINDS), id: uuid, revision: integer });
const ref = (kind) => obj({ kind: T.Literal(kind), id: uuid, revision: integer });
export const Domain = obj({ principalId: str, workspaceId: str });
const condition = obj({
	id: str,
	statement: str,
	sourceRef: str,
	sourceType: choice("user", "project-policy", "proposed"),
	required: T.Boolean(),
	applicableWhen: str,
	ruleRef: optional(str),
	verifierRef: optional(str),
});
const piScope = obj({
	source: T.Literal("pi"),
	sessionId: str,
	startMessageId: str,
	endMessageId: str,
	boundaryPrecision: choice("exact", "selection-snapshot"),
	childPolicy: choice("exclude", "explicit"),
	childSessionIds: list(str, 100),
	selectionDigest: optional(hash),
});
const offlineScope = obj({
	source: T.Literal("offline"),
	// This is the host authorization anchor, never an external ATIF session_id.
	sessionId: str,
	packageDigest: hash,
	format: T.Literal("ATIF-v1.8"),
	converterVersion: T.Literal("1"),
	trajectoryPointers: T.Array(T.String({ minLength: 1, maxLength: 1024 }), {
		minItems: 1,
		maxItems: 20,
		uniqueItems: true,
	}),
});
const scope = T.Union([piScope, offlineScope]);
export const scopeSessions = (scope) =>
	scope.source === "offline" ? [scope.sessionId] : [scope.sessionId, ...scope.childSessionIds];
const states = [
	"queued",
	"preparing",
	"running",
	"waiting-input",
	"ended",
	"blocked",
	"start-failed",
	"cancelled",
	"cancelling",
	"timed-out",
	"interrupted",
	"unknown",
];
const verdict = choice("pass", "fail", "inconclusive", "not-applicable");
const attribution = obj({
	category: choice(
		"agent-decision",
		"tool-or-app",
		"environment-or-permission",
		"requirement-or-data",
		"evaluator",
		"unknown",
	),
	evidenceRefs: list(ref("evidence")),
	status: choice("verified", "unconfirmed"),
});
export const Finding = obj({
	findingId: str,
	conditionId: optional(str),
	ruleId: str,
	ruleVersion: str,
	verdict,
	evidenceState: choice("sufficient", "partial", "unavailable", "invalid"),
	method: choice("deterministic", "human", "model"),
	nature: choice("verified", "judgment", "unconfirmed"),
	evidenceRefs: list(ref("evidence")),
	missingEvidence: list(str),
	reason: str,
	attributions: list(attribution),
	error: optional(str),
	metrics: optional(T.Record(str, T.Unknown())),
});
export const schemas = {
	contracts: obj({
		scope,
		objective: str,
		conditions: list(condition),
		constraints: list(condition),
		environmentRefs: list(str),
		provenance: str,
		evaluationSubject: choice("agent-task", "client-software"),
	}),
	targets: obj({
		kind: choice("pi", "cli", "offline"),
		clientVersion: str,
		executableIdentity: str,
		adapterVersion: str,
		configRef: str,
		capabilities: T.Record(str, choice("supported", "partial", "unsupported", "unknown")),
		isolation: str,
		credentialRef: optional(str),
	}),
	attempts: obj({
		contractRef: ref("contracts"),
		targetRef: ref("targets"),
		sourceSessionId: optional(str),
		parentAttemptRef: optional(ref("attempts")),
		previousAttemptRef: optional(ref("attempts")),
		configDigest: hash,
		state: choice(...states),
		terminationReason: optional(str),
		startedAt: optional(str),
		endedAt: optional(str),
	}),
	evidence: obj({
		attemptRef: ref("attempts"),
		sourceId: str,
		sourceEventId: optional(str),
		sourceLocator: str,
		sourceRevision: optional(str),
		producer: str,
		availability: choice("available", "partial", "unavailable"),
		origin: choice("harness-observed", "target-reported", "instrumented", "externally-verified", "human-observed"),
		kind: str,
		observedAt: str,
		occurredAt: optional(str),
		content: optional(T.String({ maxLength: LIMITS.evidenceBytes })),
		redaction: list(str),
		truncated: T.Boolean(),
	}),
	snapshots: obj({
		contractRef: ref("contracts"),
		attemptRefs: list(ref("attempts")),
		sourceWatermarks: T.Record(str, str),
		evidenceRefs: list(ref("evidence")),
		coverage: choice("complete", "partial", "unknown"),
		gaps: list(str),
		sealedAt: str,
	}),
	evaluations: obj({
		snapshotRef: ref("snapshots"),
		contractRef: ref("contracts"),
		profileVersion: str,
		evaluatorVersions: T.Record(str, str),
		configDigest: hash,
		state: choice("completed", "failed", "cancelled"),
		findings: list(Finding),
		summary: obj({
			deliveryVerdict: choice("pass", "fail", "inconclusive"),
			goal: choice("achieved", "partially-achieved", "not-achieved", "undetermined"),
			behavior: optional(choice("pass", "fail", "inconclusive")),
			counts: optional(
				obj({
					object: T.Literal("findings"),
					planned: T.Integer({ minimum: 0 }),
					executed: T.Integer({ minimum: 0 }),
					determinate: T.Integer({ minimum: 0 }),
					pass: T.Integer({ minimum: 0 }),
					fail: T.Integer({ minimum: 0 }),
					inconclusive: T.Integer({ minimum: 0 }),
					notExecuted: T.Integer({ minimum: 0 }),
					errors: T.Integer({ minimum: 0 }),
					excluded: T.Integer({ minimum: 0 }),
					passRate: T.Union([T.Number({ minimum: 0, maximum: 1 }), T.Null()]),
					coverage: T.Union([T.Number({ minimum: 0, maximum: 1 }), T.Null()]),
				}),
			),
			exclusions: optional(list(obj({ findingId: str, reason: str }))),
			requiredRuleGaps: optional(list(str)),
		}),
		assessmentStage: choice("provisional", "final"),
		configuration: optional(
			obj({
				profileId: str,
				profileVersion: str,
				rules: list(obj({ id: str, version: str, config: T.Record(str, T.Unknown()) })),
			}),
		),
		job: optional(
			obj({
				jobId: str,
				generation: T.Integer({ minimum: 1 }),
				queuedAt: str,
				startedAt: optional(str),
				endedAt: str,
				elapsedMs: optional(T.Number({ minimum: 0 })),
				clockSource: optional(T.Literal("process-monotonic")),
				cancellationRequestedAt: optional(str),
				cancellationConfirmedAt: optional(str),
				error: optional(str),
			}),
		),
	}),
	reviews: obj({
		evaluationRef: ref("evaluations"),
		findingId: str,
		previousReviewRef: optional(ref("reviews")),
		decision: verdict,
		reason: str,
	}),
};
// Compile only these bundled record schemas. Caller-supplied evaluator schemas are not compiled here.
const validators = Object.fromEntries(Object.entries(schemas).map(([kind, schema]) => [kind, Compile(schema)]));
const refValidator = Compile(Ref),
	domainValidator = Compile(Domain);
export function validate(kind, value, version = VERSION) {
	requireValue(version === VERSION, "SCHEMA_UNSUPPORTED", "Unsupported evaluation schema version");
	requireValue(
		Object.hasOwn(validators, kind) && validators[kind].Check(value),
		"INVALID_INPUT",
		`Invalid ${kind} record`,
	);
	if (kind === "contracts") {
		const conditions = [...value.conditions, ...value.constraints];
		requireValue(
			new Set(conditions.map((c) => c.id)).size === conditions.length,
			"INVALID_INPUT",
			"Duplicate condition ID",
		);
		requireValue(
			conditions.every((c) => c.sourceType !== "proposed" || !c.required),
			"INVALID_INPUT",
			"Proposed conditions cannot be required",
		);
		requireValue(
			value.scope.source !== "pi" || value.scope.childPolicy !== "exclude" || value.scope.childSessionIds.length === 0,
			"INVALID_INPUT",
			"Excluded child scope must be empty",
		);
		requireValue(
			value.scope.boundaryPrecision !== "selection-snapshot" || value.scope.selectionDigest,
			"INVALID_INPUT",
			"Historical selection needs a digest",
		);
	}
	if (kind === "evidence") {
		const contentBytes = Buffer.byteLength(value.content ?? "");
		requireValue(contentBytes <= LIMITS.evidenceBytes, "LIMIT_EXCEEDED", "Evidence exceeds byte limit");
		// Reuse only for this validated value in the current synchronous write.
		return contentBytes;
	}
}
export function validateRef(value) {
	requireValue(refValidator.Check(value), "INVALID_INPUT", "Invalid record reference");
}
export function validateDomain(value) {
	requireValue(domainValidator.Check(value), "PERMISSION_DENIED", "Trusted domain is unavailable");
}
export function references(kind, data) {
	switch (kind) {
		case "attempts":
			return [data.contractRef, data.targetRef, data.parentAttemptRef, data.previousAttemptRef].filter(Boolean);
		case "evidence":
			return [data.attemptRef];
		case "snapshots":
			return [data.contractRef, ...data.attemptRefs, ...data.evidenceRefs];
		case "evaluations":
			return [
				data.snapshotRef,
				data.contractRef,
				...data.findings.flatMap((f) => [...f.evidenceRefs, ...f.attributions.flatMap((a) => a.evidenceRefs)]),
			];
		case "reviews":
			return [data.evaluationRef, data.previousReviewRef].filter(Boolean);
		default:
			return [];
	}
}
export function redact(value) {
	if (typeof value === "string")
		return value
			.replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
			.replace(/\b(?:sk-|sk_|ghp_)[A-Za-z0-9_-]{12,}/g, "[REDACTED]");
	if (Array.isArray(value)) {
		const clean = value.map(redact);
		return clean.every((item, i) => item === value[i]) ? value : clean;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value).map(([k, v]) => [
			k,
			/^(password|secret|token|api[-_]?key|authorization|cookie|credential)$/i.test(k) ? "[REDACTED]" : redact(v),
		]);
		return entries.every(([k, v]) => v === value[k]) ? value : Object.fromEntries(entries);
	}
	return value;
}
export const transitions = {
	queued: ["preparing", "blocked", "cancelled", "start-failed"],
	preparing: ["running", "blocked", "start-failed", "cancelled", "interrupted", "unknown"],
	running: ["waiting-input", "ended", "cancelling", "interrupted", "unknown"],
	"waiting-input": ["running", "ended", "cancelling", "interrupted", "unknown"],
	cancelling: ["cancelled", "timed-out", "unknown", "interrupted"],
	interrupted: ["unknown", "running", "ended", "blocked", "start-failed", "cancelled", "timed-out"],
	unknown: ["running", "waiting-input", "ended", "blocked", "start-failed", "cancelled", "timed-out"],
};
