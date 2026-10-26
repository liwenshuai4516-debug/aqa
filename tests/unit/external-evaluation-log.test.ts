import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline, finished } from "node:stream/promises";
import { createHash } from "node:crypto";
import { ExternalEvaluationLog, type ExecutionLogLimits } from "../../server/external-evaluation-log.js";

const roots: string[] = [];
const limits = { rawBytes: 4096, lineBytes: 512, entries: 100 };
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
afterEach(async () => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function sink(channel: "stdout" | "stderr" = "stdout", budget: ExecutionLogLimits = limits) {
	const directory = await mkdtemp(join(tmpdir(), "evaluation-log-"));
	roots.push(directory);
	const file = join(directory, `${channel}.raw`);
	return { log: await ExternalEvaluationLog.create(file, channel, budget), file, directory };
}

describe("EC06 raw execution log transport", () => {
	it("keeps overflowing JSON numbers raw instead of silently serializing Infinity as null", async () => {
		const { log, file } = await sink();
		const text = '[1e999,{"n":-1e999}]\n{"n":0.1}\n';
		await pipeline(Readable.from([Buffer.from(text)]), log);
		expect(log.snapshot().entries).toEqual([
			{ start: 0, end: 21, kind: "gap", reason: "json-number-limit" },
			{ start: 21, end: text.length, kind: "json", value: { n: 0.1 } },
		]);
		expect(await readFile(file, "utf8")).toBe(text);
	});
	it("bounds nested JSON before clone/serialization and ignores brackets inside quoted/escaped strings", async () => {
		const { log, file } = await sink("stdout", { rawBytes: 65536, lineBytes: 65536, entries: 100 });
		const quoted = JSON.stringify({ text: '[\\"'.repeat(70) });
		const nested = "[".repeat(5000) + "0" + "]".repeat(5000);
		await pipeline(Readable.from([Buffer.from(nested + "\n" + quoted + "\n")]), log);
		expect(log.snapshot().entries).toEqual([
			{ start: 0, end: nested.length + 1, kind: "gap", reason: "json-depth-limit" },
			{ start: nested.length + 1, end: nested.length + quoted.length + 2, kind: "json", value: JSON.parse(quoted) },
		]);
		expect(await readFile(file, "utf8")).toBe(nested + "\n" + quoted + "\n");
	});
	it("reassembles every UTF-8 byte split and JSONL half-line with exact raw ranges, CRLF and final non-newline JSON", async () => {
		const text = '{"中文":"😀"}\r\n{"last":true}',
			bytes = Buffer.from(text);
		for (let at = 1; at < bytes.length; at++) {
			const { log, file } = await sink();
			await pipeline(Readable.from([bytes.subarray(0, at), bytes.subarray(at)]), log);
			const snapshot = log.snapshot();
			expect(await readFile(file)).toEqual(bytes);
			expect(snapshot.sha256).toBe(sha(bytes));
			expect(snapshot.entries).toEqual([
				{ start: 0, end: Buffer.byteLength('{"中文":"😀"}\r\n'), kind: "json", value: { 中文: "😀" } },
				{ start: Buffer.byteLength('{"中文":"😀"}\r\n'), end: bytes.length, kind: "json", value: { last: true } },
			]);
			expect(snapshot).toMatchObject({ streamEnded: true, interrupted: false, durable: true, gaps: {} });
		}
	});
	it("keeps non-JSON stderr as text and stdout parse/encoding failures as explicit byte-backed gaps", async () => {
		const { log, file } = await sink();
		const bytes = Buffer.concat([Buffer.from('warning\n{"ok":1}\n'), Buffer.from([0xc3, 10])]);
		await pipeline(Readable.from([bytes]), log);
		expect(log.snapshot().entries).toEqual([
			{ start: 0, end: 8, kind: "gap", reason: "invalid-json" },
			{ start: 8, end: 17, kind: "json", value: { ok: 1 } },
			{ start: 17, end: 19, kind: "gap", reason: "invalid-utf8" },
		]);
		expect(await readFile(file)).toEqual(bytes);
		const stderr = await sink("stderr");
		await pipeline(Readable.from([Buffer.from("warning\n")]), stderr.log);
		expect(stderr.log.snapshot().entries).toEqual([{ start: 0, end: 8, kind: "text", value: "warning" }]);
	});
	it("recovers after an oversized line, bounds parsed rows, and preserves later raw bytes", async () => {
		const { log, file } = await sink("stdout", { rawBytes: 128, lineBytes: 8, entries: 2 });
		const bytes = Buffer.from("1234567890123\n1\n2\n3\n");
		await pipeline(Readable.from([...bytes].map((n) => Buffer.from([n]))), log);
		expect(log.snapshot().entries).toEqual([
			{ start: 0, end: 14, kind: "gap", reason: "line-limit" },
			{ start: 14, end: 16, kind: "json", value: 1 },
		]);
		expect(log.snapshot().gaps).toEqual({ entryLimit: { start: 16, end: 20, lines: 2 } });
		expect(await readFile(file)).toEqual(bytes);
	});
	it("never parses a line cut by the raw cap or silently decodes a cut UTF-8 character", async () => {
		const { log, file } = await sink("stdout", { rawBytes: 6, lineBytes: 6, entries: 10 });
		const bytes = Buffer.from('1\n{"中":1}\n');
		await pipeline(Readable.from([bytes.subarray(0, 7), bytes.subarray(7)]), log);
		expect(await readFile(file)).toEqual(bytes.subarray(0, 6));
		expect(log.snapshot().entries).toEqual([
			{ start: 0, end: 2, kind: "json", value: 1 },
			{ start: 2, end: 6, kind: "gap", reason: "raw-limit" },
		]);
		expect(log.snapshot().gaps).toEqual({ unrecorded: { start: 6, end: bytes.length, reason: "raw-limit" } });
	});
	it("applies stream backpressure while draining excess output with bounded disk/parser storage", async () => {
		const { log, file } = await sink("stdout", { rawBytes: 65536, lineBytes: 128, entries: 10 });
		let paused = 0;
		const source = Readable.from(
			(function* () {
				for (let i = 0; i < 128; i++) yield Buffer.alloc(32768, 120);
			})(),
			{ objectMode: false },
		);
		source.on("pause", () => paused++);
		await pipeline(source, log);
		expect(paused).toBeGreaterThan(0);
		expect(log.snapshot()).toMatchObject({
			observedBytes: 4194304,
			storedBytes: 65536,
			durable: true,
			streamEnded: true,
		});
		expect((await readFile(file)).length).toBe(65536);
		expect(log.snapshot().entries.length).toBeLessThanOrEqual(10);
		expect(log.snapshot().gaps.unrecorded).toEqual({ start: 65536, end: 4194304, reason: "raw-limit" });
	});
	it("retains bytes on interruption, waits for in-flight writes, closes safely and never marks source EOF", async () => {
		const { log, file } = await sink();
		const done = finished(log);
		log.write(Buffer.from('{"pending":'));
		log.destroy(new Error("controller disconnected"));
		await expect(done).rejects.toThrow("controller disconnected");
		const bytes = await readFile(file),
			snapshot = log.snapshot();
		expect(bytes.toString()).toBe('{"pending":');
		expect(snapshot).toMatchObject({
			streamEnded: false,
			interrupted: true,
			durable: true,
			failure: "controller disconnected",
			storedBytes: bytes.length,
		});
		expect(snapshot.sha256).toBe(sha(bytes));
		expect(snapshot.entries).toEqual([{ start: 0, end: bytes.length, kind: "gap", reason: "interrupted" }]);
	});
	it("refuses replacement, symlink destinations and invalid limits without touching existing bytes", async () => {
		const { log, file, directory } = await sink();
		log.end();
		await finished(log);
		await expect(ExternalEvaluationLog.create(file, "stdout", limits)).rejects.toThrow();
		const original = join(directory, "original"),
			link = join(directory, "link");
		await writeFile(original, "keep");
		await symlink(original, link);
		await expect(ExternalEvaluationLog.create(link, "stdout", limits)).rejects.toThrow();
		expect(await readFile(original, "utf8")).toBe("keep");
		for (const value of [0, -1, NaN, Infinity, 1.5, 1024 ** 2 + 1]) {
			await expect(
				ExternalEvaluationLog.create(join(directory, "invalid"), "stdout", { ...limits, rawBytes: value }),
			).rejects.toThrow("limits");
		}
	});
	it("accounts for partial OS writes and preserves only actual bytes when the next write fails", async () => {
		const { log, file } = await sink();
		const handle = (log as any).file;
		const actualWrite = handle.write.bind(handle);
		vi.spyOn(handle, "write")
			.mockImplementationOnce((...args: unknown[]) => actualWrite(args[0], args[1], 4))
			.mockRejectedValueOnce(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
		await expect(pipeline(Readable.from([Buffer.from('{"unfinished":true}')]), log)).rejects.toThrow("disk full");
		const bytes = await readFile(file);
		expect(bytes.toString()).toBe('{"un');
		expect(log.snapshot()).toMatchObject({
			storedBytes: 4,
			observedBytes: 19,
			streamEnded: false,
			interrupted: true,
			durable: true,
			failure: "disk full",
			sha256: sha(bytes),
		});
		expect(log.snapshot().gaps.unrecorded).toEqual({ start: 4, end: 19, reason: "io-error" });
	});
	it("does not claim durability or EOF when fsync fails and still closes the raw descriptor", async () => {
		const { log, file } = await sink();
		const handle = (log as any).file;
		vi.spyOn(handle, "sync").mockRejectedValueOnce(new Error("fsync fault"));
		await expect(pipeline(Readable.from([Buffer.from("1\n")]), log)).rejects.toThrow("fsync fault");
		expect(log.snapshot()).toMatchObject({
			durable: false,
			streamEnded: false,
			interrupted: true,
			failure: "fsync fault",
		});
		expect(await readFile(file, "utf8")).toBe("1\n");
		await expect(handle.stat()).rejects.toThrow();
	});
});
