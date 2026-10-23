/** Single writer, immutable revision files. No execution or source reads during recovery.
 * authorize(context) is injected by the trusted host, never derived from request payloads.
 * The receipt and record share one atomic file; the in-memory index is fully rebuildable.
 */
import * as fs from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { publishFile } from "./durable.mjs";
import {
	VERSION,
	LIMITS,
	KINDS,
	EvaluationError,
	requireValue,
	canonical,
	digest,
	validate,
	validateRef,
	validateDomain,
	references,
	redact,
	transitions,
} from "./schema.mjs";

const key = (ref) => `${ref.kind}/${ref.id}.${ref.revision}`;
const same = (a, b) => canonical(a) === canonical(b);
const recordRef = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
const NOFOLLOW = fs.constants.O_NOFOLLOW;
const contentHash = (text) => createHash("sha256").update(text).digest("hex");

export class EvaluationStore {
	constructor({ dataDir, authorize, readOnly = false, limits = {}, fault = (_stage) => {} }) {
		requireValue(typeof authorize === "function", "PERMISSION_DENIED", "Trusted authorization provider required");
		this.authorize = authorize;
		this.readOnly = readOnly;
		this.fault = fault;
		this.closed = false;
		this.limits = { ...LIMITS, ...limits };
		for (const [name, value] of Object.entries(this.limits))
			requireValue(
				Number.isSafeInteger(value) && value > 0 && value <= LIMITS[name],
				"INVALID_INPUT",
				"Limits may only tighten the frozen defaults",
			);
		if (!readOnly) fs.mkdirSync(dataDir, { recursive: true });
		this.dataDir = fs.realpathSync(dataDir);
		this.root = join(this.dataDir, "agent-evaluation");
		if (!fs.existsSync(this.root)) {
			requireValue(!readOnly, "CAPABILITY_UNAVAILABLE", "Evaluation store does not exist");
			fs.mkdirSync(this.root, { mode: 0o700 });
		}
		this.checkDirectory(this.root);
		this.lock = join(this.root, "writer.lock");
		this.nonce = randomUUID();
		if (!readOnly) {
			try {
				const fd = fs.openSync(
					this.lock,
					fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW,
					0o600,
				);
				try {
					fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, nonce: this.nonce, at: new Date().toISOString() }));
					fs.fsyncSync(fd);
				} finally {
					fs.closeSync(fd);
				}
			} catch {
				throw new EvaluationError(
					"STORE_LOCKED",
					"Writer lock exists or cannot be created; do not reclaim by PID alone",
				);
			}
		}
		try {
			for (const kind of [...KINDS, "blobs"]) {
				const dir = join(this.root, kind);
				if (!fs.existsSync(dir) && !readOnly) fs.mkdirSync(dir, { mode: 0o700 });
				if (fs.existsSync(dir)) this.checkDirectory(dir);
			}
			this.rebuild();
		} catch (error) {
			this.close();
			throw error;
		}
	}
	checkDirectory(path) {
		const stat = fs.lstatSync(path);
		requireValue(
			stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(path) === resolve(path),
			"PERMISSION_DENIED",
			"Storage directory must not be a symlink",
		);
	}
	readFile(file, limit = this.limits.recordBytes) {
		this.checkDirectory(this.root);
		this.checkDirectory(dirname(file));
		const fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
		try {
			const stat = fs.fstatSync(fd);
			requireValue(stat.isFile() && stat.nlink === 1, "PERMISSION_DENIED", "Storage links are forbidden");
			requireValue(stat.size <= limit, "LIMIT_EXCEEDED", "Record exceeds read budget");
			const bytes = Buffer.alloc(stat.size + 1);
			const size = fs.readSync(fd, bytes, 0, bytes.length, 0);
			requireValue(size === stat.size, "STORE_CORRUPT", "Record changed during read");
			return bytes.subarray(0, size).toString("utf8");
		} finally {
			fs.closeSync(fd);
		}
	}
	load(file) {
		const raw = this.readFile(file);
		let record;
		try {
			record = JSON.parse(raw);
		} catch {
			throw new EvaluationError("STORE_CORRUPT", "Malformed record; original preserved");
		}
		requireValue(record && typeof record === "object", "STORE_CORRUPT", "Invalid record envelope");
		requireValue(record.schemaVersion === VERSION, "SCHEMA_UNSUPPORTED", "Unknown stored schema; original preserved");
		validateRef(recordRef(record));
		validateDomain(record.domain);
		validate(record.kind, record.data);
		const { digest: expected, ...unsigned } = record;
		requireValue(digest(unsigned) === expected, "STORE_CORRUPT", "Record digest mismatch");
		requireValue(
			typeof record.request?.id === "string" && typeof record.request?.digest === "string",
			"STORE_CORRUPT",
			"Missing atomic request receipt",
		);
		return record;
	}
	rebuild() {
		this.index = new Map();
		this.requests = new Map();
		this.issues = [];
		this.usedBytes = 0;
		const scan = (dir) => {
			this.checkDirectory(dir);
			for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
				const file = join(dir, item.name);
				const stat = fs.lstatSync(file);
				if (stat.isSymbolicLink()) {
					this.issues.push({ code: "STORE_CORRUPT", file: item.name });
					continue;
				}
				if (stat.isDirectory()) {
					if (dir === this.root && [...KINDS, "blobs"].includes(item.name)) scan(file);
					else this.issues.push({ code: "STORE_CORRUPT", file: item.name });
					continue;
				}
				this.usedBytes += stat.size;
				if (file === this.lock) continue;
				if (dir === join(this.root, "blobs") && /^[a-f0-9]{64}-[a-f0-9]{64}\.blob$/.test(item.name)) continue;
				if (!item.name.endsWith(".json") || dir === this.root) {
					this.issues.push({ code: "EVIDENCE_GAP", file: item.name });
					continue;
				}
				try {
					requireValue(this.index.size < this.limits.records, "LIMIT_EXCEEDED", "Too many persisted records");
					const record = this.load(file),
						ref = recordRef(record);
					requireValue(
						file === join(this.root, `${key(ref)}.json`),
						"STORE_CORRUPT",
						"Record identity differs from its filename",
					);
					const requestKey = digest([record.domain, record.request.id]);
					requireValue(!this.requests.has(requestKey), "STORE_CORRUPT", "Duplicate persisted request ID");
					this.index.set(key(ref), { file, ref, domain: record.domain });
					this.requests.set(requestKey, { ref, digest: record.request.digest });
				} catch (error) {
					this.issues.push({ code: error.code ?? "STORE_CORRUPT", file: item.name });
				}
			}
		};
		scan(this.root);
	}
	identity(context, write = false) {
		requireValue(!this.closed, "CAPABILITY_UNAVAILABLE", "Store is closed");
		const identity = this.authorize(context);
		requireValue(
			identity && Array.isArray(identity.sessionIds),
			"PERMISSION_DENIED",
			"Trusted selection identity required",
		);
		validateDomain(identity.domain);
		requireValue(!write || identity.allowWrite === true, "PERMISSION_DENIED", "Local evaluation writes denied");
		return identity;
	}
	get(
		context,
		ref,
		visited = new Set(),
		budget = { bytes: 0, items: 0, started: performance.now(), cache: new Map() },
	) {
		validateRef(ref);
		const identity = this.identity(context),
			entry = this.index.get(key(ref));
		requireValue(
			entry && same(entry.domain, identity.domain),
			"PERMISSION_DENIED",
			"Record unavailable in this authorization domain",
		);
		requireValue(!visited.has(key(ref)), "STORE_CORRUPT", "Cyclic record references");
		if (budget.cache.has(key(ref))) return budget.cache.get(key(ref));
		budget.bytes += fs.lstatSync(entry.file).size;
		budget.items += 1;
		requireValue(
			visited.size < 64 &&
				budget.bytes <= this.limits.readBytes &&
				budget.items <= this.limits.readItems &&
				performance.now() - budget.started <= this.limits.readMs,
			"LIMIT_EXCEEDED",
			"Reference traversal exceeds read budget",
		);
		const next = new Set(visited);
		next.add(key(ref));
		const record = this.load(entry.file);
		requireValue(same(record.domain, identity.domain), "PERMISSION_DENIED", "Record domain changed");
		if (record.kind === "contracts") {
			const scope = record.data.scope;
			requireValue(
				[scope.sessionId, ...scope.childSessionIds].every((id) => identity.sessionIds.includes(id)),
				"PERMISSION_DENIED",
				"Session selection is not authorized",
			);
		}
		for (const child of references(record.kind, record.data)) {
			const linked = this.get(context, child, next, budget);
			requireValue(
				record.referenceDigests?.[key(child)] === linked.digest,
				"STORE_CORRUPT",
				"Referenced evidence changed after sealing",
			);
		}
		budget.cache.set(key(ref), record);
		return record;
	}
	list(context, { kind = "contracts", cursor = "", limit = 50 } = {}) {
		this.identity(context);
		requireValue(
			KINDS.includes(kind) &&
				typeof cursor === "string" &&
				Number.isInteger(limit) &&
				limit > 0 &&
				limit <= this.limits.page,
			"INVALID_INPUT",
			"Invalid page request",
		);
		const items = [],
			keys = [...this.index.keys()].filter((k) => k.startsWith(`${kind}/`) && k > cursor).sort();
		let last = cursor;
		for (const k of keys) {
			last = k;
			try {
				const r = this.get(context, this.index.get(k).ref);
				items.push({ ...recordRef(r), createdAt: r.createdAt, digest: r.digest });
			} catch (error) {
				if (error.code !== "PERMISSION_DENIED") throw error;
			}
			if (items.length === limit) break;
		}
		return { items, nextCursor: keys.some((k) => k > last) ? last : null };
	}
	write(context, { kind, data, requestId, schemaVersion = VERSION, previousRef = undefined }) {
		const identity = this.identity(context, true);
		requireValue(
			typeof requestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(requestId),
			"INVALID_INPUT",
			"Invalid request ID",
		);
		requireValue(
			Buffer.byteLength(canonical(data)) <= this.limits.recordBytes,
			"LIMIT_EXCEEDED",
			"Input exceeds record budget",
		);
		validate(kind, data, schemaVersion);
		if (previousRef) {
			validateRef(previousRef);
			requireValue(previousRef.kind === kind, "INVALID_INPUT", "Revision kind differs");
		}
		const requestDigest = digest({ kind, data: redact(data), schemaVersion, previousRef: previousRef ?? null });
		const receipt = this.requests.get(digest([identity.domain, requestId]));
		if (receipt) {
			requireValue(
				receipt.digest === requestDigest,
				"VERSION_CONFLICT",
				"Request ID already used with different input",
			);
			return this.get(context, receipt.ref);
		}
		requireValue(!this.readOnly, "PERMISSION_DENIED", "Store is read only");
		requireValue(
			!this.issues.length,
			"STORE_CORRUPT",
			"Recovery issues require explicit repair; original files preserved",
		);
		this.checkDirectory(this.root);
		requireValue(JSON.parse(this.readFile(this.lock)).nonce === this.nonce, "STORE_LOCKED", "Writer ownership changed");
		if (kind === "reviews")
			requireValue(identity.human === true, "PERMISSION_DENIED", "Human review requires trusted UI identity");
		if (kind === "contracts")
			requireValue(
				[data.scope.sessionId, ...data.scope.childSessionIds].every((id) => identity.sessionIds.includes(id)),
				"PERMISSION_DENIED",
				"Contract selection is not authorized",
			);
		for (const ref of references(kind, data)) this.get(context, ref);
		let id = randomUUID(),
			revision = 1;
		if (previousRef) {
			requireValue(
				["contracts", "targets", "attempts"].includes(kind),
				"VERSION_CONFLICT",
				"Sealed records are immutable; create a new object",
			);
			const previous = this.get(context, previousRef);
			requireValue(
				![...this.index.values()].some(
					(e) => e.ref.kind === kind && e.ref.id === previousRef.id && e.ref.revision > previousRef.revision,
				),
				"VERSION_CONFLICT",
				"Revision is stale",
			);
			id = previous.id;
			revision = previous.revision + 1;
			if (kind === "attempts") {
				const {
					state: oldState,
					terminationReason: _oldReason,
					endedAt: _oldEnd,
					startedAt: _oldStart,
					...oldIdentity
				} = previous.data;
				const { state, terminationReason: _reason, endedAt: _end, startedAt: _start, ...newIdentity } = data;
				requireValue(
					same(oldIdentity, newIdentity) && transitions[oldState]?.includes(state),
					"VERSION_CONFLICT",
					"Invalid attempt identity or state transition",
				);
				requireValue(
					!["unknown", "interrupted"].includes(oldState) || identity.reconciled === true,
					"PERMISSION_DENIED",
					"Unknown execution requires trusted reconciliation",
				);
			}
		}
		this.validateRelations(context, kind, data);
		const clean = redact(data),
			redacted = !same(clean, data);
		if (kind === "evidence" && redacted) clean.redaction = [...new Set([...clean.redaction, "credentials-v1"])];
		validate(kind, clean);
		const record = {
			schemaVersion: VERSION,
			kind,
			id,
			revision,
			domain: identity.domain,
			createdAt: new Date().toISOString(),
			data: clean,
			referenceDigests: Object.fromEntries(
				references(kind, clean).map((ref) => [key(ref), this.get(context, ref).digest]),
			),
			redacted,
			request: { id: requestId, digest: requestDigest },
		};
		if (kind === "reviews") record.reviewer = identity.domain.principalId;
		const content = kind === "evidence" ? clean.content : undefined;
		if (content !== undefined) {
			record.contentRef = { sha256: contentHash(content), size: Buffer.byteLength(content) };
			delete clean.content;
		}
		record.digest = digest(record);
		const bytes = canonical(record);
		requireValue(
			Buffer.byteLength(bytes) <= this.limits.recordBytes,
			"LIMIT_EXCEEDED",
			"Serialized record exceeds budget",
		);
		requireValue(
			this.index.size < this.limits.records &&
				this.usedBytes +
					Buffer.byteLength(bytes) +
					(content === undefined || fs.existsSync(this.blobPath(record)) ? 0 : record.contentRef.size) <=
					this.limits.capacityBytes,
			"LIMIT_EXCEEDED",
			"Evaluation store capacity reached",
		);
		const ref = recordRef(record),
			file = join(this.root, `${key(ref)}.json`);
		this.checkDirectory(dirname(file));
		try {
			if (content !== undefined) {
				const blob = this.blobPath(record);
				this.checkDirectory(dirname(blob));
				if (fs.existsSync(blob)) this.readBlob(record);
				else {
					publishFile(blob, content);
					this.usedBytes += record.contentRef.size;
				}
			}
			publishFile(file, bytes, this.fault);
		} catch (error) {
			this.rebuild();
			throw new EvaluationError(
				error.published ? "EXECUTION_UNKNOWN" : "IO_ERROR",
				error.published
					? "Commit may be durable; query with the same request ID"
					: "Write failed; original temporary evidence preserved",
			);
		}
		this.index.set(key(ref), { file, ref, domain: record.domain });
		this.requests.set(digest([identity.domain, requestId]), { ref, digest: requestDigest });
		this.usedBytes += Buffer.byteLength(bytes);
		return structuredClone(record);
	}
	validateRelations(context, kind, data) {
		if (kind === "attempts") {
			const contract = this.get(context, data.contractRef);
			requireValue(
				!data.sourceSessionId ||
					data.sourceSessionId === contract.data.scope.sessionId ||
					(data.parentAttemptRef &&
						contract.data.scope.childSessionIds.includes(data.sourceSessionId) &&
						same(this.get(context, data.parentAttemptRef).data.contractRef, data.contractRef)),
				"INVALID_INPUT",
				"Attempt session differs from contract",
			);
			if (data.previousAttemptRef)
				requireValue(
					this.get(context, data.previousAttemptRef).data.contractRef.id === data.contractRef.id,
					"INVALID_INPUT",
					"Retry must belong to the same task",
				);
		}
		if (kind === "snapshots") {
			requireValue(
				data.attemptRefs.length > 0 && new Set(data.evidenceRefs.map(key)).size === data.evidenceRefs.length,
				"INVALID_INPUT",
				"Snapshot needs attempts and unique evidence",
			);
			for (const ref of data.attemptRefs)
				requireValue(
					same(this.get(context, ref).data.contractRef, data.contractRef),
					"INVALID_INPUT",
					"Snapshot task revision differs",
				);
			for (const ref of data.evidenceRefs)
				requireValue(
					data.attemptRefs.some((a) => a.id === this.get(context, ref).data.attemptRef.id),
					"INVALID_INPUT",
					"Evidence belongs to another attempt",
				);
		}
		if (kind === "evaluations") {
			const snapshot = this.get(context, data.snapshotRef);
			requireValue(
				same(snapshot.data.contractRef, data.contractRef),
				"INVALID_INPUT",
				"Evaluation contract differs from snapshot",
			);
			const allowed = new Set(snapshot.data.evidenceRefs.map(key));
			for (const f of data.findings)
				for (const ref of [...f.evidenceRefs, ...f.attributions.flatMap((a) => a.evidenceRefs)])
					requireValue(allowed.has(key(ref)), "PERMISSION_DENIED", "Finding evidence is outside the snapshot");
		}
		if (kind === "reviews") {
			requireValue(
				this.get(context, data.evaluationRef).data.findings.some((f) => f.findingId === data.findingId),
				"INVALID_INPUT",
				"Reviewed finding does not exist",
			);
			if (data.previousReviewRef) {
				const previous = this.get(context, data.previousReviewRef).data;
				requireValue(
					same(previous.evaluationRef, data.evaluationRef) && previous.findingId === data.findingId,
					"INVALID_INPUT",
					"Review chain differs",
				);
			}
		}
	}
	blobPath(record) {
		requireValue(
			record.kind === "evidence" &&
				/^[a-f0-9]{64}$/.test(record.contentRef?.sha256) &&
				Number.isSafeInteger(record.contentRef.size) &&
				record.contentRef.size >= 0 &&
				record.contentRef.size <= this.limits.evidenceBytes,
			"STORE_CORRUPT",
			"Invalid evidence content reference",
		);
		return join(this.root, "blobs", `${digest(record.domain)}-${record.contentRef.sha256}.blob`);
	}
	readBlob(record) {
		const content = this.readFile(this.blobPath(record), this.limits.evidenceBytes);
		requireValue(
			contentHash(content) === record.contentRef.sha256 && Buffer.byteLength(content) === record.contentRef.size,
			"STORE_CORRUPT",
			"Evidence content digest mismatch",
		);
		return content;
	}
	readEvidence(context, ref, { offset = 0, maxChars = 12000 } = {}) {
		const record = this.get(context, ref);
		requireValue(
			Number.isInteger(offset) && offset >= 0 && Number.isInteger(maxChars) && maxChars > 0 && maxChars <= 12000,
			"INVALID_INPUT",
			"Invalid evidence page",
		);
		requireValue(record.kind === "evidence" && record.contentRef, "EVIDENCE_GAP", "Evidence body is unavailable");
		const content = this.readBlob(record);
		return {
			text: content.slice(offset, offset + maxChars),
			nextOffset: offset + maxChars < content.length ? offset + maxChars : null,
			contentDigest: record.contentRef.sha256,
			size: record.contentRef.size,
		};
	}

	export(context, ref) {
		const collected = new Map();
		let bytes = 0;
		const visit = (r) => {
			if (collected.has(key(r))) return;
			const record = this.get(context, r);
			for (const child of references(record.kind, record.data)) visit(child);
			const { request: _request, domain: _domain, ...publicRecord } = record;
			// Export is a derivative; original digest is retained separately and never claims to hash redacted bytes.
			const { digest: sourceDigest, ...body } = redact(publicRecord);
			const content = { ...body, sourceDigest };
			if (record.contentRef) content.data = { ...content.data, content: this.readBlob(record) };
			bytes += Buffer.byteLength(canonical(content));
			requireValue(bytes <= this.limits.recordBytes, "LIMIT_EXCEEDED", "Export exceeds budget; select a smaller scope");
			collected.set(key(r), { ...content, digest: digest(content) });
		};
		visit(ref);
		const content = {
			schemaVersion: VERSION,
			derived: true,
			redaction: "credentials-v1; authorization domain and request receipts omitted",
			records: [...collected.values()],
		};
		requireValue(
			Buffer.byteLength(canonical(content)) <= this.limits.recordBytes,
			"LIMIT_EXCEEDED",
			"Export exceeds budget; select a smaller scope",
		);
		return { ...content, manifestDigest: digest(content) };
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		if (!this.readOnly) {
			try {
				if (JSON.parse(this.readFile(this.lock)).nonce === this.nonce) fs.unlinkSync(this.lock);
			} catch {
				/* Never remove an unverified lock. */
			}
		}
	}
}
