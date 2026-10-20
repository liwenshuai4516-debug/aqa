import { _electron } from "playwright-core";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { launchNativeApp } from "./native-app.mjs";
const executablePath = process.env.PI_DESKTOP_TEST_EXECUTABLE;
const evidencePath = resolve(process.argv[2] ?? "docs/desktop-delivery/evidence/no-replay.json");
assert(!existsSync(evidencePath), "Preserve previous no-replay evidence");
const writeBeforeInterrupt = process.argv.includes("--write-before-interrupt");
const expectedRequests = writeBeforeInterrupt ? 3 : 2;
const fixture = mkdtempSync(join(tmpdir(), "pi-no-replay-"));
const workspace = join(fixture, "中文 project");
const userData = join(fixture, "desktop");
const agent = join(userData, "agent");
mkdirSync(workspace);
mkdirSync(agent, { recursive: true });
let requests = 0;
const sockets = new Set();
const mock = createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	const payload = JSON.parse(body);
	requests++;
	res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
	const delta = (text, finish = null) =>
		res.write(
			`data: ${JSON.stringify({ id: "no-replay", object: "chat.completion.chunk", created: Date.now(), model: payload.model, choices: [{ index: 0, delta: text ? { content: text } : {}, finish_reason: finish }] })}\n\n`,
		);
	if (writeBeforeInterrupt && requests === 2) {
		assert(
			payload.tools.some((tool) => tool.function.name === "bash"),
			"Original bash tool must be available",
		);
		res.write(
			`data: ${JSON.stringify({ id: "no-replay-write", object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "append-once", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "printf 'APPEND_ONCE\\n' >> replay-proof.txt" }) } }] }, finish_reason: null }] })}\n\n`,
		);
		delta("", "tool_calls");
		res.end("data: [DONE]\n\n");
		return;
	}
	delta(requests === 1 ? "SAVED_HISTORY" : "INTERRUPTED_OUTPUT");
	if (requests === 1) {
		delta("", "stop");
		res.end("data: [DONE]\n\n");
	}
});
mock.on("connection", (socket) => {
	sockets.add(socket);
	socket.on("close", () => sockets.delete(socket));
});
mock.listen(0, "127.0.0.1");
await once(mock, "listening");
writeFileSync(
	join(agent, "models.json"),
	JSON.stringify({
		providers: {
			fixture: {
				api: "openai-completions",
				baseUrl: `http://127.0.0.1:${mock.address().port}`,
				apiKey: "local-fixture",
				models: [{ id: "no-replay", name: "Local no-replay", input: ["text"], contextWindow: 32000, maxTokens: 4096 }],
			},
		},
	}),
);
writeFileSync(join(agent, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "local-fixture" } }));
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	...(writeBeforeInterrupt ? { PI_WEB_TOOL_LAZY_LOADING: "0" } : {}),
};
for (const key of ["ELECTRON_RUN_AS_NODE", "PI_WEB_DATA_DIR", "PI_CODING_AGENT_DIR", "PI_WEB_DESKTOP_URL"])
	delete env[key];
