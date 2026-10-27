/** Real host port, original SDK source/store and enrolled VZ fake CLI. No UI/client/model claims. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { EvaluationStore } from "../plugins/agent-evaluation/store.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";
const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "evaluation-host-port");
const { PluginManager } = await import("../dist/server/plugins.js");
const { ClientSession } = await import("../dist/server/agent/agent-service.js");
const { enrollOfflineRuntime } = await import("../dist/server/external-evaluation-enrollment.js");
const { ExternalEvaluationRuntime } = await import("../dist/server/external-evaluation-runtime.js");
const { createPluginInvocation } = await import("../dist/server/mcp/plugin-mcp.js");
const output = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-port-")));
console.log(output);
const hash = (v) => createHash("sha256").update(v).digest("hex");
const refOf = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
const result = {
	status: "RUNNING",
	output,
	electronNode: process.versions.electron ?? null,
	actualAgentCliCalls: 0,
	actualModelCalls: 0,
	fixedFakeCliCalls: 0,
	checks: [],
};
let manager, store, port, enrollment;
const active = new Set();
async function until(fn, label) {
	const deadline = performance.now() + 30000;
	while (performance.now() < deadline) {
		const value = await fn();
		if (value) return value;
		await new Promise((done) => setTimeout(done, 50));
	}
	throw new Error("Timed out: " + label);
}
const dataDir = path.join(output, "data"),
	workspace = path.join(output, "workspace");
fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
const sdk = SessionManager.inMemory(workspace),
	first = sdk.appendMessage({ role: "user", content: "Offline diagnostic anchor", timestamp: 1 });
const identity = {
	domain: { principalId: "fixture-owner", workspaceId: hash(fs.realpathSync(workspace)) },
	sessionIds: [sdk.getSessionId()],
	human: true,
	allowWrite: true,
};
const owner = hash(JSON.stringify([identity.domain.principalId, identity.domain.workspaceId]));
const base = {},
	toolBase = {},
	identities = new WeakMap([
		[base, identity],
		[toolBase, { ...identity, human: false }],
	]);
const settings = { defaultPermissionPreset: "default", disabledPlugins: [], disabledPluginTools: [] };
const conversation = {
	id: "anchor",
	cwd: workspace,
	agentPreset: "standard",
	session: { sessionManager: sdk, isStreaming: false },
};
const client = Object.assign(Object.create(ClientSession.prototype), {
	clientId: "fixture-owner",
	convs: new Map([[conversation.id, conversation]]),
	settingsSvc: { current: settings },
	goalReviewTurnOf: () => false,
});
const binding = { clientId: client.clientId, conversationId: conversation.id, sessionId: sdk.getSessionId() };
let sequence = 0;
const run = (action, extra = {}, context = base, selected = binding) =>
	port.dispatch(context, selected, { action, requestId: `r${++sequence}`, ...extra });
function open() {
	store = new EvaluationStore({ dataDir, authorize: (context) => identities.get(context) ?? port?.identity(context) });
	port = globalThis.__offlinePortHost.createOfflineEvaluationExecution(store);
}
try {
	assert.equal(process.platform, "darwin");
	assert.equal(process.arch, "arm64");
	assert.ok(process.argv[2] && process.argv[3], "Verified runtime directory and trusted signed helper required");
	const plugin = path.join(dataDir, "plugins/agent-evaluation");
	fs.mkdirSync(plugin, { recursive: true, mode: 0o700 });
	fs.writeFileSync(
		path.join(plugin, "manifest.json"),
		JSON.stringify({
			id: "agent-evaluation",
			name: "offline host fixture",
			apiVersion: 2,
			permissions: ["tools", "tools:offline-execution"],
		}),
	);
	fs.writeFileSync(
		path.join(plugin, "index.mjs"),
		"export default { activate(host) { globalThis.__offlinePortHost = host; } };\n",
	);
	manager = new PluginManager(dataDir, workspace);
	manager.evaluationEvidenceProvider = (clientId, query) => {
		assert.equal(clientId, client.clientId);
		return client.readEvaluationEvidenceForPlugins(query);
	};
	manager.evaluationExecutionGuard = ({ clientId, conversationId }) => {
		assert.equal(clientId, client.clientId);
		client.verifyEvaluationExecutionForPlugins(conversationId);
	};
	await manager.ensureLoaded();
	open();
	await assert.rejects(run("offlineDescribe"), { code: "CAPABILITY_UNAVAILABLE" });
	result.checks.push("missing-installation-refused");
	enrollment = enrollOfflineRuntime(
		dataDir,
		{
			binary: fs.realpathSync(process.argv[3]),
			kernel: fs.realpathSync(path.join(process.argv[2], "boot/Image")),
			initrd: fs.realpathSync(path.join(process.argv[2], "boot/initramfs-virt")),
		},
		path.join(repo, "plugins/agent-evaluation/runtime"),
	);
	const described = await run("offlineDescribe");
	assert.equal(described.policy.modelAccess, false);
	assert.equal(described.policy.networkDevices, 0);
	const contract = store.write(base, {
		kind: "contracts",
		requestId: "anchor",
		data: {
			scope: {
				source: "pi",
				sessionId: sdk.getSessionId(),
				startMessageId: first,
				endMessageId: first,
				boundaryPrecision: "exact",
				childPolicy: "exclude",
				childSessionIds: [],
			},
			objective: "Run fixed offline diagnostics",
			conditions: [],
			constraints: [],
			environmentRefs: [],
			provenance: "self-owned synthetic SDK fixture",
			evaluationSubject: "agent-task",
		},
	});
	const literal = "$(touch should-not-exist); `pwd` 中文🙂",
		stdin = "stdin中文🙂\n";
	const ref = await run("offlinePrepare", {
		ref: refOf(contract),
		data: { argv: ["echo", literal], stdin, timeoutMs: 20000, graceMs: 200 },
	});
	active.add(ref.id);
	const launchPath = path.join(enrollment.runtimeRoot, ref.id, "launch.json");
	assert.equal(fs.existsSync(launchPath), false);
	conversation.planMode = true;
	await assert.rejects(run("offlineStart", { ref }), { code: "PERMISSION_DENIED" });
	assert.equal(fs.existsSync(launchPath), false);
	conversation.planMode = false;
	conversation.session.sessionManager = SessionManager.inMemory(workspace);
	await assert.rejects(run("offlineStart", { ref }), { code: "PERMISSION_DENIED" });
	assert.equal(fs.existsSync(launchPath), false);
	conversation.session.sessionManager = sdk;
	result.checks.push("prepare-does-not-launch-and-mode-session-change-refused");
	await run("offlineStart", { ref });
	result.fixedFakeCliCalls++;
	const ended = await until(async () => {
		const state = await run("offlineStatus", { ref });
		return state.stopConfirmed && state.state === "ended" && state;
	}, "native natural stop");
	const cleaned = await run("offlineCleanup", { ref });
	active.delete(ref.id);
	const snapshot = store.get(base, cleaned.snapshotRef),
		evidence = snapshot.data.evidenceRefs.map((r) => {
			const record = store.get(base, r);
			return { record, value: JSON.parse(store.readBlob(record)) };
		});
	assert.equal(snapshot.data.coverage, "partial");
	assert.equal(evidence[0].value.businessSuccess, "unverified");
	assert.ok(snapshot.data.gaps.includes("independent-verifier-unavailable"));
	const stdout = evidence.find((e) => e.record.data.kind === "guest-stdout").value.text;
	assert.ok(stdout.includes("ARG:" + Buffer.from(literal).toString("base64")));
	assert.ok(stdout.includes("STDIN:" + stdin));
	assert.equal(fs.existsSync(path.join(workspace, "should-not-exist")), false);
	result.checks.push("native-stop-logs-argv-stdin-partial-snapshot-cleanup");
	result.ended = ended;
	const plain = { ...binding, cwd: workspace, pluginId: "agent-evaluation", toolName: "agent_evaluation" };
	await assert.rejects(
		run(
			"offlinePrepare",
			{ ref: refOf(contract), data: { argv: ["waiting"], timeoutMs: 20000, graceMs: 200 } },
			toolBase,
			{ ...binding, invocation: plain },
		),
		{ code: "PERMISSION_DENIED" },
	);
	const invocation = createPluginInvocation(plain, () => client.verifyEvaluationExecutionForPlugins(conversation.id));
	const toolBinding = { ...binding, invocation: invocation.context };
	const waitingRef = await run(
		"offlinePrepare",
		{ ref: refOf(contract), data: { argv: ["waiting"], timeoutMs: 20000, graceMs: 200 } },
		toolBase,
		toolBinding,
	);
	active.add(waitingRef.id);
	await run("offlineStart", { ref: waitingRef }, toolBase, toolBinding);
	result.fixedFakeCliCalls++;
	await until(
		async () => (await run("offlineStatus", { ref: waitingRef })).state === "waiting-input",
		"target-reported wait",
	);
	invocation.dispose();
	await assert.rejects(run("offlineStatus", { ref: waitingRef }, toolBase, toolBinding), { code: "PERMISSION_DENIED" });
	const installManifest = path.join(dataDir, "agent-evaluation-runtime/installation/enrollment.json");
	fs.renameSync(installManifest, installManifest + ".retained");
	settings.disabledPlugins = ["agent-evaluation"];
	manager.emitClientPluginsDisabled(client.clientId, settings.disabledPlugins);
	assert.equal(fs.existsSync(path.join(enrollment.runtimeRoot, waitingRef.id, "cancel.json")), true);
	store.close();
	manager.dispose();
	const raw = new ExternalEvaluationRuntime(enrollment.runtimeRoot, owner);
	const cancelled = await until(async () => {
		const status = await raw.status(waitingRef.id);
		return status.stopConfirmed && status;
	}, "disabled VM stopped after store/host close");
	assert.equal(cancelled.state, "cancelled");
	fs.renameSync(installManifest + ".retained", installManifest);
	result.checks.push("bound-tool-only-and-disable-cancellation-survives-store-close-missing-installation");
	result.cancelled = cancelled;
	settings.disabledPlugins = [];
	await manager.reload();
	open();
	assert.equal((await run("offlineStatus", { ref: waitingRef })).state, "cancelled");
	const final = await run("offlineCleanup", { ref: waitingRef });
	active.delete(waitingRef.id);
	assert.equal(store.get(base, final.snapshotRef).data.coverage, "partial");
	result.checks.push("fresh-host-reopens-original-attempt-and-seals-without-reexecution");
	assert.equal(result.fixedFakeCliCalls, 2);
	result.status = "PASS";
} catch (error) {
	result.status = "FAIL";
	result.error = { message: error.message, stack: error.stack, code: error.code };
	process.exitCode = 1;
} finally {
	port?.close();
	store?.close();
	manager?.dispose();
	delete globalThis.__offlinePortHost;
	for (const id of active) {
		try {
			const raw = new ExternalEvaluationRuntime(enrollment.runtimeRoot, owner);
			await raw.cancel(id);
			await until(async () => (await raw.status(id)).stopConfirmed, "failure cleanup stop");
		} catch (error) {
			result.cleanupError = error.message;
			process.exitCode = 1;
		}
	}
	fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
	console.log(JSON.stringify(result, null, 2));
}
