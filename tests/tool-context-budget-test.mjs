// Local mock requests only: exercise large extension/plugin schemas through real host sessions.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { portUp } from "./lib/port-utils.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "tool-context-budget");
const base = await mkdtemp(join(tmpdir(), "tool-context-budget-"));
const work = join(base, "work"),
	agent = join(base, "agent"),
	data = join(base, "data");
const output = join(repo, "tests/scratch/tool-context-budget", process.env.BUDGET_EVIDENCE_LABEL ?? String(Date.now()));
for (const path of [work, agent, data, output, join(data, "plugins/budget-probe")])
	await mkdir(path, { recursive: true });
const port = 19340;
assert.equal(await portUp(port), false, "Dedicated test port must be free");
const extension = join(agent, "budget-extension.mjs");
const properties = Object.fromEntries(
	Array.from({ length: 80 }, (_, i) => [
		`field_${i}`,
		{ type: "string", description: `Documented field ${i}: ` + "contract detail ".repeat(12) },
	]),
);
const parameters = { type: "object", properties };
await writeFile(
	extension,
	`export default function(pi) { for (const name of ["ui_budget_probe", "mcp_budget_probe"]) pi.registerTool({name,label:name,description:"Budget probe extension",parameters:${JSON.stringify(parameters)},execute:async()=>({content:[{type:"text",text:"ok"}]})}); }`,
);
await writeFile(join(agent, "settings.json"), JSON.stringify({ extensions: [extension] }));
await writeFile(join(agent, "auth.json"), JSON.stringify({ budget: { type: "api_key", key: "local-fixture-only" } }));
await writeFile(
	join(data, "plugins/budget-probe/manifest.json"),
	JSON.stringify({
		id: "budget-probe",
		name: "Budget probe",
		version: "1.0.0",
		apiVersion: 2,
		permissions: ["tools"],
		view: false,
	}),
);
await writeFile(
	join(data, "plugins/budget-probe/index.mjs"),
	`export default { activate(host) { host.registerAgentTool({name:"api_budget_probe",description:"Budget probe plugin",parameters:${JSON.stringify(parameters)},execute:async()=>({content:[{type:"text",text:"ok"}]})}); } };`,
);
const requests = [];
const mock = createServer((req, res) => {
	if (req.method === "GET") return res.writeHead(200, { "content-type": "application/json" }).end('{"data":[]}');
	let text = "";
	req.on("data", (c) => (text += c));
	req.on("end", () => {
		const body = JSON.parse(text);
		requests.push(body);
		const messages = body.messages ?? [];
		const lastUser = messages.map((m) => m.role).lastIndexOf("user");
		const prompt = JSON.stringify(messages[lastUser]?.content ?? "");
		const hasResult = messages.slice(lastUser + 1).some((m) => m.role === "tool");
		const chunk = (delta, finish_reason = null) => ({
			id: "budget",
			object: "chat.completion.chunk",
			created: 1,
			model: body.model,
			choices: [{ index: 0, delta, finish_reason }],
		});
		const call = (prompt.includes("load one") || prompt.includes("load plugin")) && !hasResult;
		res.writeHead(200, { "content-type": "text/event-stream" });
		res.write(
			`data: ${JSON.stringify(chunk(call ? { tool_calls: [{ index: 0, id: "budget_load", type: "function", function: { name: "load_tools", arguments: JSON.stringify({ tools: [prompt.includes("load plugin") ? "api_budget_probe" : "ui_budget_probe"] }) } }] } : { content: "done" }))}\n\n`,
		);
		res.write(`data: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`);
		res.end();
	});
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
await writeFile(
	join(agent, "models.json"),
	JSON.stringify({
		providers: {
			budget: {
				api: "openai-completions",
				baseUrl: `http://127.0.0.1:${mock.address().port}`,
				apiKey: "local-fixture-only",
				models: [
					{
						id: "mock",
						name: "Budget Mock",
						contextWindow: 100000,
						maxTokens: 4096,
						reasoning: false,
						input: ["text"],
					},
				],
			},
		},
	}),
);
const env = {
	...process.env,
	PI_WEB_PORT: String(port),
	PI_WEB_CWD: work,
	PI_WEB_DATA_DIR: data,
	PI_CODING_AGENT_DIR: agent,
	PI_WEB_SDK: "bundled",
	PI_WEB_PLUGIN_CATALOG_URL: "off",
};
for (const key of Object.keys(env))
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_)/.test(key) ||
		["PI_WEB_TOKEN", "PI_API_TEST_HTTP_TARGET", "PI_API_TEST_TOKEN_FILE"].includes(key)
	)
		delete env[key];