let app, ws;
const checks = [];
async function until(predicate, timeout = 25000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error("no-replay condition timeout");
}
async function launch() {
	app = executablePath
		? await launchNativeApp({ executablePath, packaged: true, env: { ...env, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } })
		: await _electron.launch({ args: [resolve("dist/desktop/main.js")], env, timeout: 60000 });
	const page = await app.firstWindow();
	await page.waitForSelector(".app", { timeout: 60000 });
	const origin = new URL(page.url()).origin;
	const cookies = await app.evaluate(
		async ({ BrowserWindow }, url) => BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({ url }),
		origin,
	);
	const token = cookies.find((c) => c.name === "pi_web_token").value;
	ws = new WebSocket(origin.replace("http:", "ws:") + "/ws", { headers: { Authorization: `Bearer ${token}` } });
	const messages = [];
	ws.on("message", (data) => messages.push(JSON.parse(data)));
	await once(ws, "open");
	ws.send(JSON.stringify({ type: "hello", clientId: "no-replay-fixture", locale: "en" }));
	await until(() => messages.some((m) => m.type === "ready"));
	return messages;
}
const send = (m) => ws.send(JSON.stringify(m));
try {
	let messages = await launch();
	if (writeBeforeInterrupt) send({ type: "set_approval_policy", allowAll: true });
	send({ type: "set_model", modelId: "fixture/no-replay" });
	await until(() => messages.some((m) => m.state?.model?.id === "no-replay"));
	send({ type: "prompt", text: "Save a completed turn." });
	await until(() =>
		messages.some((m) => JSON.stringify(m.state?.messages ?? m.appended ?? []).includes("SAVED_HISTORY")),
	);
	send({ type: "get_state" });
	await until(() =>
		messages.some(
			(m) => m.type === "snapshot" && m.state?.isStreaming === false && JSON.stringify(m).includes("SAVED_HISTORY"),
		),
	);
	send({ type: "prompt", text: "Keep streaming until app shutdown." });
	await until(() => requests === expectedRequests && messages.some((m) => m.state?.isStreaming === true));
	if (writeBeforeInterrupt) assert.equal(readFileSync(join(workspace, "replay-proof.txt"), "utf8"), "APPEND_ONCE\n");
	await app.close();
	app = null;
	ws.close();
	ws = null;
	const stored = JSON.parse(readFileSync(join(userData, "data/client-state.json"), "utf8"));
	assert(
		stored["no-replay-fixture"]?.interrupted?.some((item) => item.sessionFile),
		"real shutdown must record interrupted session",
	);
	const sessionFile = stored["no-replay-fixture"].interrupted[0].sessionFile;
	assert(readFileSync(sessionFile, "utf8").includes("SAVED_HISTORY"));
	checks.push({
		id: "T05/D02",
		status: "PASS",
		check:
			"Real SDK streaming request interrupted by graceful desktop quit; completed history and interrupted record persisted",
	});
	messages = await launch();
	await until(() =>
		messages.some((m) => m.type === "notice" && /interrupt|restart|中断|重启/i.test(m.text ?? m.textEn ?? "")),
	);
	// Observe a bounded idle window longer than the original resume dispatch; then reopen the actual saved history.
	await new Promise((r) => setTimeout(r, 3000));
	assert.equal(requests, expectedRequests, "restart must not send Continue to provider");
	send({ type: "switch_session", path: sessionFile });
	await until(() => messages.some((m) => JSON.stringify(m.state?.messages ?? []).includes("SAVED_HISTORY")));
	await new Promise((r) => setTimeout(r, 1000));
	assert.equal(requests, expectedRequests);
	if (writeBeforeInterrupt) {
		assert.equal(
			readFileSync(join(workspace, "replay-proof.txt"), "utf8"),
			"APPEND_ONCE\n",
			"Real append must not repeat after restart or opening saved history",
		);
		checks.push({
			id: "T05/D02",
			status: "PASS",
			check:
				"Original SDK bash appended exactly one marker before interruption; exact bytes unchanged after restart and manual history reopening",
		});
	}
	checks.push({
		id: "T05/D02/A02",
		status: "PASS",
		check: `Same client reconnects, receives interruption notice, opens saved history manually; provider request count remains exactly ${expectedRequests}`,
		providerRequests: requests,
	});
	console.log(JSON.stringify(checks, null, 2));
} catch (error) {
	checks.push({ status: "FAIL", error: error.stack });
	throw error;
} finally {
	ws?.close();
	if (app) await app.close().catch(() => {});
	for (const socket of sockets) socket.destroy();
	await new Promise((r) => mock.close(r));
	writeFileSync(
		evidencePath,
		JSON.stringify(
			{ fixture, executablePath, writeBeforeInterrupt, platform: process.platform, arch: process.arch, checks },
			null,
			2,
		),
	);
}
