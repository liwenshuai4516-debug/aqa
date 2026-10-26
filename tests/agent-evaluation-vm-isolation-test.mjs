/** EC06 feasibility only: two diskless/no-network VMs, synthetic shell fixture, no real Agent CLI/model. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const runtime = process.argv[2];
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
assert.ok(runtime, "Explicit verified Alpine3.22.7 runtime directory required");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "agent-evaluation-vm-")),
	source = fileURLToPath(new URL("./fixtures/agent-evaluation/vm-supervisor.swift", import.meta.url)),
	binary = path.join(output, "vm-supervisor"),
	kernel = path.join(runtime, "boot/Image"),
	initrd = path.join(runtime, "boot/initramfs-virt"),
	nonce = randomUUID(),
	machines = [],
	hash = (bytes) => createHash("sha256").update(bytes).digest("hex"),
	result = {
		diagnosticStatus: "running",
		executionBackendAcceptance: "NOT_IMPLEMENTED",
		output,
		platform: { system: process.platform, arch: process.arch, kernel: os.release() },
		actualModelCalls: 0,
		actualAgentCliCalls: 0,
		checks: [],
	};
let bystander,
	listener,
	connections = 0;
async function until(fn, label, timeout = 10000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const value = await fn();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`Timed out: ${label}`);
}
function command(executable, args, log) {
	const run = spawnSync(executable, args, { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 });
	fs.writeFileSync(path.join(output, log), (run.stdout ?? "") + (run.stderr ?? ""));
	assert.equal(run.status, 0, `${executable}: ${run.stderr || run.error}`);
}
function launch(label) {
	const child = spawn(binary, [kernel, initrd], { stdio: ["pipe", "pipe", "pipe"] });
	const vm = {
		label,
		child,
		done: once(child, "exit"),
		stdout: "",
		stderr: "",
		events: [],
		send: (text) => child.stdin.write(text + "\n"),
	};
	machines.push(vm);
	child.stdin.on("error", () => {});
	child.stdout.on("data", (bytes) => {
		vm.stdout += bytes.toString("utf8");
		if (Buffer.byteLength(vm.stdout) > 128 * 1024) child.kill("SIGUSR1");
	});
	let pending = "";
	child.stderr.on("data", (bytes) => {
		vm.stderr += bytes.toString("utf8");
		pending += bytes.toString("utf8");
		let at;
		while ((at = pending.indexOf("\n")) !== -1) {
			const line = pending.slice(0, at);
			pending = pending.slice(at + 1);
			try {
				vm.events.push(JSON.parse(line));
			} catch {
				/* Preserve non-JSON framework diagnostics. */
			}
		}
	});
	return vm;
}
function lines(vm) {
	return vm.stdout.replaceAll("\r", "").split("\n");
}
async function prepare(vm) {
	await until(() => vm.events.some((event) => event.event === "running"), `${vm.label} framework running`);
	await until(() => vm.stdout.includes("~ #"), `${vm.label} guest shell`);
	vm.send(
		"/bin/busybox --install -s /bin; export PATH=/bin; mount -t devtmpfs devtmpfs /dev; mount -t proc proc /proc; mount -t sysfs sys /sys; printf '\\nAE_READY\\n'",
	);
	await until(() => lines(vm).includes("AE_READY"), `${vm.label} initialization`);
	assert.deepEqual(
		vm.events.find((event) => event.event === "running"),
		{ event: "running", networkDevices: 0, shares: 0, disks: 0, sockets: 0 },
	);
}
async function stop(vm) {
	assert.equal(vm.child.exitCode, null);
	assert.equal(vm.child.signalCode, null);
	assert.equal(vm.child.kill("SIGUSR1"), true);
	await until(() => vm.child.exitCode !== null || vm.child.signalCode !== null, `${vm.label} terminal`);
	assert.deepEqual(await vm.done, [0, null]);
	assert.ok(vm.events.some((event) => event.event === "force-stopped" && event.state === 0));
	const size = Buffer.byteLength(vm.stdout);
	await new Promise((resolve) => setTimeout(resolve, 300));
	assert.equal(Buffer.byteLength(vm.stdout), size);
}
try {
	result.inputs = Object.fromEntries(
		[
			[kernel, "42a15047f7cfc785e008b43f48c090f6340f34ead8446d7568126bb5cb9bc9f1"],
			[initrd, "aee79b02c16c87fb0b6180a4d652d51b0115d2f2c8a69c20f8e917ff602fe26e"],
		].map(([file, expected]) => {
			const bytes = fs.readFileSync(file);
			assert.equal(hash(bytes), expected);
			return [path.basename(file), { file, bytes: bytes.length, sha256: expected }];
		}),
	);
	command("/usr/bin/xcrun", ["swiftc", source, "-o", binary, "-framework", "Virtualization"], "compile.log");
	const entitlements = path.join(output, "entitlements.plist");
	fs.writeFileSync(
		entitlements,
		'<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.security.virtualization</key><true/></dict></plist>',
	);
	command("/usr/bin/codesign", ["--sign", "-", "--entitlements", entitlements, "--force", binary], "codesign.log");
	result.supervisor = { sourceSha256: hash(fs.readFileSync(source)), binarySha256: hash(fs.readFileSync(binary)) };
	const canary = path.join(output, "host-only-canary.txt");
	fs.writeFileSync(canary, nonce);
	listener = net.createServer((socket) => {
		connections++;
		socket.end();
	});
	listener.listen(0, "127.0.0.1");
	await once(listener, "listening");
	const port = listener.address().port;
	assert.ok(port >= 8900);
	bystander = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", nonce], { stdio: "ignore" });
	const first = launch("first"),
		peer = launch("peer");
	await Promise.all([prepare(first), prepare(peer)]);
	for (const vm of [first, peer]) {
		vm.send(
			`test ! -e '${canary}' && printf '\\nAE_HOST_HIDDEN\\n'; printf 'AE_NET:%s\\n' /sys/class/net/*; nc -w 1 127.0.0.1 ${port}; printf '\\nAE_TCP_EXIT:%s\\n' "$?"; uname -r`,
		);
		await until(() => lines(vm).some((line) => line.startsWith("AE_TCP_EXIT:")), `${vm.label} network check`);
		assert.ok(lines(vm).includes("AE_HOST_HIDDEN"));
		assert.deepEqual(
			lines(vm).filter((line) => line.startsWith("AE_NET:")),
			["AE_NET:/sys/class/net/lo"],
		);
		assert.ok(lines(vm).includes("AE_TCP_EXIT:1"));
	}
	assert.equal(connections, 0);
	assert.equal(fs.readFileSync(canary, "utf8"), nonce);
	first.send(`printf '%s' '${nonce}' > /attempt-only; printf '\\nAE_FIRST_FILE\\n'`);
	await until(() => lines(first).includes("AE_FIRST_FILE"), "first RAM file");
	peer.send("test ! -e /attempt-only && printf '\\nAE_PEER_CLEAN\\n'");
	await until(() => lines(peer).includes("AE_PEER_CLEAN"), "independent RAM roots");
	// Child deliberately creates a new session and ignores TERM. It is confined to this guest.
	first.send("cat > /root-fixture.sh <<'END_FIXTURE'");
	first.send(
		'#!/bin/sh\nsetsid sh -c \'trap "" TERM; while :; do printf "\\nAE_CHILD_BEAT:%s\\n" "$$"; sleep 0.1; done\' &\nchild=$!\nprintf \'\\nAE_ROOT:%s:%s\\n\' "$$" "$child"\nwhile :; do sleep 1; done\nEND_FIXTURE\nsh /root-fixture.sh &',
	);
	const rootLine = await until(() => lines(first).find((line) => /^AE_ROOT:\d+:\d+$/.test(line)), "root/child IDs");
	const [, rootPid, childPid] = rootLine.split(":");
	await until(
		() => lines(first).filter((line) => line === `AE_CHILD_BEAT:${childPid}`).length >= 3,
		"detached child heartbeat",
	);
	first.send(
		`printf '\\nAE_ROOT_STAT:'; cat /proc/${rootPid}/stat; printf '\\nAE_CHILD_STAT:'; cat /proc/${childPid}/stat; kill -TERM ${rootPid}; sleep 0.3; printf '\\nAE_AFTER_ROOT_CANCEL\\n'; test -d /proc/${childPid} && printf 'AE_CHILD_SURVIVES\\n'`,
	);
	await until(() => lines(first).includes("AE_CHILD_SURVIVES"), "child survives root cancellation");
	const rootStat = lines(first).find((line) => line.startsWith(`AE_ROOT_STAT:${rootPid} `)),
		childStat = lines(first).find((line) => line.startsWith(`AE_CHILD_STAT:${childPid} `));
	assert.ok(rootStat && childStat);
	assert.notEqual(rootStat.split(" ")[4], childStat.split(" ")[4], "Detached child still in root process group");
	const afterCancel = first.stdout.lastIndexOf("AE_AFTER_ROOT_CANCEL\r\n");
	await until(
		() => first.stdout.slice(afterCancel).split(`AE_CHILD_BEAT:${childPid}`).length >= 4,
		"continued orphan output",
	);
	await stop(first);
	peer.send("printf '\\nAE_PEER_STILL_RUNNING\\n'");
	await until(() => lines(peer).includes("AE_PEER_STILL_RUNNING"), "peer VM unaffected");
	assert.equal(bystander.exitCode, null);
	assert.equal(bystander.signalCode, null);
	const fresh = launch("fresh");
	await prepare(fresh);
	fresh.send("test ! -e /attempt-only && test ! -e /root-fixture.sh && printf '\\nAE_RESTART_CLEAN\\n'");
	await until(() => lines(fresh).includes("AE_RESTART_CLEAN"), "new VM never replays prior RAM state");
	await stop(fresh);
	await stop(peer);
	assert.equal(connections, 0);
	assert.equal(fs.readFileSync(canary, "utf8"), nonce);
	for (const input of Object.values(result.inputs)) assert.equal(hash(fs.readFileSync(input.file)), input.sha256);
	result.checks.push({
		noNetworkShareDiskOrVsock: true,
		guestOnlyLoopback: true,
		hostCanaryInvisibleUnchanged: true,
		hostListenerConnections: connections,
		separateRAMRoots: true,
		rootPid,
		childPid,
		rootStat,
		childStat,
		detachedChildSurvivedRootCancel: true,
		wholeVMForceStopConfirmed: true,
		noOutputAfterStop: true,
		peerAndHostBystanderUnaffected: true,
		freshVMHasNoPriorFiles: true,
	});
	result.diagnosticStatus = "PASS";
} catch (error) {
	result.diagnosticStatus = "FAIL";
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	for (const vm of machines) {
		if (vm.child.exitCode === null && vm.child.signalCode === null) {
			vm.child.kill("SIGUSR1");
			try {
				await until(() => vm.child.exitCode !== null || vm.child.signalCode !== null, "owned cleanup", 5000);
			} catch {
				vm.child.kill("SIGKILL");
				await vm.done;
				result.diagnosticStatus = "FAIL";
				result.cleanupFallback = true;
				process.exitCode = 1;
			}
		}
		fs.writeFileSync(path.join(output, `${vm.label}.stdout.log`), vm.stdout);
		fs.writeFileSync(path.join(output, `${vm.label}.stderr.log`), vm.stderr);
	}
	if (bystander) {
		const done = once(bystander, "exit");
		bystander.kill("SIGTERM");
		await done;
	}
	if (listener) await new Promise((resolve) => listener.close(resolve));
	result.machines = machines.map((vm) => ({
		label: vm.label,
		supervisorPid: vm.child.pid,
		exitCode: vm.child.exitCode,
		signalCode: vm.child.signalCode,
		events: vm.events,
	}));
	fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
