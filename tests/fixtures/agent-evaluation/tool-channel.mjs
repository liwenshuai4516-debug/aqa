/** Local scripted SSE fixture only: deterministic tool calls, no external model. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function createToolChannelFixture(agentDir) {
	let selected;
	const observations = [];
	const server = createServer((request, response) => {
		if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
			response.writeHead(404).end();
			return;
		}
		let bytes = "";
		request.on("data", (chunk) => (bytes += chunk));
		request.on("end", () => {
			try {
				assert.ok(selected, "No scripted tool step selected");
				const payload = JSON.parse(bytes),
					messages = payload.messages ?? [],
					lastUser = messages.map((message) => message.role).lastIndexOf("user"),
					tail = messages.slice(lastUser + 1),
					results = tail.filter((message) => message.role === "tool"),
					tool = payload.tools?.find((entry) => entry.function?.name === "agent_evaluation");
				assert.ok(tool, "Actual SDK request omitted agent_evaluation");
				assert.ok(selected.requests++ < 2, "Unexpected scripted response loop");
				observations.push({
					step: selected.id,
					model: payload.model,
					toolSchema: tool.function.parameters,
					toolResults: results,
				});
				const delta = results.length
					? { content: `SCRIPTED_FIXTURE_DONE:${selected.id}` }
					: {
							tool_calls: [
								{
									index: 0,
									id: selected.id,
									type: "function",
									function: { name: "agent_evaluation", arguments: JSON.stringify(selected.args) },
								},
							],
						};
				response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
				for (const [part, finish] of [
					[delta, null],
					[{}, results.length ? "stop" : "tool_calls"],
				])
					response.write(
						`data: ${JSON.stringify({ id: "offline-tool-channel", object: "chat.completion.chunk", model: "offline-tool-fixture", choices: [{ index: 0, delta: part, finish_reason: finish }] })}\n\n`,
					);
				response.end("data: [DONE]\n\n");
			} catch (error) {
				observations.push({ error: error.message });
				response.writeHead(500).end("Scripted fixture failed");
			}
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	assert.ok(port >= 8900);
	await writeFile(
		join(agentDir, "models.json"),
		JSON.stringify({
			providers: {
				"offline-tool-fixture": {
					api: "openai-completions",
					baseUrl: `http://127.0.0.1:${port}/v1`,
					apiKey: "synthetic-not-a-credential",
					models: [
						{
							id: "offline-tool-fixture",
							name: "Local scripted tool fixture",
							input: ["text"],
							contextWindow: 32000,
							maxTokens: 512,
						},
					],
				},
			},
		}),
	);
	return {
		select(id, args) {
			selected = { id, args, requests: 0 };
		},
		observations,
		close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
	};
}
