import { extensionToolDenial } from "../../server/extension-tool-gate.js";
import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { planModeDenial } from "../../server/plan-mode.js";
import { delegationDenial } from "../../server/delegate-mode.js";
import { withPlanModeGate } from "../../server/tool-guards.js";

describe("UI execution guards", () => {
	it.each([
		["ui_test_run", "start"],
		["ui_discover_record", "action"],
		["ui_case_design", "save-file"],
		["ui_test_workflow", "start"],
		["ui_asset_maintain", "audit-evidence"],
		["mcp__ui_playwright_test__browser_click", ""],
	])("rejects %s/%s before implementation in plan and reviewer modes", (name, operation) => {
		const params = { request: { operation } };
		expect(planModeDenial(name, params)).toBeDefined();
		expect(delegationDenial(name, params)).toBeDefined();
	});
	it.each([
		["ui_test_run", "status"],
		["ui_discover_record", "status"],
		["ui_test_workflow", "catalog"],
		["ui_design_diagnose", "schema"],
	])("allows read-only %s/%s", (name, operation) => {
		expect(planModeDenial(name, { request: { operation } })).toBeUndefined();
		expect(delegationDenial(name, { request: { operation } })).toBeUndefined();
	});
	it.each(["ui_test_run", "data_space_env"])("does not enter a blocked executor: %s", async (name) => {
		let executions = 0;
		const tool = withPlanModeGate(
			{
				name,
				label: "probe",
				description: "probe",
				parameters: Type.Object({}),
				execute: async () => {
					executions++;
					return { content: [{ type: "text", text: "executed" }], details: {} };
				},
			},
			() => true,
			() => "zh",
		);
		await expect(
			tool.execute(
				"probe",
				{ request: { operation: "start" }, action: "refresh" } as never,
				undefined,
				undefined,
				{} as never,
			),
		).rejects.toThrow();
		expect(executions).toBe(0);
	});
});

describe("extension permission and operation boundaries", () => {
	const state = {
		planMode: false,
		delegateMode: false,
		goalReview: false,
		permission: "workspace-write-never",
		uiDisabled: false,
	};
	it.each([
		["ui_discover_record", "inventory"],
		["ui_discover_record", "start"],
		["ui_discover_record", "finish"],
		["ui_case_design", "candidate"],
		["ui_case_design", "save-cases"],
		["ui_design_diagnose", "diagnose"],
		["ui_design_review", ""],
		["ui_result_analysis", "parse"],
		["ui_result_analysis", "save-analysis"],
		["ui_result_analysis", "draft-report"],
		["ui_result_review", "review"],
		["ui_result_review", "deliver"],
		["ui_asset_maintain", "export"],
		["ui_asset_maintain", "import"],
		["ui_test_workflow", "checkpoint"],
		["ui_test_workflow", "block"],
		["ui_test_workflow", "resume-task"],
	])("rejects side effects %s/%s under readonly permission", (name, operation) => {
		expect(extensionToolDenial(name, { request: { operation } }, { ...state, permission: "read-only" })).toBeDefined();
		expect(extensionToolDenial(name, { request: { operation } }, state)).toBeUndefined();
	});
	it.each([
		undefined,
		null,
		{},
		{ request: {} },
		{ request: { operation: "Status" } },
		{ request: { operation: ["status"] } },
	])("fails closed for malformed/unknown operations %s", (input) => {
		expect(extensionToolDenial("ui_test_run", input, { ...state, planMode: true })).toBeDefined();
	});
	it("unknown extensions/MCP are not trusted just because the name sounds readonly", () => {
		for (const name of ["third_party_query", "mcp__unknown__read", "ui_future_tool"]) {
			expect(extensionToolDenial(name, {}, { ...state, delegateMode: true })).toBeDefined();
			expect(extensionToolDenial(name, {}, state)).toBeUndefined();
		}
	});
	it("UI disabling blocks readonly and nested MCP calls too", () => {
		expect(
			extensionToolDenial("ui_test_workflow", { request: { operation: "catalog" } }, { ...state, uiDisabled: true }),
		).toBeDefined();
		expect(
			extensionToolDenial("mcp__ui_playwright_test__browser_snapshot", {}, { ...state, uiDisabled: true }),
		).toBeDefined();
	});
	it("full access does not override plan/delegate/goal restrictions; host read still works", () => {
		for (const field of ["planMode", "delegateMode", "goalReview"]) {
			const mode = { ...state, permission: "danger-full-access", [field]: true };
			expect(extensionToolDenial("ui_test_run", { request: { operation: "start" } }, mode)).toBeDefined();
			expect(extensionToolDenial("read", { path: "hello.txt" }, mode)).toBeUndefined();
		}
	});
});

describe("Data Space environment effects", () => {
	it.each([undefined, "list"])("allows only side-effect-free environment query %s", (action) => {
		expect(planModeDenial("data_space_env", { action })).toBeUndefined();
		expect(delegationDenial("data_space_env", { action })).toBeUndefined();
		expect(
			extensionToolDenial(
				"data_space_env",
				{ action },
				{ planMode: false, delegateMode: false, goalReview: false, permission: "read-only", uiDisabled: false },
			),
		).toBeUndefined();
	});
	it.each(["refresh", "Refresh", "unknown"])("blocks environment effect %s in restricted modes", (action) => {
		expect(planModeDenial("data_space_env", { action })).toBeDefined();
		expect(delegationDenial("data_space_env", { action })).toBeDefined();
		expect(
			extensionToolDenial(
				"data_space_env",
				{ action },
				{ planMode: false, delegateMode: false, goalReview: false, permission: "read-only", uiDisabled: false },
			),
		).toBeDefined();
	});
});
