/** Trusted zero-model fixture copied into a fresh sandbox. Never reads user configuration. */
import fs from "node:fs";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
const [mode, nonce, port, ...args] = process.argv.slice(2);
const emit = (data) => process.stdout.write(JSON.stringify({ nonce, ...data }) + "\n");
const check = (fn) => {
	try {
		return { allowed: true, value: fn() };
	} catch (error) {
		return { allowed: false, code: error.code };
	}
};
if (mode === "--version") {
	emit({ version: "ec06-synthetic-cli@1" });
} else if (mode === "detached") {
	// Every fixture process has its own short watchdog, including if its parent or test controller exits.
	setTimeout(() => process.exit(0), 2500);
	emit({ phase: "detached-ready", pid: process.pid });
} else if (mode === "tree") {
	setTimeout(() => process.exit(0), 5000);
	const child = spawn(process.execPath, [process.argv[1], "detached", nonce], {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});
	child.on("error", (error) => emit({ phase: "child-error", code: error.code }));
	child.stdout.pipe(process.stdout);
	child.stderr.pipe(process.stderr);
	child.unref();
	emit({ phase: "parent-ready", pid: process.pid, childPid: child.pid });
} else if (mode === "bystander") {
	setTimeout(() => process.exit(0), 5000);
	emit({ phase: "bystander-ready", pid: process.pid });
} else if (mode === "probe" || mode === "child") {
	setTimeout(() => process.exit(88), 3000).unref();
	const result = {
		phase: mode,
		pid: process.pid,
		outsideRead: check(() => fs.readFileSync("../outside.txt", "utf8")),
		outsideWrite: check(() => fs.writeFileSync("../outside-new.txt", "forbidden")),
		symlinkRead: check(() => fs.readFileSync("outside-link", "utf8")),
		hardlink: check(() => {
			fs.linkSync("../outside.txt", `hardlink-${mode}`);
			return fs.readFileSync(`hardlink-${mode}`, "utf8");
		}),
	};
	if (mode === "probe") {
		result.inside = check(() => {
			fs.writeFileSync("allowed.txt", "fixture");
			return fs.readFileSync("allowed.txt", "utf8");
		});
		result.argv = args;
		result.stdin = fs.readFileSync(0, "utf8");
		result.environment = Object.fromEntries(
			["HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "NODE_OPTIONS"].map((key) => [
				key,
				process.env[key] ?? null,
			]),
		);
		const child = spawnSync(process.execPath, [process.argv[1], "child", nonce, port], {
			env: process.env,
			encoding: "utf8",
			timeout: 3000,
			maxBuffer: 65536,
		});
		result.child = {
			status: child.status,
			signal: child.signal,
			error: child.error?.code,
			stdout: child.stdout,
			stderr: child.stderr,
		};
	}
	const socket = net.connect({ host: "127.0.0.1", port: Number(port) });
	socket.once("error", (error) => {
		result.network = { allowed: false, code: error.code };
		emit(result);
	});
	socket.once("connect", () => {
		socket.destroy();
		result.network = { allowed: true };
		emit(result);
	});
} else {
	emit({ phase: "invalid-mode" });
	process.exitCode = 2;
}
