/** EC06 offline launch-window crash diagnosis, not a product ExecutionAdapter. No Agent CLI/model. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

function publish(file, value) {
	const temporary = `${file}.${randomUUID()}.tmp`;
	const fd = fs.openSync(temporary, "wx", 0o600);
	try {
		fs.writeFileSync(fd, JSON.stringify(value));
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	fs.renameSync(temporary, file);
	const directory = fs.openSync(path.dirname(file), "r");
	try {
		fs.fsyncSync(directory);
	} finally {
		fs.closeSync(directory);
	}
}
// This process is the deliberately crashed original controller, before any controller handle save.
if (process.argv[2] === "--controller") {
	const [directory, binary, kernel, initrd, phase] = process.argv.slice(3);
	publish(path.join(directory, "intent.json"), { attemptId: randomUUID(), nonce: randomUUID() });
	if (phase === "before-spawn") process.kill(process.pid, "SIGKILL");
	const out = fs.openSync(path.join(directory, "console.log"), "wx", 0o600);
	const err = fs.openSync(path.join(directory, "supervisor.stderr.log"), "wx", 0o600);
	const child = spawn(binary, [kernel, initrd, directory], { detached: true, stdio: ["ignore", out, err] });
	child.on("spawn", () => process.kill(process.pid, "SIGKILL"));
	child.on("error", () => process.exit(11));
} else {
	await diagnose();
}

async function diagnose() {
	assert.equal(process.platform, "darwin");
	assert.equal(process.arch, "arm64");
	const runtime = process.argv[2];
	assert.ok(runtime, "Explicit pinned Alpine3.22.7 runtime required");
	const output = fs.mkdtempSync(path.join(os.tmpdir(), "agent-evaluation-vm-recovery-"));
	fs.chmodSync(output, 0o700);
	console.log(output);
	const source = fileURLToPath(new URL("./fixtures/agent-evaluation/vm-recovery-supervisor.swift", import.meta.url));
	const binary = path.join(output, "vm-recovery-supervisor");
	const kernel = path.join(runtime, "boot/Image"),
		initrd = path.join(runtime, "boot/initramfs-virt");
	const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
	const inputs = [
		[kernel, "42a15047f7cfc785e008b43f48c090f6340f34ead8446d7568126bb5cb9bc9f1"],
		[initrd, "aee79b02c16c87fb0b6180a4d652d51b0115d2f2c8a69c20f8e917ff602fe26e"],
	];
	const result = {
		status: "running",
		productAcceptance: "NOT_IMPLEMENTED",
		output,
		actualAgentCliCalls: 0,
		actualModelCalls: 0,
		checks: [],
		attempts: [],
	};
	const active = [];
	let bystander;
	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	async function until(fn, label, timeout = 10000) {
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			const value = fn();
			if (value) return value;
			await delay(25);
		}
		throw new Error(`Timed out: ${label}`);
	}
	function command(executable, args, log) {
		const run = spawnSync(executable, args, { encoding: "utf8", timeout: 60000, maxBuffer: 1024 ** 2 });
		fs.writeFileSync(path.join(output, log), (run.stdout ?? "") + (run.stderr ?? ""));
		assert.equal(run.status, 0, `${executable}: ${run.stderr || run.error}`);
	}
	function records(directory) {
		return fs
			.readdirSync(directory)
			.filter((name) => /^event-\d{6}\.json$/.test(name) && fs.existsSync(path.join(directory, `${name}.sealed`)))
			.sort()
			.map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")));
	}
	function handle(directory) {
		const intent = JSON.parse(fs.readFileSync(path.join(directory, "intent.json"), "utf8"));
		const claimed = records(directory)[0];
		assert.ok(claimed && claimed.event === "claimed");
		assert.equal(claimed.attemptId, intent.attemptId);
		assert.equal(claimed.nonce, intent.nonce);
		return claimed;
	}
	function control(directory, identity, action, overrides = {}) {
		const requestId = randomUUID();
		publish(path.join(directory, "control.json"), {
			attemptId: identity.attemptId,
			nonce: identity.nonce,
			supervisorId: identity.supervisorId,
			requestId,
			action,
			...overrides,
		});
		return requestId;
	}
	async function reconcile(directory, identity, timeout = 1500) {
		const journal = records(directory);
		if (journal.some((event) => event.event === "stopped" && event.state === 0)) return "stopped";
		if (!identity) return "unknown";
		const requestId = control(directory, identity, "probe");
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			const response = records(directory).find(
				(event) =>
					event.event === "probe" &&
					event.requestId === requestId &&
					event.supervisorId === identity.supervisorId &&
					event.nonce === identity.nonce &&
					event.attemptId === identity.attemptId,
			);
			if (response) return response.state === 1 ? "running" : "unknown";
			await delay(25);
		}
		return "unknown";
	}
	async function stop(directory, identity) {
		control(directory, identity, "stop");
		await until(
			() => records(directory).some((event) => event.event === "stopped" && event.state === 0),
			"framework stop confirmation",
		);
		assert.equal(await reconcile(directory, identity), "stopped");
	}
	function attempt(name) {
		const directory = path.join(output, name);
		fs.mkdirSync(directory, { mode: 0o700 });
		result.attempts.push({ name, directory });
		return directory;
	}
	async function crashController(directory, phase) {
		const child = spawn(
			process.execPath,
			[fileURLToPath(import.meta.url), "--controller", directory, binary, kernel, initrd, phase],
			{ stdio: "ignore" },
		);
		assert.deepEqual(await once(child, "exit"), [null, "SIGKILL"]);
		assert.equal(fs.existsSync(path.join(directory, "controller-handle.json")), false);
	}
	function duplicate(directory) {
		const run = spawnSync(binary, [kernel, initrd, directory], { encoding: "utf8", timeout: 5000 });
		assert.equal(run.status, 9, "Existing durable launch claim must reject another supervisor");
	}
	try {
		for (const [file, expected] of inputs) assert.equal(sha(fs.readFileSync(file)), expected);
		command("/usr/bin/xcrun", ["swiftc", source, "-o", binary, "-framework", "Virtualization"], "compile.log");
		fs.writeFileSync(
			path.join(output, "entitlements.plist"),
			'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.virtualization</key><true/></dict></plist>',
		);
		command(
			"/usr/bin/codesign",
			["--sign", "-", "--entitlements", path.join(output, "entitlements.plist"), "--force", binary],
			"codesign.log",
		);
		result.sourceSha256 = sha(fs.readFileSync(source));
		result.inputs = inputs;
		bystander = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
		await once(bystander, "spawn");
		const before = attempt("before-spawn");
		await crashController(before, "before-spawn");
		assert.equal(await reconcile(before), "unknown");
		assert.equal(fs.existsSync(path.join(before, "launch-claim")), false);
		assert.deepEqual(records(before), []);
		result.checks.push(
			"Controller SIGKILL after durable intent but before spawn: unknown; no recovery spawn or replay.",
		);
		const claimOnly = attempt("claim-before-handle");
		publish(path.join(claimOnly, "intent.json"), { attemptId: randomUUID(), nonce: randomUUID() });
		const claimCrash = spawn(binary, [kernel, initrd, claimOnly, "--crash-after-claim"], { stdio: "ignore" });
		assert.deepEqual(await once(claimCrash, "exit"), [null, "SIGKILL"]);
		assert.equal(fs.existsSync(path.join(claimOnly, "launch-claim")), true);
		assert.deepEqual(records(claimOnly), []);
		assert.equal(await reconcile(claimOnly), "unknown");
		duplicate(claimOnly);
		result.checks.push(
			"Supervisor SIGKILL after fsynced exclusive launch claim but before first handle: unknown; durable marker prevents duplicate launch. VM start was never reached.",
		);

		const recovered = attempt("after-spawn");
		active.push(recovered);
		await crashController(recovered, "after-spawn");
		await until(() => records(recovered).some((event) => event.event === "running"), "orphan supervisor starts VM");
		const identity = handle(recovered);
		const observation = spawnSync("/bin/ps", ["-p", String(identity.pid), "-o", "pid=,ppid=,pgid=,stat=,command="], {
			encoding: "utf8",
		});
		assert.equal(observation.status, 0);
		fs.writeFileSync(path.join(recovered, "orphan-process.txt"), observation.stdout);
		const processColumns = observation.stdout.trim().split(/\s+/);
		assert.equal(Number(processColumns[0]), identity.pid);
		assert.equal(Number(processColumns[1]), 1, "Original controller died; supervisor is reparented");
		assert.equal(await reconcile(recovered, identity), "running");
		await until(() => fs.readFileSync(path.join(recovered, "console.log"), "utf8").includes("~ #"), "guest boot");
		duplicate(recovered);
		assert.equal(records(recovered).filter((event) => event.event === "starting").length, 1);
		control(recovered, identity, "stop", { nonce: randomUUID() });
		await until(
			() => records(recovered).filter((event) => event.event === "control-rejected").length === 1,
			"nonce rejection",
		);
		control(recovered, identity, "stop", { supervisorId: randomUUID() });
		await until(
			() => records(recovered).filter((event) => event.event === "control-rejected").length === 2,
			"supervisor identity rejection",
		);
		assert.equal(await reconcile(recovered, { ...identity, pid: bystander.pid }), "running");
		assert.equal(bystander.exitCode, null);
		assert.equal(bystander.signalCode, null);
		result.checks.push(
			"Original controller SIGKILL after spawn/before handle: recovered same supervisor via sealed records and fresh challenge; duplicate launch rejected; mismatched nonce/identity cannot stop; diagnostic PID changed to live bystander has no control effect.",
		);
		await stop(recovered, identity);
		await until(
			() => spawnSync("/bin/ps", ["-p", String(identity.pid), "-o", "pid="], { encoding: "utf8" }).status === 1,
			"orphan supervisor exited after stop",
		);
		const consoleBytes = fs.statSync(path.join(recovered, "console.log")).size;
		await delay(200);
		assert.equal(fs.statSync(path.join(recovered, "console.log")).size, consoleBytes);
		duplicate(recovered);
		assert.equal(records(recovered).filter((event) => event.event === "starting").length, 1);
		assert.ok(!records(recovered).some((event) => event.reason === "diagnostic-watchdog"));
		result.checks.push(
			"Recovered controller receives durable VZ state0 stop confirmation; no console output after stop; completed claim still rejects replay.",
		);

		const lost = attempt("supervisor-crash");
		publish(path.join(lost, "intent.json"), { attemptId: randomUUID(), nonce: randomUUID() });
		const out = fs.openSync(path.join(lost, "console.log"), "wx", 0o600);
		const err = fs.openSync(path.join(lost, "supervisor.stderr.log"), "wx", 0o600);
		const owned = spawn(binary, [kernel, initrd, lost], { stdio: ["ignore", out, err] });
		fs.closeSync(out);
		fs.closeSync(err);
		const exited = once(owned, "exit");
		active.push(lost);
		await until(() => records(lost).some((event) => event.event === "running"), "owned supervisor running");
		const lostIdentity = handle(lost);
		assert.equal(await reconcile(lost, lostIdentity), "running");
		assert.equal(owned.kill("SIGKILL"), true);
		assert.deepEqual(await exited, [null, "SIGKILL"]);
		assert.equal(await reconcile(lost, { ...lostIdentity, pid: bystander.pid }), "unknown");
		assert.ok(!records(lost).some((event) => event.event === "stopped"));
		result.attempts.find((entry) => entry.directory === lost).cleanupUnconfirmed =
			"Supervisor SIGKILL observed through owned ChildProcess; no framework stop confirmation, no PID-based cleanup or automatic restart.";
		duplicate(lost);
		assert.equal(bystander.exitCode, null);
		assert.equal(bystander.signalCode, null);
		result.checks.push(
			"Owned supervisor SIGKILL leaves running journal but no fresh challenge/stop confirmation: unknown; retained claim rejects retry; no signal sent to stored or replaced PID. No claim of confirmed guest stop.",
		);
		for (const [file, expected] of inputs) assert.equal(sha(fs.readFileSync(file)), expected);
		result.status = "PASS";
	} catch (error) {
		result.status = "FAIL";
		result.error = error.stack;
		process.exitCode = 1;
	} finally {
		for (const directory of active) {
			const journal = records(directory);
			if (
				!journal.some((event) => event.event === "stopped") &&
				!result.attempts.find((entry) => entry.directory === directory).cleanupUnconfirmed
			) {
				try {
					await stop(directory, handle(directory));
				} catch (error) {
					result.attempts.find((entry) => entry.directory === directory).cleanupUnconfirmed = error.message;
				}
			}
		}
		if (bystander) {
			const done = once(bystander, "exit");
			bystander.kill("SIGTERM");
			await done;
		}
		for (const entry of result.attempts) entry.events = records(entry.directory);
		fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
		console.log(JSON.stringify({ status: result.status, output, error: result.error }));
	}
}
