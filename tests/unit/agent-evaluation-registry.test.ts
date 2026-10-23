import { describe, expect, it } from "vitest";
import { Type as T } from "typebox";
import { EvaluationRegistry } from "../../plugins/agent-evaluation/registry.mjs";
import { aggregate } from "../../plugins/agent-evaluation/aggregate.mjs";
const rule = (id = "F01", overrides: any = {}) => ({
	manifest: {
		id,
		version: "1",
		method: "deterministic",
		supportedTaskTypes: ["agent-task"],
		requiredEvidence: [],
		configSchema: T.Object({ threshold: T.Optional(T.Number({ minimum: 0 })) }, { additionalProperties: false }),
		outputSchemaVersion: 1,
		timeoutMs: 100,
		budget: { maxFindings: 100 },
		dependencies: [],
		...overrides,
	},
	evaluate: () => [],
});
const profile = (changes: any = {}) => ({
	id: "internal",
	version: "1",
	taskTypes: ["agent-task"],
	rules: [{ id: "F01", version: "1", config: {} }],
	required: [],
	aggregation: "contract-v1",
	...changes,
});

describe("EC03 trusted extension registry", () => {
	it("registers versioned rules, profiles and adapters without exposing business capabilities", () => {
		const registry = new EvaluationRegistry();
		registry.registerEvaluators([rule()]);
		registry.registerProfile(profile());
		const collect = () => ({ items: [] });
		registry.registerAdapter({ id: "pi", version: "1", capabilities: () => ({ history: "partial" }), collect });
		expect(registry.adapter("pi", "1").collect).toBe(collect);
		expect(registry.orderedRules(registry.profile("internal", "1"))).toEqual(profile().rules);
		expect(Object.isFrozen(registry.evaluator("F01", "1").manifest.configSchema)).toBe(true);
	});
	it("rejects duplicate identity/version while allowing an independently readable new version", () => {
		const registry = new EvaluationRegistry();
		registry.registerEvaluators([rule()]);
		expect(() => registry.registerEvaluators([rule()])).toThrow(/already registered/);
		registry.registerEvaluators([rule("F01", { version: "2" })]);
		expect(registry.evaluator("F01", "1").manifest.version).toBe("1");
		expect(registry.evaluator("F01", "2").manifest.version).toBe("2");
		registry.registerProfile(profile());
		expect(() => registry.registerProfile(profile())).toThrow(/already registered/);
	});
	it("rejects cycles and missing dependencies atomically", () => {
		const registry = new EvaluationRegistry();
		expect(() =>
			registry.registerEvaluators([
				rule("F01", { dependencies: [{ id: "F02", version: "1" }] }),
				rule("F02", { dependencies: [{ id: "F01", version: "1" }] }),
			]),
		).toThrow(/cycle/);
		expect(() => registry.evaluator("F01", "1")).toThrow(/not registered/);
		expect(() => registry.registerEvaluators([rule("F01", { dependencies: [{ id: "F02", version: "1" }] })])).toThrow(
			/Missing/,
		);
	});
	it("orders dependencies and rejects profiles that omit them", () => {
		const registry = new EvaluationRegistry();
		registry.registerEvaluators([rule("F02", { dependencies: [{ id: "F01", version: "1" }] }), rule()]);
		expect(() => registry.registerProfile(profile({ rules: [{ id: "F02", version: "1", config: {} }] }))).toThrow(
			/omits/,
		);
		registry.registerProfile(
			profile({
				rules: [
					{ id: "F02", version: "1", config: {} },
					{ id: "F01", version: "1", config: {} },
				],
			}),
		);
		expect(registry.orderedRules(registry.profile("internal", "1")).map((r) => r.id)).toEqual(["F01", "F02"]);
	});
	it("rejects unregistered versions, unsupported types, malformed schemas and invalid configuration", () => {
		const registry = new EvaluationRegistry();
		expect(() =>
			registry.registerEvaluators([rule("Bad", { configSchema: { $ref: "https://example.invalid/schema" } })]),
		).toThrow(/refs/);
		expect(() => registry.registerEvaluators([rule("Bad", { configSchema: { type: "invalid" } })])).toThrow(/schema/);
		expect(() => registry.registerEvaluators([rule("Bad", { timeoutMs: -1 })])).toThrow(/manifest/);
		registry.registerEvaluators([rule()]);
		expect(() => registry.registerProfile(profile({ rules: [{ id: "F01", version: "2", config: {} }] }))).toThrow(
			/not registered/,
		);
		expect(() => registry.registerProfile(profile({ taskTypes: ["client-software"] }))).toThrow(/task type/);
		expect(() =>
			registry.registerProfile(profile({ rules: [{ id: "F01", version: "1", config: { threshold: -1 } }] })),
		).toThrow(/configuration/);
		expect(() => registry.registerProfile(profile({ required: [{ id: "F09", version: "1" }] }))).toThrow(
			/not selected/,
		);
	});
	it("freezes copies rather than caller-owned mutable profile/schema/capabilities", () => {
		const registry = new EvaluationRegistry(),
			evaluator = rule(),
			input = profile();
		registry.registerEvaluators([evaluator]);
		registry.registerProfile(input);
		evaluator.manifest.timeoutMs = 1;
		input.rules[0].config = { threshold: 9 };
		expect(registry.evaluator("F01", "1").manifest.timeoutMs).toBe(100);
		expect(registry.profile("internal", "1").rules[0].config).toEqual({});
		const caps = { history: "partial" };
		registry.registerAdapter({ id: "pi", version: "1", capabilities: () => caps, collect: () => {} });
		caps.history = "supported";
		expect(registry.adapter("pi", "1").capabilities()).toEqual({ history: "partial" });
	});
});
const condition = (id: string, changes: any = {}) => ({
	id,
	required: true,
	sourceType: "user",
	applicableWhen: "always",
	...changes,
});
const finding = (conditionId: string, verdict: string, changes: any = {}) => ({
	findingId: conditionId,
	conditionId,
	verdict,
	reason: "fixture",
	...changes,
});
describe("EC03 contract aggregation", () => {
	it.each([
		[[], [], "undetermined", "inconclusive"],
		[[condition("a")], [finding("a", "pass")], "achieved", "pass"],
		[[condition("a")], [finding("a", "fail")], "not-achieved", "fail"],
		[[condition("a"), condition("b")], [finding("a", "pass"), finding("b", "fail")], "partially-achieved", "fail"],
		[[condition("a"), condition("b")], [finding("a", "fail")], "undetermined", "fail"],
		[[condition("a")], [finding("a", "inconclusive")], "undetermined", "inconclusive"],
	])(
		"computes required goals and delivery without hiding unknown or known failure (%#)",
		(conditions, findings, goal, deliveryVerdict) => {
			expect(aggregate({ conditions, constraints: [] }, findings)).toMatchObject({ goal, deliveryVerdict });
		},
	);
	it("keeps correct refusal separate from an unmet goal", () => {
		expect(
			aggregate({ conditions: [condition("goal")], constraints: [condition("refuse")] }, [
				finding("goal", "fail"),
				finding("refuse", "pass"),
			]),
		).toMatchObject({ goal: "not-achieved", behavior: "pass", deliveryVerdict: "fail" });
	});
	it("does not show successful delivery when an achieved goal violates required constraints", () => {
		expect(
			aggregate({ conditions: [condition("goal")], constraints: [condition("policy")] }, [
				finding("goal", "pass"),
				finding("policy", "fail"),
			]),
		).toMatchObject({ goal: "achieved", behavior: "fail", deliveryVerdict: "fail" });
	});
	it("keeps proposed/advisory failures out of the required goal and gate", () => {
		expect(
			aggregate(
				{ conditions: [condition("goal"), condition("proposal", { sourceType: "proposed" })], constraints: [] },
				[finding("goal", "pass"), finding("proposal", "fail")],
			),
		).toMatchObject({ goal: "achieved", deliveryVerdict: "pass" });
	});
	it("uses separate pass-rate and coverage denominators, with zero denominators left unknown", () => {
		expect(
			aggregate(
				{ conditions: [], constraints: [] },
				[
					finding("a", "pass"),
					finding("b", "fail"),
					finding("c", "inconclusive", { error: "RULE_TIMEOUT" }),
					finding("d", "not-applicable"),
				],
				{ planned: 5, executed: 4 },
			),
		).toMatchObject({
			counts: {
				object: "findings",
				planned: 5,
				executed: 4,
				passRate: 0.5,
				coverage: 0.5,
				notExecuted: 1,
				errors: 1,
				excluded: 1,
			},
		});
		expect(aggregate({ conditions: [], constraints: [] }, []).counts).toMatchObject({ passRate: null, coverage: null });
	});
	it("cannot drop an always-applicable condition by returning unsupported or unproven not-applicable", () => {
		expect(
			aggregate({ conditions: [condition("a")], constraints: [] }, [finding("a", "not-applicable")]),
		).toMatchObject({ goal: "undetermined", deliveryVerdict: "inconclusive" });
	});
	it("does not remove an unknown applicability from a mixed denominator", () => {
		const result = aggregate({ conditions: [condition("a"), condition("b")], constraints: [] }, [
			finding("a", "pass"),
			finding("b", "not-applicable"),
		]);
		expect(result).toMatchObject({
			goal: "undetermined",
			deliveryVerdict: "inconclusive",
			counts: { excluded: 0, inconclusive: 1, coverage: 0.5 },
		});
	});

	it("keeps a required evaluator execution gap visible without making the task an Agent failure", () => {
		expect(
			aggregate({ conditions: [condition("a")], constraints: [] }, [finding("a", "pass")], {
				requiredRuleGaps: ["F06@1 failed"],
			}),
		).toMatchObject({ goal: "achieved", deliveryVerdict: "inconclusive", requiredRuleGaps: ["F06@1 failed"] });
	});
});
