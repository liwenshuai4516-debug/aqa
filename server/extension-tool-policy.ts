/** Operation effects for the installed UI workflow and unclassified MCP calls.
 * Keep this in sync with the pinned pi-ui-testing contracts; unknown operations
 * fail closed in restricted modes. Annotations are author hints, not authority.
 */
export type ExtensionToolEffect = "query" | "asset-write" | "browser-action" | "test-execution";
const QUERIES: Record<string, readonly string[]> = {
	ui_discover_record: ["status"],
	ui_case_design: ["check"],
	ui_design_diagnose: ["schema", "status"],
	ui_test_run: ["status", "plan-recovery"],
	ui_result_analysis: ["read-trace"],
	ui_asset_maintain: ["impact", "inspect-import"],
	ui_test_workflow: ["catalog", "status"],
};
export function extensionToolEffect(name: string, params: unknown): ExtensionToolEffect | undefined {
	const action = params && typeof params === "object" ? (params as { action?: unknown }).action : undefined;
	if (name === "agent_evaluation")
		return [
			"describe",
			"experimentStatus",
			"dataSpaceDescribe",
			"dataSpaceObserve",
			"projectReportStatus",
			"list",
			"get",
			"readEvidence",
			"export",
			"status",
		].includes(action as string)
			? "query"
			: "asset-write";
	if (name === "data_space_cases")
		return action === undefined || ["list", "get", "stats"].includes(action as string) ? "query" : "asset-write";
	if (name === "data_space_env") return action === undefined || action === "list" ? "query" : "asset-write";
	if (name === "data_space_record_result") return "asset-write";
	if (name === "data_space_automation")
		return ["inspect", "route", "archive-status", "sync-status"].includes(action as string) ? "query" : "asset-write";
	if (name === "ui_validate_artifact") return "query";
	if (name.startsWith("mcp__")) return "browser-action";
	if (!name.startsWith("ui_")) return undefined;
	const request = params && typeof params === "object" ? (params as { request?: unknown }).request : undefined;
	const operation = request && typeof request === "object" ? (request as { operation?: unknown }).operation : undefined;
	if (typeof operation === "string" && QUERIES[name]?.includes(operation)) return "query";
	if (name === "ui_test_run" || (name === "ui_design_diagnose" && operation === "diagnose")) return "test-execution";
	if (name === "ui_discover_record" && operation === "action") return "browser-action";
	return "asset-write";
}
