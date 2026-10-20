// D03: real SSH transport and SFTP requests against an isolated filesystem.
import assert from "node:assert/strict";
import ssh2 from "ssh2";
import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";

const fixture = await fs.mkdtemp(join(tmpdir(), "pi-d03-sftp-"));
const data = join(fixture, "data");
const agent = join(fixture, "agent");
const remote = join(fixture, "remote");
const plugin = join(data, "plugins/vscode-editor");
await fs.mkdir(plugin, { recursive: true });
for (const name of ["ssh2", "asn1", "bcrypt-pbkdf", "safer-buffer", "tweetnacl"])
	await fs.cp(resolve("node_modules", name), join(plugin, "node_modules", name), { recursive: true });
await fs.mkdir(remote);
// Seed the old installed version, then let the original host synchronize 0.5.2.
for (const name of ["index.mjs", "manifest.json"])
	await fs.copyFile(
		join("/Users/liyingjun/Desktop/SW-QA/pi-web-ui-main/plugins/vscode-editor", name),
		join(plugin, name),
	);
await fs.writeFile(join(plugin, "retained-user-file.txt"), "retain me");
const result = { fixture, transport: "ssh2 SSH + SFTP over loopback TCP", checks: [] };
async function port() {
	const server = createServer().listen(0, "127.0.0.1");
	await once(server, "listening");
	const value = server.address().port;
	await new Promise((r) => server.close(r));
	return value;
}
const sshPort = await port();
const webPort = await port();
const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });
const clients = new Set();
const ssh = new ssh2.Server({ hostKeys: [key] }, (client) => {
	clients.add(client);
	client.on("close", () => clients.delete(client));
	client.on("error", () => {});
	client.on("authentication", (ctx) =>
		ctx.method === "password" && ctx.username === "tester" && ctx.password === "fixture-only"
			? ctx.accept()
			: ctx.reject(),
	);
	client.on("ready", () =>
		client.on("session", (accept) =>
			accept().on("sftp", (acceptSftp) => {
				const sftp = acceptSftp();
				const handles = new Map();
				let sequence = 0;
				const local = (p) => {
					const value = resolve(remote, "." + p);
					assert(value === remote || value.startsWith(remote + "/"));
					return value;
				};
				const error = (id, err) => sftp.status(id, err.code === "ENOENT" ? 2 : err.code === "EACCES" ? 3 : 4);
				sftp.on("REALPATH", (id, p) => sftp.name(id, [{ filename: p || "/" }]));
				sftp.on("STAT", async (id, p) => {
					try {
						const s = await fs.stat(local(p));
						sftp.attrs(id, { mode: s.mode, size: s.size });
					} catch (e) {
						error(id, e);
					}
				});
				sftp.on("MKDIR", async (id, p) => {
					try {
						if (p === "/denied") throw Object.assign(new Error("denied fixture"), { code: "EACCES" });
						await fs.mkdir(local(p));
						sftp.status(id, 0);
					} catch (e) {
						error(id, e);
					}
				});
				sftp.on("OPEN", async (id, p, flags) => {
					try {
						const handle = await fs.open(local(p), flags & 2 ? "w" : "r");
						const token = Buffer.from(String(++sequence));
						handles.set(token.toString(), handle);
						sftp.handle(id, token);
					} catch (e) {
						error(id, e);
					}
				});
				sftp.on("FSTAT", async (id, h) => {
					try {
						const s = await handles.get(h.toString()).stat();
						sftp.attrs(id, { mode: s.mode, size: s.size });
					} catch (e) {
						error(id, e);
					}
				});
				sftp.on("WRITE", async (id, h, offset, buffer) => {
					try {
						await handles.get(h.toString()).write(buffer, 0, buffer.length, offset);
						sftp.status(id, 0);
					} catch (e) {
						error(id, e);
					}
				});
				sftp.on("READ", async (id, h, offset, length) => {
					try {
						const b = Buffer.alloc(length);
						const { bytesRead } = await handles.get(h.toString()).read(b, 0, length, offset);
						if (bytesRead) sftp.data(id, b.subarray(0, bytesRead));
						else sftp.status(id, 1);
					} catch (e) {
						error(id, e);
					}
				});
				sftp.on("CLOSE", async (id, h) => {
					try {
						await handles.get(h.toString()).close();
						handles.delete(h.toString());
						sftp.status(id, 0);
					} catch (e) {
						error(id, e);
					}
				});
			}),
		),
	);
});
ssh.listen(sshPort, "127.0.0.1");
await once(ssh, "listening");
let child, socket;
try {
	child = spawn(process.execPath, [resolve("dist/server/index.js")], {
		env: {
			...process.env,
			PI_WEB_PORT: String(webPort),
			PI_WEB_HOST: "127.0.0.1",
			PI_WEB_CWD: fixture,
			PI_WEB_DATA_DIR: data,
			PI_CODING_AGENT_DIR: agent,
			PI_WEB_SDK: "bundled",
			PI_WEB_TOKEN: "",
			PI_WEB_PLUGIN_CATALOG_URL: "off",
		},
		stdio: ["ignore", "ignore", "pipe"],
	});
	child.stderr.on("data", (d) => process.stderr.write(d));
	const deadline = Date.now() + 30000;
	while (true) {
		try {
			if ((await fetch(`http://127.0.0.1:${webPort}/api/health`)).ok) break;
		} catch {}
		assert(Date.now() < deadline, "service readiness timeout");
		await new Promise((r) => setTimeout(r, 200));
	}
	socket = new WebSocket(`ws://127.0.0.1:${webPort}/ws`);
	await once(socket, "open");
	const ready = new Promise((r) =>
		socket.on("message", (d) => {
			if (JSON.parse(d).type === "ready") r();
		}),
	);
	socket.send(JSON.stringify({ type: "hello", clientId: "d03-isolated" }));
	await ready;
	const rpc = (payload) =>
		new Promise((resolveRpc, reject) => {
			const reqId = String(Math.random());
			const timer = setTimeout(() => {
				socket.off("message", listener);
				reject(new Error("RPC timeout " + payload.action));
			}, 15000);
			const listener = (d) => {
				const m = JSON.parse(d);
				if (m.type === "plugin_data" && m.payload?.reqId === reqId && m.payload.res) {
					clearTimeout(timer);
					socket.off("message", listener);
					resolveRpc(m.payload);
				}
			};
			socket.on("message", listener);
			socket.send(
				JSON.stringify({ type: "plugin_message", pluginId: "vscode-editor", payload: { ...payload, reqId } }),
			);
		});
	await rpc({ action: "state" });
	assert.equal(JSON.parse(await fs.readFile(join(plugin, "manifest.json"))).version, "0.5.2");
	assert.equal(await fs.readFile(join(plugin, "retained-user-file.txt"), "utf8"), "retain me");
	assert.equal(
		await fs.readFile(join(plugin, "index.mjs"), "utf8"),
		await fs.readFile("plugins/vscode-editor/index.mjs", "utf8"),
	);
	result.checks.push("PASS: isolated installed 0.5.1 upgraded to exact 0.5.2 source, user file retained");
	assert(
		(
			await rpc({
				action: "hosts_save",
				host: { name: "fixture", host: "127.0.0.1", port: sshPort, username: "tester", password: "fixture-only" },
			})
		).ok,
	);
	const state = await rpc({ action: "state" });
	const connection = await rpc({ action: "connect", id: state.state.hosts.find((h) => h.name === "fixture").id });
	assert(connection.ok, connection.error);
	const connId = connection.connId;
	let r = await rpc({ action: "write", connId, path: "/中文/space dir/deep/text.txt", text: "真实 SFTP UTF-8" });
	assert(r.ok, r.error);
	assert.equal(await fs.readFile(join(remote, "中文/space dir/deep/text.txt"), "utf8"), "真实 SFTP UTF-8");
	r = await rpc({ action: "read", connId, path: "/中文/space dir/deep/text.txt" });
	assert.equal(r.text, "真实 SFTP UTF-8");
	assert(
		(await rpc({ action: "write", connId, path: "/中文/space dir/deep/second.txt", text: "existing parents" })).ok,
	);
	result.checks.push("PASS: nested Chinese/space directories, disk write and SFTP read, existing parents");
	await fs.writeFile(join(remote, "collision"), "unchanged");
	for (const path of ["/collision/child.txt", "/denied/child.txt"]) {
		r = await rpc({ action: "write", connId, path, text: "must fail" });
		assert.equal(r.ok, false, JSON.stringify(r));
		assert(r.error);
	}
	assert.equal(await fs.readFile(join(remote, "collision"), "utf8"), "unchanged");
	await assert.rejects(fs.stat(join(remote, "denied")));
	result.checks.push("PASS: non-directory and SFTP permission-denied errors propagate without writing");
	r = await rpc({ action: "upload_begin", connId, dir: "/upload/new/sub", name: "chunk.txt", size: 6 });
	assert(r.ok, r.error);
	for (const [i, content] of ["abc", "def"].entries()) {
		const uploaded = await rpc({
			action: "upload",
			connId,
			uploadId: r.uploadId,
			i,
			total: 2,
			b64: Buffer.from(content).toString("base64"),
		});
		assert(uploaded.ok, uploaded.error);
	}
	assert.equal(await fs.readFile(join(remote, "upload/new/sub/chunk.txt"), "utf8"), "abcdef");
	result.checks.push("PASS: chunked upload creates missing parents and writes exact contents");
} catch (e) {
	result.error = e.stack;
	process.exitCode = 1;
} finally {
	socket?.terminate();
	for (const client of clients) client.end();
	ssh.close();
	if (child && child.exitCode === null) {
		child.kill("SIGTERM");
		await once(child, "exit");
	}
	await fs.writeFile("docs/desktop-delivery/evidence/D03-ssh-sftp.json", JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
