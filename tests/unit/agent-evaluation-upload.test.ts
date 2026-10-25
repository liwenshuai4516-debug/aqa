import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { AtifUploads, UPLOAD_LIMITS } from "../../plugins/agent-evaluation/upload.mjs";
const source = { principalId: "owner", workspaceId: "workspace", conversationId: "conversation", sessionId: "anchor" };
const raw = Buffer.from(
	JSON.stringify({
		schema_version: "ATIF-v1.8",
		session_id: "foreign",
		agent: { name: "fixture", version: "1" },
		steps: [{ step_id: 1, source: "user", message: "中文😀" }],
	}),
);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const uploads: AtifUploads[] = [];
const setup = () => {
	const u = new AtifUploads();
	uploads.push(u);
	return u;
};
const start = (u: AtifUploads, bytes = raw, owner = "owner", src = source) =>
	u.start(owner, src, "start", { byteLength: bytes.length, sha256: hash(bytes) });
const chunk = (u: AtifUploads, uploadId: string, bytes = raw, offset = 0) =>
	u.chunk("owner", source, { uploadId, offset, base64: bytes.toString("base64") });
afterEach(() => {
	for (const u of uploads.splice(0)) u.close();
	vi.useRealTimers();
});
describe("EC05 bounded transient uploads", () => {
	it("retries the same start and byte chunks exactly, including a split Unicode code point", () => {
		const u = setup(),
			entry = start(u),
			split = raw.indexOf(Buffer.from("😀")) + 1;
		expect(start(u)).toEqual(entry);
		expect(() => u.preview("owner", source, entry.uploadId)).toThrow(/incomplete/);
		const first = raw.subarray(0, split);
		expect(chunk(u, entry.uploadId, first).offset).toBe(split);
		expect(chunk(u, entry.uploadId, first).offset).toBe(split);
		chunk(u, entry.uploadId, raw.subarray(split), split);
		expect(u.parse("owner", source, entry.uploadId).converted.rawText).toBe(raw.toString());
		expect(u.preview("owner", source, entry.uploadId)).toMatchObject({
			origin: "target-reported",
			eventCount: 1,
			trajectories: [{ pointer: "#", sessionId: "foreign" }],
		});
	});
	it("rejects changed replay, gaps, overflow, noncanonical base64 and oversized chunks", () => {
		const u = setup(),
			{ uploadId } = start(u);
		chunk(u, uploadId, raw.subarray(0, 5));
		for (const data of [
			{ offset: 0, base64: Buffer.from("other").toString("base64") },
			{ offset: 6, base64: "eA==" },
			{ offset: raw.length, base64: "eA==" },
			{ offset: 5, base64: "eB==" },
			{ offset: 5, base64: "eA" },
			{ offset: 5, base64: Buffer.alloc(UPLOAD_LIMITS.chunkBytes + 1).toString("base64") },
		])
			expect(() => u.chunk("owner", source, { uploadId, ...data })).toThrow();
		expect(u.get("owner", source, uploadId).offset).toBe(5);
		expect(() => u.start("owner", source, "start", { byteLength: raw.length, sha256: "0".repeat(64) })).toThrow(
			/changed/,
		);
	});
	it("binds to owner, workspace, conversation and host anchor on every operation", () => {
		const u = setup(),
			{ uploadId } = start(u);
		for (const key of Object.keys(source)) {
			const wrong = { ...source, [key]: "different" };
			expect(() => u.get("owner", wrong, uploadId)).toThrow(/unavailable/);
		}
		expect(() => u.get("other", source, uploadId)).toThrow(/unavailable/);
		expect(() => start(u, raw, "owner", { ...source, sessionId: "other" })).toThrow(/previous/);
	});
	it("caps total reservations and rejects over-budget lengths before allocation", () => {
		const u = setup();
		for (const length of [0, -1, 0.5, 512 * 1024 + 1])
			expect(() => u.start("owner", source, "start", { byteLength: length, sha256: hash(raw) })).toThrow();
		for (let i = 0; i < UPLOAD_LIMITS.entries; i++) start(u, raw, `owner${i}`);
		expect(() => start(u, raw, "overflow")).toThrow(/capacity/);
	});
	it("detects wrong package digest and rejects malformed or unsupported completed documents", () => {
		const u = setup(),
			entry = u.start("owner", source, "start", { byteLength: raw.length, sha256: "0".repeat(64) });
		chunk(u, entry.uploadId);
		expect(() => u.preview("owner", source, entry.uploadId)).toThrow(/SHA256/);
		u.discard(entry.uploadId);
		for (const bytes of [Buffer.from("{"), Buffer.from(raw.toString().replace("ATIF-v1.8", "ATIF-v9.9"))]) {
			const { uploadId } = start(u, bytes);
			chunk(u, uploadId, bytes);
			expect(() => u.preview("owner", source, uploadId)).toThrow();
			u.discard(uploadId);
		}
	});
	it("expires without traffic, zeros raw bytes, and clears on client disable or close", () => {
		vi.useFakeTimers();
		const u = setup(),
			{ uploadId } = start(u);
		chunk(u, uploadId);
		const held = u.get("owner", source, uploadId).bytes;
		vi.advanceTimersByTime(UPLOAD_LIMITS.ttlMs);
		expect(held.every((b: number) => b === 0)).toBe(true);
		expect(() => u.get("owner", source, uploadId)).toThrow(/expired/);
		const next = start(u);
		u.stopClient("other");
		expect(u.get("owner", source, next.uploadId)).toBeTruthy();
		u.stopClient("owner");
		expect(u.entries.size).toBe(0);
		start(u);
		u.close();
		expect(u.entries.size).toBe(0);
	});
	it("keeps preview bounded even for huge declared identities and many losses", () => {
		const u = setup(),
			doc = JSON.parse(raw.toString());
		doc.session_id = "x".repeat(80000);
		doc.agent.name = "y".repeat(80000);
		doc.steps = Array.from({ length: 100 }, (_, i) => ({
			step_id: i + 1,
			source: "agent",
			message: "data",
			reasoning_content: "unverified",
		}));
		const bytes = Buffer.from(JSON.stringify(doc)),
			{ uploadId } = start(u, bytes);
		for (let offset = 0; offset < bytes.length; offset += UPLOAD_LIMITS.chunkBytes)
			chunk(u, uploadId, bytes.subarray(offset, offset + UPLOAD_LIMITS.chunkBytes), offset);
		const preview = u.preview("owner", source, uploadId);
		expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThan(48 * 1024);
		expect(preview.losses.length).toBe(20);
		expect(preview.nextOffset).toBe(20);
		expect(JSON.stringify(preview)).not.toContain("unverified");
		expect(u.preview("owner", source, uploadId, 20).losses.length).toBe(20);
	});
});
