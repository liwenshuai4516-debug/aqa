/** One controlled workflow entry; raw MCP execution and approval signing stay private. */
export default {
	activate(host) {
		host.registerAgentTool({
			name: "api_test_execute",
			label: "API test workflow",
			description:
				"Prepare, independently review, run, retest or read reports for a frozen API suite. Only loopback fixtures are supported. Executable approval is issued by the host after review, never from an imported pass label.",
			promptSnippet: "Build, review, run or inspect an API fixture suite.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					action: { type: "string", enum: ["prepare", "revise", "review", "run", "retest", "report"] },
					runRef: { type: "string" },
					sourcePath: { type: "string" },
					operationIds: { type: "array", items: { type: "string" }, maxItems: 3 },
					cases: { type: "array", items: { type: "object" }, maxItems: 3 },
					rules: { type: "array", items: { type: "object" } },
					baseUrl: { type: "string" },
					outputPath: { type: "string" },
					requiredKeywords: { type: "array", items: { type: "string" } },
					model: { type: "string" },
					priorRunId: { type: "string" },
					runId: { type: "string" },
				},
			},
			execute: async (_id, params, signal, _onUpdate, context) => {
				if (!context) throw new Error("This engine does not provide controlled API execution");
				if (!params.action) {
					if (typeof params.runRef !== "string") throw new Error("A run reference or workflow action is required");
					return host.mcp.call(
						context,
						{ serverId: "api-testing", toolName: "runApprovedSuite", runRef: params.runRef },
						signal,
					);
				}
				const { runRef, ...input } = params;
				return host.mcp.call(
					context,
					{ serverId: "api-testing", toolName: "workflow", runRef: runRef ?? "new", input },
					signal,
				);
			},
		});
	},
};
