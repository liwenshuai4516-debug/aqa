/** Controlled workflow entry; the raw MCP runner is never registered as an agent tool. */
export default {
	activate(host) {
		host.registerAgentTool({
			name: "api_test_execute",
			label: "API test execution",
			description:
				"Execute one host-approved, frozen API test run reference. Unreviewed or changed suites are rejected. Only isolated fixtures are currently supported.",
			promptSnippet: "Execute an approved API test suite.",
			parameters: {
				type: "object",
				properties: { runRef: { type: "string" } },
				required: ["runRef"],
				additionalProperties: false,
			},
			execute: async (_id, params, signal, _onUpdate, context) => {
				if (!context) throw new Error("This engine does not provide controlled API execution");
				return host.mcp.call(
					context,
					{ serverId: "api-testing", toolName: "runApprovedSuite", runRef: params.runRef },
					signal,
				);
			},
		});
	},
};
