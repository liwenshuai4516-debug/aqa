/** Actual host + SDK tool_call interception. Local scripted SSE, no paid model. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectEnvironment, openProjectSocket, waitUntil } from "../qa/ui/project-environment.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "ui-tool-guards");
const evidence = join(repo, "tests/scratch/ui-guards", String(Date.now()));
await mkdir(evidence, { recursive: true });
let step;
const mock = createServer((req, res) => {
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		const payload = JSON.parse(body || "{}");
		const tail = (payload.messages ?? []).slice((payload.messages ?? []).map((m) => m.role).lastIndexOf("user") + 1);
		const tool = [...tail].reverse().find((m) => m.role === "tool");
		const delta = tool
			? { content: "SEEN:" + tool.content }
			: {
					tool_calls: [
						{
							index: 0,
							id: `probe-${Date.now()}`,
							type: "function",
							function: { name: step.name, arguments: JSON.stringify({ request: { operation: step.operation } }) },
						},
					],
				};
		res.writeHead(200, { "content-type": "text/event-stream" });
		for (const [part, finish] of [
			[delta, null],
			[{}, tool ? "stop" : "tool_calls"],
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "mock",
						object: "chat.completion.chunk",
						model: "mock-model",
						choices: [{ index: 0, delta: part, finish_reason: finish }],
					}) +
					"\n\n",
			);
		res.end("data: [DONE]\n\n");
	});
});
await new Promise((ok) => mock.listen(0, "127.0.0.1", ok));
let fixture;
const checks = [];
let passed = false;
try {
	fixture = await createProjectEnvironment({
		prepare: async ({ agentDir }) => {
			await writeFile(
				join(agentDir, "settings.json"),
				JSON.stringify({ extensions: [join(repo, "tests/fixtures/ui-guard-extension.mjs")] }),
			);
			await writeFile(join(agentDir, "auth.json"), JSON.stringify({ mock: { type: "api_key", key: "dummy" } }));
			await writeFile(
				join(agentDir, "models.json"),
				JSON.stringify({
					providers: {
						mock: {
							api: "openai-completions",
							baseUrl: `http://127.0.0.1:${mock.address().port}/v1`,
							apiKey: "dummy",
							models: [{ id: "mock-model", name: "Mock" }],
						},
					},
				}),
			);
		},
	});
	const channel = await openProjectSocket(fixture);
	channel.send({ type: "set_model", modelId: "mock/mock-model" });
	await waitUntil(() => channel.state.model?.id === "mock-model", "mock model selected");
	const executions = async () =>
		(
			await readFile(join(fixture.workDir, "executions.log"), "utf8").catch((e) => {
				if (e.code === "ENOENT") return "";
				throw e;
			})
		)
			.trim()
			.split("\n")
			.filter(Boolean);
	const invoke = async (name, operation, allowed) => {
		const count = channel.state.messages.length;
		const before = (await executions()).length;
		step = { name, operation };
		channel.send({ type: "prompt", text: `fixture ${name} ${operation}` });
		await waitUntil(
			() =>
				channel.state.messages.length > count + 1 &&
				!channel.state.isStreaming &&
				channel.state.messages
					.slice(count)
					.some((m) => m.role === "assistant" && JSON.stringify(m.content).includes("SEEN:")),
			"probe result",
		);
		const result = channel.state.messages.slice(count).filter((m) => m.role === "toolResult");
		assert.ok(result.length, "SDK must record actual tool result");
		assert.equal(JSON.stringify(result).includes("PROBE_EXECUTED"), allowed, JSON.stringify(result));
		const after = (await executions()).length;
		assert.equal(
			after - before,
			allowed && operation !== "status" ? 1 : 0,
			"denied execution must have no side effects",
		);
		checks.push({ name, operation, allowed, sideEffects: after - before });
	};
	channel.send({ type: "set_plan_mode", enabled: true });
	await waitUntil(() => channel.state.planMode, "plan mode");
	await invoke("ui_test_run", "start", false);
	await invoke("ui_discover_record", "action", false);
	await invoke("ui_case_design", "save-file", false);
	await invoke("mcp__fixture__browser_click", "click", false);
	await invoke("ui_test_workflow", "catalog", false); // query outer -> blocked nested action
	await invoke("ui_test_run", "status", true);
	channel.send({ type: "set_plan_mode", enabled: false });
	await waitUntil(() => !channel.state.planMode, "plan off");
	channel.send({ type: "dsh_permission_set", preset: "read-only" });
	await waitUntil(() => channel.state.permission === "read-only", "readonly permission");
	await invoke("ui_discover_record", "action", false);
	await invoke("ui_test_run", "status", true);
	channel.send({ type: "dsh_permission_set", preset: "workspace-write-never" });
	await waitUntil(() => channel.state.permission === "workspace-write-never", "write permission restored");
	await invoke("ui_test_run", "start", true);
	assert.equal((await executions()).length, 1);
	passed = true;
} finally {
	const cleanup = await fixture?.dispose();
	await new Promise((ok) => mock.close(ok));
	await writeFile(
		join(evidence, "result.json"),
		JSON.stringify(
			{ status: passed ? "PASS" : "FAIL", checks, cleanup, actualModelCalls: 0, scriptedModel: true },
			null,
			2,
		),
	);
	console.log(JSON.stringify({ status: passed ? "PASS" : "FAIL", checks: checks.length, evidence }));
}
