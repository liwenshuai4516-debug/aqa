/** Kill the actual unified-store controller after fixed guest wait; retain lock and explicitly recover a copy. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { EvaluationStore } from "../plugins/agent-evaluation/store.mjs";
const controller = process.argv[2] === "--controller";
const repo = fileURLToPath(new URL("..", import.meta.url));
if (!controller) ensureBuild(repo, "evaluation-execution-recovery");
const { enrollOfflineRuntime } = await import("../dist/server/external-evaluation-enrollment.js");
const { ExternalEvaluationRuntime } = await import("../dist/server/external-evaluation-runtime.js");
const { ExternalEvaluationExecution } = await import("../dist/server/external-evaluation-execution.js");
const domain = { principalId: "recovery-fixture", workspaceId: "self-owned" };
const identity = { domain, sessionIds: ["s1"], human: true, allowWrite: true, allowExecution: true, reconciled: true };
const context = {};
const owner = createHash("sha256")
	.update(JSON.stringify([domain.principalId, domain.workspaceId]))
	.digest("hex");
const ref = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
async function until(fn, label) {
	const end = Date.now() + 30000;
	while (Date.now() < end) {
		const value = await fn();
		if (value) return value;
		await new Promise((done) => setTimeout(done, 50));
	}
	throw new Error("Timed out: " + label);
}
if (controller) {
	const spec = read(process.argv[3]);
	const store = new EvaluationStore({ dataDir: spec.dataDir, authorize: () => identity });
	const execution = new ExternalEvaluationExecution(store, spec.enrolled.runtimeRoot);
	const contract = store.write(context, {
		kind: "contracts",
		requestId: "anchor",
		data: {
			scope: {
				source: "pi",
				sessionId: "s1",
				startMessageId: "m1",
				endMessageId: "m1",
				boundaryPrecision: "exact",
				childPolicy: "exclude",
				childSessionIds: [],
			},
			objective: "Owned controller crash; no real model",
			conditions: [],
			constraints: [],
			environmentRefs: [],
			provenance: "offline fixture",
			evaluationSubject: "agent-task",
		},
	});
	const attempt = execution.prepare(context, {
		requestId: "prepare",
		contractRef: ref(contract),
		backend: spec.enrolled.backend,
		guest: { ...spec.enrolled.guest, argv: ["waiting"] },
		timeoutMs: 12000,
		graceMs: 200,
	});
	await execution.start(context, attempt);
	await until(async () => (await execution.status(context, attempt)).state === "waiting-input", "actual guest wait");
	const directory = path.join(spec.enrolled.runtimeRoot, attempt.id);
	fs.writeFileSync(
		path.join(spec.output, "checkpoint.json"),
		JSON.stringify({
			attempt,
			handle: read(path.join(directory, "native-handle.json")),
			claim: fs.readFileSync(path.join(directory, "guest-input.json"), "utf8"),
			lock: fs.readFileSync(path.join(spec.dataDir, "agent-evaluation/writer.lock"), "utf8"),
		}),
	);
	process.kill(process.pid, "SIGKILL");
} else {
	const output = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-execution-recovery-")));
	console.log(output);
	const dataDir = path.join(output, "data"),
		recoveredDir = path.join(output, "recovered");
	fs.mkdirSync(dataDir, { mode: 0o700 });
	const result = {
		status: "RUNNING",
		output,
		electronNode: process.versions.electron ?? null,
		actualAgentCliCalls: 0,
		actualModelCalls: 0,
		fixedFakeCliCalls: 0,
		checks: [],
	};
	let bystander, raw, attempt, store;
	try {
		assert.ok(process.argv[2], "Trusted existing enrolled installation required");
		const installation = fs.realpathSync(process.argv[2]);
		const enrolled = enrollOfflineRuntime(
			dataDir,
			{
				binary: path.join(installation, "binary"),
				kernel: path.join(installation, "kernel"),
				initrd: path.join(installation, "initrd"),
			},
			path.join(repo, "plugins/agent-evaluation/runtime"),
		);
		raw = new ExternalEvaluationRuntime(enrolled.runtimeRoot, owner);
		bystander = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
		const spec = path.join(output, "spec.json");
		fs.writeFileSync(spec, JSON.stringify({ output, dataDir, enrolled }));
		const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--controller", spec], {
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});
		let logs = "";
		child.stdout.on("data", (d) => (logs += d));
		child.stderr.on("data", (d) => (logs += d));
		const [code, signal] = await once(child, "exit");
		fs.writeFileSync(path.join(output, "controller.log"), logs);
		assert.equal(signal, "SIGKILL", logs);
		assert.equal(code, null);
		const checkpoint = read(path.join(output, "checkpoint.json"));
		attempt = checkpoint.attempt;
		result.fixedFakeCliCalls = 1;
		const directory = path.join(enrolled.runtimeRoot, attempt.id),
			originalStore = path.join(dataDir, "agent-evaluation");
		assert.equal(fs.readFileSync(path.join(originalStore, "writer.lock"), "utf8"), checkpoint.lock);
		// Original writer protection refuses the real dead lock; no PID-based unlock or mutation.
		assert.throws(() => new EvaluationStore({ dataDir, authorize: () => identity }), { code: "STORE_LOCKED" });
		assert.equal(fs.readFileSync(path.join(originalStore, "writer.lock"), "utf8"), checkpoint.lock);
		const live = await raw.status(attempt.id);
		assert.equal(live.state, "waiting-input");
		assert.equal(live.instance, checkpoint.handle.instance);
		result.checks.push(
			"actual SIGKILL after persisted waiting state retains original writer lock; writes refused, independent worker and original VM continue",
		);
		// Explicit fixture recovery: copy confirmed records, excluding only the exact owned dead writer lock.
		fs.mkdirSync(recoveredDir, { mode: 0o700 });
		fs.cpSync(originalStore, path.join(recoveredDir, "agent-evaluation"), {
			recursive: true,
			filter: (source) => path.basename(source) !== "writer.lock",
		});
		const originalBytes = new Map();
		for (const kind of ["contracts", "targets", "attempts"])
			for (const name of fs.readdirSync(path.join(originalStore, kind))) {
				const relative = path.join(kind, name);
				originalBytes.set(relative, fs.readFileSync(path.join(originalStore, relative)));
				assert.deepEqual(
					fs.readFileSync(path.join(recoveredDir, "agent-evaluation", relative)),
					originalBytes.get(relative),
				);
			}
		store = new EvaluationStore({ dataDir: recoveredDir, authorize: () => identity });
		const execution = new ExternalEvaluationExecution(store, enrolled.runtimeRoot);
		assert.equal((await execution.status(context, attempt)).state, "waiting-input");
		// Repeating the old handle only observes the already-launched worker.
		await execution.start(context, attempt);
		assert.deepEqual(read(path.join(directory, "native-handle.json")), checkpoint.handle);
		assert.equal(fs.readFileSync(path.join(directory, "guest-input.json"), "utf8"), checkpoint.claim);
		const ended = await until(async () => {
			const s = await execution.status(context, attempt);
			return s.state === "timed-out" && s.stopConfirmed && s;
		}, "original deadline and native stop");
		const cleaned = await execution.cleanup(context, attempt);
		assert.equal(store.get(context, cleaned.snapshotRef).data.coverage, "partial");
		assert.equal(fs.readFileSync(path.join(directory, "guest-input.json"), "utf8"), checkpoint.claim);
		assert.deepEqual(read(path.join(directory, "native-handle.json")), checkpoint.handle);
		assert.equal(fs.readdirSync(enrolled.runtimeRoot).filter((n) => /^[a-f0-9-]{36}$/.test(n)).length, 1);
		for (const [relative, bytes] of originalBytes)
			assert.deepEqual(fs.readFileSync(path.join(originalStore, relative)), bytes);
		assert.equal(fs.readFileSync(path.join(originalStore, "writer.lock"), "utf8"), checkpoint.lock);
		process.kill(bystander.pid, 0);
		result.checks.push(
			"explicit copied-store recovery keeps original records/lock; same native handle/input claim, no new environment, original timeout confirmed, partial seal/cleanup; bystander alive",
		);
		result.ended = ended;
		result.recovery = {
			source: originalStore,
			destination: path.join(recoveredDir, "agent-evaluation"),
			excluded: "exact owned dead writer.lock; originals retained",
			attempt,
			originalRecordFiles: originalBytes.size,
		};
		result.status = "PASS";
	} catch (error) {
		result.status = "FAIL";
		result.error = error.stack;
		process.exitCode = 1;
	} finally {
		store?.close();
		if (attempt) {
			try {
				const s = await raw.status(attempt.id);
				if (!s.stopConfirmed) await raw.cancel(attempt.id);
			} catch (error) {
				result.cleanupError = error.stack;
				result.status = "FAIL";
				process.exitCode = 1;
			}
		}
		if (bystander) {
			const done = once(bystander, "exit");
			bystander.kill("SIGTERM");
			await done;
		}
		fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
		console.log(JSON.stringify(result, null, 2));
	}
}
