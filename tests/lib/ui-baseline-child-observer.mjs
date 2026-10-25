/** Test-only Node preload. Aggregate counters only: no paths, arguments, URLs or file contents. */
import fs from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { subscribe } from "node:diagnostics_channel";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";

/** Version-pinned test observer using the same listener as Playwright Test, without changing API results. */
export function observePlaywrightApi(root = process.cwd()) {
	const require = createRequire(join(root, "package.json"));
	const fromPlaywright = createRequire(require.resolve("playwright/package.json"));
	const version = fromPlaywright("playwright-core/package.json").version;
	if (version !== "1.62.1") throw new Error("API observation requires the actual runner Playwright 1.62.1");
	const instrumentation = fromPlaywright("playwright-core")._instrumentation;
	if (typeof instrumentation?.addListener !== "function") throw new Error("API listener unavailable; counters unknown");
	const calls = {},
		pending = new WeakMap();
	const listener = {
		onApiCallBegin(data, channel) {
			const key = `${channel.type}.${channel.method}`;
			calls[key] ??= { started: 0, completed: 0, failed: 0 };
			calls[key].started++;
			pending.set(data, key);
		},
		onApiCallEnd(data) {
			const key = pending.get(data);
			if (!key) return;
			calls[key].completed++;
			if (data.error) calls[key].failed++;
			pending.delete(data);
		},
	};
	instrumentation.addListener(listener);
	return { version, calls, stop: () => instrumentation.removeListener(listener) };
}

const directory = process.env.PI_UI_BASELINE_OBSERVER_DIR;
if (directory) {
	const started = performance.now();
	const api = observePlaywrightApi();
	const record = {
		pid: process.pid,
		parent_pid: process.ppid,
		fs_promises: {},
		children: [],
		playwright_api: { version: api.version, calls: api.calls },
	};
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
					"This Node process async fs/promises calls and direct child spawn events only. Playwright 1.62.1 external channel API starts/completions/failures counted without parameters. Not OS I/O, browser-internal navigations, trace-internal snapshots or process-tree CPU time.",
			}),
		);
	});
}
