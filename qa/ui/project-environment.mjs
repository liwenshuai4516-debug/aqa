/** Isolated instance of this project. No personal runtime/config or business service. */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { ArtifactStore, UiDataScope } from "pi-ui-testing";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const prefix = "aqa-ui-fixture-";
export const processAlive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		if (e.code === "ESRCH") return false;
		throw e;
	}
};
async function availablePort() {
	const socket = createServer();
	await new Promise((ok, no) => {
		socket.once("error", no);
		socket.listen(0, "127.0.0.1", ok);
	});
	const port = socket.address().port;
	await new Promise((ok, no) => socket.close((e) => (e ? no(e) : ok())));
	if (port < 8900) throw new Error("Fixture port must be >=8900");
	return port;
}
export async function waitUntil(check, label, timeout = 30000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await check()) return;
		await delay(50);
	}
	throw new Error(`Timed out: ${label}`);
}
export async function openProjectSocket(fixture) {
	const socket = new WebSocket(`${fixture.url.replace("http", "ws")}/ws`, {
		headers: { Authorization: `Bearer ${fixture.token}` },
	});
	const frames = [];
	let snapshot;
	socket.on("message", (raw) => {
		const frame = JSON.parse(String(raw));
		frames.push(frame);
		if (frame.type === "snapshot") snapshot = frame.state;
		else if (frame.type === "snapshot_delta" && snapshot?.rev === frame.baseRev)
			snapshot = { ...snapshot, ...frame.state, messages: [...snapshot.messages, ...frame.appended] };
	});
	// Caller owns this socket, but environment teardown always closes it too.
	fixture.sockets.add(socket);
	try {
		await once(socket, "open");
		socket.send(JSON.stringify({ type: "hello", clientId: fixture.identity.clientId }));
		await waitUntil(() => snapshot, "fixture snapshot");
		return {
			socket,
			frames,
			get state() {
				return snapshot;
			},
			send: (message) => socket.send(JSON.stringify(message)),
		};
	} catch (error) {
		socket.terminate();
		throw error;
	}
}
export async function cleanupAbandonedEnvironment(root) {
	const actual = resolve(root);
	if (
		dirname(actual) !== resolve(tmpdir()) ||
		!basename(actual).startsWith(prefix) ||
		(await lstat(actual)).isSymbolicLink()
	)
		throw new Error("Not an owned fixture directory");
	const marker = JSON.parse(await readFile(join(actual, "owner.json"), "utf8"));
	if (marker.root !== actual || marker.kind !== "aqa-ui-fixture" || !/^[a-f0-9-]{36}$/.test(marker.id))
		throw new Error("Invalid fixture owner");
	if (marker.serverPid && processAlive(marker.serverPid))
		throw new Error("Fixture server is still alive; refusing cleanup");
	if (marker.parentPid && processAlive(marker.parentPid))
		throw new Error("Fixture owner is still alive; refusing cleanup");
	await rm(actual, { recursive: true });
	return { removed: actual, id: marker.id, serverStopped: true };
}
export async function createProjectEnvironment({ prepare, signalHandlers = false } = {}) {
	const port = await availablePort();
	const root = await mkdtemp(join(tmpdir(), prefix));
	const id = randomUUID();
	const dataDir = join(root, "data"),
		agentDir = join(root, "agent"),
		workDir = join(root, "work");
	const marker = { kind: "aqa-ui-fixture", id, root, parentPid: process.pid, serverPid: null };
	const fixture = {
		root,
		id,
		dataDir,
		agentDir,
		workDir,
		token: randomUUID(),
		port,
		sockets: new Set(),
		identity: { clientId: `fixture-${id}`, role: "isolated-test-client" },
	};
	fixture.url = `http://127.0.0.1:${fixture.port}`;
	let server, data, disposed, onSignal;
	const scopes = [];
	let dataClosed = false;
	let log = "";
	fixture.dispose = () =>
		(disposed ??= (async () => {
			if (onSignal) {
				process.off("SIGTERM", onSignal);
				process.off("SIGINT", onSignal);
			}
			for (const socket of fixture.sockets) socket.terminate();
			let records = [],
				cleanupError;
			try {
				records = (await Promise.all(scopes.map((scope) => scope.cleanup()))).flat();
			} catch (error) {
				cleanupError = error;
			}
			if (server?.pid && server.exitCode === null && server.signalCode === null) {
				const exited = once(server, "exit");
				server.kill("SIGTERM");
				const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
				try {
					await exited;
				} finally {
					clearTimeout(timer);
				}
			}
			if (cleanupError) throw cleanupError; // server is stopped; retain evidence for reconciliation
			const residual = records.filter((r) => r.cleanup_state !== "cleaned");
			if (server?.pid && processAlive(server.pid)) throw new Error("Owned server did not stop");
			if (residual.length) throw new Error(`Fixture data cleanup failed: ${residual.map((r) => r.data_id).join(",")}`);
			await rm(root, { recursive: true });
			return { id, port: fixture.port, serverPid: server?.pid, records, residual, removed: true };
		})());
	try {
		for (const dir of [workDir, dataDir, agentDir]) await mkdir(dir);
		await writeFile(join(root, "owner.json"), JSON.stringify(marker));
		await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [], extensions: [], skills: [] }));
		await writeFile(join(agentDir, "auth.json"), "{}");
		await writeFile(join(workDir, "fixture-identity.json"), JSON.stringify(fixture.identity));
		await prepare?.(fixture);
		server = spawn(
			process.execPath,
			["--import", fileURLToPath(new URL("./parent-watch.mjs", import.meta.url)), join(repo, "dist/server/index.js")],
			{
				cwd: workDir,
				env: {
					...Object.fromEntries(
						Object.entries(process.env).filter(([key]) => !/TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL/i.test(key)),
					),
					PI_WEB_HOST: "127.0.0.1",
					PI_WEB_PORT: String(fixture.port),
					PI_WEB_DATA_DIR: dataDir,
					PI_CODING_AGENT_DIR: agentDir,
					PI_WEB_CWD: workDir,
					PI_WEB_SDK: "bundled",
					PI_WEB_TOKEN: fixture.token,
					PI_WEB_PLUGIN_CATALOG_URL: "off",
					PI_WEB_PLUGIN_CATALOG_INSTALL: "0",
					PI_WEB_TOOL_LAZY_LOADING: "0",
				},
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		fixture.serverPid = server.pid;
		marker.serverPid = server.pid;
		await writeFile(join(root, "owner.json"), JSON.stringify(marker));
		server.stdout.on("data", (c) => {
			log = (log + c).slice(-12000);
		});
		server.stderr.on("data", (c) => {
			log = (log + c).slice(-12000);
		});
		server.on("error", (e) => {
			log += e.message;
		});
		await waitUntil(async () => {
			if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Fixture server exited: ${log}`);
			try {
				return (await fetch(`${fixture.url}/api/health`)).ok;
			} catch {
				return false;
			}
		}, "isolated service startup");
		// Health alone cannot establish instance identity. An authenticated WS must
		// agree on cwd and empty initial transcript before any test can write.
		const channel = await openProjectSocket(fixture);
		if (channel.state.cwd !== workDir || channel.state.messages.length || channel.state.isStreaming)
			throw new Error("Fixture identity/initial state mismatch");
		channel.socket.terminate();
		fixture.preflight = {
			status: "completed",
			checks: ["authenticated-client", "workspace", "empty-transcript"],
			identity: fixture.identity,
		};
		const newDataScope = () => {
			data = new UiDataScope(
				new ArtifactStore(workDir),
				{ kind: "run", id, task_id: "project-fixture" },
				{ environment_id: id, role: fixture.identity.role, isolation: "context" },
			);
			scopes.push(data);
			dataClosed = false;
		};
		newDataScope();
		fixture.createOwnedData = (value) => {
			if (dataClosed) newDataScope();
			return data.prepare({
				creation_method: "synthetic-file",
				fixture_version: "1",
				cleanup_method: "owned-file-only",
				ttl_ms: 3600000,
				create: async (key) => {
					await mkdir(join(workDir, "fixture-data"), { recursive: true });
					const path = join(workDir, "fixture-data", `${key}.json`);
					await writeFile(path, JSON.stringify(value), { flag: "wx" });
					return path;
				},
				cleanup: (key) => rm(join(workDir, "fixture-data", `${key}.json`), { force: true }),
			});
		};
		fixture.assertNoOwnedData = async () => {
			const { readdir } = await import("node:fs/promises");
			const files = await readdir(join(workDir, "fixture-data")).catch((e) => {
				if (e.code === "ENOENT") return [];
				throw e;
			});
			if (files.some((name) => name.startsWith(data.namespace))) throw new Error("Owned data remains");
		};
		fixture.cleanupData = async () => {
			const records = await data.cleanup();
			dataClosed = true;
			await fixture.assertNoOwnedData();
			return records;
		};
		if (signalHandlers) {
			onSignal = () => {
				void fixture.dispose().then(
					() => process.exit(143),
					(error) => {
						console.error(error);
						process.exit(1);
					},
				);
			};
			process.on("SIGTERM", onSignal);
			process.on("SIGINT", onSignal);
		}
		return fixture;
	} catch (error) {
		await fixture.dispose();
		throw error;
	}
}
