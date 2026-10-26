import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { encodeGuestInput, GuestProtocolDecoder } from "../../server/external-evaluation-guest.js";
const frame = (nonce: string, channel: string, payload = "") => Buffer.from(`AE1:${nonce}:${channel}:${payload}\r\n`);
describe("offline guest byte protocol", () => {
	it("encodes empty/newline/metacharacter argv and all stdin bytes without shell interpolation", () => {
		const argv = ["", "空 格\n\n", "$(touch /canary); `id` ' \\"];
		const stdin = Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 256));
		const lines = encodeGuestInput(argv, stdin).toString().split("\n");
		expect(lines.slice(2, 5).map((line) => Buffer.from(line.slice(2), "base64").toString())).toEqual(argv);
		expect(Buffer.concat(lines.slice(5, -2).map((line) => Buffer.from(line.slice(2), "base64")))).toEqual(stdin);
		expect(lines.every((line) => line.length < 2048)).toBe(true);
	});
	it("refuses NUL, invalid Unicode, oversized individual/total argv and stdin", () => {
		for (const argv of [["\0"], ["\ud800"], ["x".repeat(1025)], Array(17).fill(""), Array(9).fill("x".repeat(1024))])
			expect(() => encodeGuestInput(argv, Buffer.alloc(0))).toThrow();
		expect(() => encodeGuestInput([], Buffer.alloc(65537))).toThrow();
	});
	it("reassembles byte-fragmented serial frames and treats exit as a guest report only", () => {
		const nonce = randomUUID(),
			decoder = new GuestProtocolDecoder(nonce);
		const raw = Buffer.concat([
			Buffer.from("boot noise\r\n"),
			frame(randomUUID(), "exit", "0"),
			frame(nonce, "started", "12"),
			frame(nonce, "stdout", Buffer.from("中文🙂\0\n").toString("base64")),
			frame(nonce, "stderr", "AAEC"),
			frame(nonce, "stdout-eof"),
			frame(nonce, "stderr-eof"),
			frame(nonce, "exit", "7"),
		]);
		const frames = [...raw].flatMap((byte) => decoder.push(Buffer.from([byte])));
		expect(frames.find((f) => f.channel === "stdout")?.bytes).toEqual(Buffer.from("中文🙂\0\n"));
		expect(frames.at(-1)?.bytes.toString()).toBe("7");
		expect(decoder.finish()).toEqual({ exited: true, gaps: [] });
	});
	it("preserves gaps for malformed data, high-bit bytes, oversized frames and missing exit", () => {
		const nonce = randomUUID(),
			decoder = new GuestProtocolDecoder(nonce);
		expect(decoder.push(frame(nonce, "stdout", "YQ"))).toEqual([]);
		expect(decoder.push(frame(nonce, "stdout", "é"))).toEqual([]);
		decoder.push(Buffer.from("x".repeat(3000) + "\n"));
		decoder.push(frame(nonce, "stdout-eof"));
		expect(decoder.push(frame(nonce, "stdout", "YQ=="))).toEqual([]);
		expect(decoder.push(frame(nonce, "exit", "0"))).toEqual([]);
		decoder.push(Buffer.from("AE1:"));
		expect(decoder.finish().gaps).toEqual(
			expect.arrayContaining([
				"invalid-base64",
				"line-budget",
				"after-eof",
				"invalid-exit",
				"partial-line",
				"missing-exit",
			]),
		);
	});
	it("bounds each reconstructed stream, frame count and total serial bytes", () => {
		const nonce = randomUUID(),
			decoder = new GuestProtocolDecoder(nonce),
			payload = Buffer.alloc(512).toString("base64");
		let accepted = 0;
		for (let i = 0; i < 130; i++) accepted += decoder.push(frame(nonce, "stdout", payload)).length;
		expect(accepted).toBe(128);
		decoder.push(Buffer.alloc(1024 * 1024, 120));
		expect(decoder.finish().gaps).toContain("console-budget");
		const counted = new GuestProtocolDecoder(nonce);
		for (let i = 0; i < 1025; i++) counted.push(frame(nonce, "initial"));
		expect(counted.finish().gaps).toContain("event-budget");
	});
});
