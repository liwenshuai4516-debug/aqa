/** Compiled service wiring with two isolated clients; no prompts, models, or personal data. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { ensureBuild } from "./lib/ensure-build.mjs";
const repo = fileURLToPath(new URL("../", import.meta.url));
ensureBuild(repo, "agent-evaluation-server");
const output = mkdtempSync(join(tmpdir(), "agent-evaluation-server-"));
const data = join(output, "data"),
	workspace = join(output, "workspace"),
	agent = join(output, "agent");
const plugin = join(data, "plugins/evaluation-probe");
for (const path of [plugin, workspace, agent]) mkdirSync(path, { recursive: true });
writeFileSync(
	join(plugin, "manifest.json"),
	JSON.stringify({ name: "evaluation-probe", version: "0.1.0", permissions: ["tools"] }),
);
writeFileSync(
	join(plugin, "index.mjs"),
	`export default { activate(host) {
return host.onMessage((payload, from) => {
 try {
  const conversationId = payload.conversationId ?? host.getActiveConversation({clientId: from})?.conversationId;
  const page = host.readEvaluationEvidence(from, {conversationId, mode: "describe", limit: 1});
  host.sendTo(from, {requestId: payload.requestId, page});
 } catch(error) { host.sendTo(from, {requestId: payload.requestId, error: {code: error.code, message: error.message}}); }
}); }};`,
);
const reserved = createServer();
reserved.listen(0, "127.0.0.1");
await once(reserved, "listening");
const port = reserved.address().port;
assert.ok(port >= 8900);
await new Promise((resolve) => reserved.close(resolve));
const proc = spawn(process.execPath, [join(repo, "dist/server/index.js")], {
	env: {
		PATH: process.env.PATH,
		TMPDIR: process.env.TMPDIR,
		LANG: "en_US.UTF-8",
		PI_WEB_PORT: String(port),
		PI_WEB_DATA_DIR: data,
		PI_WEB_CWD: workspace,
		PI_CODING_AGENT_DIR: agent,
	},
	stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
for (const stream of [proc.stdout, proc.stderr])
	stream.on("data", (data) => {
		log = (log + data).slice(-100000);
	});
const sockets = [],
	checks = [];
const result = {
	status: "running",
	scope: "isolated compiled server, two clients, no model or business calls; not Electron",
	output,
	checks,
};
function receive(socket, predicate, timeout = 20000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			socket.off("message", handler);
			reject(new Error("WebSocket response timed out"));
		}, timeout);
		function handler(raw) {
			const message = JSON.parse(raw.toString());
			if (predicate(message)) {
				clearTimeout(timer);
				socket.off("message", handler);
				resolve(message);
			}
		}
		socket.on("message", handler);
	});
}
async function connect(clientId) {
	const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
	sockets.push(socket);
	const ready = receive(socket, (m) => m.type === "ready");
	await once(socket, "open");
	socket.send(JSON.stringify({ type: "hello", clientId }));
	await ready;
	socket.send(JSON.stringify({ type: "new_chat" }));
	return socket;
}
let sequence = 0;
async function query(socket, payload = {}) {
	const requestId = `probe-${++sequence}`;
	const reply = receive(
		socket,
		(m) => m.type === "plugin_data" && m.pluginId === "evaluation-probe" && m.payload?.requestId === requestId,
	);
	socket.send(
		JSON.stringify({ type: "plugin_message", pluginId: "evaluation-probe", payload: { ...payload, requestId } }),
	);
	return (await reply).payload;
}
try {
	const deadline = Date.now() + 30000;
	for (;;) {
		if (proc.exitCode !== null) throw new Error(`Server exited: ${proc.exitCode}`);
		try {
			const response = await fetch(`http://127.0.0.1:${port}/api/config`, { signal: AbortSignal.timeout(500) });
			if (response.status) break;
		} catch {}
		if (Date.now() >= deadline) throw new Error("Server startup timed out");
		await delay(200);
	}
	const a = await connect("evaluation-client-a"),
		b = await connect("evaluation-client-b");
	const selected = async (socket, payload = {}) => {
		let reply;
		for (let i = 0; i < 30; i++) {
			reply = await query(socket, payload);
			if (reply.page) return reply;
			await delay(100);
		}
		assert.fail(JSON.stringify(reply));
	};
	const one = await selected(a, { owner: "evaluation-client-b" }),
		two = await selected(b);
	assert.equal(one.page.principalId, "evaluation-client-a");
	assert.equal(two.page.principalId, "evaluation-client-b");
	assert.notEqual(one.page.sessionId, two.page.sessionId);
	assert.equal(one.page.workspaceId, two.page.workspaceId);
	checks.push("Compiled index/engine/provider/plugin channel uses trusted sender and separate SDK sessions");
	assert.equal((await query(a, { conversationId: "missing-conversation" })).error.code, "PERMISSION_DENIED");
	checks.push("Unknown conversation is rejected without snapshot fallback");
	assert.equal((await query(a)).page.sessionId, one.page.sessionId);
	checks.push("Read-only probing does not create a new session or send a prompt");
	result.status = "PASS";
} catch (error) {
	result.status = "FAIL";
	result.error = String(error);
	process.exitCode = 1;
} finally {
	for (const socket of sockets) socket.terminate();
	if (proc.exitCode === null && proc.signalCode === null) {
		const exited = once(proc, "exit");
		proc.kill("SIGTERM");
		const timer = setTimeout(() => proc.kill("SIGKILL"), 5000);
		await exited;
		clearTimeout(timer);
	}
	writeFileSync(join(output, "server.log"), log);
	writeFileSync(join(output, "summary.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
