/** Fixed-schema validation must preserve interpreter decisions when accelerated. No models or external schemas. */
import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import {
	schemas,
	Ref,
	Domain,
	validate,
	validateRef,
	validateDomain,
	canonical,
	jsonStringBytes,
} from "../../plugins/agent-evaluation/schema.mjs";
import { engineFixture, ref } from "../fixtures/agent-evaluation/engine.mjs";
import { F06 } from "../../plugins/agent-evaluation/evaluators/basic.mjs";

const accepts = (check: (v: any) => void, value: any) => {
	try {
		check(value);
		return true;
	} catch {
		return false;
	}
};
function* mutations(value: any): Generator<any> {
	for (const replacement of [null, undefined, false, 0, NaN, Infinity, "", "字段😀", [], {}]) yield replacement;
	if (!value || typeof value !== "object") return;
	for (const name of Object.keys(value)) {
		const missing = structuredClone(value);
		delete missing[name];
		yield missing;
		for (const replacement of [null, undefined, false, -1, 1.5, "", "wrong", [], {}])
			yield { ...structuredClone(value), [name]: replacement };
		if (value[name] && typeof value[name] === "object")
			for (const nested of mutations(value[name])) yield { ...structuredClone(value), [name]: nested };
	}
	yield { ...value, unexpected: "must reject" };
	yield Object.assign(Object.create(null), value);
}
describe("bundled schema acceleration", () => {
	it("counts the exact JSON bytes of every UTF-16 unit and paired/unpaired surrogate boundaries", () => {
		for (let code = 0; code <= 0xffff; code++) {
			const text = String.fromCharCode(code);
			expect(jsonStringBytes(text), `UTF-16 ${code}`).toBe(Buffer.byteLength(JSON.stringify(text)));
		}
		const allUnits = Array.from({ length: 65536 }, (_, code) => String.fromCharCode(code)).join("");
		for (const text of [
			"",
			allUnits,
			"😀中文",
			"\ud83d\ud83d\ude00\ude00",
			'\u0000\b\t\n\f\r"\\'.repeat(1000),
			"x".repeat(200000),
		]) {
			expect(jsonStringBytes(text)).toBe(Buffer.byteLength(JSON.stringify(text)));
			const envelope = { kind: "evidence", data: { content: text, source: "合成" }, requestId: "test" },
				empty = { ...envelope, data: { ...envelope.data, content: "" } };
			expect(Buffer.byteLength(canonical(empty)) + jsonStringBytes(text) - 2).toBe(
				Buffer.byteLength(canonical(envelope)),
			);
		}
	});
	it("matches interpreter decisions for all seven persisted kinds and nested malformed values", async () => {
		const f = engineFixture({ rules: [F06] });
		try {
			const report = await f.engine.evaluate(f.context, f.args);
			const samples: Record<string, any> = {};
			for (const kind of Object.keys(schemas)) {
				if (kind === "reviews")
					samples[kind] = {
						evaluationRef: ref(report),
						findingId: "fixture",
						decision: "inconclusive",
						reason: "offline",
					};
				else samples[kind] = f.store.get(f.context, ref(f.store.list(f.context, { kind }).items[0])).data;
			}
			for (const [kind, value] of Object.entries(samples)) {
				expect(
					accepts((v) => validate(kind, v), value),
					kind,
				).toBe(true);
				for (const candidate of mutations(value))
					expect(
						accepts((v) => validate(kind, v), candidate),
						kind,
					).toBe(Check(schemas[kind as keyof typeof schemas], candidate));
			}
		} finally {
			f.cleanup();
		}
	});
	it("preserves reference/domain guards, strict kind names and Unicode byte limits", () => {
		const recordRef = { kind: "evidence", id: "12345678-1234-4234-8234-123456789abc", revision: 1 };
		for (const candidate of mutations(recordRef)) expect(accepts(validateRef, candidate)).toBe(Check(Ref, candidate));
		for (const candidate of mutations({ principalId: "用户", workspaceId: "工作区" }))
			expect(accepts(validateDomain, candidate)).toBe(Check(Domain, candidate));
		for (const kind of ["__proto__", "constructor", "missing"]) expect(() => validate(kind, {})).toThrow(/Invalid/);
		const evidence = {
			attemptRef: { ...recordRef, kind: "attempts" },
			sourceId: "fixture",
			sourceLocator: "fixture",
			producer: "fixture",
			availability: "available",
			origin: "harness-observed",
			kind: "text",
			observedAt: "now",
			content: "😀".repeat(300000),
			redaction: [],
			truncated: false,
		};
		expect(Check(schemas.evidence, evidence)).toBe(true);
		expect(() => validate("evidence", evidence)).toThrow(/byte limit/);
	});
});
