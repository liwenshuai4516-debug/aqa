// Installed adapter + official external DSH, with a loopback scripted model only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";
assert(process.versions.electron, "Use installed Electron Node runtime");
const runtimeRoot = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve evidence");
const fixture = mkdtempSync("/tmp/pi-dsh-local-execution-");
const dirs = Object.fromEntries(["workspace", "data", "agent", "sessions", "home"].map((n) => [n, join(fixture, n)]));
Object.values(dirs).forEach((p) => mkdirSync(p, { recursive: true }));
for (const key of Object.keys(process.env))
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_)/.test(key)
	)
		delete process.env[key];
process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
process.env.DSH_HOME = dirs.home;
process.env.PI_WEB_DSH_RUNTIME = join(runtimeRoot, "node_modules");
const result = {
	fixture,
	executablePath: process.execPath,
	runtimeRoot,
	status: "FAIL",
	realModelRequests: 0,
	requests: [],
	notifications: [],
};
const provider = createServer(async (req, res) => {
	try {
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const body = JSON.parse(Buffer.concat(chunks));
		result.requests.push({
			path: req.url,
			inputBytes: Buffer.concat(chunks).length,
			model: body.model,
			stream: body.stream,
			maxTokens: body.max_tokens,
			tools: body.tools?.map((t) => t.function),
		});
		assert(result.requests.length <= 4, "Unexpected local requests");
		const hasToolResult = body.messages?.some((m) => m.role === "tool");
		const useWrite = body.tools?.some((t) => t.function?.name === "write") && !hasToolResult;
		if (hasToolResult) result.toolResults = body.messages.filter((m) => m.role === "tool");
		const toolCalls = [
			{
				id: "dsh-local-write",
				type: "function",
				function: {
					name: "write",
					arguments: JSON.stringify({ file_path: "中文 DSH结果.txt", content: "DSH_FILE_OK" }),
				},
			},
		];
		const message = useWrite
			? { role: "assistant", content: null, tool_calls: toolCalls }
			: { role: "assistant", content: "DSH_LOCAL_EXECUTION_OK" };
		if (body.stream) {
			res.writeHead(200, { "content-type": "text/event-stream" });
			for (const [delta, finish_reason] of [
				[
					useWrite
						? { role: "assistant", tool_calls: toolCalls.map((t) => ({ index: 0, ...t })) }
						: { role: "assistant", content: message.content },
					null,
				],
				[{}, useWrite ? "tool_calls" : "stop"],
			])
				res.write(
					`data: ${JSON.stringify({ id: "dsh-local", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
				);
			res.end("data: [DONE]\n\n");
		} else {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					id: "dsh-local",
					object: "chat.completion",
					model: body.model,
					choices: [{ index: 0, message, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);
		}
	} catch (e) {
		result.providerError = e.message;
		res.writeHead(500);
		res.end("Local fixture failed");
	}
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
const resources = resolve(dirname(process.execPath), "../Resources/app");
const { DshRuntime } = await import(pathToFileURL(join(resources, "dist/server/dsh/dsh-client.js")).href);
const { generatePresetClones } = await import(pathToFileURL(join(resources, "dist/server/dsh/preset-clones.js")).href);
const clones = generatePresetClones(dirs.data);
const runtime = new DshRuntime({
	cwd: dirs.workspace,
	dataDir: dirs.data,
	agentDir: dirs.agent,
	sessionRoot: dirs.sessions,
	maxTokens: 128,
	model: "deepseek-flash",
	env: {
		DSH_HOME: dirs.home,
		PI_WEB_DSH_RUNTIME: process.env.PI_WEB_DSH_RUNTIME,
		PI_WEB_DSH_PRESET_PATCH: clones.patchFile,
		DEEPSEEK_API_KEY: "local-only",
		DEEPSEEK_BASE_URL: `http://127.0.0.1:${provider.address().port}`,
	},
});
runtime.onNotification((method, params) => result.notifications.push({ method, params }));
try {
	await runtime.start();
	result.messageId = await runtime.prompt("dsh-local-execution", [
		{ type: "text", text: "Write DSH_FILE_OK to 中文 DSH结果.txt, then reply DSH_LOCAL_EXECUTION_OK." },
	]);
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline && !result.notifications.some((n) => n.params?.event?.type === "turn/end"))
		await new Promise((r) => setTimeout(r, 100));
	assert(result.requests.length > 0, "Official runtime must request loopback model");
	assert(
		result.notifications.some(
			(n) =>
				n.params?.event?.type === "assistant/message" &&
				JSON.stringify(n.params.event.data).includes("DSH_LOCAL_EXECUTION_OK"),
		),
		"Original runtime must stream local reply",
	);
	assert.equal(
		readFileSync(join(dirs.workspace, "中文 DSH结果.txt"), "utf8"),
		"DSH_FILE_OK",
		"Original DSH write must persist exact bytes",
	);
	assert(result.toolResults?.length > 0, "Original DSH tool result must return to local model");
	assert(
		result.notifications.some(
			(n) => n.params?.event?.type === "turn/end" && n.params.event.data?.reason?.kind === "completed",
		),
		"Original runtime must complete turn",
	);
	assert(
		result.requests.every((r) => r.maxTokens > 0 && r.maxTokens <= 128),
		"All local model requests keep bounded output",
	);
	result.fileHex = readFileSync(join(dirs.workspace, "中文 DSH结果.txt")).toString("hex");
	result.status = "PASS";
} catch (e) {
	result.error = e.stack;
	process.exitCode = 1;
} finally {
	await runtime.close();
	result.runtimeStopped = !runtime.alive;
	if (result.status === "PASS") {
		try {
			const files = readdirSync(dirs.sessions, { recursive: true }).filter((n) => n.endsWith(".jsonl.zstd"));
			assert.equal(files.length, 1);
			const input = readFileSync(join(dirs.sessions, files[0]));
			let offset = 0;
			const parts = [];
			while (offset < input.length) {
				const out = zstdDecompressSync(input.subarray(offset), { info: true });
				assert(out.engine.bytesWritten > 0);
				parts.push(out.buffer);
				offset += out.engine.bytesWritten;
			}
			const records = Buffer.concat(parts)
				.toString()
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l));
			assert(records.some((e) => e.type === "tool/call" && e.data.name === "write"));
			assert(records.some((e) => e.type === "tool/result"));
			assert(
				records.some(
					(e) =>
						e.type === "assistant/message" &&
						e.data.message?.content?.some((c) => c.type === "text" && c.text === "DSH_LOCAL_EXECUTION_OK"),
				),
			);
			assert(records.some((e) => e.type === "turn/end" && e.data.reason?.kind === "completed"));
			result.persistence = {
				file: join(dirs.sessions, files[0]),
				compressedFrames: parts.length,
				records: records.length,
				toolCall: true,
				toolResult: true,
				reply: true,
				completed: true,
			};
		} catch (e) {
			result.status = "FAIL";
			result.persistenceError = e.stack;
			process.exitCode = 1;
		}
	}
	provider.closeAllConnections();
	await new Promise((r) => provider.close(r));
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
