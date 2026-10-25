/** Exact persisted byte compatibility against the pre-0.4.17 canonical serializer. */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonical, digest } from "../../plugins/agent-evaluation/schema.mjs";
function legacy(value: any): any {
	if (Array.isArray(value)) return `[${value.map(legacy).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${legacy(value[k])}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
const check = (value: any) => {
	const before = legacy(value);
	expect(canonical(value)).toBe(before);
	if (before !== undefined) expect(digest(value)).toBe(createHash("sha256").update(before).digest("hex"));
};
describe("canonical persisted byte compatibility", () => {
	it("retains lexical numeric keys, escaping, Unicode and legacy undefined/sparse semantics", () => {
		const samples = [
			null,
			undefined,
			false,
			0,
			-0,
			NaN,
			Infinity,
			"",
			'中文😀\ud800\u0000\n\t"\\',
			[],
			new Array(3),
			[undefined, null, , false],
			{ value: undefined },
			{ "2": "second", "10": "tenth", "01": "first" },
			JSON.parse('{"__proto__":{"safe":true},"constructor":"literal"}'),
			Object.assign(Object.create(null), { z: 1, a: 2 }),
			new Date(0),
		];
		for (const value of samples) check(value);
		expect(canonical({ "2": 2, "10": 10 })).toBe('{"10":10,"2":2}');
	});
	it("matches nested deterministic documents and preserves the caller's values", () => {
		let state = 0x10203040;
		const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
		const primitive = () => [null, true, false, next() / 2 ** 32, `line ${next()} 中文😀\n\"\\`][next() % 5];
		const document = (depth: number): any => {
			if (!depth) return primitive();
			const values = Array.from({ length: next() % 5 }, () => document(depth - 1));
			return next() % 2 ? values : Object.fromEntries(values.map((v, i) => [`${next() % 100}-${i}`, v]));
		};
		for (let i = 0; i < 1000; i++) {
			const value = document(4),
				before = structuredClone(value);
			check(value);
			expect(value).toEqual(before);
		}
	});
	it("keeps long escaped evidence envelopes and unsupported input failures unchanged", () => {
		check({
			kind: "evidence",
			data: {
				content: JSON.stringify({ message: { content: [{ type: "text", text: '中文😀\"\\\n'.repeat(30000) }] } }),
			},
			requestId: "fixture",
		});
		const cyclic: any = {};
		cyclic.self = cyclic;
		for (const value of [1n, cyclic]) {
			expect(() => legacy(value)).toThrow();
			expect(() => canonical(value)).toThrow();
		}
	});
});
