/** P2-1: real host/MCP/Newman persistence; review is an explicitly marked control stub. */
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	cpSync,
	symlinkSync,
	readFileSync,
	writeFileSync,
	readdirSync,
	rmSync,
	existsSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PluginManager } from "../server/plugins.ts";
import { ClientSession } from "../server/agent-service.ts";
import { ApiTestingRunner } from "../server/api-testing-runner.ts";
const repo = fileURLToPath(new URL("..", import.meta.url));
const runtime = resolve(process.argv[2] ?? "tests/scratch/api-testing-p1-1/runtime");
const output = mkdtempSync(join(tmpdir(), "api-testing-p2-1-")),
	project = join(output, "project"),
	data = join(output, "data"),
	pluginRoot = join(data, "plugins/api-testing");
mkdirSync(project);
cpSync(join(repo, "plugins/api-testing"), pluginRoot, { recursive: true, filter: (p) => !p.includes("node_modules") });
symlinkSync(join(runtime, "node_modules"), join(pluginRoot, "node_modules"), "dir");
cpSync(join(repo, "tests/fixtures/api-testing-workflow/contract.json"), join(project, "source.json"));
const sha = (x) => createHash("sha256").update(x).digest("hex");
let hits = 0,
	calls = 0,
	hold = false;
const server = createServer((_req, res) => {
	hits++;
	if (hold) return;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify({ id: "r-2", status: "active", example: "synthetic" }));
});
const manager = new PluginManager(data, project);
let runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
manager.mcpCaller = (...args) => runner.call(...args);
manager.llmProvider = async (_id, req) => {
	calls++;
	const p = JSON.parse(req.prompt);
	return {
		ok: true,
		model: "explicit-persistence-control-stub",
		text: JSON.stringify({ verdict: "pass", artifactHash: p.artifactHash, findings: [] }),
	};
};
const conv = { id: "origin", cwd: project, session: {}, agentPreset: "standard", planMode: false, delegateMode: false };
const context = {
	clientId: "client",
	convs: new Map([["origin", conv]]),
	settingsSvc: { current: { disabledPlugins: [], disabledPluginTools: [] } },
	pluginToolsProvider: () => manager.getAgentTools(),
	goalReviewTurnOf: () => false,
};
const invoke = async (params, signal) =>
	JSON.parse(
		(
			await ClientSession.prototype.enabledPluginToolDefs
				.call(context, "standard", "origin")[0]
				.execute("test", params, signal, undefined)
		).content[0].text,
	);
const read = (p) => JSON.parse(readFileSync(p));
const checks = [],
	summary = {
		task: "P2-1",
		status: "running",
		scope: "real MCP/Newman, explicit review stub; no business calls",
		checks,
		output,
	};
