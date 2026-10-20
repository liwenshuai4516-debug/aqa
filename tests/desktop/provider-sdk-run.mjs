// Read the test credential only from stdin; never write auth files or response headers.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
let credential = "";
for await (const chunk of process.stdin) credential += chunk;
credential = credential.trim();
assert(credential, "Test credential is required on stdin");
const packageRoot = resolve(process.argv[2]);
const { completeSimple } = await import(
	pathToFileURL(resolve(packageRoot, "node_modules/@earendil-works/pi-ai/dist/compat.js"))
);
const model = {
	id: "deepseek-chat",
	name: "DeepSeek Chat acceptance",
	api: "openai-completions",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	reasoning: false,
	input: ["text"],
	contextWindow: 128000,
	maxTokens: 128,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const started = Date.now();
const evidence = {
	provider: "DeepSeek",
	model: model.id,
	packageRoot,
	requests: 1,
	maxOutputTokens: 128,
	budgetCny: 1,
	fixture: "one short text prompt; no tools or user files",
	status: "FAIL",
};
try {
	const message = await completeSimple(
		model,
		{ messages: [{ role: "user", content: "Reply with exactly DESKTOP_ACCEPTANCE_OK", timestamp: Date.now() }] },
		{ apiKey: credential, maxTokens: 128, temperature: 0, signal: AbortSignal.timeout(60000) },
	);
	const text = message.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("");
	evidence.stopReason = message.stopReason;
	evidence.usage = {
		input: message.usage.input,
		output: message.usage.output,
		cacheRead: message.usage.cacheRead,
		cacheWrite: message.usage.cacheWrite,
	};
	assert.equal(message.stopReason, "stop", "Provider did not finish successfully");
	assert(text.includes("DESKTOP_ACCEPTANCE_OK"), "Acceptance marker missing");
	evidence.status = "PASS";
} catch (error) {
	// Do not serialize the provider error, request configuration or auth headers.
	evidence.error = error.name === "AssertionError" ? error.message : error.name;
	process.exitCode = 1;
} finally {
	credential = "";
	evidence.elapsedMs = Date.now() - started;
	writeFileSync("docs/desktop-delivery/evidence/deepseek-sdk.json", JSON.stringify(evidence, null, 2));
	console.log(JSON.stringify(evidence, null, 2));
}
