/** EC06 backend feasibility diagnostic. Passing this diagnostic does NOT approve an execution backend. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { once } from "node:events";
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-evaluation-isolation-")));
const result = {
	diagnosticStatus: "running",
	executionBackendAcceptance: "BLOCKED",
	output: root,
	platform: process.platform,
	arch: process.arch,
	kernel: os.release(),
	node: process.version,
	actualModelCalls: 0,
	actualAgentCliCalls: 0,
	checks: [],
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
const literal = (value) => JSON.stringify(value);
const roots = [];
function executableOnPath(name) {
	for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!directory) continue;
		const candidate = path.join(directory, name);
		try {
			fs.accessSync(candidate, fs.constants.X_OK);
			if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
		} catch {
			/* Continue the bounded named-runtime lookup. */
		}
	}
	return null;
}
let listener;
function observeProcess(pid, nonce) {
	const value = spawnSync("/bin/ps", ["-p", String(pid), "-o", "pid=,ppid=,pgid=,lstart=,command="], {
		encoding: "utf8",
		timeout: 2000,
		maxBuffer: 16384,
	});
	const line = value.stdout.trim();
	return line.includes(nonce) ? { line, fields: line.split(/\s+/), pid } : null;
}
async function waitFor(fn, ms = 5000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const value = await fn();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("Timed out while observing owned fixture process");
}
function start(profile, work, args) {
	const child = spawn(
		"/usr/bin/sandbox-exec",
		["-p", profile, process.execPath, path.join(work, "probe.mjs"), ...args],
		{ cwd: work, env: environment(work), detached: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	let text = "",
		stderr = "";
	child.stdout.on("data", (bytes) => {
		text += bytes.toString();
		if (text.length >= 65536) child.kill("SIGTERM");
	});
	child.stderr.on("data", (bytes) => {
		stderr += bytes.toString();
		if (stderr.length >= 65536) child.kill("SIGTERM");
	});
	const done = once(child, "exit");
	roots.push({ child, done });
	return {
		child,
		done,
		lines: () =>
			text
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((s) => JSON.parse(s)),
		stderr: () => stderr,
	};
}
function environment(work) {
	return {
		PATH: path.dirname(process.execPath),
		HOME: path.join(work, "home"),
		TMPDIR: path.join(work, "tmp"),
		XDG_CONFIG_HOME: path.join(work, "config"),
		XDG_CACHE_HOME: path.join(work, "cache"),
		OPENSSL_CONF: "/dev/null",
		LANG: "C",
		TZ: "UTC",
	};
}
try {
	result.runtimeInventory = Object.fromEntries(
		["docker", "podman", "colima", "limactl", "qemu-system-aarch64", "orb"].map((name) => [
			name,
			executableOnPath(name),
		]),
	);
	assert.equal(process.platform, "darwin", "This diagnostic supports only the current native macOS backend candidate");
	const node = fs.realpathSync(process.execPath),
		libraries = new Set();
	const linked = spawnSync("/usr/bin/otool", ["-L", node], { encoding: "utf8", timeout: 5000 });
	assert.equal(linked.status, 0);
	for (const line of linked.stdout.split("\n")) {
		const name = line.trim().split(" ")[0];
		if (line.startsWith("\t") && name.startsWith("/opt/")) {
			libraries.add(path.dirname(fs.realpathSync(name)));
			libraries.add(path.dirname(name));
		}
	}
	result.executable = { path: node, sha256: sha(fs.readFileSync(node)), runtimeLibraryDirectories: [...libraries] };
	const work = path.join(root, "work");
	fs.mkdirSync(work);
	for (const directory of ["home", "tmp", "config", "cache"]) fs.mkdirSync(path.join(work, directory));
	fs.writeFileSync(path.join(root, "outside.txt"), "synthetic-outside-fixture", { mode: 0o600 });
	fs.symlinkSync(path.join(root, "outside.txt"), path.join(work, "outside-link"));
	fs.copyFileSync(
		fileURLToPath(new URL("./fixtures/agent-evaluation/isolation-probe.mjs", import.meta.url)),
		path.join(work, "probe.mjs"),
	);
	const parents = new Set();
	for (const target of [work, node, ...libraries]) {
		let dir = path.dirname(target);
		while (!parents.has(dir)) {
			parents.add(dir);
			const next = path.dirname(dir);
			if (next === dir) break;
			dir = next;
		}
	}
	const profile = `(version 1)\n(deny default)\n(allow process-exec (literal ${literal(node)}))\n(allow process-fork)\n(allow sysctl-read)\n(allow file-map-executable)\n(allow file-read* ${[...parents].map((p) => `(literal ${literal(p)})`).join(" ")} (subpath "/System/Library") (subpath "/usr/lib") (literal ${literal(node)}) ${[...libraries].map((p) => `(subpath ${literal(p)})`).join(" ")} (subpath ${literal(work)}) (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/zero") (subpath "/dev/fd"))\n(allow file-write* (subpath ${literal(work)}))\n(allow process-info* (target self))\n(allow signal (target self))`;
	fs.writeFileSync(path.join(root, "profile.sb"), profile);
	result.profile = {
		sha256: sha(profile),
		path: path.join(root, "profile.sb"),
		ancestorDirectoryListing: true,
		personalDirectoriesNotGranted: true,
	};
	let accepted = 0;
	listener = net
		.createServer((socket) => {
			accepted++;
			socket.destroy();
		})
		.listen(0, "127.0.0.1");
	await once(listener, "listening");
	const port = listener.address().port;
	assert.ok(port >= 8900);
	const nonce = randomUUID(),
		argument = "literal $(touch never-run) ; 中文",
		stdin = "synthetic stdin; no model\n";
	for (const [id, current] of [
		["fork-allowed", profile],
		["fork-denied", profile.replace("(allow process-fork)", "")],
	]) {
		const version = spawnSync(
			"/usr/bin/sandbox-exec",
			["-p", current, node, path.join(work, "probe.mjs"), "--version", nonce],
			{ cwd: work, env: environment(work), encoding: "utf8", timeout: 5000, maxBuffer: 65536 },
		);
		assert.equal(version.status, 0, version.stderr);
		assert.equal(JSON.parse(version.stdout).version, "ec06-synthetic-cli@1");
		const r = spawnSync(
			"/usr/bin/sandbox-exec",
			["-p", current, node, path.join(work, "probe.mjs"), "probe", nonce, String(port), argument],
			{ cwd: work, env: environment(work), input: stdin, encoding: "utf8", timeout: 5000, maxBuffer: 65536 },
		);
		const receipt = {
			id,
			status: r.status,
			signal: r.signal,
			error: r.error?.code,
			stdout: r.stdout,
			stderr: r.stderr,
		};
		result.checks.push(receipt);
		assert.equal(r.status, 0, r.stderr);
		const data = JSON.parse(r.stdout);
		assert.deepEqual(data.inside, { allowed: true, value: "fixture" });
		assert.deepEqual(data.argv, [argument]);
		assert.equal(data.stdin, stdin);
		for (const key of ["outsideRead", "outsideWrite", "symlinkRead", "hardlink", "network"])
			assert.deepEqual(data[key], { allowed: false, code: "EPERM" });
		assert.equal(data.environment.NODE_OPTIONS, null);
		if (id === "fork-allowed") {
			assert.equal(data.child.status, 0, data.child.stderr);
			const inherited = JSON.parse(data.child.stdout);
			for (const key of ["outsideRead", "outsideWrite", "symlinkRead", "hardlink", "network"])
				assert.deepEqual(inherited[key], { allowed: false, code: "EPERM" });
		} else assert.equal(data.child.error, "EPERM");
	}
	assert.equal(accepted, 0);
	assert.equal(fs.existsSync(path.join(root, "outside-new.txt")), false);
	assert.equal(fs.existsSync(path.join(work, "never-run")), false);
	result.network = {
		port,
		acceptedConnections: accepted,
		scope: "loopback deny probe only; no external connection attempted",
	};
	// A group leader remains alive until the controller signals its own newly created process group.
	const treeNonce = randomUUID(),
		tree = start(profile, work, ["tree", treeNonce]);
	const bystanderNonce = randomUUID(),
		bystander = start(profile, work, ["bystander", bystanderNonce]);
	await waitFor(
		() =>
			tree.lines().some((l) => l.phase === "detached-ready") &&
			bystander.lines().some((l) => l.phase === "bystander-ready"),
	);
	const parent = tree.lines().find((l) => l.phase === "parent-ready"),
		detached = tree.lines().find((l) => l.phase === "detached-ready");
	const before = {
		parent: observeProcess(parent.pid, treeNonce),
		detached: observeProcess(detached.pid, treeNonce),
		bystander: observeProcess(bystander.child.pid, bystanderNonce),
	};
	assert.ok(before.parent && before.detached && before.bystander);
	assert.equal(Number(before.parent.fields[2]), parent.pid);
	assert.equal(Number(before.detached.fields[2]), detached.pid);
	assert.notEqual(parent.pid, detached.pid);
	process.kill(-parent.pid, "SIGTERM");
	const rootExit = await tree.done;
	const escaped = observeProcess(detached.pid, treeNonce);
	assert.ok(escaped, "Expected counterexample must actually remain alive after group cancellation");
	assert.ok(observeProcess(bystander.child.pid, bystanderNonce), "Bystander must remain unaffected");
	result.processContainment = {
		before,
		rootExit,
		escapedAfterGroupCancel: escaped,
		verdict: "UNSUPPORTED",
		reason: "A sandbox-inheriting child created a separate process group and survived the original group cancellation",
	};
	// Do not signal a detached PID. This trusted fixture exits itself; verify its exact nonce-bearing process disappears.
	await waitFor(() => !observeProcess(detached.pid, treeNonce), 5000);
	bystander.child.kill("SIGTERM");
	await bystander.done;
	result.processContainment.fixtureSelfExitConfirmed = true;
	result.processContainment.bystanderStopViaOwnedHandle = true;
	assert.equal(fs.readFileSync(path.join(root, "outside.txt"), "utf8"), "synthetic-outside-fixture");
	result.diagnosticStatus = "PASS";
	result.blockingConditions = [
		"No verified whole-attempt containment/stop for escaped descendants",
		"No container/VM backend is configured and verified for this attempt; PATH inventory is recorded, and no runtime was installed",
	];
} catch (error) {
	result.diagnosticStatus = "FAIL";
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	for (const { child, done } of roots) {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
		await done.catch(() => {});
	}
	if (listener) await new Promise((resolve) => listener.close(resolve));
	fs.writeFileSync(path.join(root, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
