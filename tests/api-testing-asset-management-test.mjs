/** P2-2 management through the real controlled plugin tool and real MCP/Newman. */
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	cpSync,
	symlinkSync,
	readFileSync,
	writeFileSync,
	rmSync,
	existsSync,
	realpathSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PluginManager } from "../server/plugins.ts";
import { ClientSession } from "../server/agent/agent-service.ts";
import { ApiTestingRunner } from "../server/api-testing-runner.ts";
const repo = fileURLToPath(new URL("..", import.meta.url)),
	runtime = resolve(process.argv[2] ?? "tests/scratch/api-testing-p1-1/runtime");
const output = mkdtempSync(join(tmpdir(), "api-testing-p2-2-")),
	project = join(output, "project"),
	data = join(output, "data"),
	pluginRoot = join(data, "plugins/api-testing");
mkdirSync(project);
cpSync(join(repo, "plugins/api-testing"), pluginRoot, { recursive: true, filter: (p) => !p.includes("node_modules") });
symlinkSync(join(runtime, "node_modules"), join(pluginRoot, "node_modules"), "dir");
cpSync(join(repo, "tests/fixtures/api-testing-workflow/contract.json"), join(project, "source.json"));
let calls = 0,
	hits = 0;
const server = createServer((_req, res) => {
	hits++;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify({ id: "r-2", status: "active", example: "synthetic" }));
});
let runner = new ApiTestingRunner(join(data, "api-testing/runs"), pluginRoot);
const manager = new PluginManager(data, project);
manager.mcpCaller = (...args) => runner.call(...args);
manager.llmProvider = async (_id, req) => {
	calls++;
	return {
		ok: true,
		model: "explicit-management-control-stub",
		text: JSON.stringify({ verdict: "pass", artifactHash: JSON.parse(req.prompt).artifactHash, findings: [] }),
	};
};
const conv = { id: "origin", cwd: project, session: {}, agentPreset: "standard", planMode: false, delegateMode: false };
const ctx = {
	clientId: "client",
	convs: new Map([["origin", conv]]),
	settingsSvc: { current: { disabledPlugins: [], disabledPluginTools: [] } },
	pluginToolsProvider: () => manager.getAgentTools(),
	goalReviewTurnOf: () => false,
};
let lastListText = "";
const invoke = async (params) => {
	const raw = await ClientSession.prototype.enabledPluginToolDefs
		.call(ctx, "standard", "origin")[0]
		.execute("test", params, undefined, undefined);
	if (params.action === "asset_list") {
		lastListText = raw.content[0].text;
		return raw.details;
	}
	return JSON.parse(raw.content[0].text);
};
const read = (path) => JSON.parse(readFileSync(path)),
	sha = (x) => createHash("sha256").update(x).digest("hex");
const checks = [],
	summary = {
		task: "P2-2",
		scope: "isolated real controlled tool/MCP/Newman; explicit review stub; existing tool display",
		status: "running",
		checks,
		output,
	};
