/** Test-only host counters. No arguments, paths, environment values or tool bodies are recorded. */
import fs from "node:fs/promises";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";

export function measureDiscovery() {
	const started = performance.now();
	const originals = Object.fromEntries(["readFile", "readdir", "writeFile", "rename"].map((key) => [key, fs[key]]));
	const counters = Object.fromEntries(Object.keys(originals).map((key) => [key, 0]));
	const record = { invocations: [], milestones: [], directChildren: [] };
	for (const key of Object.keys(originals))
		fs[key] = async (...args) => {
			counters[key]++;
			return originals[key](...args);
		};
	syncBuiltinESMExports();
	const spawned = ({ process: child }) => {
		const event = { kind: "unknown", started: false, elapsed_ms: null };
		record.directChildren.push(event);
		child.once("spawn", () => {
			event.kind = child.spawnargs?.some((arg) => /chrome|chromium/i.test(arg)) ? "browser" : "other";
			event.started = true;
			event.elapsed_ms = performance.now() - started;
		});
	};
	subscribe("child_process", spawned);
	return {
		async invoke(tool, operation, call) {
			const start = performance.now(),
				before = { ...counters };
			const sample = { tool, operation, status: "threw" };
			try {
				const response = await call();
				sample.status = response.status;
				return response;
			} finally {
				sample.elapsed_ms = performance.now() - start;
				sample.fs_promises = Object.fromEntries(Object.keys(counters).map((key) => [key, counters[key] - before[key]]));
				record.invocations.push(sample);
			}
		},
		mark(name) {
			record.milestones.push({ name, elapsed_ms: performance.now() - started, fs_promises: { ...counters } });
		},
		stop() {
			unsubscribe("child_process", spawned);
			Object.assign(fs, originals);
			syncBuiltinESMExports();
			return record;
		},
	};
}