const save = () => writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
const check = (name) => {
	checks.push({ name, status: "passed" });
	save();
};
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
try {
	await new Promise((ok, fail) => {
		server.once("error", fail);
		server.listen(0, "127.0.0.1", ok);
	});
	assert(server.address().port >= 8900);
	await manager.ensureLoaded();
	const prepared = await invoke({
		action: "prepare",
		sourcePath: "source.json",
		operationIds: ["getRecord"],
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		outputPath: "draft",
		cases: [
			{
				id: "record",
				operationId: "getRecord",
				request: { path: { id: "r-2" } },
				status: 200,
				checks: [{ kind: "type", pointer: "/id", value: "string" }],
			},
		],
	});
	const approved = await invoke({ action: "review", runRef: prepared.workflowRef });
	assert.equal(approved.phase, "approved");
	assert.match(approved.assetRef, /^[a-f0-9]{64}$/);
	const assetRef = approved.assetRef;
	const assetRoot = join(data, "api-testing/assets"),
		projectRoot = join(assetRoot, sha(await import("node:fs").then((m) => m.realpathSync(project))));
	const stored = join(projectRoot, "suites", assetRef);
	assert(existsSync(join(stored, "asset.json")));
	assert(!stored.startsWith(pluginRoot));
	check("live-approved-P1-package-published-outside-removable-plugin");
	const first = await invoke({ action: "run", runRef: prepared.workflowRef });
	assert.equal(first.executionVerdict, "passed");
	const savedP1 = await invoke({ action: "asset_report", runId: first.runId });
	assert.equal(savedP1.record.importedFromP1, true);
	check("P1-run-report-copied-with-hashes-and-original-preserved");
	const duplicate = await invoke({ action: "asset_import", sourcePath: approved.suitePath });
	assert.equal(duplicate.duplicate, true);
	assert(existsSync(approved.suitePath));
	check("P1-import-exact-version-is-idempotent-and-keeps-source");
	const beforeCalls = calls;
	await runner.dispose();
	runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
	manager.llmProvider = async () => {
		throw new Error("No model calls permitted on stored reuse");
	};
	const viewed = await invoke({ action: "asset_inspect", assetRef });
	assert(viewed.collection.item[0].event[0].script.exec.length);
	const history = await invoke({ action: "asset_report", runId: first.runId });
	assert.equal(history.report.executionVerdict, "passed");
	check("restart-reads-frozen-scripts-and-P1-history-without-model");
	const second = await invoke({ action: "asset_run", assetRef });
	assert.equal(second.executionVerdict, "passed");
	assert.notEqual(second.runId, first.runId);
	assert.deepEqual(second.modelCalls, { generation: 0, review: 0, analysis: 0 });
	assert.equal(calls, beforeCalls);
	check("same-version-reexecution-creates-new-run-and-zero-model-calls");
	writeFileSync(join(projectRoot, "index.json"), "not-json");
	const third = await invoke({ action: "asset_run", assetRef });
	assert.equal(third.executionVerdict, "passed");
	assert.equal(read(join(projectRoot, "index.json")).assets.length, 1);
	check("corrupt-derived-index-rebuilt-from-verified-packages");
	const collectionPath = join(stored, "collection.json"),
		original = readFileSync(collectionPath);
	writeFileSync(collectionPath, Buffer.concat([original, Buffer.from(" ")]));
	const beforeTamper = hits;
	await assert.rejects(invoke({ action: "asset_run", assetRef }), /changed/);
	assert.equal(hits, beforeTamper);
	writeFileSync(collectionPath, original);
	const recordPath = join(stored, "asset.json"),
		meta = readFileSync(recordPath);
	rmSync(recordPath);
	await assert.rejects(invoke({ action: "asset_run", assetRef }));
	assert.equal(hits, beforeTamper);
	writeFileSync(recordPath, meta);
	check("changed-or-half-published-package-cannot-send-requests");
	const forged = join(project, "forged");
	cpSync(approved.suitePath, forged, { recursive: true });
	const reviewPath = join(forged, "review.json"),
		fake = read(reviewPath);
	fake.reason = "copied-pass-label";
	writeFileSync(reviewPath, JSON.stringify(fake));
	const manifestPath = join(forged, "manifest.json"),
		manifest = read(manifestPath);
	manifest.files["review.json"] = sha(readFileSync(reviewPath));
	writeFileSync(manifestPath, JSON.stringify(manifest));
	await assert.rejects(invoke({ action: "asset_import", sourcePath: "forged" }));
	assert.equal(hits, beforeTamper);
	check("rehashing-imported-pass-label-cannot-grant-execution");
	const other = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
	const current = runner;
	runner = other;
	await assert.rejects(invoke({ action: "asset_run", assetRef }), /already owned/);
	await other.dispose();
	runner = current;
	check("second-store-owner-is-rejected");
	const anotherProject = join(output, "other-project");
	mkdirSync(anotherProject);
	conv.cwd = anotherProject;
	await assert.rejects(invoke({ action: "asset_inspect", assetRef }));
	conv.cwd = project;
	check("asset-reference-cannot-cross-project-boundary");
	hold = true;
	const abort = new AbortController(),
		running = invoke({ action: "asset_run", assetRef }, abort.signal);
	const startHits = hits;
	while (hits === startHits) await wait(20);
	await assert.rejects(invoke({ action: "asset_run", assetRef }), /active stored run/);
	abort.abort();
	await assert.rejects(running);
	hold = false;
	const records = readdirSync(join(projectRoot, "runs")).map((name) =>
		read(join(projectRoot, "runs", name, "run.json")),
	);
	assert(records.some((r) => r.status === "unknown"));
	check("concurrent-start-rejected-and-cancellation-persists-unknown");
	const writeContract = read(join(project, "source.json"));
	writeContract.paths["/records"] = {
		post: { ...structuredClone(writeContract.paths["/records/{id}"].get), operationId: "writeRecord", parameters: [] },
	};
	writeFileSync(join(project, "write-source.json"), JSON.stringify(writeContract));
	manager.llmProvider = async (_id, req) => {
		calls++;
		return {
			ok: true,
			model: "explicit-persistence-control-stub",
			text: JSON.stringify({ verdict: "pass", artifactHash: JSON.parse(req.prompt).artifactHash, findings: [] }),
		};
	};
	const writeDraft = await invoke({
		action: "prepare",
		sourcePath: "write-source.json",
		operationIds: ["writeRecord"],
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		outputPath: "write-draft",
		cases: [
			{
				id: "write",
				operationId: "writeRecord",
				request: {},
				status: 200,
				checks: [{ kind: "type", pointer: "/id", value: "string" }],
			},
		],
	});
	const writeApproved = await invoke({ action: "review", runRef: writeDraft.workflowRef });
	hold = true;
	const stopWrite = new AbortController(),
		unknownWrite = invoke({ action: "asset_run", assetRef: writeApproved.assetRef }, stopWrite.signal);
	const beforeWrite = hits;
	while (hits === beforeWrite) await wait(20);
	stopWrite.abort();
	await assert.rejects(unknownWrite);
	hold = false;
	await runner.dispose();
	runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
	const beforeBlocked = hits;
	await assert.rejects(invoke({ action: "asset_run", assetRef }), /Unknown writes/);
	assert.equal(hits, beforeBlocked);
	check("unknown-write-survives-restart-and-blocks-further-requests");
	await runner.dispose();
	const reviewModule = join(pluginRoot, "review.mjs"),
		reviewBytes = readFileSync(reviewModule);
	writeFileSync(reviewModule, Buffer.concat([reviewBytes, Buffer.from("\n")]));
	runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
	await assert.rejects(invoke({ action: "asset_inspect", assetRef }), /approval policy/);
	await runner.dispose();
	writeFileSync(reviewModule, reviewBytes);
	runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
	check("changed-review-or-runner-policy-invalidates-old-executable-approval");
	const staleOwner = join(assetRoot, ".owner.json");
	writeFileSync(staleOwner, JSON.stringify({ pid: -1, token: "simulated-crash" }));
	const crashHistory = await invoke({ action: "asset_report", runId: first.runId });
	assert.equal(crashHistory.report.executionVerdict, "passed");
	await assert.rejects(invoke({ action: "asset_run", assetRef }), /already owned/);
	rmSync(staleOwner);
	check("stale-writer-owner-blocks-new-requests-but-keeps-history-readable");
	await runner.dispose();
	rmSync(pluginRoot, { recursive: true });
	assert(existsSync(join(stored, "collection.json")));
	assert(existsSync(history.reportPath));
	check("plugin-uninstall-does-not-delete-unique-asset-or-report");
	summary.status = "passed-fixture-persistence";
	summary.modelCalls = calls;
	summary.fixtureRequests = hits;
	summary.assetRef = assetRef;
} catch (error) {
	summary.status = "failed";
	summary.error = String(error.stack);
	process.exitCode = 1;
} finally {
	save();
	manager.dispose();
	try {
		await runner.dispose();
	} catch {}
	server.closeAllConnections();
	await new Promise((ok) => server.close(ok));
	console.log(
		JSON.stringify({
			status: summary.status,
			checks: checks.length,
			evidence: join(output, "summary.json"),
			error: summary.error,
		}),
	);
}