const clientId = randomUUID();
let child,
	ws,
	state,
	settings,
	stderr = "",
	revision = 0,
	pluginRevision = 0;
const result = { status: "FAIL", checks: [], requests: [], actualPaidModelCalls: 0, businessRequests: 0 };
async function until(test, label, timeout = 30000) {
	const start = Date.now();
	while (!test()) {
		if (Date.now() - start > timeout) throw new Error(`Timeout: ${label}\n${stderr.slice(-2000)}`);
		await delay(30);
	}
}
function send(value) {
	ws.send(JSON.stringify(value));
}
async function start() {
	child = spawn(process.execPath, [join(repo, "dist/server/index.js")], {
		cwd: repo,
		env,
		stdio: ["ignore", "ignore", "pipe"],
	});
	child.stderr.on("data", (chunk) => (stderr += chunk));
	const start = Date.now();
	while (!(await portUp(port))) {
		assert.ok(Date.now() - start < 30000, "Server startup");
		await delay(50);
	}
	state = undefined;
	settings = undefined;
	ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
	ws.on("message", (raw) => {
		const m = JSON.parse(String(raw));
		if (m.type === "snapshot") state = m.state;
		if (m.type === "snapshot_delta" && state?.rev === m.baseRev) state = { ...state, ...m.state };
		if (m.type === "plugins") pluginRevision++;
		if (m.type === "settings_state") {
			settings = m.settings;
			revision++;
		}
	});
	await new Promise((resolve, reject) => {
		ws.once("open", resolve);
		ws.once("error", reject);
	});
	send({ type: "hello", clientId });
	await until(() => state?.conversationId && settings, "initial session");
	send({ type: "set_model", modelId: "budget/mock" });
	await until(() => state?.model?.id === "mock", "mock selected");
}
async function stop() {
	ws?.close();
	if (child?.exitCode === null) {
		const exited = new Promise((r) => child.once("exit", r));
		child.kill("SIGTERM");
		await exited;
	}
	await until(() => !child || child.exitCode !== null, "server exited");
}
const names = (request) => (request.tools ?? []).map((t) => t.function?.name).filter(Boolean);
const system = (request) => request.messages.find((m) => ["system", "developer"].includes(m.role))?.content ?? "";
function metric(request) {
	const schema = JSON.stringify(request.tools ?? []);
	const sys = system(request);
	return {
		toolCount: names(request).length,
		toolNames: names(request),
		schemaBytes: Buffer.byteLength(schema),
		systemBytes: Buffer.byteLength(sys),
		schemaEstimate: Math.ceil(schema.length / 4),
	};
}
async function prompt(text) {
	const index = requests.length;
	send({ type: "prompt", text });
	await until(() => requests.length > index, "mock request");
	await until(() => state && !state.isStreaming, "reply ended");
	return requests[index];
}
async function configure(value) {
	send({ type: "set_settings", ...value });
	await until(
		() => Object.entries(value).every(([k, v]) => JSON.stringify(settings?.[k]) === JSON.stringify(v)),
		"settings applied",
	);
}
async function fresh() {
	const id = state.conversationId;
	send({ type: "new_chat" });
	await until(() => state?.conversationId && state.conversationId !== id, "new conversation");
}
const core = ["bash", "read", "edit", "write", "load_tools"];
const check = (label, condition) => {
	result.checks.push({ label, passed: Boolean(condition) });
};
try {
	await start();
	await configure({ toolLazyLoading: false });
	const eager = await prompt("eager baseline");
	check(
		"eager fixture contains extension and plugin schemas",
		["ui_budget_probe", "mcp_budget_probe", "api_budget_probe"].every((n) => names(eager).includes(n)),
	);
	await configure({ toolLazyLoading: true });
	await fresh();
	const first = await prompt("baseline");

	check(
		"new lazy session declares only five baseline tools",
		names(first).length === 5 && core.every((n) => names(first).includes(n)),
	);
	check(
		"deferred tools remain discoverable",
		["ui_budget_probe", "mcp_budget_probe", "api_budget_probe"].every((n) => system(first).includes(n)),
	);
	const loaded = await prompt("load one");
	await until(() => requests.length >= requests.indexOf(loaded) + 2, "load continuation");
	const afterLoad = requests[requests.indexOf(loaded) + 1];
	check(
		"load adds only the requested extension",
		names(afterLoad).includes("ui_budget_probe") &&
			!names(afterLoad).includes("mcp_budget_probe") &&
			!names(afterLoad).includes("api_budget_probe"),
	);
	check("system prefix remains byte-identical", system(first) === system(afterLoad));
	check(
		"wire tools append without changing previous declarations",
		JSON.stringify(first.tools) === JSON.stringify(afterLoad.tools.slice(0, first.tools.length)),
	);
	await until(() => !state.isStreaming, "load complete");
	const oldRevision = pluginRevision;
	send({ type: "plugins_reload" });
	await until(() => pluginRevision > oldRevision, "plugin rescan");
	const rescanned = await prompt("after rescan");
	check(
		"plugin rescan preserves lazy loadout",
		names(rescanned).includes("ui_budget_probe") &&
			!names(rescanned).includes("api_budget_probe") &&
			!names(rescanned).includes("mcp_budget_probe"),
	);
	await configure({ disabledPluginTools: ["api_budget_probe"] });
	const disabled = await prompt("disabled plugin");
	check(
		"disabled plugin is absent from schemas and catalog",
		!names(disabled).includes("api_budget_probe") && !system(disabled).includes("api_budget_probe"),
	);
	await configure({ disabledPluginTools: [] });
	const sessionPath = state.sessionFile;
	await stop();
	await start();
	send({ type: "switch_session", path: sessionPath });
	await until(() => state?.sessionFile === sessionPath, "restored loaded session");
	const restored = await prompt("restored");
	check(
		"restart restores used/loaded extension without loading the registry",
		names(restored).includes("ui_budget_probe") &&
			!names(restored).includes("api_budget_probe") &&
			!names(restored).includes("mcp_budget_probe"),
	);
	await fresh();
	const plain = await prompt("ordinary history");
	const plainPath = state.sessionFile;
	await stop();
	await start();
	send({ type: "switch_session", path: plainPath });
	await until(() => state?.sessionFile === plainPath, "plain history restored");
	const plainRestored = await prompt("plain restored");
	check(
		"ordinary history does not seed all SDK default-active tools",
		names(plainRestored).length === 5 && core.every((n) => names(plainRestored).includes(n)),
	);
	const pluginRequest = await prompt("load plugin");
	await until(() => requests.length >= requests.indexOf(pluginRequest) + 2, "plugin load continuation");
	const pluginLoaded = requests[requests.indexOf(pluginRequest) + 1];
	check(
		"host plugin can be loaded on demand without loading unrelated extensions",
		names(pluginLoaded).includes("api_budget_probe") &&
			!names(pluginLoaded).includes("ui_budget_probe") &&
			!names(pluginLoaded).includes("mcp_budget_probe"),
	);
	await until(() => !state.isStreaming, "plugin load complete");
	await configure({ disabledPluginTools: ["api_budget_probe"] });
	const deniedRequest = await prompt("load plugin");
	await until(() => requests.length >= requests.indexOf(deniedRequest) + 2, "denied load continuation");
	const denied = requests[requests.indexOf(deniedRequest) + 1];
	check(
		"explicitly disabled plugin cannot be loaded",
		!names(denied).includes("api_budget_probe") && /unknown|disabled/i.test(JSON.stringify(denied.messages.slice(-1))),
	);
	result.requests = [
		{ phase: "eager", ...metric(eager) },
		{ phase: "lazy first", ...metric(first) },
		{ phase: "lazy one loaded", ...metric(afterLoad) },
		{ phase: "after rescan", ...metric(rescanned) },
		{ phase: "restored", ...metric(restored) },
		{ phase: "plain restored", ...metric(plainRestored) },
	];
	check(
		"first-request schema reduced by at least 70% in large-schema fixture",
		metric(first).schemaBytes < metric(eager).schemaBytes * 0.3,
	);
	result.status = result.checks.every((x) => x.passed) ? "PASS" : "FAIL";
	if (result.status !== "PASS") process.exitCode = 1;
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	await stop();
	await new Promise((r) => mock.close(r));
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	await writeFile(join(output, "server.log"), stderr);
	await writeFile(join(output, "requests.json"), JSON.stringify(requests));
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
