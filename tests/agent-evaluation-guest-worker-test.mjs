/** Persistent worker + actual pinned guest CLI. No models, real Agent client, UI or unified store execution. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ensureBuild } from "./lib/ensure-build.mjs";
if (process.argv[2] !== "--controller")
	ensureBuild(fileURLToPath(new URL("..", import.meta.url)), "evaluation-guest-worker");
const { ExternalEvaluationRuntime } = await import("../dist/server/external-evaluation-runtime.js");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
async function until(fn, label, timeout = 15000) {
	const end = performance.now() + timeout;
	while (performance.now() < end) {
		const result = await fn();
		if (result) return result;
		await new Promise((done) => setTimeout(done, 30));
	}
	throw new Error("Timed out: " + label);
}
if (process.argv[2] === "--controller") {
	const spec = read(process.argv[3]),
		runtime = new ExternalEvaluationRuntime(spec.root, spec.owner);
	await runtime.start(spec.id);
	const status = await until(async () => {
		const state = await runtime.status(spec.id);
		return state.guest?.started && state.guest.logCursors.stdout > 0 && state.guest.reportedExit === null
			? state
			: false;
	}, "guest output before controller crash");
	fs.writeFileSync(spec.beforeCrash, JSON.stringify(status));
	process.kill(process.pid, "SIGKILL");
} else await diagnose();
async function diagnose() {
	assert.equal(process.platform, "darwin");
	assert.equal(process.arch, "arm64");
	assert.ok(process.argv[2], "Verified offline runtime required");
	const output = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-guest-worker-")));
	console.log(output);
	const root = path.join(output, "attempts"),
		owner = "a".repeat(64);
	fs.mkdirSync(root, { mode: 0o700 });
	const runtime = new ExternalEvaluationRuntime(root, owner),
		active = [];
	const source = fileURLToPath(new URL("./fixtures/agent-evaluation/vm-supervisor.swift", import.meta.url)),
		binary = path.join(output, "vm-supervisor");
	const asset = (filename) => {
		const p = fs.realpathSync(filename);
		return { path: p, sha256: sha(fs.readFileSync(p)) };
	};
	const fixture = (name) => asset(fileURLToPath(new URL("./fixtures/agent-evaluation/" + name, import.meta.url)));
	const guest = (argv, stdin = Buffer.alloc(0)) => ({
		version: "ae-offline-fake-cli-1",
		target: fixture("guest-cli.sh"),
		runner: fixture("guest-cli-runner.sh"),
		argv,
		stdinBase64: stdin.toString("base64"),
	});
	const result = {
		status: "running",
		output,
		actualModelCalls: 0,
		actualAgentCliCalls: 0,
		electronNode: process.versions.electron ?? null,
		checks: [],
	};
	let bystander;
	const command = (exe, args, log) => {
		const run = spawnSync(exe, args, { encoding: "utf8", timeout: 60000 });
		fs.writeFileSync(path.join(output, log), (run.stdout ?? "") + (run.stderr ?? ""));
		assert.equal(run.status, 0, run.error?.message || run.stderr);
	};
	const terminal = (id) =>
		until(async () => {
			const status = await runtime.status(id);
			return status.stopConfirmed && status.state !== "prepared" ? status : false;
		}, "native stop confirmation");
	try {
		command("/usr/bin/xcrun", ["swiftc", source, "-o", binary, "-framework", "Virtualization"], "compile.log");
		const plist = path.join(output, "entitlements.plist");
		fs.writeFileSync(
			plist,
			'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.virtualization</key><true/></dict></plist>',
		);
		command("/usr/bin/codesign", ["--sign", "-", "--entitlements", plist, "--force", binary], "codesign.log");
		const backend = {
			version: "vz-offline-1",
			binary: asset(binary),
			kernel: asset(path.join(process.argv[2], "boot/Image")),
			initrd: asset(path.join(process.argv[2], "boot/initramfs-virt")),
		};
		result.backend = backend;
		result.inputs = Object.fromEntries(
			[
				"server/external-evaluation-runtime.ts",
				"server/external-evaluation-guest-session.ts",
				"server/external-evaluation-guest.ts",
				"dist/server/external-evaluation-runtime.js",
				"dist/server/external-evaluation-guest-session.js",
				"dist/server/external-evaluation-guest.js",
				"tests/fixtures/agent-evaluation/guest-cli.sh",
				"tests/fixtures/agent-evaluation/guest-cli-runner.sh",
				"tests/agent-evaluation-guest-worker-test.mjs",
			].map((name) => {
				const p = fileURLToPath(new URL("../" + name, import.meta.url));
				return [p, asset(p)];
			}),
		);
		const rejected = randomUUID();
		assert.throws(
			() =>
				runtime.prepare(rejected, backend, 15000, 100, {
					...guest(["echo"]),
					target: { ...guest(["echo"]).target, sha256: "0".repeat(64) },
				}),
			{ code: "VERSION_CONFLICT" },
		);
		assert.equal(fs.existsSync(path.join(root, rejected)), false);
		bystander = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
			stdio: "ignore",
			env: { PATH: "/usr/bin:/bin", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
		});
		await once(bystander, "spawn");
		const id = randomUUID(),
			directory = path.join(root, id),
			request = guest(["chunks"]);
		active.push(id);
		runtime.prepare(id, backend, 15000, 150, request);
		assert.throws(() => runtime.prepare(id, backend, 15000, 150, { ...request, argv: ["empty"] }), {
			code: "VERSION_CONFLICT",
		});
		const spec = path.join(output, "controller.json"),
			beforeCrash = path.join(output, "before-crash.json");
		fs.writeFileSync(spec, JSON.stringify({ root, owner, id, beforeCrash }));
		const controller = spawn(process.execPath, [fileURLToPath(import.meta.url), "--controller", spec], {
			stdio: ["ignore", "pipe", "pipe"],
			env: { PATH: "/usr/bin:/bin", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
		});
		let controllerLog = "";
		controller.stderr.on("data", (b) => (controllerLog += b.toString()));
		const controllerExit = await once(controller, "exit");
		fs.writeFileSync(path.join(output, "controller.stderr"), controllerLog);
		assert.deepEqual(controllerExit, [null, "SIGKILL"], controllerLog);
		const prior = read(beforeCrash),
			handle = fs.readFileSync(path.join(directory, "native-handle.json")),
			claim = fs.readFileSync(path.join(directory, "guest-input.json"));
		const recovered = await runtime.status(id);
		assert.equal(recovered.instance, prior.instance);
		assert.ok(recovered.guest.inputRecordsAcknowledged >= prior.guest.inputRecordsAcknowledged);
		await runtime.start(id);
		assert.deepEqual(fs.readFileSync(path.join(directory, "native-handle.json")), handle);
		assert.deepEqual(fs.readFileSync(path.join(directory, "guest-input.json")), claim);
		const ended = await terminal(id);
		assert.equal(ended.state, "ended");
		assert.equal(ended.guest.reportedExit, 0);
		assert.deepEqual(ended.guest.protocol.gaps, []);
		assert.equal(fs.readFileSync(path.join(directory, "guest-stdout.raw"), "utf8"), '{"final":"中文🙂"}\n');
		assert.equal(fs.readFileSync(path.join(directory, "guest-stderr.raw"), "utf8"), "diagnostic stderr\n");
		assert.deepEqual(fs.readFileSync(path.join(directory, "guest-input.json")), claim);
		const raw = path.join(directory, "guest-stdout.raw"),
			original = fs.readFileSync(raw);
		fs.writeFileSync(path.join(output, "guest-stdout-original.raw"), original);
		fs.writeFileSync(raw, Buffer.alloc(original.length, 120));
		fs.copyFileSync(raw, path.join(output, "guest-stdout-tampered.raw"));
		await assert.rejects(() => runtime.status(id), { code: "EVIDENCE_GAP" });
		await assert.rejects(() => runtime.cleanup(id), { code: "EVIDENCE_GAP" });
		assert.ok(fs.existsSync(path.join(root, "admission.json")));
		fs.writeFileSync(raw, original);
		await runtime.cleanup(id);
		result.recovery = {
			beforeCrash: prior,
			recovered,
			ended,
			guestInputDecisionUnchanged: true,
			nativeHandleUnchanged: true,
		};
		result.checks.push(
			"Controller SIGKILL after first actual guest output: same independent worker/native handle recovered, no second input claim, exact continued stdout/stderr, actual whole-VM stop. Guest raw tamper blocks status/cleanup and keeps admission.",
		);
		const waiting = randomUUID();
		active.push(waiting);
		runtime.prepare(waiting, backend, 15000, 150, guest(["waiting"]));
		await runtime.start(waiting);
		await until(async () => {
			const state = await runtime.status(waiting);
			return state.guest?.started && state.guest.logCursors.stderr > 0;
		}, "actual waiting FIFO");
		await assert.rejects(() => new ExternalEvaluationRuntime(root, "b".repeat(64)).cancel(waiting), {
			code: "PERMISSION_DENIED",
		});
		await runtime.cancel(waiting);
		const cancelled = await terminal(waiting);
		assert.equal(cancelled.state, "cancelled");
		assert.equal(cancelled.guest.reportedExit, null);
		assert.deepEqual(cancelled.guest.protocol.gaps, ["missing-exit"]);
		for (const log of Object.values(cancelled.guest.logs)) {
			assert.equal(log.streamEnded, false);
			assert.equal(log.interrupted, true);
			assert.equal(log.durable, true);
		}
		await runtime.cleanup(waiting);
		result.cancelled = cancelled;
		const timed = randomUUID();
		active.push(timed);
		runtime.prepare(timed, backend, 5000, 100, guest(["waiting"]));
		await runtime.start(timed);
		const timedOut = await terminal(timed);
		assert.equal(timedOut.state, "timed-out");
		assert.equal(timedOut.guest.started, true);
		await runtime.cleanup(timed);
		result.timedOut = timedOut;
		const binaryId = randomUUID(),
			input = Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 256));
		active.push(binaryId);
		runtime.prepare(binaryId, backend, 20000, 100, guest(["binary"], input));
		await runtime.start(binaryId);
		const binaryResult = await terminal(binaryId);
		assert.equal(binaryResult.state, "ended");
		assert.equal(binaryResult.guest.reportedExit, 0);
		assert.deepEqual(fs.readFileSync(path.join(root, binaryId, "guest-stdout.raw")), input);
		await runtime.cleanup(binaryId);
		result.binary = binaryResult;
		assert.equal(bystander.exitCode, null);
		assert.equal(bystander.signalCode, null);
		for (const identity of Object.values(result.inputs))
			assert.equal(sha(fs.readFileSync(identity.path)), identity.sha256);
		result.checks.push(
			"Frozen version/hash/input preflight, private stdout/stderr with exact64KiB binary input, actual waiting FIFO cancel/timeout, foreign owner denied, bystander survives; all cleanup retains evidence.",
		);
		result.status = "PASS";
	} catch (error) {
		result.status = "FAIL";
		result.error = error.stack;
		process.exitCode = 1;
	} finally {
		for (const id of active) {
			try {
				const state = await runtime.status(id);
				if (!state.stopConfirmed) {
					await runtime.cancel(id);
					await terminal(id);
				}
			} catch (error) {
				result.cleanupError = String(error);
				result.status = "FAIL";
				process.exitCode = 1;
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
