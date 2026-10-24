// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { configurationHtml, readConfiguration } from "../../plugins/agent-evaluation/client/configuration.mjs";
import { translator } from "../../plugins/agent-evaluation/client/i18n.mjs";
import { createInternalRegistry, internalProfile } from "../../plugins/agent-evaluation/profiles/internal.mjs";
const t = translator("en");
const esc = (value: unknown) =>
	String(value ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
	);
afterEach(() => document.body.replaceChildren());
function form(configs: any) {
	const conditions = ["F01", "F02", "F04", "F05", "F08"].map((id) => ({
		id: `c-${id}`,
		statement: `Frozen ${id} requirement <img src=x>`,
		ruleRef: `${id}@1`,
	}));
	const el = document.createElement("form");
	el.innerHTML = configurationHtml(configs, conditions, t, esc);
	document.body.append(el);
	return el;
}
function fullConfigs(overrides: any = {}) {
	return Object.fromEntries(internalProfile(overrides).rules.map((rule: any) => [rule.id, rule.config]));
}
describe("installed rule configuration form", () => {
	it("round-trips every installed rule and pricing field without changing zero, null, spaces or explicit empty selection", () => {
		const configs = fullConfigs({
			F01: {
				checks: [
					{
						conditionId: "c-F01",
						path: " leading space/<img src=x>.json",
						format: "json",
						sha256: "a".repeat(64),
						jsonSchema: { type: "object", required: ["ok"], properties: { ok: { const: true } } },
					},
				],
			},
			F02: { checks: [{ conditionId: "c-F02", runId: "run-1", caseIds: [] }] },
			F04: { checks: [{ conditionId: "c-F04", prerequisiteToolCallId: "first", dependentToolCallId: "second" }] },
			F05: {
				checks: [
					{
						conditionId: "c-F05",
						claimEvidenceId: "claim",
						claimPath: "/ok",
						basisEvidenceId: "basis",
						basisPath: "/result",
						expectedValue: null,
					},
				],
			},
			F07: { pollingToolNames: ["poll"], repairToolNames: ["edit", "write"] },
			F08: {
				checks: [{ conditionId: "c-F08", maxAgentWallMs: 0 }],
				childWaitToolNames: ["wait"],
				prices: [
					{
						provider: "fixture",
						model: "offline",
						currency: "USD",
						version: "test-only",
						inputPerMillion: 0,
						outputPerMillion: 0.25,
						cacheReadPerMillion: 0,
						cacheWritePerMillion: 0,
					},
				],
			},
		});
		const el = form(configs),
			result = readConfiguration(el, t);
		expect(result).toEqual(configs);
		expect(el.querySelector("img")).toBeNull();
		expect(() => createInternalRegistry(result)).not.toThrow();
	});
	it("distinguishes all native cases from an explicitly empty case list", () => {
		const configs = fullConfigs({ F02: { checks: [{ conditionId: "c-F02", runId: "native" }] } });
		const el = form(configs);
		expect(readConfiguration(el, t)).toEqual(configs);
		el.querySelector<HTMLSelectElement>("[data-case-scope]")!.value = "selected";
		expect(readConfiguration(el, t).F02.checks[0].caseIds).toEqual([]);
		el.querySelector<HTMLTextAreaElement>('[data-field="caseIds"]')!.value = "case-1\ncase-2";
		expect(readConfiguration(el, t).F02.checks[0].caseIds).toEqual(["case-1", "case-2"]);
	});
	it("keeps unbound conditions out of check selection and rejects malformed expected values before submission", () => {
		const configs = fullConfigs({
			F05: {
				checks: [
					{
						conditionId: "c-F05",
						claimEvidenceId: "claim",
						claimPath: "/ok",
						basisEvidenceId: "basis",
						basisPath: "/result",
						expectedValue: false,
					},
				],
			},
		});
		const el = form(configs);
		expect(el.querySelector('[data-config-row="F05"] [data-field="conditionId"]')!.textContent).not.toContain("c-F01");
		el.querySelector<HTMLTextAreaElement>('[data-field="expectedValue"]')!.value = "{bad";
		expect(() => readConfiguration(el, t)).toThrow(/valid JSON/);
	});
});
