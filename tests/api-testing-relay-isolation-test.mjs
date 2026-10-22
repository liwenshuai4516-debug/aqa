/** Fixed TCP relay experiment: real MCP/Newman and OS profile; not a production target gateway. */
import assert from "node:assert/strict";
import { createServer as tcpServer, connect } from "node:net";
import { createServer as httpServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { McpClient } from "../server/mcp-bridge.ts";
import { prepareApiFixtureIsolation } from "../server/api-testing-isolation.ts";
const runtime = realpathSync(
	resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "tests/scratch/api-testing-p1-1/runtime"),
);
assert.equal(process.platform, "darwin", "Only macOS OS boundary is verified");
const output = realpathSync(mkdtempSync(join(tmpdir(), "api-testing-relay-probe-")));
const report = {
	startedAt: new Date().toISOString(),
	output,
	scope: "fixed TCP relay feasibility; not host integration or business acceptance",
	checks: [],
	requests: [],
};
const servers = [],
	clients = new Set(),
	sockets = new Set();
const listen = async (s) => {
	servers.push(s);
	await new Promise((ok, fail) => {
		s.once("error", fail);
		s.listen(0, "127.0.0.1", ok);
	});
	assert(s.address().port >= 8900);
	return s.address().port;
};
async function relay(ip, port) {
	assert(/^\d+\.\d+\.\d+\.\d+$/.test(ip));
	const s = tcpServer((down) => {
		const up = connect({ host: ip, port });
		for (const socket of [down, up]) {
			sockets.add(socket);
			socket.once("close", () => sockets.delete(socket));
			socket.on("error", () => {
				up.destroy();
				down.destroy();
			});
		}
		up.setTimeout(5000, () => {
			up.destroy();
			down.destroy();
		});
		down.pipe(up);
		up.pipe(down);
	});
	return await listen(s);
}
async function run(
	name,
	port,
	path,
	script = 'pm.test("status",()=>pm.response.to.have.status(200));',
	targetPort = port,
) {
	const dir = join(output, name);
	mkdirSync(dir);
	cpSync("plugins/api-testing/runner.mjs", join(dir, "runner.mjs"));
	writeFileSync(
		join(dir, "input.json"),
		JSON.stringify({
			runId: name,
			collection: {
				info: { name, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
				item: [
					{
						name,
						request: { method: "GET", url: `http://127.0.0.1:${targetPort}${path}` },
						event: [{ listen: "test", script: { type: "text/javascript", exec: [script] } }],
					},
				],
			},
			requestTimeout: 2000,
		}),
	);
	const cmd = prepareApiFixtureIsolation(dir, runtime, port);
	const client = new McpClient(
		"relay-probe",
		{
			command: "/usr/bin/env",
			args: [
				"-i",
				`HOME=${dir}`,
				`TMPDIR=${dir}`,
				`PI_API_TEST_RUN_ROOT=${dir}`,
				`PI_API_TEST_RUNTIME=${runtime}`,
				...cmd,
				process.execPath,
				join(dir, "runner.mjs"),
			],
			cwd: dir,
		},
		(...m) => writeFileSync(join(dir, "stderr.log"), m.join(" ") + "\n", { flag: "a" }),
	);
	clients.add(client);
	try {
		await client.start();
		return await client.call("runApprovedSuite", {}, 12000);
	} finally {
		await client.closeAndWait();
		clients.delete(client);
	}
}
try {
	const denied = httpServer((req, res) => {
		report.requests.push({ target: "denied", path: req.url });
		res.end("unexpected");
	});
	const deniedPort = await listen(denied);
	const target = httpServer((req, res) => {
		report.requests.push({ target: "fixed", path: req.url });
		res.setHeader("content-type", "application/json");
		if (req.url === "/redirect") res.writeHead(302, { Location: `http://127.0.0.1:${deniedPort}/escape` });
		res.end('{"ok":true}');
	});
	const targetPort = await listen(target);
	const localRelay = await relay("127.0.0.1", targetPort);
	const positive = await run("local-positive", localRelay, "/ok");
	assert.equal(positive.executionVerdict, "passed");
	report.checks.push({ name: "actual-MCP-Newman-through-fixed-relay", result: positive });
	const direct = await run("direct-upstream-denied", localRelay, "/direct", undefined, targetPort);
	assert.notEqual(direct.executionVerdict, "passed");
	assert(!report.requests.some((r) => r.path === "/direct"));
	report.checks.push({ name: "OS-denies-direct-upstream-connect", result: direct });
	const redirect = await run("local-redirect", localRelay, "/redirect");
	assert.notEqual(redirect.executionVerdict, "passed");
	assert(!report.requests.some((r) => r.target === "denied"));
	report.checks.push({ name: "redirect-cannot-reach-other-port", result: redirect });
	// Public documentation only; user supplied this URL. No login or business API requests.
	if (process.argv.includes("--public-docs")) {
		const docsRelay = await relay("192.168.90.224", 18168);
		const docs = await run(
			"public-docs",
			docsRelay,
			"/doc.html",
			'pm.test("public Swagger page",()=>{pm.response.to.have.status(200);pm.expect(pm.response.text()).to.include("html");});',
		);
		report.checks.push({ name: "fixed-private-IP-public-Swagger-page", result: docs });
		assert.equal(docs.executionVerdict, "passed");
	}
	report.publicDocsRequested = process.argv.includes("--public-docs");
	report.status = "passed-feasibility-only";
} catch (e) {
	report.status = "failed";
	report.error = e.stack;
	process.exitCode = 1;
} finally {
	for (const c of clients) await c.closeAndWait();
	for (const s of sockets) s.destroy();
	for (const s of servers) await new Promise((ok) => s.close(ok));
	report.finishedAt = new Date().toISOString();
	writeFileSync(join(output, "summary.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
}
