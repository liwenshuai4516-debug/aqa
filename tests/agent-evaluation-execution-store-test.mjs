/** Actual pinned VM/fake CLI -> existing unified store. No product execution entry or real Agent/model. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { EvaluationStore } from "../plugins/agent-evaluation/store.mjs";
import { EvaluationEngine } from "../plugins/agent-evaluation/evaluate.mjs";
import { createInternalRegistry } from "../plugins/agent-evaluation/profiles/internal.mjs";
const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "evaluation-execution-store");
const { ExternalEvaluationExecution } = await import("../dist/server/external-evaluation-execution.js");
const { ExternalEvaluationRuntime } = await import("../dist/server/external-evaluation-runtime.js");
const output = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-execution-store-")));
console.log(output);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const refOf = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const result = {
	status: "RUNNING",
	output,
	actualModelCalls: 0,
	actualAgentCliCalls: 0,
	electronNode: process.versions.electron ?? null,
	checks: [],
	attempts: [],
};
const root = path.join(output, "runtime");
fs.mkdirSync(root, { mode: 0o700 });
const identity = {
	domain: { principalId: "fixture-user", workspaceId: "fixture-project" },
	sessionIds: ["anchor-session"],
	allowWrite: true,
	allowExecution: true,
};
const context = {},
	identities = new WeakMap([[context, identity]]);
const owner = sha(JSON.stringify([identity.domain.principalId, identity.domain.workspaceId]));
const runtime = new ExternalEvaluationRuntime(root, owner);
let store, bridge, bystander;
const active = [];
function open() {
	store = new EvaluationStore({ dataDir: path.join(output, "data"), authorize: (ctx) => identities.get(ctx) });
	bridge = new ExternalEvaluationExecution(store, root);
}
const command = (exe, args, name) => {
	const run = spawnSync(exe, args, { encoding: "utf8", timeout: 60000 });
	fs.writeFileSync(path.join(output, name), (run.stdout ?? "") + (run.stderr ?? ""));
	assert.equal(run.status, 0, run.error?.message || run.stderr);
};
const asset = (name) => ({ path: fs.realpathSync(name), sha256: sha(fs.readFileSync(name)) });
const fixture = (name) => asset(path.join(repo, "plugins/agent-evaluation/runtime", name));
async function until(fn, label, timeout = 20000) {
	const deadline = performance.now() + timeout;
	while (performance.now() < deadline) {
		const value = await fn();
		if (value) return value;
		await new Promise((done) => setTimeout(done, 40));
	}
	throw new Error("Timed out: " + label);
}
const completed = (ref) =>
	until(async () => {
		const value = await bridge.status(context, ref);
		return value.stopConfirmed && !["preparing", "running", "waiting-input", "cancelling"].includes(value.state)
			? value
			: false;
	}, "confirmed terminal attempt");
try {
	assert.equal(process.platform, "darwin");
	assert.equal(process.arch, "arm64");
	assert.ok(process.argv[2], "Verified offline Alpine runtime required");
	const binary = path.join(output, "vm-supervisor");
	command(
		"/usr/bin/xcrun",
		[
			"swiftc",
			path.join(repo, "plugins/agent-evaluation/runtime/vm-supervisor.swift"),
			"-o",
			binary,
			"-framework",
			"Virtualization",
		],
		"compile.log",
	);
	const entitlements = path.join(output, "entitlements.plist");
	fs.writeFileSync(
		entitlements,
		'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.virtualization</key><true/></dict></plist>',
	);
	command("/usr/bin/codesign", ["--force", "--sign", "-", "--entitlements", entitlements, binary], "codesign.log");
	const backend = {
		version: "vz-offline-1",
		binary: asset(binary),
		kernel: asset(path.join(process.argv[2], "boot/Image")),
		initrd: asset(path.join(process.argv[2], "boot/initramfs-virt")),
	};
	result.backend = backend;
	open();
	const contract = store.write(context, {
		kind: "contracts",
		requestId: "anchor",
		data: {
			scope: {
				source: "pi",
				sessionId: "anchor-session",
				startMessageId: "u1",
				endMessageId: "u1",
				boundaryPrecision: "exact",
				childPolicy: "exclude",
				childSessionIds: [],
			},
			objective: "Verify the offline fixture artifact independently",
			conditions: [
				{
					id: "artifact",
					statement: "Fixture artifact must be independently verified",
					sourceRef: "user:u1",
					sourceType: "user",
					required: true,
					applicableWhen: "always",
					ruleRef: "F01",
				},
			],
			constraints: [],
			environmentRefs: [],
			provenance: "synthetic-fixture:user:u1",
			evaluationSubject: "agent-task",
		},
	});
	const input = (requestId, mode, bytes = Buffer.alloc(0), timeoutMs = 15000) => ({
		requestId,
		contractRef: refOf(contract),
		backend,
		guest: {
			version: "ae-offline-fake-cli-1",
			target: fixture("guest-cli.sh"),
			runner: fixture("guest-cli-runner.sh"),
			argv: [mode],
			stdinBase64: bytes.toString("base64"),
		},
		timeoutMs,
		graceMs: 100,
	});
	const prepare = (spec) => {
		const a = bridge.prepare(context, spec);
		active.push(a);
		result.attempts.push(a);
		return a;
	};
	bystander = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
		stdio: "ignore",
		env: { PATH: "/usr/bin:/bin", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
	});
	await once(bystander, "spawn");
	const raw = Buffer.from('{"token":"fixture-secret","text":"中文🙂"}\n{"ok":true}\n');
	const spec = input("redacted-binary", "binary", raw),
		a = prepare(spec);
	const foreign = {};
	identities.set(foreign, { ...identity, domain: { ...identity.domain, principalId: "other" } });
	await assert.rejects(bridge.start(foreign, a), { code: "PERMISSION_DENIED" });
	await bridge.start(context, a);
	await completed(a);
	const snapshot = await bridge.seal(context, a),
		saved = store.get(context, snapshot);
	assert.equal(saved.data.coverage, "partial");
	assert.ok(saved.data.gaps.includes("independent-verifier-unavailable"));
	assert.equal(saved.data.evidenceRefs.length, 3);
	const values = saved.data.evidenceRefs.map((ref) => {
		const record = store.get(context, ref);
		return { record, value: JSON.parse(store.readBlob(record)) };
	});
	assert.equal(values[0].record.data.origin, "harness-observed");
	assert.equal(values[0].value.businessSuccess, "unverified");
	assert.equal(values[1].record.data.origin, "target-reported");
	assert.ok(values[1].value.text.includes("中文🙂"));
	assert.ok(!JSON.stringify(values).includes("fixture-secret"));
	const rawFile = path.join(root, a.id, "guest-stdout.raw"),
		claimFile = path.join(root, a.id, "guest-input.json");
	assert.deepEqual(fs.readFileSync(rawFile), raw);
	const claim = fs.readFileSync(claimFile),
		before = fs.readFileSync(path.join(root, a.id, "native-handle.json"));
	store.close();
	open();
	assert.equal(bridge.prepare(context, spec).id, a.id);
	assert.equal((await bridge.start(context, a)).state, "ended");
	assert.deepEqual(fs.readFileSync(claimFile), claim);
	assert.deepEqual(fs.readFileSync(path.join(root, a.id, "native-handle.json")), before);
	assert.deepEqual(await bridge.seal(context, a), snapshot);
	result.checks.push(
		"Existing store reopened from stale handle; frozen prepare/start/seal do not replay or duplicate snapshot",
	);
	const engine = new EvaluationEngine(store, createInternalRegistry());
	const report = await engine.evaluate(context, {
		snapshotRef: snapshot,
		profileId: "internal",
		profileVersion: "1",
		requestId: "score",
	});
	assert.equal(report.data.summary.deliveryVerdict, "inconclusive");
	result.report = refOf(report);
	result.checks.push(
		"Original unified scorer returns inconclusive for unverified mandatory artifact despite guest exit0",
	);
	const tampered = Buffer.from(raw);
	tampered[0] ^= 1;
	fs.writeFileSync(rawFile, tampered);
	fs.copyFileSync(rawFile, path.join(output, "tampered-guest-stdout.raw"));
	await assert.rejects(bridge.cleanup(context, a), { code: "EVIDENCE_GAP" });
	assert.equal(fs.existsSync(path.join(root, "admission.json")), true);
	fs.writeFileSync(rawFile, raw);
	await bridge.cleanup(context, a);
	active.splice(active.indexOf(a), 1);
	result.checks.push(
		"Private original remains exact; redacted JSONL in unified evidence; same-length tamper blocks cleanup and retains admission",
	);
	const b = prepare(input("cancel-wait", "waiting"));
	await bridge.start(context, b);
	await until(async () => {
		const s = await bridge.status(context, b);
		return s.state === "waiting-input" && (await runtime.status(b.id)).guest?.waitingInput && s;
	}, "real guest FIFO wait");
	await bridge.cancel(context, b);
	assert.equal((await completed(b)).state, "cancelled");
	const cancelled = await bridge.cleanup(context, b);
	active.splice(active.indexOf(b), 1);
	assert.ok(store.get(context, cancelled.snapshotRef).data.gaps.some((gap) => gap.endsWith(":interrupted")));
	result.checks.push(
		"Actual FIFO cancellation reaches confirmed native stop; interrupted logs remain explicit in unified snapshot",
	);
	const c = prepare(input("timeout-wait", "waiting", Buffer.alloc(0), 5000));
	await bridge.start(context, c);
	await until(
		async () => (await bridge.status(context, c)).state === "waiting-input",
		"persisted wait before original timeout",
	);
	assert.equal((await completed(c)).state, "timed-out");
	await bridge.cleanup(context, c);
	active.splice(active.indexOf(c), 1);
	result.checks.push("Frozen five-second timeout enters timed-out attempt through cancelling and seals before cleanup");
	const d = prepare(input("before-start", "empty"));
	await bridge.cancel(context, d);
	await bridge.cleanup(context, d);
	active.splice(active.indexOf(d), 1);
	assert.equal(fs.existsSync(path.join(root, d.id, "native-handle.json")), false);
	result.checks.push("Cancel before start persists no-start proof without creating a VM");
	const e = prepare(input("empty-exit", "empty"));
	await bridge.start(context, e);
	await completed(e);
	const empty = await bridge.cleanup(context, e);
	active.splice(active.indexOf(e), 1);
	assert.equal(store.get(context, empty.snapshotRef).data.coverage, "partial");
	process.kill(bystander.pid, 0);
	assert.equal(fs.existsSync(path.join(root, "admission.json")), false);
	result.checks.push(
		"Exit0 with no artifact retains incomplete evidence; bystander survives and all normal admissions released",
	);
	result.sourceHashes = Object.fromEntries(
		[
			"server/external-evaluation-execution.ts",
			"server/external-evaluation-runtime.ts",
			"dist/server/external-evaluation-execution.js",
			"dist/server/external-evaluation-runtime.js",
			"plugins/agent-evaluation/store.mjs",
			"plugins/agent-evaluation/schema.mjs",
			"plugins/agent-evaluation/collect.mjs",
			"tests/agent-evaluation-execution-store-test.mjs",
		].map((name) => [name, asset(path.join(repo, name))]),
	);
	result.status = "PASS";
} catch (error) {
	result.status = "FAIL";
	result.error = String(error.stack ?? error);
	throw error;
} finally {
	for (const ref of active) {
		try {
			await runtime.cancel(ref.id);
		} catch (error) {
			result.cleanupError ??= String(error);
		}
	}
	if (bystander) {
		bystander.kill("SIGTERM");
		await once(bystander, "exit");
	}
	store?.close();
	fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ output, status: result.status, checks: result.checks }, null, 2));
}
