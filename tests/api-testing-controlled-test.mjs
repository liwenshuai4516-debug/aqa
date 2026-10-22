/** P0-2: actual plugin + ClientSession adapter + private stdio MCP/Newman, no model. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, cpSync, symlinkSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PluginManager } from "../server/plugins.ts";
import { ClientSession } from "../server/agent/agent-service.ts";
import { ApiTestingRunner } from "../server/api-testing-runner.ts";
import { API_FIXTURE_ISOLATION_POLICY } from "../server/api-testing-isolation.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = resolve(process.argv[2] ?? join(root, "tests/scratch/api-testing-p0-1/reproduce"));
const output = mkdtempSync(join(tmpdir(), "api-testing-p0-2-"));
const data = join(output, "data");
const project = join(output, "project");
mkdirSync(project, { recursive: true });
const pluginRoot = join(data, "plugins/api-testing");
cpSync(join(root, "plugins/api-testing"), pluginRoot, {
	recursive: true,
	filter: (path) => !path.includes("node_modules"),
});
symlinkSync(join(runtime, "node_modules"), join(pluginRoot, "node_modules"), "dir");
const runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
let manager;
async function load() {
	manager = new PluginManager(data, project);
	manager.mcpCaller = runner.call;
	await manager.ensureLoaded();
}
const hits = [];
const server = createServer((req, res) => {
	hits.push(req.url);
	if (req.url.startsWith("/hold")) return;
	res.setHeader("Content-Type", "application/json");
	res.end('{"ok":true}');
});
let port = 19080;
for (; port < 19180; port++) {
	try {
		await new Promise((ok, fail) => {
			server.once("error", fail);
			server.listen(port, "127.0.0.1", () => {
				server.removeListener("error", fail);
				ok();
			});
		});
		break;
	} catch (e) {
		if (e.code !== "EADDRINUSE") throw e;
	}
}
assert(port < 19180);
const origin = `http://127.0.0.1:${port}`;
const checks = [];
const check = (name, evidence = {}) => checks.push({ name, status: "passed", evidence });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test) {
	const deadline = Date.now() + 10000;
	while (!test()) {
		if (Date.now() > deadline) throw new Error("Fixture wait timed out");
		await wait(10);
	}
}
function binding(cwd = project, conversationId = "origin") {
	const conv = { id: conversationId, cwd, session: {}, agentPreset: "standard", planMode: false, delegateMode: false };
	const ctx = {
		clientId: "client",
		convs: new Map([[conversationId, conv]]),
		settingsSvc: { current: { disabledPlugins: [], disabledPluginTools: [] } },
		pluginToolsProvider: () => manager.getAgentTools(),
		goalReviewTurnOf: () => false,
		activeId: conversationId,
	};
	return {
		conv,
		ctx,
		identity: { clientId: "client", conversationId, cwd, pluginId: "api-testing", toolName: "api_test_execute" },
		defs: () => ClientSession.prototype.enabledPluginToolDefs.call(ctx, "standard", conversationId),
		execute(ref, signal) {
			const def = this.defs()[0];
			return def.execute("test", { runRef: ref }, signal, undefined);
		},
	};
}
let serial = 0;
function bundle(binding, path = "/ok", verdict = "pass") {
	const dir = join(binding.identity.cwd, `bundle-${++serial}`);
	mkdirSync(dir, { recursive: true });
	const collection = {
		info: {
			name: "hand-reviewed-fixture",
			schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
		},
		item: [
			{
				name: "fixture-check",
				request: { method: "GET", url: origin + path },
				event: [
					{
						listen: "test",
						script: {
							type: "text/javascript",
							exec: [
								'pm.test("explicit fixture contract", () => { pm.response.to.have.status(200); pm.expect(pm.response.json().ok).to.eql(true); });',
							],
						},
					},
				],
			},
		],
	};
	const bytes = JSON.stringify(collection);
	writeFileSync(join(dir, "collection.json"), bytes);
	writeFileSync(join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 1, collectionSha256: sha(bytes) }));
	writeFileSync(join(dir, "review.json"), JSON.stringify({ verdict, artifactHash: sha(bytes) }));
	return dir;
}
function approve(binding, dir, timeoutMs) {
	return runner.approveFixture({ identity: binding.identity, bundleRoot: dir, fixtureOrigin: origin, timeoutMs });
}
function state(ref) {
	return json(join(data, "api-testing/runs", ref, "run.json"));
}
function pid(ref) {
	return Number(readFileSync(join(data, "api-testing/runs", ref, "pid")));
}
function alive(id) {
	try {
		process.kill(id, 0);
		return true;
	} catch {
		return false;
	}
}
async function rejectedWithoutRequest(action, pattern) {
	const before = hits.length;
	await assert.rejects(action, pattern);
	assert.equal(hits.length, before);
}
const report = {
	schemaVersion: 1,
	task: "P0-2",
	startedAt: new Date().toISOString(),
	platform: process.platform,
	node: process.version,
	output,
	checks,
};
try {
	await load();
	const bound = binding();
	assert.deepEqual(
		manager.getAgentTools().map((t) => t.name),
		["api_test_execute"],
	);
	assert(!manager.getAgentTools().some((t) => t.name === "runApprovedSuite"));
	check("raw-MCP-tool-is-private");
	assert.throws(() => approve(bound, bundle(bound, "/ok", "revise")), /unreviewed/);
	await rejectedWithoutRequest(() => bound.execute("not-approved"), /unapproved/);
	check("unreviewed-and-unknown-refs-never-start");
	const tamperedDir = bundle(bound);
	const tampered = approve(bound, tamperedDir);
	writeFileSync(join(tamperedDir, "collection.json"), "{}");
	await rejectedWithoutRequest(() => bound.execute(tampered), /hash/);
	check("changed-hash-never-starts");
	const ready = approve(bound, bundle(bound));
	const staleDef = bound.defs()[0];
	for (const mode of ["planMode", "delegateMode"]) {
		bound.conv[mode] = true;
		await rejectedWithoutRequest(() => bound.execute(ready), /mode/);
		bound.conv[mode] = false;
	}
	check("plan-and-delegate-modes-block-before-network");
	for (const field of ["disabledPlugins", "disabledPluginTools"]) {
		bound.ctx.settingsSvc.current[field] = [field === "disabledPlugins" ? "api-testing" : "api_test_execute"];
		assert.deepEqual(bound.defs(), []);
		await rejectedWithoutRequest(() => staleDef.execute("test", { runRef: ready }, undefined, undefined), /disabled/);
		bound.ctx.settingsSvc.current[field] = [];
	}
	check("closed-plugin-or-tool-blocks-stale-definitions");
	await rejectedWithoutRequest(
		() => manager.getAgentTools()[0].execute("test", { runRef: ready }, undefined, undefined, bound.identity),
		/identity/,
	);
	check("model-supplied-context-cannot-forge-identity");
	const other = binding(project, "other");
	await rejectedWithoutRequest(() => other.execute(ready), /another caller/);
	check("approved-ref-bound-to-client-conversation-project");
	bound.ctx.activeId = "other";
	const success = JSON.parse((await bound.execute(ready)).content[0].text);
	assert.equal(success.executionVerdict, "passed");
	assert.equal(state(ready).identity.conversationId, "origin");
	assert.equal(state(ready).isolationPolicy, API_FIXTURE_ISOLATION_POLICY);
	assert(existsSync(join(data, "api-testing/runs", ready, "isolation.sb")));
	assert(!alive(pid(ready)));
	assert.equal(success.scope, "fixture");
	await rejectedWithoutRequest(() => bound.execute(ready), /already attempted/);
	check("real-MCP-Newman-success-keeps-origin-on-foreground-switch", { runId: ready, assertions: success.assertions });
	check("duplicate-run-ref-never-resends");

	// Two projects run concurrently; cancel one without killing the other.
	const projectB = join(output, "project-b");
	mkdirSync(projectB);
	const second = binding(projectB, "second");
	const aRef = approve(bound, bundle(bound, "/hold-a"));
	const bRef = approve(second, bundle(second, "/hold-b"));
	const aController = new AbortController();
	const bController = new AbortController();
	const aRun = bound.execute(aRef, aController.signal).then(
		() => null,
		(e) => e,
	);
	const bRun = second.execute(bRef, bController.signal).then(
		() => null,
		(e) => e,
	);
	await until(() => hits.includes("/hold-a") && hits.includes("/hold-b"));
	const blockedRef = approve(bound, bundle(bound));
	await rejectedWithoutRequest(() => bound.execute(blockedRef), /active API test run/);
	aController.abort();
	assert(await aRun);
	assert(!alive(pid(aRef)));
	assert(alive(pid(bRef)));
	assert.equal(state(aRef).executionVerdict, "unknown");
	bController.abort();
	assert(await bRun);
	assert(!alive(pid(bRef)));
	check("stop-only-own-run-preserve-unknown-and-project-mutual-exclusion", { canceled: aRef, other: bRef });

	const liveRef = approve(bound, bundle(bound, "/hold-mode"));
	const live = bound.execute(liveRef).then(
		() => null,
		(e) => e,
	);
	await until(() => hits.includes("/hold-mode"));
	bound.conv.planMode = true;
	assert(await live);
	assert(!alive(pid(liveRef)));
	assert.equal(state(liveRef).executionVerdict, "unknown");
	bound.conv.planMode = false;
	check("mode-revocation-stops-pending-dedicated-run");
	const switchRef = approve(bound, bundle(bound, "/hold-session"));
	const switched = bound.execute(switchRef).then(
		() => null,
		(e) => e,
	);
	await until(() => hits.includes("/hold-session"));
	bound.conv.session = {};
	assert(await switched);
	assert(!alive(pid(switchRef)));
	assert.equal(state(switchRef).executionVerdict, "unknown");
	check("replaced-origin-session-cancels-without-writing-another-conversation");
	const unloadRef = approve(bound, bundle(bound, "/hold-unload"));
	const unloaded = bound.execute(unloadRef).then(
		() => null,
		(e) => e,
	);
	await until(() => hits.includes("/hold-unload"));
	manager.dispose();
	assert(await unloaded);
	assert(!alive(pid(unloadRef)));
	assert.equal(state(unloadRef).executionVerdict, "unknown");
	assert.deepEqual(manager.getAgentTools(), []);
	check("plugin-deactivation-stops-owned-runner-and-removes-workflow-tool");
	await load();
	const timeoutRef = approve(bound, bundle(bound, "/hold-deadline"), 1800);
	await assert.rejects(() => bound.execute(timeoutRef));
	assert.equal(state(timeoutRef).executionVerdict, "unknown");
	assert(!alive(pid(timeoutRef)));
	check("whole-run-deadline-reaps-process-before-release");
	const resumed = approve(bound, bundle(bound));
	assert.equal(JSON.parse((await bound.execute(resumed)).content[0].text).executionVerdict, "passed");
	check("new-run-works-after-cancellation-without-retrying-old-ref");
	report.status = "passed-fixture-only";
} catch (error) {
	report.status = "failed";
	report.error = String(error.stack);
	process.exitCode = 1;
} finally {
	manager?.dispose();
	server.closeAllConnections();
	server.close();
	await once(server, "close");
	report.finishedAt = new Date().toISOString();
	report.fixtureRequests = hits;
	writeFileSync(join(output, "summary.json"), JSON.stringify(report, null, 2));
	console.log(
		JSON.stringify(
			{ status: report.status, checks: checks.length, evidence: join(output, "summary.json"), error: report.error },
			null,
			2,
		),
	);
}
