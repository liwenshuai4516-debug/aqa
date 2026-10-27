/** Single writer, immutable revision files. No execution or source reads during recovery.
 * authorize(context) is injected by the trusted host, never derived from request payloads.
 * The receipt and record share one atomic file; the in-memory index is fully rebuildable.
 */
import * as fs from "node:fs";
import { isUtf8 } from "node:buffer";
import { join, resolve, dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { publishFile } from "./durable.mjs";
import { encodePack, readPackIndex } from "./pack.mjs";
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
	scopeSessions,
} from "./schema.mjs";

const key = (ref) => `${ref.kind}/${ref.id}.${ref.revision}`;
const same = (a, b) => canonical(a) === canonical(b);
const recordRef = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
// Index/loaded domains and requested references have passed their fixed schemas.
const sameDomain = (a, b) => a?.principalId === b.principalId && a?.workspaceId === b.workspaceId;
const sameRef = (a, b) => a.kind === b.kind && a.id === b.id && a.revision === b.revision;
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
		return this.readFileBytes(file, limit).toString("utf8");
	}
	readFileBytes(file, limit = this.limits.recordBytes) {
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
			return bytes.subarray(0, size);
		} finally {
			fs.closeSync(fd);
		}
	}
	readRange(file, offset, length) {
		this.checkDirectory(this.root);
		this.checkDirectory(dirname(file));
		const fd = fs.openSync(file, fs.constants.O_RDONLY | NOFOLLOW);
		try {
			const stat = fs.fstatSync(fd);
			requireValue(stat.isFile() && stat.nlink === 1, "PERMISSION_DENIED", "Storage links are forbidden");
			requireValue(
				Number.isSafeInteger(offset) &&
					offset >= 0 &&
					Number.isSafeInteger(length) &&
					length >= 0 &&
					length <= this.limits.recordBytes &&
					stat.size <= this.limits.readBytes &&
					offset + length <= stat.size,
				"STORE_CORRUPT",
				"Invalid packed read range",
			);
			const bytes = Buffer.alloc(length);
			requireValue(
				fs.readSync(fd, bytes, 0, length, offset) === length,
				"STORE_CORRUPT",
				"Evidence pack changed during read",
			);
			return bytes;
		} finally {
			fs.closeSync(fd);
		}
	}
	load(file, segment = undefined, prefetched = undefined) {
		const raw =
			prefetched ??
			(segment ? this.readRange(file, segment.offset, segment.length).toString("utf8") : this.readFile(file));
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
	packedEntries(file, size) {
		const ranges = readPackIndex((offset, length) => this.readRange(file, offset, length), size, this.limits);
		return ranges.map(([offset, length, blobOffset, blobLength]) => {
			const segment = { offset, length },
				record = this.load(file, segment);
			requireValue(record.kind === "evidence", "STORE_CORRUPT", "Only evidence may be packed");
			requireValue(
				record.contentRef
					? /^[a-f0-9]{64}$/.test(record.contentRef.sha256) &&
							record.contentRef.size === blobLength &&
							blobOffset !== null
					: blobOffset === null,
				"STORE_CORRUPT",
				"Packed body differs from record",
			);
			return {
				record,
				entry: { file, ...segment, ref: recordRef(record), domain: record.domain },
				blob: record.contentRef ? { file, offset: blobOffset, length: blobLength } : undefined,
			};
		});
	}
	indexPacked(entries) {
		for (const { record, entry, blob } of entries) {
			this.index.set(key(entry.ref), entry);
			this.requests.set(digest([record.domain, record.request.id]), { ref: entry.ref, digest: record.request.digest });
			if (blob) this.packedBlobs.set(this.blobPath(record), blob);
		}
	}
	rebuild() {
		this.index = new Map();
		this.requests = new Map();
		this.packedBlobs = new Map();
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
				if (dir === join(this.root, "evidence") && /^batch-[a-f0-9-]{36}\.pack$/.test(item.name)) {
					try {
						const entries = this.packedEntries(file, stat.size),
							keys = new Set(),
							requests = new Set();
						requireValue(
							this.index.size + entries.length <= this.limits.records,
							"LIMIT_EXCEEDED",
							"Too many persisted records",
						);
						for (const { record, entry } of entries) {
							const recordKey = key(entry.ref),
								requestKey = digest([record.domain, record.request.id]);
							requireValue(
								!this.index.has(recordKey) &&
									!keys.has(recordKey) &&
									!this.requests.has(requestKey) &&
									!requests.has(requestKey),
								"STORE_CORRUPT",
								"Duplicate packed record or request ID",
							);
							keys.add(recordKey);
							requests.add(requestKey);
						}
						this.indexPacked(entries);
					} catch (error) {
						this.issues.push({ code: error.code ?? "STORE_CORRUPT", file: item.name });
					}
					continue;
				}
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
		budget = { bytes: 0, items: 0, metadataItems: 0, started: performance.now(), cache: new Map() },
	) {
		validateRef(ref);
		const identity = this.identity(context),
			entry = this.index.get(key(ref));
		if (budget.authorization !== undefined)
			requireValue(
				budget.authorization === canonical([identity.domain, identity.sessionIds]),
				"PERMISSION_DENIED",
				"Read authorization changed",
			);
		requireValue(
			entry && sameDomain(entry.domain, identity.domain),
			"PERMISSION_DENIED",
			"Record unavailable in this authorization domain",
		);
		requireValue(!visited.has(key(ref)), "STORE_CORRUPT", "Cyclic record references");
		if (budget.cache.has(key(ref))) return budget.cache.get(key(ref));
		budget.bytes += entry.length ?? fs.lstatSync(entry.file).size;
		// The source-event budget must allow a full snapshot plus its authorization graph.
		// Both categories remain independently bounded, with shared byte/time/depth limits.
		if (ref.kind === "evidence") budget.items += 1;
		else budget.metadataItems += 1;
		requireValue(
			visited.size < 64 &&
				budget.bytes <= this.limits.readBytes &&
				budget.items <= this.limits.readItems &&
				budget.metadataItems <= this.limits.readItems &&
				performance.now() - budget.started <= this.limits.readMs,
			"LIMIT_EXCEEDED",
			"Reference traversal exceeds read budget",
		);
		const next = new Set(visited);
		next.add(key(ref));
		const record = this.load(
			entry.file,
			entry.offset === undefined ? undefined : entry,
			budget.prefetched?.get(key(ref)),
		);
		requireValue(sameRef(record, ref), "STORE_CORRUPT", "Record identity changed");
		requireValue(sameDomain(record.domain, identity.domain), "PERMISSION_DENIED", "Record domain changed");
		if (record.kind === "contracts") {
			const scope = record.data.scope;
			requireValue(
				scopeSessions(scope).every((id) => identity.sessionIds.includes(id)),
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
	getMany(context, refs) {
		const identity = this.identity(context);
		requireValue(
			Array.isArray(refs) && refs.length <= this.limits.readItems,
			"LIMIT_EXCEEDED",
			"Too many record references",
		);
		const budget = {
			bytes: 0,
			items: 0,
			metadataItems: 0,
			started: performance.now(),
			cache: new Map(),
			authorization: canonical([identity.domain, identity.sessionIds]),
			prefetched: new Map(),
		};
		// Read only requested, adjacent metadata ranges together. This synchronous
		// request owns the bytes; every record still passes load/get validation and
		// every later request reopens the file. Bodies and unselected gaps stay out.
		const files = new Map();
		let bytes = 0;
		for (const ref of refs) {
			validateRef(ref);
			const entry = this.index.get(key(ref));
			requireValue(
				entry && sameDomain(entry.domain, identity.domain),
				"PERMISSION_DENIED",
				"Record unavailable in this authorization domain",
			);
			if (entry.offset === undefined) continue;
			if (!files.has(entry.file)) files.set(entry.file, new Map());
			files.get(entry.file).set(key(ref), entry);
		}
		for (const [file, entries] of files) {
			let pending = [],
				start = 0,
				end = 0;
			const flush = () => {
				if (!pending.length) return;
				const length = end - start;
				if (bytes + length <= this.limits.readBytes) {
					const raw = this.readRange(file, start, length);
					bytes += length;
					for (const [id, entry] of pending)
						budget.prefetched.set(
							id,
							raw.subarray(entry.offset - start, entry.offset - start + entry.length).toString("utf8"),
						);
				}
				pending = [];
			};
			for (const item of [...entries].sort(([, a], [, b]) => a.offset - b.offset)) {
				const entry = item[1];
				if (pending.length && (entry.offset !== end || end - start + entry.length > this.limits.recordBytes)) flush();
				if (!pending.length) start = entry.offset;
				end = entry.offset + entry.length;
				pending.push(item);
			}
			flush();
		}
		return refs.map((ref) => this.get(context, ref, new Set(), budget));
	}
	latest(context, reference) {
		this.get(context, reference);
		const found = [...this.index.values()]
			.filter((e) => e.ref.kind === reference.kind && e.ref.id === reference.id)
			.sort((a, b) => b.ref.revision - a.ref.revision)[0];
		return this.get(context, found.ref);
	}

	list(
		context,
		{ kind = "contracts", cursor = "", limit = 50, latestOnly = false } = {},
		project = (record, _read) => ({ ...recordRef(record), createdAt: record.createdAt, digest: record.digest }),
		accept = undefined,
	) {
		const identity = this.identity(context);
		const freshBudget = () => ({
			bytes: 0,
			items: 0,
			metadataItems: 0,
			started: performance.now(),
			cache: new Map(),
			authorization: canonical([identity.domain, identity.sessionIds]),
		});
		let budget = freshBudget();
		const read = (ref) => this.get(context, ref, new Set(), budget);
		requireValue(
			KINDS.includes(kind) &&
				typeof cursor === "string" &&
				Number.isInteger(limit) &&
				limit > 0 &&
				limit <= this.limits.page,
			"INVALID_INPUT",
			"Invalid page request",
		);
		const latest = new Map();
		if (latestOnly)
			for (const e of this.index.values()) {
				if (e.ref.kind === kind && e.ref.revision > (latest.get(e.ref.id) ?? 0)) latest.set(e.ref.id, e.ref.revision);
			}
		const items = [],
			keys = [...this.index.keys()]
				.filter((k) => {
					if (!k.startsWith(`${kind}/`) || k <= cursor) return false;
					const r = this.index.get(k).ref;
					return !latestOnly || latest.get(r.id) === r.revision;
				})
				.sort();
		let last = cursor;
		const started = performance.now();
		for (const k of keys) {
			if (accept)
				requireValue(
					performance.now() - started <= this.limits.readMs,
					"LIMIT_EXCEEDED",
					"Filtered list deadline exceeded",
				);
			last = k;
			let record;
			try {
				// Reuse only this synchronous list's bounded, authorized graph. A different
				// root that no longer fits is read afresh under the original per-root limits.
				const retained = budget.cache.size > 0;
				try {
					record = read(this.index.get(k).ref);
				} catch (error) {
					if (error.code !== "LIMIT_EXCEEDED" || !retained) throw error;
					budget = freshBudget();
					record = read(this.index.get(k).ref);
				}
			} catch (error) {
				if (error.code !== "PERMISSION_DENIED") throw error;
				continue;
			}
			if (accept && !accept(record)) continue;
			items.push(project(record, read));
			if (items.length === limit) break;
		}
		if (accept)
			requireValue(
				performance.now() - started <= this.limits.readMs,
				"LIMIT_EXCEEDED",
				"Filtered list deadline exceeded",
			);
		return { items, nextCursor: keys.some((k) => k > last) ? last : null };
	}
	lookupRequest(context, requestId) {
		const identity = this.identity(context);
		const receipt = this.requests.get(digest([identity.domain, requestId]));
		if (!receipt) return undefined;
		const record = this.get(context, receipt.ref);
		requireValue(
			record.request.id === requestId && record.request.digest === receipt.digest,
			"STORE_CORRUPT",
			"Request receipt changed",
		);
		return record;
	}

	#checkWriter() {
		requireValue(!this.readOnly, "PERMISSION_DENIED", "Store is read only");
		requireValue(
			!this.issues.length,
			"STORE_CORRUPT",
			"Recovery issues require explicit repair; original files preserved",
		);
		this.checkDirectory(this.root);
		requireValue(JSON.parse(this.readFile(this.lock)).nonce === this.nonce, "STORE_LOCKED", "Writer ownership changed");
	}
	#prepareWrite(
		context,
		{ kind, data, requestId, schemaVersion = VERSION, previousRef = undefined },
		sharedBudget,
		originalBytes,
	) {
		const identity = this.identity(context, true);
		if (sharedBudget)
			requireValue(
				sharedBudget.authorization === canonical([identity.domain, identity.sessionIds]),
				"PERMISSION_DENIED",
				"Batch authorization changed",
			);
		requireValue(
			typeof requestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(requestId),
			"INVALID_INPUT",
			"Invalid request ID",
		);
		const inputBytes = canonical(data),
			inputSize = Buffer.byteLength(inputBytes);
		requireValue(inputSize <= this.limits.recordBytes, "LIMIT_EXCEEDED", "Input exceeds record budget");
		validate(kind, data, schemaVersion);
		if (kind === "snapshots")
			requireValue(
				data.evidenceRefs.length <= this.limits.snapshotItems,
				"LIMIT_EXCEEDED",
				"Snapshot evidence budget reached",
			);
		if (previousRef) {
			validateRef(previousRef);
			requireValue(previousRef.kind === kind, "INVALID_INPUT", "Revision kind differs");
		}
		// Sanitize once per synchronous write. The request digest describes the clean
		// input before evidence metadata is annotated or its body moves into a blob.
		const sanitized = redact(data),
			redacted = sanitized !== data,
			clean = { ...sanitized };
		// Hash the exact legacy canonical envelope, reusing the bounded serialized data.
		// Keep the sanitized input digest distinct from later metadata/blob transformations.
		const originalRef =
			originalBytes === undefined ? undefined : { sha256: contentHash(originalBytes), size: originalBytes.length };
		const requestDigest = createHash("sha256")
			.update('{"data":')
			.update(redacted ? canonical(sanitized) : inputBytes)
			.update(",")
			.update(
				canonical({
					kind,
					schemaVersion,
					previousRef: previousRef ?? null,
					...(originalRef ? { originalRef } : {}),
				}).slice(1),
			)
			.digest("hex");
		const receipt = this.requests.get(digest([identity.domain, requestId]));
		if (receipt) {
			requireValue(
				receipt.digest === requestDigest,
				"VERSION_CONFLICT",
				"Request ID already used with different input",
			);
			return { existing: this.get(context, receipt.ref), inputSize };
		}
		if (!sharedBudget?.writerChecked) {
			this.#checkWriter();
			if (sharedBudget) sharedBudget.writerChecked = true;
		}
		if (kind === "reviews")
			requireValue(identity.human === true, "PERMISSION_DENIED", "Human review requires trusted UI identity");
		if (kind === "contracts")
			requireValue(
				scopeSessions(data.scope).every((id) => identity.sessionIds.includes(id)),
				"PERMISSION_DENIED",
				"Contract selection is not authorized",
			);
		// Reuse only within this synchronous commit. Never retain authorized records across
		// requests: each later operation must recheck current bytes and session access.
		const budget = sharedBudget ?? {
			bytes: 0,
			items: 0,
			metadataItems: 0,
			started: performance.now(),
			cache: new Map(),
		};
		const read = (ref) => this.get(context, ref, new Set(), budget);
		for (const ref of references(kind, data)) read(ref);
		let id = randomUUID(),
			revision = 1;
		if (previousRef) {
			requireValue(
				["contracts", "targets", "attempts", "experiments"].includes(kind),
				"VERSION_CONFLICT",
				"Sealed records are immutable; create a new object",
			);
			const previous = read(previousRef);
			requireValue(
				![...this.index.values()].some(
					(e) => e.ref.kind === kind && e.ref.id === previousRef.id && e.ref.revision > previousRef.revision,
				),
				"VERSION_CONFLICT",
				"Revision is stale",
			);
			id = previous.id;
			revision = previous.revision + 1;
			if (kind === "experiments") {
				requireValue(
					same(previous.data.datasetRef, data.datasetRef) && same(previous.data.policy, data.policy),
					"VERSION_CONFLICT",
					"Experiment configuration is immutable",
				);
			}
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
		this.validateRelations(kind, data, read);
		if (kind === "evidence" && redacted) clean.redaction = [...new Set([...clean.redaction, "credentials-v1"])];
		const contentBytes = validate(kind, clean);
		const record = {
			schemaVersion: VERSION,
			kind,
			id,
			revision,
			domain: identity.domain,
			createdAt: new Date().toISOString(),
			data: clean,
			referenceDigests: Object.fromEntries(references(kind, clean).map((ref) => [key(ref), read(ref).digest])),
			redacted,
			request: { id: requestId, digest: requestDigest },
		};
		if (kind === "reviews") record.reviewer = identity.domain.principalId;
		if (originalRef) record.originalRef = originalRef;
		const content = kind === "evidence" ? clean.content : undefined;
		if (content !== undefined) {
			record.contentRef = { sha256: contentHash(content), size: contentBytes };
			requireValue(
				record.contentRef.size <= this.limits.evidenceBytes,
				"LIMIT_EXCEEDED",
				"Evidence exceeds configured byte limit",
			);
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
					(originalRef && originalRef.sha256 !== record.contentRef?.sha256 && !fs.existsSync(this.originalPath(record))
						? originalRef.size
						: 0) +
					(content === undefined || fs.existsSync(this.blobPath(record)) ? 0 : record.contentRef.size) <=
					this.limits.capacityBytes,
			"LIMIT_EXCEEDED",
			"Evaluation store capacity reached",
		);
		return { record, bytes, content, inputSize };
	}
	write(context, input) {
		return this.#publishPrepared(this.#prepareWrite(context, input));
	}
	/** Only an explicit human import can retain original bytes outside ordinary redacted evidence. */
	writeOriginalEvidence(context, input, originalBytes) {
		const identity = this.identity(context, true);
		requireValue(identity.human === true, "PERMISSION_DENIED", "Original archive requires trusted human import");
		requireValue(
			input.kind === "evidence" &&
				input.data?.kind === "atif-source" &&
				input.data.producer === "atif-import-v1" &&
				input.data.origin === "target-reported",
			"INVALID_INPUT",
			"Original archive requires ATIF source evidence",
		);
		requireValue(
			originalBytes instanceof Uint8Array &&
				originalBytes.byteLength > 0 &&
				originalBytes.byteLength <= this.limits.evidenceBytes,
			"LIMIT_EXCEEDED",
			"Original source exceeds archive budget",
		);
		const bytes = Buffer.from(originalBytes);
		requireValue(
			Buffer.from(bytes.toString("utf8")).equals(bytes),
			"INVALID_INPUT",
			"Original source must be valid UTF-8",
		);
		return this.#publishPrepared(this.#prepareWrite(context, input, undefined, bytes), bytes);
	}
	#publishPrepared(prepared, originalBytes) {
		if (prepared.existing && originalBytes !== undefined) this.#readOriginal(prepared.existing);
		if (prepared.existing) return prepared.existing;
		const { record, bytes, content } = prepared;
		const ref = recordRef(record),
			file = join(this.root, `${key(ref)}.json`);
		this.checkDirectory(dirname(file));
		try {
			if (originalBytes !== undefined) {
				const original = this.originalPath(record);
				this.checkDirectory(dirname(original));
				if (fs.existsSync(original)) this.#readOriginal(record);
				else {
					publishFile(original, originalBytes, (stage) => this.fault(`original:${stage}`));
					this.usedBytes += originalBytes.length;
				}
			}
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
		this.requests.set(digest([record.domain, record.request.id]), { ref, digest: record.request.digest });
		this.usedBytes += Buffer.byteLength(bytes);
		return structuredClone(record);
	}
	/** One synchronous, bounded commit. No provisional record escapes before both syncs and publication. */
	writeEvidenceBatch(context, inputs) {
		return [...this.#writeEvidence(context, inputs, false)].flat();
	}
	/** Yield independently durable, bounded chunks; a later error retains committed prefixes. */
	*writeEvidencePage(context, inputs) {
		yield* this.#writeEvidence(context, inputs, true);
	}
	*#writeEvidence(context, inputs, split) {
		const identity = this.identity(context, true);
		requireValue(
			Array.isArray(inputs) && inputs.length > 0 && inputs.length <= this.limits.snapshotItems,
			"LIMIT_EXCEEDED",
			"Invalid evidence batch size",
		);
		const freshBudget = () => ({
			bytes: 0,
			items: 0,
			metadataItems: 0,
			started: performance.now(),
			cache: new Map(),
			authorization: canonical([identity.domain, identity.sessionIds]),
			writerChecked: false,
		});
		let budget = freshBudget(),
			pending = new Map(),
			result = [],
			inputSize = 0,
			packSize = 26;
		const flush = () => {
			const committed = this.#publishEvidenceBatch(context, budget, pending, result);
			budget = freshBudget();
			pending = new Map();
			result = [];
			inputSize = 0;
			packSize = 26;
			return committed;
		};
		for (const input of inputs) {
			requireValue(input.kind === "evidence" && !input.previousRef, "INVALID_INPUT", "Batch accepts new evidence only");
			let prepared = this.#prepareWrite(context, input, budget);
			// Raw body bytes plus exact record bytes and a conservative index entry.
			// encodePack remains the exact physical-budget authority; no body pre-scan.
			let physicalSize = prepared.existing
				? 0
				: Buffer.byteLength(prepared.bytes) + (prepared.record.contentRef?.size ?? 0) + 100;
			if (
				split &&
				result.length &&
				(inputSize + prepared.inputSize > this.limits.readBytes || packSize + physicalSize > this.limits.readBytes)
			) {
				yield flush();
				// Recheck bytes, receipts and authorization after publishing the prefix.
				prepared = this.#prepareWrite(context, input, budget);
				physicalSize = prepared.existing
					? 0
					: Buffer.byteLength(prepared.bytes) + (prepared.record.contentRef?.size ?? 0) + 100;
			}
			if (split && (prepared.inputSize > this.limits.readBytes || physicalSize + 26 > this.limits.readBytes)) {
				// Preserve the collector's existing single-record fallback under tighter pack limits.
				yield [this.#publishPrepared(prepared)];
				budget = freshBudget();
				continue;
			}
			inputSize += prepared.inputSize;
			requireValue(inputSize <= this.limits.readBytes, "LIMIT_EXCEEDED", "Evidence batch input exceeds budget");
			if (prepared.existing) {
				result.push(prepared.existing);
				continue;
			}
			const record = prepared.record,
				requestKey = digest([record.domain, record.request.id]),
				prior = pending.get(requestKey);
			requireValue(
				!prior || prior.record.request.digest === record.request.digest,
				"VERSION_CONFLICT",
				"Batch request ID already used with different input",
			);
			if (!prior) {
				pending.set(requestKey, prepared);
				packSize += physicalSize;
			}
			result.push(prior?.record ?? record);
		}
		if (result.length) yield flush();
	}
	#publishEvidenceBatch(context, budget, pending, result) {
		const items = [...pending.values()];
		if (!items.length) return structuredClone(result);
		const finalIdentity = this.identity(context, true);
		requireValue(
			budget.authorization === canonical([finalIdentity.domain, finalIdentity.sessionIds]),
			"PERMISSION_DENIED",
			"Batch authorization changed",
		);
		// A synchronous batch shares preparation checks, but must recheck before publication.
		this.#checkWriter();
		const pack = encodePack(items, this.limits),
			file = join(this.root, "evidence", `batch-${randomUUID()}.pack`);
		requireValue(
			this.index.size + items.length <= this.limits.records && this.usedBytes + pack.size <= this.limits.capacityBytes,
			"LIMIT_EXCEEDED",
			"Evaluation store capacity reached",
		);
		this.checkDirectory(dirname(file));
		try {
			publishFile(file, pack.body, this.fault, pack.manifest);
		} catch (error) {
			this.rebuild();
			throw new EvaluationError(
				error.published ? "EXECUTION_UNKNOWN" : "IO_ERROR",
				error.published
					? "Batch may be durable; query with the same request IDs"
					: "Batch write failed; original temporary evidence preserved",
			);
		}
		this.indexPacked(
			items.map(({ record }, i) => {
				const [offset, length, blobOffset, blobLength] = pack.index[i];
				return {
					record,
					entry: { file, offset, length, ref: recordRef(record), domain: record.domain },
					blob: record.contentRef ? { file, offset: blobOffset, length: blobLength } : undefined,
				};
			}),
		);
		this.usedBytes += pack.size;
		return structuredClone(result);
	}
	validateRelations(kind, data, read) {
		if (kind === "experiments") {
			const dataset = read(data.datasetRef);
			for (const entry of data.entries) {
				const c = dataset.data.cases[entry.slot % dataset.data.cases.length];
				requireValue(c?.id === entry.caseId, "VERSION_CONFLICT", "Experiment case identity differs");
				if (entry.attemptRef)
					requireValue(
						same(read(entry.attemptRef).data.contractRef, c.contractRef),
						"VERSION_CONFLICT",
						"Attempt contract differs from dataset",
					);
				if (entry.snapshotRef)
					requireValue(
						entry.attemptRef && read(entry.snapshotRef).data.attemptRefs.some((r) => r.id === entry.attemptRef.id),
						"VERSION_CONFLICT",
						"Snapshot attempt differs",
					);
				if (entry.evaluationRef)
					requireValue(
						entry.snapshotRef && same(read(entry.evaluationRef).data.snapshotRef, entry.snapshotRef),
						"VERSION_CONFLICT",
						"Report snapshot differs",
					);
			}
		}

		if (kind === "attempts") {
			const contract = read(data.contractRef);
			if (contract.data.scope.source === "offline")
				requireValue(
					!data.sourceSessionId && read(data.targetRef).data.kind === "offline",
					"INVALID_INPUT",
					"Offline attempts cannot claim a host execution session",
				);
			requireValue(
				!data.sourceSessionId ||
					data.sourceSessionId === contract.data.scope.sessionId ||
					(data.parentAttemptRef &&
						contract.data.scope.childSessionIds.includes(data.sourceSessionId) &&
						same(read(data.parentAttemptRef).data.contractRef, data.contractRef)),
				"INVALID_INPUT",
				"Attempt session differs from contract",
			);
			if (data.previousAttemptRef)
				requireValue(
					read(data.previousAttemptRef).data.contractRef.id === data.contractRef.id,
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
					same(read(ref).data.contractRef, data.contractRef),
					"INVALID_INPUT",
					"Snapshot task revision differs",
				);
			for (const ref of data.evidenceRefs)
				requireValue(
					data.attemptRefs.some((a) => a.id === read(ref).data.attemptRef.id),
					"INVALID_INPUT",
					"Evidence belongs to another attempt",
				);
		}
		if (kind === "evaluations") {
			const snapshot = read(data.snapshotRef);
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
				read(data.evaluationRef).data.findings.some((f) => f.findingId === data.findingId),
				"INVALID_INPUT",
				"Reviewed finding does not exist",
			);
			if (data.previousReviewRef) {
				const previous = read(data.previousReviewRef).data;
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
		const file = this.blobPath(record),
			packed = this.packedBlobs.get(file);
		const bytes = packed
			? this.readRange(packed.file, packed.offset, packed.length)
			: this.readFileBytes(file, this.limits.evidenceBytes);
		return this.#decodeBlob(record, bytes);
	}
	#decodeBlob(record, bytes) {
		// Validate the persisted bytes before decoding. Invalid UTF-8 must not become
		// replacement characters with a different digest after the conversion.
		requireValue(
			bytes.length === record.contentRef.size && isUtf8(bytes) && contentHash(bytes) === record.contentRef.sha256,
			"STORE_CORRUPT",
			"Evidence content digest mismatch",
		);
		return bytes.toString("utf8");
	}

	/** Read only selected adjacent bodies within one synchronous collection pass. */
	*readBlobs(records) {
		requireValue(
			Array.isArray(records) && records.length <= this.limits.readItems,
			"LIMIT_EXCEEDED",
			"Too many body references",
		);
		const files = new Map();
		for (const record of records) {
			const packed = this.packedBlobs.get(this.blobPath(record));
			if (!packed) {
				yield { record, content: this.readBlob(record) };
				continue;
			}
			if (!files.has(packed.file)) files.set(packed.file, []);
			files.get(packed.file).push({ record, ...packed });
		}
		const store = this;
		for (const [file, entries] of files) {
			let pending = [],
				start = 0,
				end = 0;
			function* flush() {
				if (!pending.length) return;
				const bytes = store.readRange(file, start, end - start);
				for (const entry of pending)
					yield {
						record: entry.record,
						content: store.#decodeBlob(
							entry.record,
							bytes.subarray(entry.offset - start, entry.offset - start + entry.length),
						),
					};
				pending = [];
			}
			for (const entry of entries.sort((a, b) => a.offset - b.offset)) {
				if (pending.length && (entry.offset !== end || entry.offset + entry.length - start > this.limits.recordBytes))
					yield* flush();
				if (!pending.length) start = entry.offset;
				end = entry.offset + entry.length;
				pending.push(entry);
			}
			yield* flush();
		}
	}

	originalPath(record) {
		requireValue(
			record.kind === "evidence" &&
				/^[a-f0-9]{64}$/.test(record.originalRef?.sha256) &&
				Number.isSafeInteger(record.originalRef.size) &&
				record.originalRef.size > 0 &&
				record.originalRef.size <= this.limits.evidenceBytes,
			"STORE_CORRUPT",
			"Invalid original archive reference",
		);
		return join(this.root, "blobs", `${digest(record.domain)}-${record.originalRef.sha256}.blob`);
	}
	#readOriginal(record) {
		let text;
		try {
			text = this.readFile(this.originalPath(record), this.limits.evidenceBytes);
		} catch (error) {
			if (error instanceof EvaluationError) throw error;
			throw new EvaluationError("STORE_CORRUPT", "Original archive is unavailable; retained files require inspection");
		}
		requireValue(
			contentHash(text) === record.originalRef.sha256 && Buffer.byteLength(text) === record.originalRef.size,
			"STORE_CORRUPT",
			"Original archive digest mismatch",
		);
		return text;
	}
	readOriginal(context, ref) {
		requireValue(
			this.identity(context).human === true,
			"PERMISSION_DENIED",
			"Original source is restricted to trusted human access",
		);
		const record = this.get(context, ref);
		requireValue(record.originalRef, "EVIDENCE_GAP", "No original archive for this evidence");
		return this.#readOriginal(record);
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
		// Human reviews point back to the report and are not reachable through its immutable references.
		if (ref.kind === "evaluations") {
			for (const entry of this.index.values()) {
				if (entry.ref.kind !== "reviews") continue;
				let review;
				try {
					review = this.get(context, entry.ref);
				} catch (error) {
					if (error.code === "PERMISSION_DENIED") continue;
					throw error;
				}
				if (key(review.data.evaluationRef) === key(ref)) visit(entry.ref);
			}
		}
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
