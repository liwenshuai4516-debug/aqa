/** Bounded, ephemeral UI uploads. Package bytes never select a host identity or execute code. */
import { createHash, randomUUID } from "node:crypto";
import { parseAtif, ATIF_LIMITS } from "./adapters/atif.mjs";
import { digest, redact, requireValue } from "./schema.mjs";
export const UPLOAD_LIMITS = Object.freeze({ entries: 4, chunkBytes: 24 * 1024, ttlMs: 10 * 60 * 1000 });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const label = (value) => (typeof value === "string" ? value.slice(0, 48) : null);
export class AtifUploads {
	constructor() {
		this.entries = new Map();
	}
	binding(clientId, source) {
		return digest([clientId, source.principalId, source.workspaceId, source.conversationId, source.sessionId]);
	}
	prune() {
		for (const [id, entry] of this.entries) if (entry.expiresAt <= Date.now()) this.discard(id);
	}
	start(clientId, source, requestId, data) {
		this.prune();
		requireValue(
			data &&
				Number.isInteger(data.byteLength) &&
				data.byteLength > 0 &&
				data.byteLength <= ATIF_LIMITS.bytes &&
				typeof data.sha256 === "string" &&
				/^[a-f0-9]{64}$/.test(data.sha256),
			"INVALID_INPUT",
			"A bounded byte length and SHA256 are required",
		);
		const binding = this.binding(clientId, source);
		for (const entry of this.entries.values()) {
			if (entry.binding !== binding || entry.requestId !== requestId) continue;
			requireValue(
				entry.byteLength === data.byteLength && entry.sha256 === data.sha256,
				"VERSION_CONFLICT",
				"Upload request changed",
			);
			return this.status(entry);
		}
		requireValue(
			![...this.entries.values()].some((e) => e.clientId === clientId),
			"IN_PROGRESS",
			"Discard the previous upload first",
		);
		requireValue(
			this.entries.size < UPLOAD_LIMITS.entries,
			"LIMIT_EXCEEDED",
			"Upload capacity reached; retry after an upload expires",
		);
		const entry = {
			uploadId: randomUUID(),
			requestId,
			clientId,
			binding,
			byteLength: data.byteLength,
			sha256: data.sha256,
			bytes: Buffer.alloc(data.byteLength),
			offset: 0,
			expiresAt: Date.now() + UPLOAD_LIMITS.ttlMs,
			timer: null,
		};
		entry.timer = setTimeout(() => this.discard(entry.uploadId), UPLOAD_LIMITS.ttlMs);
		entry.timer.unref?.();
		this.entries.set(entry.uploadId, entry);
		return this.status(entry);
	}
	get(clientId, source, uploadId) {
		this.prune();
		const entry = this.entries.get(uploadId);
		requireValue(
			entry && entry.binding === this.binding(clientId, source),
			"PERMISSION_DENIED",
			"Upload expired or is unavailable for this source",
		);
		return entry;
	}
	status(entry) {
		return {
			uploadId: entry.uploadId,
			offset: entry.offset,
			byteLength: entry.byteLength,
			sha256: entry.sha256,
			chunkBytes: UPLOAD_LIMITS.chunkBytes,
			expiresAt: entry.expiresAt,
		};
	}
	chunk(clientId, source, data) {
		const entry = this.get(clientId, source, data?.uploadId);
		requireValue(
			data &&
				Number.isInteger(data.offset) &&
				data.offset >= 0 &&
				typeof data.base64 === "string" &&
				data.base64.length > 0 &&
				data.base64.length <= (UPLOAD_LIMITS.chunkBytes / 3) * 4 &&
				/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.base64),
			"INVALID_INPUT",
			"A canonical bounded base64 chunk and byte offset are required",
		);
		const bytes = Buffer.from(data.base64, "base64"),
			end = data.offset + bytes.length;
		requireValue(
			bytes.toString("base64") === data.base64 && end <= entry.byteLength,
			"INVALID_INPUT",
			"Chunk exceeds upload bounds",
		);
		if (data.offset < entry.offset) {
			requireValue(
				end <= entry.offset && entry.bytes.subarray(data.offset, end).equals(bytes),
				"VERSION_CONFLICT",
				"Previously uploaded bytes differ",
			);
		} else {
			requireValue(data.offset === entry.offset, "VERSION_CONFLICT", "Upload the next sequential chunk");
			bytes.copy(entry.bytes, data.offset);
			entry.offset = end;
		}
		return this.status(entry);
	}
	parse(clientId, source, uploadId) {
		const entry = this.get(clientId, source, uploadId);
		requireValue(entry.offset === entry.byteLength, "EVIDENCE_GAP", "Upload is incomplete");
		requireValue(hash(entry.bytes) === entry.sha256, "VERSION_CONFLICT", "Uploaded package SHA256 differs");
		return { entry, converted: parseAtif(entry.bytes) };
	}
	preview(clientId, source, uploadId, offset = 0) {
		const { entry, converted } = this.parse(clientId, source, uploadId);
		requireValue(offset <= converted.losses.length, "INVALID_INPUT", "Loss offset is outside the preview");
		return {
			...this.status(entry),
			format: converted.format,
			converterVersion: converted.converterVersion,
			origin: "target-reported",
			eventCount: converted.events.length,
			trajectories: redact(
				converted.trajectories.map((t) => ({
					pointer: `#${t.pointer}`,
					parentPointer: t.parentPointer == null ? null : `#${t.parentPointer}`,
					sessionId: label(t.sessionId),
					trajectoryId: label(t.trajectoryId),
					agentName: label(t.agent?.name),
					agentVersion: label(t.agent?.version),
				})),
			),
			lossCount: converted.losses.length,
			losses: converted.losses
				.slice(offset, offset + 20)
				.map((l) => ({ pointer: l.pointer.slice(0, 256), reason: l.reason })),
			nextOffset: offset + 20 < converted.losses.length ? offset + 20 : null,
		};
	}
	discard(uploadId) {
		const entry = this.entries.get(uploadId);
		if (!entry) return;
		clearTimeout(entry.timer);
		entry.bytes.fill(0);
		this.entries.delete(uploadId);
	}
	discardOwned(clientId, source, uploadId) {
		if (uploadId) {
			this.get(clientId, source, uploadId);
			this.discard(uploadId);
			return;
		}
		const binding = this.binding(clientId, source);
		for (const [id, entry] of this.entries) if (entry.binding === binding) this.discard(id);
	}
	stopClient(clientId) {
		for (const [id, entry] of this.entries) if (entry.clientId === clientId) this.discard(id);
	}
	close() {
		for (const id of this.entries.keys()) this.discard(id);
	}
}
