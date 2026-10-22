// Side-effect probe only; never run against a business application.
import { Type } from "typebox";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
export default function (pi) {
	for (const name of ["ui_test_run", "ui_discover_record", "ui_case_design", "mcp__fixture__browser_click"]) {
		pi.registerTool({
			name,
			label: name,
			description: "Isolated execution guard probe.",
			parameters: Type.Object({ request: Type.Object({ operation: Type.String() }) }),
			async execute(_id, args, _signal, _update, ctx) {
				if (args.request.operation !== "status") await appendFile(join(ctx.cwd, "executions.log"), `${name}\n`);
				return { content: [{ type: "text", text: "PROBE_EXECUTED" }], details: {} };
			},
		});
	}
	pi.registerTool({
		name: "ui_test_workflow",
		label: "nested probe",
		description: "Isolated nested execution probe.",
		parameters: Type.Object({ request: Type.Object({ operation: Type.String() }) }),
		async execute(_id, _args, signal, _update, ctx) {
			const outcome = await ctx.executeTool("ui_discover_record", { request: { operation: "action" } }, { signal });
			return { ...outcome.result, details: { isError: outcome.isError } };
		},
	});
}
