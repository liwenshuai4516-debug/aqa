/** P0-1 verification entry only. No product registration or arbitrary input paths. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const runRoot = process.env.P0_RUN_ROOT;
const require = createRequire(join(process.env.P0_RUNTIME, "package.json"));
const load = (name) => import(pathToFileURL(require.resolve(name)).href);
const { McpServer } = await load("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = await load("@modelcontextprotocol/sdk/server/stdio.js");
// Import the pinned upstream executor directly; deliberately bypass cloud fetch/upload.
const upstream = dirname(require.resolve("@postman/postman-mcp-server"));
const { executeCollection } = await import(pathToFileURL(join(upstream, "tools/runner/executor.js")).href);
const manifest = JSON.parse(readFileSync(join(runRoot, "input.json"), "utf8"));
writeFileSync(join(runRoot, "pid"), String(process.pid));
const save = (value) => writeFileSync(join(runRoot, "result.json"), JSON.stringify(value, null, 2));
let started = false;
const server = new McpServer({ name: "postman-local-p0-probe", version: "0.0.0" });
server.registerTool("runLocalFixture", { description: "Run the single hand-approved P0 fixture." }, async () => {
	if (started) throw new Error("This process is single-use; do not resend unknown requests.");
	started = true;
	const identity = {
		runId: manifest.runId,
		status: "running",
		executionVerdict: "unknown",
		pid: process.pid,
		cloudKeyPresent: !!process.env.POSTMAN_API_KEY,
		parentCanaryPresent: !!process.env.P0_PARENT_CANARY,
	};
	save(identity);
	const result = await executeCollection({
		collection: { json: manifest.collection, name: manifest.collection.info.name, id: manifest.runId },
		params: { collectionId: manifest.runId, requestTimeout: manifest.requestTimeout ?? 1000, scriptTimeout: 500 },
	});
	// Deliberately narrow evidence projection for these fixtures; never serialize raw summary.
	const executions = result.summary.run.executions.map((execution) => ({
		caseId: execution.item.name,
		method: execution.request.method,
		path: execution.request.url.getPath(),
		status: execution.response?.code ?? null,
		response: execution.response ? { ok: execution.response.json().ok ?? null } : null,
		requestError: execution.requestError ? { code: execution.requestError.code ?? "REQUEST_ERROR" } : null,
		assertions: (execution.assertions ?? []).map((a) => ({
			name: a.assertion,
			passed: !a.error,
			skipped: !!a.skipped,
			error: a.error
				? { name: a.error.name, message: a.error.message.replaceAll(process.env.P0_SECRET, "[REDACTED]") }
				: null,
		})),
	}));
	const stats = result.summary.run.stats;
	const failures = result.summary.run.failures.length;
	const verdict = stats.requests.failed
		? "error"
		: failures
			? "failed"
			: !stats.assertions.total || stats.assertions.pending
				? "blocked"
				: "passed";
	const evidence = {
		...identity,
		status: "completed",
		executionVerdict: verdict,
		requests: stats.requests,
		assertions: stats.assertions,
		failures,
		executions,
		durationMs: result.durationMs,
		evidenceProjection: "fixture allowlist; headers/body fields omitted",
	};
	save(evidence);
	return { content: [{ type: "text", text: verdict }], structuredContent: evidence };
});
await server.connect(new StdioServerTransport());
