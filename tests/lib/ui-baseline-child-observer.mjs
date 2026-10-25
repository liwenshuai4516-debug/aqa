/** Test-only Node preload. Aggregate counters only: no paths, arguments, URLs or file contents. */
import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { subscribe } from "node:diagnostics_channel";
import { syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";

const directory = process.env.PI_UI_BASELINE_OBSERVER_DIR;
if (directory) {
	const started = performance.now();
	const record = { pid: process.pid, parent_pid: process.ppid, fs_promises: {}, children: [] };
	for (const name of ["readFile", "readdir", "writeFile", "rename"]) {
		const original = fs[name];
		fs[name] = async (...args) => {
			record.fs_promises[name] = (record.fs_promises[name] ?? 0) + 1;
			return original(...args);
		};
	}
	syncBuiltinESMExports();
	subscribe("child_process", ({ process: child }) => {
		const event = { kind: "unknown", started: false, pid: null, exit_code: null, signal: null };
		record.children.push(event);
		child.once("spawn", () => {
			const executable = basename(child.spawnargs?.[0] ?? "").toLowerCase();
			event.kind = /^(chrome|chromium|chrome-headless-shell|headless_shell|google chrome)(\.exe)?$/.test(executable)
				? "browser"
				: /^node(?:\.exe)?$/.test(executable)
					? "node"
					: "other";
			event.started = true;
			event.pid = child.pid;
		});
		child.once("exit", (code, signal) => {
			event.exit_code = code;
			event.signal = signal;
		});
	});
	process.once("exit", (code) => {
		writeFileSync(
			join(directory, `${process.pid}.json`),
			JSON.stringify({
				...record,
				exit_code: code,
				elapsed_ms: performance.now() - started,
				coverage:
					"This Node process async fs/promises calls and direct child spawn events only. Not OS I/O, native browser internals, navigation, snapshots or process-tree CPU time.",
			}),
		);
	});
}
