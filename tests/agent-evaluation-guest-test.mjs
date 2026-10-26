/** Real diskless VZ guest transport diagnostic. Zero real Agent CLI/model calls; no product execution entry. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ensureBuild } from "./lib/ensure-build.mjs";
ensureBuild(fileURLToPath(new URL("..", import.meta.url)), "evaluation-guest");
const { encodeGuestInput, GuestProtocolDecoder } = await import("../dist/server/external-evaluation-guest.js");
const { ExternalEvaluationLog } = await import("../dist/server/external-evaluation-log.js");
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
assert.ok(process.argv[2], "Explicit verified offline Alpine runtime required");
const output = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-guest-")));
console.log(output);
const source = fileURLToPath(new URL("./fixtures/agent-evaluation/vm-supervisor.swift", import.meta.url));
const binary = path.join(output, "vm-supervisor"),
	kernel = path.join(process.argv[2], "boot/Image"),
	initrd = path.join(process.argv[2], "boot/initramfs-virt");
const target = fs.readFileSync(new URL("./fixtures/agent-evaluation/guest-cli.sh", import.meta.url));
const runner = fs.readFileSync(new URL("./fixtures/agent-evaluation/guest-cli-runner.sh", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const result = {
	status: "running",
	output,
	actualModelCalls: 0,
	actualAgentCliCalls: 0,
	electronNode: process.versions.electron ?? null,
	scenarios: [],
};
const machines = [];
let bystander;
async function until(fn, label, ms = 12000) {
	const deadline = performance.now() + ms;
	while (performance.now() < deadline) {
		const value = await fn();
		if (value) return value;
		await new Promise((done) => setTimeout(done, 10));
	}
	throw new Error(`Timed out: ${label}`);
}
function command(executable, args, log) {
	const run = spawnSync(executable, args, { encoding: "utf8", timeout: 60000 });
	fs.writeFileSync(path.join(output, log), (run.stdout ?? "") + (run.stderr ?? ""));
	assert.equal(run.status, 0, run.error?.message || run.stderr);
}
async function stop(vm) {
	if (vm.child.exitCode === null && vm.child.signalCode === null) vm.child.kill("SIGUSR1");
	assert.deepEqual(await vm.done, [0, null]);
	assert.ok(vm.events.some((e) => e.event === "force-stopped" && e.state === 0));
	await vm.capturing;
}
async function run(label, argv, stdin = Buffer.alloc(0), expectedExit = 0, observe, expectedError) {
	const nonce = randomUUID(),
		directory = path.join(output, label),
		decoder = new GuestProtocolDecoder(nonce);
	fs.mkdirSync(directory, { mode: 0o700 });
	const logs = {};
	for (const channel of ["stdout", "stderr"])
		logs[channel] = await ExternalEvaluationLog.create(path.join(directory, `${channel}.raw`), channel, {
			rawBytes: 65536,
			lineBytes: 16384,
			entries: 256,
		});
	const child = spawn(binary, [kernel, initrd], {
		stdio: ["pipe", "pipe", "pipe"],
		env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
	});
	const vm = {
		label,
		child,
		done: once(child, "exit"),
		events: [],
		frames: [],
		console: [],
		native: [],
		streamWrites: Promise.resolve(),
		capturing: null,
	};
	machines.push(vm);
	child.stdin.on("error", () => {});
	vm.capturing = Promise.all([
		new Promise((resolve, reject) => {
			let bytes = 0;
			child.stdout.on("data", (chunk) => {
				bytes += chunk.length;
				if (bytes <= 1024 ** 2) vm.console.push(chunk);
				else child.kill("SIGUSR1");
				for (const frame of decoder.push(chunk)) {
					vm.frames.push({ channel: frame.channel, payload: frame.bytes.toString("base64"), at: performance.now() });
					if (frame.channel === "stdout" || frame.channel === "stderr")
						vm.streamWrites = vm.streamWrites.then(async () => {
							if (!logs[frame.channel].write(frame.bytes)) await once(logs[frame.channel], "drain");
						});
				}
			});
			child.stdout.on("end", resolve);
			child.stdout.on("error", reject);
		}),
		new Promise((resolve, reject) => {
			let pending = "",
				bytes = 0;
			child.stderr.on("data", (chunk) => {
				bytes += chunk.length;
				if (bytes <= 65536) vm.native.push(chunk);
				else child.kill("SIGUSR1");
				pending += chunk.toString();
				let at;
				while ((at = pending.indexOf("\n")) !== -1) {
					try {
						vm.events.push(JSON.parse(pending.slice(0, at)));
					} catch {}
					pending = pending.slice(at + 1);
				}
			});
			child.stderr.on("end", resolve);
			child.stderr.on("error", reject);
		}),
	]);
	const value = (channel) =>
		vm.frames.filter((f) => f.channel === channel).map((f) => Buffer.from(f.payload, "base64"));
	const text = (channel) => Buffer.concat(value(channel)).toString();
	try {
		await until(() => vm.events.some((e) => e.event === "running"), label + " native running");
		await until(() => Buffer.concat(vm.console).includes("~ #"), label + " shell");
		child.stdin.write(
			"/bin/busybox --install -s /bin; export PATH=/bin; mount -t devtmpfs devtmpfs /dev; mount -t proc proc /proc; stty -echo; mkdir /ae\n",
		);
		const upload = (name, bytes) =>
			`base64 -d > /ae/${name} <<'AE_END'\n${bytes
				.toString("base64")
				.match(/.{1,76}/g)
				.join("\n")}\nAE_END\n`;
		child.stdin.write(
			upload(
				"target",
				expectedError === "version"
					? Buffer.from(target.toString().replace("ae-offline-fake-cli 1", "ae-offline-fake-cli 2"))
					: target,
			) + upload("runner", runner),
		);
		child.stdin.write(`stty raw -echo; exec /bin/sh /ae/runner ${nonce}\n`);
		await until(() => value("ready").length === 1, label + " receiver ready");
		fs.writeFileSync(path.join(directory, "request.raw"), encodeGuestInput(argv, stdin));
		const lines = encodeGuestInput(argv, stdin).toString().trimEnd().split("\n");
		let ack = 0;
		for (const line of lines) {
			child.stdin.write(line + "\n");
			ack++;
			await until(() => value("ack").some((b) => b.toString() === String(ack)), label + " request ack " + ack);
		}
		if (expectedError) {
			await until(() => text("error") === expectedError, label + " preflight error");
			assert.equal(value("started").length, 0);
			assert.equal(text("stdout"), "");
		} else {
			await until(() => value("started").length === 1, label + " started");
			assert.equal(text("version"), "ae-offline-fake-cli 1");
			assert.equal(text("initial"), "");
		}
		if (observe) await observe({ vm, value, text, until });
		if (expectedExit !== null) {
			await until(() => value("exit").length === 1, label + " CLI exit");
			assert.equal(text("exit"), String(expectedExit));
			assert.equal(child.exitCode, null, "Guest exit is not native process exit");
			assert.equal(
				vm.events.some((e) => e.event === "guest-stopped" || e.event === "force-stopped"),
				false,
			);
		}
		await stop(vm);
		await vm.streamWrites;
		for (const channel of ["stdout", "stderr"]) {
			if (value(`${channel}-eof`).length === 1) {
				logs[channel].end();
				await once(logs[channel], "finish");
			} else {
				logs[channel].destroy();
				await once(logs[channel], "close");
			}
		}
		const protocol = decoder.finish();
		assert.deepEqual(protocol.gaps, expectedExit === null ? ["missing-exit"] : []);
		const record = {
			label,
			argv,
			stdinBytes: stdin.length,
			stdinSha256: hash(stdin),
			guestReportedExit: expectedExit,
			expectedPreflightError: expectedError,
			protocol,
			stopConfirmed: true,
			nativeExit: await vm.done,
			logs: { stdout: logs.stdout.snapshot(), stderr: logs.stderr.snapshot() },
		};
		for (const channel of ["stdout", "stderr"]) {
			assert.equal(record.logs[channel].streamEnded, expectedExit !== null);
			assert.equal(record.logs[channel].interrupted, expectedExit === null);
		}
		result.scenarios.push(record);
		return {
			record,
			stdout: fs.readFileSync(path.join(directory, "stdout.raw")),
			stderr: fs.readFileSync(path.join(directory, "stderr.raw")),
		};
	} finally {
		if (child.exitCode === null && child.signalCode === null) await stop(vm);
		await vm.streamWrites.catch(() => {});
		for (const channel of ["stdout", "stderr"]) if (!logs[channel].writableFinished) logs[channel].destroy();
		fs.writeFileSync(path.join(directory, "console.raw"), Buffer.concat(vm.console));
		fs.writeFileSync(path.join(directory, "native.raw"), Buffer.concat(vm.native));
		fs.writeFileSync(path.join(directory, "frames.json"), JSON.stringify(vm.frames, null, 2));
	}
}
try {
	assert.equal(hash(fs.readFileSync(kernel)), "42a15047f7cfc785e008b43f48c090f6340f34ead8446d7568126bb5cb9bc9f1");
	assert.equal(hash(fs.readFileSync(initrd)), "aee79b02c16c87fb0b6180a4d652d51b0115d2f2c8a69c20f8e917ff602fe26e");
	command("/usr/bin/xcrun", ["swiftc", source, "-o", binary, "-framework", "Virtualization"], "compile.log");
	const entitlement = path.join(output, "entitlements.plist");
	fs.writeFileSync(
		entitlement,
		'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.virtualization</key><true/></dict></plist>',
	);
	command("/usr/bin/codesign", ["--sign", "-", "--entitlements", entitlement, "--force", binary], "codesign.log");
	result.inputs = Object.fromEntries(
		[
			kernel,
			initrd,
			source,
			binary,
			fileURLToPath(new URL("../dist/server/external-evaluation-guest.js", import.meta.url)),
			fileURLToPath(new URL("./fixtures/agent-evaluation/guest-cli.sh", import.meta.url)),
			fileURLToPath(new URL("./fixtures/agent-evaluation/guest-cli-runner.sh", import.meta.url)),
		].map((file) => [file, { sha256: hash(fs.readFileSync(file)), bytes: fs.statSync(file).size }]),
	);
	bystander = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
		stdio: "ignore",
		env: { PATH: "/usr/bin:/bin", ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
	});
	await once(bystander, "spawn");
	const args = ["echo", "", "空 格\n\n", "$(touch /ae/work/injected); `id` ' \\", "x".repeat(1024)],
		input = Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 256));
	const echoed = await run("argv-stdin", args, input.subarray(0, 1024));
	const prefix = Buffer.from(
		"ENV:/ae/home:/ae/config:/ae/cache:/bin\n" +
			args
				.slice(1)
				.map((arg) => "ARG:" + Buffer.from(arg).toString("base64") + "\n")
				.join("") +
			"STDIN:",
	);
	assert.deepEqual(echoed.stdout, Buffer.concat([prefix, input.subarray(0, 1024)]));
	assert.equal(echoed.stderr.length, 0);
	const binaryRoundtrip = await run("binary-stdin-limit", ["binary"], input);
	assert.deepEqual(binaryRoundtrip.stdout, input);
	assert.equal(binaryRoundtrip.stderr.length, 0);
	const chunks = await run("half-line-final-alive", ["chunks"], Buffer.alloc(0), 0, async ({ vm, text, until }) => {
		await until(() => text("stdout").includes("中文🙂"), "final text before exit");
		assert.equal(
			vm.frames.some((f) => f.channel === "exit"),
			false,
		);
		assert.equal(vm.child.exitCode, null);
	});
	assert.equal(chunks.stdout.toString(), '{"final":"中文🙂"}\n');
	assert.equal(chunks.stderr.toString(), "diagnostic stderr\n");
	const empty = await run("exit0-no-artifact", ["empty"]);
	assert.equal(empty.stdout.length, 0);
	const failed = await run("exit7", ["failure"], Buffer.alloc(0), 7);
	assert.equal(failed.stderr.toString(), "expected failure\n");
	await run("waiting-cancel", ["waiting"], Buffer.alloc(0), null, async ({ text, until }) => {
		await until(() => text("stderr").includes("waiting-input"), "waiting message");
	});
	await run("version-mismatch", ["echo"], Buffer.alloc(0), null, undefined, "version");
	assert.equal(bystander.exitCode, null);
	assert.equal(bystander.signalCode, null);
	for (const [file, identity] of Object.entries(result.inputs))
		assert.equal(hash(fs.readFileSync(file)), identity.sha256);
	result.status = "PASS";
} catch (error) {
	result.status = "FAIL";
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	for (const vm of machines)
		if (vm.child.exitCode === null && vm.child.signalCode === null) {
			vm.child.kill("SIGUSR1");
			await vm.done;
		}
	if (bystander && bystander.exitCode === null && bystander.signalCode === null) {
		const done = once(bystander, "exit");
		bystander.kill("SIGTERM");
		await done;
	}
	result.nativeProcesses = machines.map((vm) => ({
		label: vm.label,
		pid: vm.child.pid,
		exitCode: vm.child.exitCode,
		signalCode: vm.child.signalCode,
	}));
	fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}
