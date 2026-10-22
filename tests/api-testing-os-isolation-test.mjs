/** macOS OS boundary acceptance: synthetic files/local ports only; not a real-target authorization. */
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	realpathSync,
	symlinkSync,
	cpSync,
	existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { McpClient } from "../server/mcp-bridge.ts";
import { API_FIXTURE_ISOLATION_POLICY, prepareApiFixtureIsolation } from "../server/api-testing-isolation.ts";
assert.equal(process.platform, "darwin", "This acceptance requires macOS; other platforms are not verified");
assert(existsSync("/usr/bin/sandbox-exec"));
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtime = realpathSync(resolve(process.argv[2] ?? "tests/scratch/api-testing-p1-1/runtime"));
const root = realpathSync(mkdtempSync(join(tmpdir(), "api-testing-os-mcp-")));
const outside = join(root, "outside-canary");
writeFileSync(outside, "SYNTHETIC_OS_CANARY");
const checks = [],
	events = [];
const summary = {
	task: "real-target-isolation-followup",
	scope: "macOS restricted files and loopback port; actual MCP/Newman; no user business calls",
	status: "running",
	isolationPolicy: API_FIXTURE_ISOLATION_POLICY,
	root,
	checks,
	events,
};
const save = () => writeFileSync(join(root, "summary.json"), JSON.stringify(summary, null, 2));
const check = (name, evidence) => {
	checks.push({ name, status: "passed", evidence });
	save();
};
const blocked = createServer((req, res) => {
	events.push({ target: "denied", url: req.url });
	res.end('{"ok":true}');
});
const allowed = createServer(async (req, res) => {
	let bytes = 0,
		containsCanary = false;
	for await (const chunk of req) {
		bytes += chunk.length;
		containsCanary ||= chunk.toString().includes("SYNTHETIC_OS_CANARY");
	}
	events.push({ target: "allowed", url: req.url, bytes, containsCanary });
	res.setHeader("Content-Type", "application/json");
	if (req.url === "/redirect") res.writeHead(302, { Location: `http://127.0.0.1:${blocked.address().port}/outside` });
	if (req.url === "/slow") return;
	res.end('{"ok":true}');
});
const listen = async (s) => {
	await new Promise((ok, fail) => {
		s.once("error", fail);
		s.listen(0, "127.0.0.1", ok);
	});
	assert(s.address().port >= 8900);
};
const active = new Set();
function directory(name) {
	const run = join(root, name);
	mkdirSync(run);
	prepareApiFixtureIsolation(run, runtime, allowed.address().port);
	return run;
}
const baseCollection = (url, script = 'pm.test("200",()=>pm.response.to.have.status(200));', extra = {}) => ({
	info: { name: "synthetic-os-probe", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
	item: [
		{
			name: "probe",
			request: { method: "GET", url, ...extra },
			event: [{ listen: "test", script: { type: "text/javascript", exec: [script] } }],
		},
	],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(predicate, ms = 5000) {
	const end = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() >= end) throw new Error("Own process condition timed out");
		await wait(20);
	}
}
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
async function run(name, collection, { cancel = false, expectFileDenial = false, insideFile = false } = {}) {
	const dir = directory(name);
	if (insideFile) {
		writeFileSync(join(dir, "upload.txt"), "OS_ALLOWED_UPLOAD");
		collection.item[0].request.body.file.src = join(dir, "upload.txt");
	}
	cpSync(join(repo, "plugins/api-testing/runner.mjs"), join(dir, "runner.mjs"));
	writeFileSync(
		join(dir, "input.json"),
		JSON.stringify({ runId: name, collection, requestTimeout: cancel ? 10000 : 1000 }),
	);
	const client = new McpClient(
		"os-probe",
		{
			command: "/usr/bin/env",
			args: [
				"-i",
				`HOME=${dir}`,
				`TMPDIR=${dir}`,
				`PATH=${dirname(process.execPath)}:/usr/bin:/bin`,
				`PI_API_TEST_RUN_ROOT=${dir}`,
				`PI_API_TEST_RUNTIME=${runtime}`,
				"/usr/bin/sandbox-exec",
				"-f",
				join(dir, "isolation.sb"),
				process.execPath,
				join(dir, "runner.mjs"),
			],
			cwd: dir,
		},
		(...args) => writeFileSync(join(dir, "stderr.log"), args.join(" ") + "\n", { flag: "a" }),
	);
	active.add(client);
	try {
		await client.start();
		assert.deepEqual(
			client.getTools().map((t) => t.name),
			["runApprovedSuite"],
		);
		const abort = new AbortController();
		const call = client.call("runApprovedSuite", {}, 15000, abort.signal);
		if (cancel) {
			await until(() => events.some((e) => e.url === "/slow"));
			abort.abort(new Error("Own probe cancelled"));
			client.close();
			await assert.rejects(call);
			return { dir, result: JSON.parse(readFileSync(join(dir, "result.json"))) };
		}
		if (expectFileDenial) {
			await assert.rejects(call, /进程退出|exited/);
			assert.match(readFileSync(join(dir, "stderr.log"), "utf8"), /EPERM/);
			return {
				dir,
				result: JSON.parse(readFileSync(join(dir, "result.json"))),
				outcome: "Newman file stream EPERM exits dedicated process; unknown retained",
			};
		}
		const result = await call;
		assert.deepEqual(result, JSON.parse(readFileSync(join(dir, "result.json"))));
		return { dir, result };
	} finally {
		client.close();
		active.delete(client);
		if (existsSync(join(dir, "pid"))) await until(() => !alive(Number(readFileSync(join(dir, "pid")))));
	}
}
try {
	await listen(allowed);
	await listen(blocked);
	const base = `http://127.0.0.1:${allowed.address().port}`;
	const p = directory("native-probes");
	symlinkSync(outside, join(p, "outside-link"));
	writeFileSync(join(p, "inside"), "SYNTHETIC_INSIDE");
	const code = `const f=require('fs'),c=require('child_process'),checks=[];function access(name,fn){try{fn();checks.push({name,denied:false});}catch(e){checks.push({name,denied:e.code==='EPERM'});}}access('inside-read',()=>f.readFileSync(${JSON.stringify(join(p, "inside"))}));access('outside-read',()=>f.readFileSync(${JSON.stringify(outside)}));access('symlink-read',()=>f.readFileSync(${JSON.stringify(join(p, "outside-link"))}));access('outside-write',()=>f.writeFileSync(${JSON.stringify(join(root, "outside-written"))},'synthetic'));access('inside-write',()=>f.writeFileSync(${JSON.stringify(join(p, "written"))},'synthetic'));const r=c.spawnSync(process.execPath,['-e',${JSON.stringify(`require('fs').readFileSync(${JSON.stringify(outside)})`)}],{encoding:'utf8'});checks.push({name:'child-read',denied:r.status===1&&r.stderr.includes('EPERM')});console.log(JSON.stringify(checks));`;
	writeFileSync(join(p, "probe.cjs"), code);
	const child = spawn(
		"/usr/bin/sandbox-exec",
		["-f", join(p, "isolation.sb"), process.execPath, join(p, "probe.cjs")],
		{
			cwd: p,
			env: { HOME: p, TMPDIR: p },
		},
	);
	let output = "",
		errors = "";
	child.stdout.on("data", (b) => (output += b));
	child.stderr.on("data", (b) => (errors += b));
	assert.equal(await new Promise((ok) => child.on("close", ok)), 0, errors);
	const native = JSON.parse(output);
	assert.deepEqual(
		native.map((c) => c.denied),
		[false, true, true, true, false, true],
	);
	check("OS-denies-outside-file-symlink-write-and-inherited-child-read", native);
	const passed = await run("positive", baseCollection(base + "/ok"));
	assert.equal(passed.result.executionVerdict, "passed");
	check("actual-MCP-and-unmodified-pinned-Newman-pass-inside-OS-boundary", passed.result);
	const failed = await run(
		"negative-assertion",
		baseCollection(base + "/ok", 'pm.test("deliberate 201",()=>pm.response.to.have.status(201));'),
	);
	assert.equal(failed.result.executionVerdict, "failed");
	check("actual-assertion-failure-is-retained", failed.result.executionVerdict);
	const beforeDenied = events.filter((e) => e.target === "denied").length;
	const direct = await run("denied-port", baseCollection(`http://127.0.0.1:${blocked.address().port}/direct`));
	assert.notEqual(direct.result.executionVerdict, "passed");
	assert.equal(events.filter((e) => e.target === "denied").length, beforeDenied);
	check("OS-denies-other-port-without-JavaScript-network-guard", direct.result);
	const redirect = await run("redirect", baseCollection(base + "/redirect"));
	assert.notEqual(redirect.result.executionVerdict, "passed");
	assert.equal(events.filter((e) => e.target === "denied").length, beforeDenied);
	check("Newman-followed-redirect-cannot-reach-unapproved-port", redirect.result);
	const insideUpload = await run(
		"inside-file-body",
		baseCollection(base + "/inside-file", undefined, {
			method: "POST",
			body: { mode: "file", file: { src: "host-populates-this" } },
		}),
		{ insideFile: true },
	);
	assert.equal(insideUpload.result.executionVerdict, "passed");
	assert.equal(events.find((e) => e.url === "/inside-file").bytes, Buffer.byteLength("OS_ALLOWED_UPLOAD"));
	check("Newman-can-upload-explicit-inside-file-while-outside-remains-denied", insideUpload.result);

	const file = await run(
		"outside-file-body",
		baseCollection(base + "/file", undefined, { method: "POST", body: { mode: "file", file: { src: outside } } }),
		{ expectFileDenial: true },
	);
	assert(!events.some((e) => e.containsCanary));
	assert.equal(file.result.executionVerdict, "unknown");
	check("Newman-file-body-cannot-read-or-upload-outside-canary", file.result);
	const cancelled = await run("cancel", baseCollection(base + "/slow"), { cancel: true });
	assert.equal(cancelled.result.executionVerdict, "unknown");
	assert.equal(events.filter((e) => e.url === "/slow").length, 1);
	check("cancellation-exits-own-sandbox-process-and-retains-unknown-without-retry", cancelled.result);
	summary.status = "passed-local-OS-MCP-boundary-only";
	summary.runnerSha256 = createHash("sha256")
		.update(readFileSync(join(repo, "plugins/api-testing/runner.mjs")))
		.digest("hex");
	summary.remaining = [
		"arbitrary remote-IP target restriction is not proven",
		"host runner is restricted to macOS loopback fixtures; remote integration remains unverified",
		"real business authentication and test records are unavailable",
		"system/runtime read roots and mach services are not a general hostile-native-code sandbox",
	];
	save();
	console.log(JSON.stringify(summary, null, 2));
} catch (error) {
	summary.status = "failed";
	summary.error = error.stack;
	save();
	throw error;
} finally {
	for (const client of active) client.close();
	for (const s of [allowed, blocked]) {
		s.closeAllConnections();
		await new Promise((r) => s.close(r));
	}
}