const check = (name) => {
	checks.push({ name, status: "passed" });
	writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
};
try {
	await new Promise((ok, fail) => {
		server.once("error", fail);
		server.listen(0, "127.0.0.1", ok);
	});
	assert(server.address().port >= 8900);
	await manager.ensureLoaded();
	const empty = await invoke({ action: "asset_list" });
	assert.equal(empty.assets.length, 0);
	assert(lastListText.includes("暂无套件"));
	assert.equal(calls, 0);
	assert.equal(hits, 0);
	check("empty-list-guides-user-through-existing-text-display-without-model-or-request");
	const cases = [
		{
			id: "record",
			operationId: "getRecord",
			request: { path: { id: "r-2" } },
			status: 200,
			checks: [{ kind: "type", pointer: "/id", value: "string" }],
		},
	];
	const prepared = await invoke({
		action: "prepare",
		sourcePath: "source.json",
		operationIds: ["getRecord"],
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		outputPath: "draft",
		cases,
	});
	const approved = await invoke({ action: "review", runRef: prepared.workflowRef }),
		assetRef = approved.assetRef;
	const first = await invoke({ action: "asset_run", assetRef });
	assert.equal(first.executionVerdict, "passed");
	const listing = await invoke({ action: "asset_list" });
	assert.equal(listing.assets[0].status, "approved");
	assert.equal(listing.runs[0].runId, first.runId);
	assert(lastListText.includes("| Version / 版本"));
	assert(JSON.stringify(listing).length < 64000);
	check("asset-and-run-lists-are-bounded-and-use-existing-tool-display");
	const cloned = await invoke({ action: "asset_clone", assetRef, outputPath: "cloned" });
	assert.equal(cloned.phase, "draft");
	assert.equal(cloned.inheritedApproval, false);
	assert.equal(read(join(cloned.draftPath, "manifest.json")).state, "draft");
	await assert.rejects(
		invoke({ action: "asset_run", assetRef: sha(readFileSync(join(cloned.draftPath, "manifest.json"))) }),
	);
	check("clone-is-new-draft-and-does-not-inherit-execution-approval");
	const beforeArchive = hits;
	await invoke({ action: "asset_archive", assetRef, archived: true });
	await assert.rejects(invoke({ action: "asset_run", assetRef }), /Archived/);
	await assert.rejects(invoke({ action: "run", runRef: prepared.workflowRef }), /Archived/);
	assert.equal(hits, beforeArchive);
	assert.equal((await invoke({ action: "asset_list" })).assets[0].status, "archived");
	await assert.rejects(invoke({ action: "asset_delete", assetRef }), /referenced/);
	await invoke({ action: "asset_archive", assetRef, archived: false });
	check("archive-blocks-execution-and-retained-runs-prevent-deletion");
	const exported = await invoke({ action: "asset_export", assetRef, outputPath: "backup" });
	assert(existsSync(join(exported.backupPath, "backup.json")));
	await assert.rejects(invoke({ action: "asset_export", assetRef, outputPath: "backup" }), /already exists/);
	check("export-publishes-complete-hashed-backup-without-overwriting");
	const projectStore = join(data, "api-testing/assets", sha(realpathSync(project))),
		stored = join(projectStore, "suites", assetRef),
		runDir = join(projectStore, "runs", first.runId),
		collectionHash = sha(readFileSync(join(stored, "collection.json")));
	rmSync(stored, { recursive: true });
	rmSync(runDir, { recursive: true });
	const restored = await invoke({ action: "asset_restore", sourcePath: "backup" });
	assert.equal(restored.restored, true);
	assert.equal(sha(readFileSync(join(stored, "collection.json"))), collectionHash);
	assert.equal((await invoke({ action: "asset_report", runId: first.runId })).report.executionVerdict, "passed");
	check("same-host-restore-recovers-exact-suite-and-run-hashes-after-loss");
	const count = calls,
		beforeRestore = hits;
	await invoke({ action: "asset_restore", sourcePath: "backup" });
	assert.equal(hits, beforeRestore);
	assert.equal(calls, count);
	check("duplicate-restore-is-idempotent-and-calls-no-model-or-interface");
	const file = join(exported.backupPath, "suite/collection.json"),
		bytes = readFileSync(file);
	writeFileSync(file, Buffer.concat([bytes, Buffer.from(" ")]));
	await assert.rejects(invoke({ action: "asset_restore", sourcePath: "backup" }), /hash/);
	writeFileSync(file, bytes);
	check("tampered-backup-file-is-rejected-before-replacing-assets");
	const existing = join(stored, "collection.json"),
		original = readFileSync(existing);
	writeFileSync(existing, Buffer.concat([original, Buffer.from(" ")]));
	await assert.rejects(invoke({ action: "asset_restore", sourcePath: "backup" }), /different contents/);
	assert.equal(readFileSync(existing).length, original.length + 1);
	writeFileSync(existing, original);
	check("same-id-different-contents-conflict-never-overwrites");
	const backupFile = join(exported.backupPath, "backup.json"),
		backupBytes = readFileSync(backupFile),
		forged = JSON.parse(backupBytes);
	forged.signature = "0".repeat(64);
	writeFileSync(backupFile, JSON.stringify(forged));
	await assert.rejects(invoke({ action: "asset_restore", sourcePath: "backup" }), /signature/);
	writeFileSync(backupFile, backupBytes);
	check("copied-pass-label-or-forged-backup-cannot-grant-approval");
	const otherProject = join(output, "other-project");
	mkdirSync(otherProject);
	conv.cwd = otherProject;
	assert.equal((await invoke({ action: "asset_list" })).assets.length, 0);
	await assert.rejects(invoke({ action: "asset_restore", sourcePath: exported.backupPath }), /outside/);
	conv.cwd = project;
	check("management-list-and-restore-stay-inside-bound-project");
	const outside = join(output, "outside");
	mkdirSync(outside);
	writeFileSync(join(outside, "canary.json"), "{}");
	const linked = join(project, "linked-backup");
	mkdirSync(linked);
	symlinkSync(join(outside, "canary.json"), join(linked, "backup.json"));
	await assert.rejects(invoke({ action: "asset_restore", sourcePath: "linked-backup" }), /outside/);
	check("backup-metadata-symlink-cannot-read-outside-project");
	const clonePrepared = await invoke({
		action: "prepare",
		sourcePath: "cloned/source.json",
		operationIds: ["getRecord"],
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		outputPath: "clone-prepared",
		cases,
	});
	const cloneApproved = await invoke({ action: "review", runRef: clonePrepared.workflowRef });
	assert.notEqual(cloneApproved.assetRef, assetRef);
	await invoke({ action: "asset_archive", assetRef: cloneApproved.assetRef, archived: true });
	await invoke({ action: "asset_delete", assetRef: cloneApproved.assetRef });
	assert(!existsSync(join(projectStore, "suites", cloneApproved.assetRef)));
	assert(existsSync(stored));
	check("unreferenced-archived-clone-can-be-deleted-with-original-history-kept");
	await runner.dispose();
	const originalRunner = runner;
	runner = new ApiTestingRunner(join(output, "another-host/api-testing/runs"), pluginRoot);
	await assert.rejects(invoke({ action: "asset_restore", sourcePath: "backup" }), /signature/);
	await runner.dispose();
	runner = originalRunner;
	check("foreign-host-backup-does-not-silently-inherit-source-host-trust");
	summary.status = "passed-fixture-management";
	summary.modelCalls = calls;
	summary.fixtureRequests = hits;
	summary.assetRef = assetRef;
} catch (error) {
	summary.status = "failed";
	summary.error = String(error.stack);
	process.exitCode = 1;
} finally {
	writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
	manager.dispose();
	await runner.dispose();
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
