/** P0-1 real stdio MCP → pinned Postman executor → Newman. Run with --import tsx. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { McpClient } from "../server/mcp/mcp-bridge.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixture = join(root, "tests/fixtures/api-testing-p0");
const runtime = resolve(process.argv[2] ?? join(root, "tests/scratch/api-testing-p0-1/runtime"));
const require = createRequire(join(runtime, "package.json"));
const upstream = require.resolve("@postman/postman-mcp-server");
const output = mkdtempSync(join(tmpdir(), "api-testing-p0-1-"));
const secret = "p0-synthetic-sensitive-marker";
process.env.P0_PARENT_CANARY = "synthetic-parent-env";
const events = [];
const checks = [];
const clients = new Set();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const check = (name, evidence) => {
	checks.push({ name, status: "passed", evidence });
};
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
async function until(test, timeout = 6000) {
	const start = Date.now();
	while (!test()) {
		if (Date.now() - start > timeout) throw new Error("Condition timed out");
		await wait(25);
	}
}
const passScript = 'pm.test("status is 200", () => pm.response.to.have.status(200));';
function collection(name, path = "/ok", script = passScript, request = {}) {
	return {
		info: { name, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
		item: [
			{
				name,
				request: { method: "GET", url: base + path, ...request },
				event: script ? [{ listen: "test", script: { type: "text/javascript", exec: [script] } }] : [],
			},
		],
	};
}
let nativeCollection;
const server = createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	events.push({
		method: req.method,
		path: req.url,
		fileCanaryReceived: body.includes("P0_FILE_CANARY"),
		syntheticSecretReceived: body.includes(secret),
	});
	res.setHeader("Content-Type", "application/json");
	if (req.url.startsWith("/collections/")) return res.end(JSON.stringify({ collection: nativeCollection }));
	if (req.url === "/collectionruns") return res.end('{"ok":true}');
	if (req.url === "/slow" || req.url === "/cancel" || req.url === "/deadline") return; // wait for runner termination
	if (req.url === "/redirect") {
		res.writeHead(302, { Location: base + "/redirect-target" });
		return res.end('{"ok":true}');
	}
	if (req.url === "/egress") {
		res.writeHead(302, { Location: "http://p0-egress.invalid/never-send" });
		return res.end('{"ok":true}');
	}
	res.end(JSON.stringify({ ok: true, token: secret }));
});
// Bind only a free isolated port >= 8900; never stop a pre-existing listener.
let port = 18980;
for (; port < 19080; port++) {
	try {
		await new Promise((ok, fail) => {
			server.once("error", fail);
			server.listen(port, "127.0.0.1", () => {
				server.removeListener("error", fail);
				ok();
			});
		});
		break;
	} catch (error) {
		if (error.code !== "EADDRINUSE") throw error;
	}
}
assert(port < 19080);
const base = `http://127.0.0.1:${port}`;
function spec(runRoot, entry, extra = {}) {
	return {
		command: "/usr/bin/env",
		args: [
			"-i",
			`PATH=${dirname(process.execPath)}:/usr/bin:/bin`,
			`HOME=${runRoot}`,
			`TMPDIR=${runRoot}`,
			`P0_RUNTIME=${runtime}`,
			`P0_RUN_ROOT=${runRoot}`,
			`P0_SECRET=${secret}`,
			`P0_NETWORK_LOG=${join(runRoot, "network.jsonl")}`,
			...Object.entries(extra).map(([key, value]) => `${key}=${value}`),
			process.execPath,
			"--require",
			join(fixture, "network-audit.cjs"),
			entry,
		],
		cwd: runRoot,
	};
}
function client(runRoot, entry = join(fixture, "local-runner.mjs"), extra = {}) {
	const instance = new McpClient("p0", spec(runRoot, entry, extra), (...args) => {
		// No request/response body logging; synthetic key also scrubbed from diagnostic text.
		const text = args.join(" ").replaceAll(secret, "[REDACTED]");
		writeFileSync(join(runRoot, "stderr.log"), text + "\n", { flag: "a" });
	});
	clients.add(instance);
	return instance;
}
function directory(name) {
	const dir = join(output, name);
	mkdirSync(dir);
	return dir;
}
async function run(name, input, requestTimeout) {
	const dir = directory(name);
	writeFileSync(join(dir, "input.json"), JSON.stringify({ runId: name, collection: input, requestTimeout }, null, 2));
	const instance = client(dir);
	try {
		await instance.start();
		assert.deepEqual(
			instance.getTools().map((t) => t.name),
			["runLocalFixture"],
		);
		const result = await instance.call("runLocalFixture", {}, 10000);
		assert.deepEqual(result, json(join(dir, "result.json")));
		return { dir, result };
	} finally {
		instance.close();
		clients.delete(instance);
		if (existsSync(join(dir, "pid"))) await until(() => !alive(Number(readFileSync(join(dir, "pid")))));
	}
}
for (const [name, expected] of [
	["@postman/postman-mcp-server", "2.14.0"],
	["newman", "6.2.2"],
	["@modelcontextprotocol/sdk", "1.27.1"],
]) {
	assert.equal(json(join(runtime, "node_modules", name, "package.json")).version, expected);
}
const report = {
	schemaVersion: 1,
	task: "P0-1",
	startedAt: new Date().toISOString(),
	platform: process.platform,
	node: process.version,
	output,
	versions: { postmanMcp: "2.14.0", newman: "6.2.2", mcpSdk: "1.27.1" },
	harnessSha256: hash(fileURLToPath(import.meta.url)),
	inputs: Object.fromEntries(
		["local-runner.mjs", "network-audit.cjs", "package-lock.json"].map((p) => [p, hash(join(fixture, p))]),
	),
	checks,
};
try {
	// Native behavior, no personal key/config: startup without key really fails.
	const noKeyDir = directory("native-no-key");
	const noKey = spec(noKeyDir, upstream);
	const native = spawnSync(noKey.command, noKey.args, { cwd: noKeyDir, encoding: "utf8", timeout: 10000 });
	assert.equal(native.status, 1);
	assert.match(native.stderr, /POSTMAN_API_KEY/);
	writeFileSync(join(noKeyDir, "stderr.log"), native.stderr);
	check("native-requires-cloud-key", { exitCode: native.status });

	// The cloud API fixture is local; MCP server and executor are the unmodified npm release.
	const nativeDir = directory("native-cloud-path");
	nativeCollection = collection("native-real-execution");
	const official = client(nativeDir, upstream, {
		POSTMAN_API_KEY: secret,
		POSTMAN_API_BASE_URL: base,
		POSTMAN_MCP_TELEMETRY: "false",
	});
	await official.start(20000);
	const tool = official.getTools().find((t) => t.name === "runCollection");
	assert(tool);
	assert(!Object.hasOwn(tool.inputSchema.properties, "collection"));
	assert(Object.hasOwn(tool.inputSchema.properties, "collectionId"));
	const nativeResult = await official.call("runCollection", { collectionId: "fixture", requestTimeout: 1000 }, 10000);
	await until(() => events.some((e) => e.path === "/collectionruns"));
	assert.equal(typeof nativeResult.content, "string");
	assert(events.find((e) => e.path === "/collectionruns").syntheticSecretReceived);
	writeFileSync(join(nativeDir, "mcp-result.json"), JSON.stringify(nativeResult));
	official.close();
	clients.delete(official);
	check("native-cloud-fetch-upload-despite-telemetry-false", {
		events: events.filter((e) => e.path.startsWith("/collection")),
		structuredContent: false,
	});

	const passed = await run("pass", collection("pass"));
	assert.equal(passed.result.executionVerdict, "passed");
	assert.equal(passed.result.assertions.total, 1);
	assert.equal(passed.result.executions[0].status, 200);
	assert.equal(passed.result.executions[0].response.ok, true);
	assert(!readFileSync(join(passed.dir, "result.json"), "utf8").includes(secret));
	check("local-pass-and-projected-structured-evidence", {
		requests: passed.result.requests,
		assertions: passed.result.assertions,
	});
	const failed = await run(
		"fail",
		collection(
			"fail",
			"/ok",
			'pm.test("intentional failure", () => pm.expect(pm.response.json().token).to.eql("wrong"));',
		),
	);
	assert.equal(failed.result.executionVerdict, "failed");
	assert.equal(failed.result.assertions.failed, 1);
	assert(!readFileSync(join(failed.dir, "result.json"), "utf8").includes(secret));
	assert.match(failed.result.executions[0].assertions[0].error.message, /REDACTED/);
	check("local-failed-assertion-preserved-and-synthetic-secret-redacted", { failures: failed.result.failures });
	const zero = await run("zero", collection("zero", "/ok", ""));
	assert.equal(zero.result.executionVerdict, "blocked");
	assert.equal(zero.result.assertions.total, 0);
	check("zero-assertions-never-pass", { verdict: zero.result.executionVerdict });
	const network = await run(
		"network-error",
		collection("network-error", "/ok", "", { url: "http://127.0.0.1:0/unreachable" }),
	);
	assert.equal(network.result.executionVerdict, "error");
	assert(network.result.executions[0].requestError);
	check("network-error-is-not-assertion-success", { error: network.result.executions[0].requestError });
	const timeout = await run("request-timeout", collection("request-timeout", "/slow", ""), 100);
	assert.equal(timeout.result.executionVerdict, "error");
	check("request-timeout", { error: timeout.result.executions[0].requestError });

	// Boundary probes use synthetic data only; these observations do not establish a sandbox.
	await assert.rejects(run("egress", collection("egress", "/egress", "")), /进程退出 \(78\)/);
	const egressDir = join(output, "egress");
	assert.equal(json(join(egressDir, "result.json")).executionVerdict, "unknown");
	assert.match(readFileSync(join(egressDir, "network.jsonl"), "utf8"), /p0-egress.invalid/);
	check("redirect-external-egress-denied-by-diagnostic-hook", { processExit: 78, result: "unknown", osSandbox: false });
	const redirected = await run("redirect", collection("redirect", "/redirect"));
	assert.equal(redirected.result.executionVerdict, "passed");
	assert(events.some((e) => e.path === "/redirect-target"));
	check("upstream-follows-redirects-boundary-gap", { followed: true });
	const canaryFile = join(output, "file-canary.txt");
	writeFileSync(canaryFile, "P0_FILE_CANARY");
	const fileRead = await run(
		"file-read",
		collection("file-read", "/upload", passScript, {
			method: "POST",
			body: { mode: "file", file: { src: canaryFile } },
		}),
	);
	assert.equal(fileRead.result.executionVerdict, "passed");
	assert(events.some((e) => e.path === "/upload" && e.fileCanaryReceived));
	check("upstream-can-read-absolute-file-boundary-gap", { syntheticFileReceived: true });
	const environment = await run(
		"environment",
		collection(
			"environment",
			"/ok",
			'pm.test("no process environment in script", () => pm.expect(typeof process).to.eql("undefined"));',
		),
	);
	assert.equal(environment.result.executionVerdict, "passed");
	assert.equal(environment.result.parentCanaryPresent, false);
	assert.equal(environment.result.cloudKeyPresent, false);
	check("script-process-global-unavailable", { sanitizedLauncherEnvironment: true, osIsolationProven: false });

	// Abort and deadline use the existing bridge + explicit dedicated process close.
	// A client timeout/cancellation alone does NOT prove that Newman stopped.
	const sentinelDir = directory("unrelated-runner");
	const sentinel = client(sentinelDir);
	writeFileSync(
		join(sentinelDir, "input.json"),
		JSON.stringify({ runId: "sentinel", collection: collection("sentinel") }),
	);
	await sentinel.start();
	await until(() => existsSync(join(sentinelDir, "pid")));
	const sentinelPid = Number(readFileSync(join(sentinelDir, "pid")));
	for (const mode of ["cancel", "deadline"]) {
		const dir = directory(mode);
		const instance = client(dir);
		writeFileSync(
			join(dir, "input.json"),
			JSON.stringify({ runId: mode, collection: collection(mode, `/${mode}`, ""), requestTimeout: 60000 }),
		);
		await instance.start();
		const controller = new AbortController();
		const pending = instance.call("runLocalFixture", {}, mode === "deadline" ? 2500 : 10000, controller.signal).then(
			() => {
				throw new Error("Expected interruption");
			},
			(error) => String(error.message),
		);
		await until(() => events.some((e) => e.path === `/${mode}`));
		if (mode === "cancel") controller.abort();
		const reason = await pending;
		assert.match(reason, mode === "cancel" ? /abort|取消/i : /timeout|超时/i);
		const pid = Number(readFileSync(join(dir, "pid")));
		assert(alive(pid)); // transport cancellation is insufficient by itself
		instance.close();
		clients.delete(instance);
		await until(() => !alive(pid));
		assert(alive(sentinelPid));
		const partial = json(join(dir, "result.json"));
		assert.equal(partial.executionVerdict, "unknown");
		writeFileSync(
			join(dir, "result.json"),
			JSON.stringify({ ...partial, status: mode === "cancel" ? "canceled" : "timed_out", reason, processExited: true }),
		);
		check(`${mode}-dedicated-process-stopped-no-retry`, {
			unknownResultPreserved: true,
			unrelatedRunnerAlive: true,
			requests: events.filter((e) => e.path === `/${mode}`).length,
		});
		assert.equal(events.filter((e) => e.path === `/${mode}`).length, 1);
	}
	sentinel.close();
	clients.delete(sentinel);
	await until(() => !alive(sentinelPid));
	const localUploads = events.filter((e) => e.path === "/collectionruns").length;
	assert.equal(localUploads, 1); // exactly the native control; all local-mode runs bypass upload
	check("local-no-cloud-key-no-upload", { nativeControlUploads: localUploads, localUploads: 0 });
	const connections = readdirSync(output).flatMap((name) => {
		const path = join(output, name, "network.jsonl");
		return existsSync(path)
			? readFileSync(path, "utf8")
					.trim()
					.split("\n")
					.map((line) => ({ run: name, ...JSON.parse(line) }))
			: [];
	});
	assert(connections.length > 0);
	assert(
		connections.every((connection) => connection.port && ["127.0.0.1", "p0-egress.invalid"].includes(connection.host)),
	);
	check("diagnostic-network-observations", { connections, packetCapture: false, osSandbox: false });
	report.status = "fixture-feasibility-passed-real-target-blocked";
} catch (error) {
	report.status = "failed";
	report.error = String(error.stack);
	process.exitCode = 1;
} finally {
	for (const instance of clients) instance.close();
	server.closeAllConnections();
	server.close();
	await once(server, "close");
	delete process.env.P0_PARENT_CANARY;
	report.finishedAt = new Date().toISOString();
	report.fixtureEvents = events;
	writeFileSync(join(output, "summary.json"), JSON.stringify(report, null, 2));
	console.log(
		JSON.stringify(
			{ status: report.status, checks: checks.length, evidence: join(output, "summary.json"), error: report.error },
			null,
			2,
		),
	);
}
