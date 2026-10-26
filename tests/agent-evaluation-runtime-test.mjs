/** EC06 actual host VM environment lifecycle, not a guest CLI/ExecutionAdapter or Electron UI test. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { ensureBuild } from "./lib/ensure-build.mjs";
if (process.argv[2] !== "--controller")
	ensureBuild(fileURLToPath(new URL("..", import.meta.url)), "evaluation-runtime");
const { ExternalEvaluationRuntime } = await import("../dist/server/external-evaluation-runtime.js");
const emittedRuntime = fileURLToPath(new URL("../dist/server/external-evaluation-runtime.js", import.meta.url));
if (process.argv[2] === "--controller") {
	const spec = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
	await new ExternalEvaluationRuntime(spec.root, spec.owner).start(spec.attemptId);
	process.kill(process.pid, "SIGKILL");
} else {
	await diagnose();
}
async function diagnose() {
	assert.equal(process.platform, "darwin");
	assert.equal(process.arch, "arm64");
	const runtimeInputs = process.argv[2];
	assert.ok(runtimeInputs, "Explicit verified Alpine3.22.7 runtime required");
	const output = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-runtime-")));
	console.log(output);
	const source = fileURLToPath(new URL("./fixtures/agent-evaluation/vm-supervisor.swift", import.meta.url));
	const binary = path.join(output, "vm-supervisor"),
		root = path.join(output, "environments"),
		owner = "a".repeat(64);
	fs.mkdirSync(root, { mode: 0o700 });
	const enrolled = {
		version: "vz-offline-1",
		binary: { path: binary },
		kernel: { path: fs.realpathSync(path.join(runtimeInputs, "boot/Image")) },
		initrd: { path: fs.realpathSync(path.join(runtimeInputs, "boot/initramfs-virt")) },
	};
	const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
	const runtimeSha256 = sha(fs.readFileSync(emittedRuntime));
	const read = (directory, file) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
	const result = {
		status: "running",
		output,
		actualModelCalls: 0,
		actualAgentCliCalls: 0,
		component: "VZ environment lifecycle; no CLI input/outputs or unified attempts yet",
		electronNode: process.versions.electron ?? null,
		checks: [],
	};
	let bystander;
	const active = [],
		expectedUnknown = [],
		host = new ExternalEvaluationRuntime(root, owner);
	async function until(fn, label, timeout = 12000) {
		const deadline = performance.now() + timeout;
		while (performance.now() < deadline) {
			const value = await fn();
			if (value) return value;
			await new Promise((done) => setTimeout(done, 30));
		}
		throw new Error(`Timed out: ${label}`);
	}
	function command(executable, args, log) {
		const run = spawnSync(executable, args, { encoding: "utf8", timeout: 60000, maxBuffer: 1024 ** 2 });
		fs.writeFileSync(path.join(output, log), (run.stdout ?? "") + (run.stderr ?? ""));
		assert.equal(run.status, 0, `${executable}: ${run.stderr || run.error}`);
	}
	async function terminal(runtime, id) {
		return until(async () => {
			const state = await runtime.status(id);
			return state.stopConfirmed && state.state !== "prepared" ? state : false;
		}, "confirmed terminal environment");
	}
	try {
		command("/usr/bin/xcrun", ["swiftc", source, "-o", binary, "-framework", "Virtualization"], "compile.log");
		const entitlement = path.join(output, "entitlements.plist");
		fs.writeFileSync(
			entitlement,
			'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.virtualization</key><true/></dict></plist>',
		);
		command("/usr/bin/codesign", ["--sign", "-", "--entitlements", entitlement, "--force", binary], "codesign.log");
		for (const identity of Object.values(enrolled).filter((v) => typeof v === "object"))
			identity.sha256 = sha(fs.readFileSync(identity.path));
		result.enrollment = enrolled;
		result.nativeSourceSha256 = sha(fs.readFileSync(source));
		const rejected = randomUUID();
		assert.throws(
			() => host.prepare(rejected, { ...enrolled, binary: { ...enrolled.binary, sha256: "0".repeat(64) } }, 5000, 100),
			{ code: "VERSION_CONFLICT" },
		);
		assert.equal(fs.existsSync(path.join(root, rejected)), false);
		bystander = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
			stdio: "ignore",
			env: { PATH: "/usr/bin:/bin", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
		});
		await once(bystander, "spawn");
		const id = randomUUID(),
			directory = path.join(root, id);
		active.push(id);
		const preparation = host.prepare(id, enrolled, 15000, 150);
		assert.deepEqual(host.prepare(id, enrolled, 15000, 150), preparation);
		assert.throws(() => host.prepare(id, enrolled, 14000, 150), { code: "VERSION_CONFLICT" });
		const spec = path.join(output, "controller-spec.json");
		fs.writeFileSync(spec, JSON.stringify({ root, owner, attemptId: id }));
		const controller = spawn(process.execPath, [fileURLToPath(import.meta.url), "--controller", spec], {
			stdio: "ignore",
			env: { PATH: "/usr/bin:/bin", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
		});
		assert.deepEqual(await once(controller, "exit"), [null, "SIGKILL"]);
		const recovered = new ExternalEvaluationRuntime(root, owner);
		await until(
			async () => (await recovered.status(id)).state === "running",
			"fresh worker reply after controller crash",
		);
		const supervisor = read(directory, "supervisor.json"),
			native = read(directory, "native-handle.json");
		const observation = spawnSync("/bin/ps", ["-p", String(supervisor.pid), "-o", "pid=,ppid=,lstart=,command="], {
			encoding: "utf8",
		});
		assert.equal(observation.status, 0);
		assert.equal(Number(observation.stdout.trim().split(/\s+/)[1]), 1);
		fs.writeFileSync(path.join(output, "orphan-worker.txt"), observation.stdout);
		assert.equal((await recovered.start(id)).state, "running");
		assert.equal(read(directory, "supervisor.json").instance, supervisor.instance);
		await assert.rejects(new ExternalEvaluationRuntime(root, "b".repeat(64)).cancel(id), { code: "PERMISSION_DENIED" });
		result.checks.push(
			"Prepared intent is idempotent; changed config refused. Controller SIGKILL after start does not kill independent worker. Same VM recovered by fresh reply; duplicate start attaches without respawn; foreign owner refused.",
		);
		const blocked = randomUUID();
		host.prepare(blocked, enrolled, 5000, 150);
		await assert.rejects(host.start(blocked), { code: "EXECUTION_UNKNOWN" });
		assert.equal((await host.status(blocked)).state, "blocked");
		await host.cleanup(blocked);
		assert.equal(read(root, "admission.json").attemptId, id);
		result.checks.push(
			"Second environment blocked by unreleased admission; its no-start cleanup cannot release the first environment's guard.",
		);
		fs.writeFileSync(path.join(directory, "native-handle.before.json"), JSON.stringify(native), { mode: 0o600 });
		fs.writeFileSync(path.join(directory, "native-handle.json"), JSON.stringify({ ...native, pid: bystander.pid }), {
			mode: 0o600,
		});
		await recovered.cancel(id);
		const cancelled = await terminal(recovered, id);
		assert.equal(cancelled.state, "cancelled");
		assert.equal(cancelled.forced, true);
		const grace = read(directory, "cancelling.json"),
			force = read(directory, "force-stop.json");
		assert.ok(force.at - grace.at >= 150);
		const events = cancelled.logs.native.entries.map((entry) => entry.value?.event).filter(Boolean);
		assert.ok(events.some((event) => event.startsWith("graceful-stop-")));
		assert.ok(events.indexOf("force-stopped") > events.findIndex((event) => event.startsWith("graceful-stop-")));
		assert.equal(bystander.exitCode, null);
		assert.equal(bystander.signalCode, null);
		fs.writeFileSync(path.join(directory, "native-handle.json"), JSON.stringify(native), { mode: 0o600 });
		const evidenceHash = sha(fs.readFileSync(path.join(directory, "console.raw")));
		const originalConsole = fs.readFileSync(path.join(directory, "console.raw"));
		fs.appendFileSync(path.join(directory, "console.raw"), "x");
		fs.copyFileSync(path.join(directory, "console.raw"), path.join(directory, "console.tampered.raw"));
		await assert.rejects(recovered.status(id), { code: "EVIDENCE_GAP" });
		await assert.rejects(recovered.cleanup(id), { code: "EVIDENCE_GAP" });
		assert.equal(read(root, "admission.json").attemptId, id);
		fs.writeFileSync(path.join(directory, "console.raw"), originalConsole, { mode: 0o600 });
		await recovered.cleanup(id);
		await recovered.cleanup(id);
		assert.equal(fs.existsSync(path.join(root, "admission.json")), false);
		assert.equal(sha(fs.readFileSync(path.join(directory, "console.raw"))), evidenceHash);
		assert.equal((await recovered.start(id)).state, "cancelled");
		result.checks.push(
			"Cancel first requests native graceful shutdown, waits configured grace then confirms whole-VM force-stop. Stored PID replaced by live bystander had no effect; only owned ChildProcess controlled. Cleanup releases admission, preserves raw evidence and never replays the old attempt.",
		);
		result.cancelled = cancelled;
		const timeout = randomUUID();
		active.push(timeout);
		host.prepare(timeout, enrolled, 1500, 100);
		await host.start(timeout);
		const timedOut = await terminal(host, timeout);
		assert.equal(timedOut.state, "timed-out");
		assert.equal(timedOut.stopConfirmed, true);
		await host.cleanup(timeout);
		result.timedOut = timedOut;
		result.checks.push(
			"Fresh environment times out under frozen limit, performs graceful/force protocol, confirms stop and releases only its own admission.",
		);
		const unknown = randomUUID(),
			unknownDirectory = path.join(root, unknown);
		host.prepare(unknown, enrolled, 15000, 150);
		active.push(unknown);
		const unknownIntent = read(unknownDirectory, "intent.json");
		function durableFixture(directory, file, data) {
			const fd = fs.openSync(path.join(directory, file), "wx", 0o600);
			fs.writeFileSync(fd, JSON.stringify(data));
			fs.fsyncSync(fd);
			fs.closeSync(fd);
			const parent = fs.openSync(directory, "r");
			fs.fsyncSync(parent);
			fs.closeSync(parent);
		}
		durableFixture(unknownDirectory, "launch.json", {
			action: "start",
			attemptId: unknown,
			nonce: unknownIntent.nonce,
		});
		durableFixture(root, "admission.json", { attemptId: unknown, nonce: unknownIntent.nonce });
		const workerError = fs.openSync(path.join(unknownDirectory, "owned-worker.stderr"), "wx", 0o600);
		const ownedWorker = spawn(
			process.execPath,
			[
				fileURLToPath(new URL("../dist/server/external-evaluation-runtime.js", import.meta.url)),
				"--supervise",
				unknownDirectory,
			],
			{
				stdio: ["ignore", "ignore", workerError],
				env: { PATH: "/usr/bin:/bin", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
			},
		);
		fs.closeSync(workerError);
		const workerExited = once(ownedWorker, "exit");
		await until(async () => (await host.status(unknown)).state === "running", "owned worker running");
		const orphanNative = read(unknownDirectory, "native-handle.json");
		assert.equal(ownedWorker.kill("SIGKILL"), true);
		expectedUnknown.push({ id: unknown, native: orphanNative });
		assert.deepEqual(await workerExited, [null, "SIGKILL"]);
		assert.equal((await host.status(unknown)).state, "unknown");
		await assert.rejects(host.cleanup(unknown), { code: "EXECUTION_UNKNOWN" });
		assert.equal((await host.start(unknown)).state, "unknown");
		const conflict = randomUUID();
		host.prepare(conflict, enrolled, 5000, 150);
		await assert.rejects(host.start(conflict), { code: "EXECUTION_UNKNOWN" });
		assert.equal(read(root, "admission.json").attemptId, unknown);
		result.unknownWorker = {
			attemptId: unknown,
			native: orphanNative,
			state: "unknown",
			stopConfirmed: false,
			admissionRetained: true,
		};
		result.checks.push(
			"Owned worker SIGKILL leaves unknown with no fresh response and no replay. Cleanup and conflicting environment remain blocked. Native process observation is read-only and never substitutes for VM stop confirmation.",
		);
		for (const identity of Object.values(enrolled).filter((v) => typeof v === "object"))
			assert.equal(sha(fs.readFileSync(identity.path)), identity.sha256);
		assert.equal(sha(fs.readFileSync(emittedRuntime)), runtimeSha256);
		result.runtimeSha256 = runtimeSha256;
		result.status = "PASS";
	} catch (error) {
		result.status = "FAIL";
		result.error = error.stack;
		process.exitCode = 1;
	} finally {
		for (const lost of expectedUnknown) {
			try {
				await until(
					() => {
						const observation = spawnSync("/bin/ps", ["-p", String(lost.native.pid), "-o", "command="], {
							encoding: "utf8",
						});
						return observation.status === 1 || !observation.stdout.includes(binary);
					},
					"native diagnostic helper self-termination after worker crash",
					55000,
				);
				result.orphanNativeProcessAbsent = true;
			} catch (error) {
				result.status = "FAIL";
				process.exitCode = 1;
				result.orphanNativeObservationError = error.message;
			}
		}
		for (const id of active) {
			if (expectedUnknown.some((lost) => lost.id === id)) continue;
			try {
				const state = await host.status(id);
				if (!state.stopConfirmed) {
					await host.cancel(id);
					await terminal(host, id);
				}
			} catch (error) {
				(result.cleanupUnconfirmed ??= []).push({ id, error: error.message });
			}
		}
		if (bystander && bystander.exitCode === null && bystander.signalCode === null) {
			const done = once(bystander, "exit");
			bystander.kill("SIGTERM");
			await done;
		}
		fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
		console.log(JSON.stringify({ status: result.status, output, error: result.error }));
	}
}
