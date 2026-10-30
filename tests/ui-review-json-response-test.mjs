import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setup, response } from "./fixtures/data-space/ui-design-fixture.mjs";

const runtime = dirname(fileURLToPath(import.meta.resolve("pi-ui-testing")));
const { reviewerJsonOptions } = await import(pathToFileURL(join(runtime, "review-response.js")).href);
const model = { api: "openai-completions" };

test("review JSON mode composes the provider hook without changing request data", async () => {
	const original = { messages: [{ role: "user", content: "JSON facts" }], temperature: 0 };
	let calls = 0;
	const options = reviewerJsonOptions("openai-completions", {
		maxTokens: 4096,
		onPayload: async (payload, selected) => {
			calls++;
			assert.equal(selected, model);
			return { ...payload, marker: "hook" };
		},
	});
	const body = await options.onPayload(original, model);
	assert.deepEqual(body, { ...original, marker: "hook", response_format: { type: "json_object" } });
	assert.equal(options.maxTokens, 4096);
	assert.equal(calls, 1);
	assert.equal(original.response_format, undefined);
});

test("Responses JSON mode preserves text settings and leaves other providers unchanged", async () => {
	for (const api of ["openai-responses", "openai-codex-responses", "azure-openai-responses"]) {
		const payload = { model: "fixture", text: { verbosity: "low" }, stream: true };
		const body = await reviewerJsonOptions(api).onPayload(payload, model);
		assert.deepEqual(body, { ...payload, text: { verbosity: "low", format: { type: "json_object" } } });
		assert.deepEqual(payload.text, { verbosity: "low" });
	}
	const options = { maxTokens: 123 };
	assert.equal(reviewerJsonOptions("anthropic-messages", options), options);
	await assert.rejects(reviewerJsonOptions("openai-responses").onPayload({ text: "invalid" }, model), /object text/);
});

test("malformed duplicated review remains rejected; raw evidence and runtime gate are preserved", async (t) => {
	const f = await setup(t);
	const raw = '{"decision":"approved","z_end_turn_review":"\n{"decision":"approved"}';
	let saved;
	await assert.rejects(
		f.service.assess(f.taskRef, f.assetRef, "malformed-json", async () => ({
			raw,
			provider: "fixture",
			model: "controlled",
			stop_reason: "stop",
		})),
		(error) => {
			assert.match(error.message, /不是有效 JSON/);
			saved = error.artifact_refs.find((ref) => ref.path.endsWith("/raw.json"));
			return true;
		},
	);
	assert.ok(saved);
	assert.equal(JSON.parse(await readFile(join(f.root, saved.path), "utf8")).response, raw);
	const reviewed = await f.service.assess(f.taskRef, f.assetRef, "valid-json-new-call", response);
	assert.equal(reviewed.round, 2);
	assert.equal(reviewed.decision, "approved");
	await assert.rejects(f.service.gate(f.assetRef, reviewed.review_ref), /运行就绪/);
});
