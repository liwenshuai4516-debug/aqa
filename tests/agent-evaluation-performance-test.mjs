/** EC00 fixed offline workload comparison; separate processes prevent warm caches/RSS leaking across modes. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { engineFixture } from "./fixtures/agent-evaluation/engine.mjs";
import { EvidenceCollector } from "../plugins/agent-evaluation/collect.mjs";
import { F06 } from "../plugins/agent-evaluation/evaluators/basic.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";
ensureBuild(fileURLToPath(new URL("..", import.meta.url)), "agent-evaluation-performance");
const { readEvaluationEvidence } = await import("../dist/server/agent/evaluation-evidence.js");
const bytesIn = (dir) =>
	readdirSync(dir, { withFileTypes: true }).reduce(
		(n, e) => n + (e.isDirectory() ? bytesIn(join(dir, e.name)) : statSync(join(dir, e.name)).size),
		0,
	);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
if (process.argv[2] === "--worker") {
	const workload = process.argv[3],
		enabled = process.argv[4] === "on";
	const count = workload === "serial" ? 20 : workload === "parallel" ? 200 : 100;
	const entries = new Map(),
		text = workload === "long" ? "x".repeat(200000) : "fixture output";
	let parentId = null;
	for (let i = 0; i < count; i++) {
		const callId = `call-${i}`,
			id = `event-${i}`;
		entries.set(callId, {
			id: callId,
			parentId,
			type: "message",
			timestamp: new Date().toISOString(),
			message: {
				role: "assistant",
				content: [{ type: "toolCall", id: `tool-${i}`, name: "read", arguments: { path: `fixture-${i}.txt` } }],
				timestamp: Date.now(),
			},
		});
		entries.set(id, {
			id,
			parentId: callId,
			type: "message",
			timestamp: new Date().toISOString(),
			message: {
				role: "toolResult",
				toolCallId: `tool-${i}`,
				toolName: "read",
				content: [{ type: "text", text }],
				isError: false,
				timestamp: Date.now(),
			},
		});
		parentId = id;
	}
	const f = engineFixture({ rules: [F06], evidence: [] });
	// Match the fixed fixture's selected contract boundaries, without mutating immutable records.
	const source = {
		principalId: "fixture",
		workspaceId: "workspace",
		workspace: f.directory,
		conversationId: "conv",
		sessionId: "session",
		children: [],
		persisted: true,
		isStreaming: false,
		leafId: parentId,
		getEntry: (id) => entries.get(id),
	};
	const contract = f.store.write(f.context, {
		kind: "contracts",
		requestId: "performance-contract",
		data: {
			...f.contract.data,
			scope: { ...f.contract.data.scope, startMessageId: "call-0", endMessageId: parentId },
		},
	});
	const attempt = f.store.write(f.context, {
		kind: "attempts",
		requestId: "performance-attempt",
		data: { ...f.attempt.data, contractRef: { kind: contract.kind, id: contract.id, revision: contract.revision } },
	});
	const collector = new EvidenceCollector(f.store, {
		readEvaluationEvidence: (_id, query) => readEvaluationEvidence(source, query),
	});
	const profile = {};
	if (process.env.EVALUATION_PROFILE === "1") {
		for (const name of ["get", "load", "readFile", "readRange", "readBlob", "write", "writeEvidenceBatch"]) {
			const original = f.store[name].bind(f.store);
			profile[name] = { calls: 0, elapsedMs: 0 };
			f.store[name] = (...args) => {
				const start = performance.now();
				profile[name].calls++;
				try {
					return original(...args);
				} finally {
					profile[name].elapsedMs += performance.now() - start;
				}
			};
		}
	}
	const beforeBytes = bytesIn(f.directory),
		cpu = process.cpuUsage(),
		started = performance.now();
	const wait = () => new Promise((resolve) => setTimeout(resolve, 1));
	if (workload === "parallel") for (let i = 0; i < count; i += 20) await Promise.all(Array.from({ length: 20 }, wait));
	else for (let i = 0; i < count; i++) await wait();
	let collected, failure;
	if (enabled)
		try {
			collected = await collector.collect(f.context, {
				attemptRef: { kind: attempt.kind, id: attempt.id, revision: attempt.revision },
				conversationId: "conv",
				requestId: "performance-collect",
			});
		} catch (e) {
			failure = { code: e.code, message: e.message };
		}
	const elapsedMs = performance.now() - started,
		cpuUsed = process.cpuUsage(cpu);
	const result = {
		workload,
		enabled,
		elapsedMs,
		cpuMs: (cpuUsed.user + cpuUsed.system) / 1000,
		peakRssBytes: process.resourceUsage().maxRSS * 1024,
		diskBytes: bytesIn(f.directory) - beforeBytes,
		inputBytes: Buffer.byteLength(JSON.stringify([...entries.values()])),
		evidenceCount: collected?.evidenceRefs.length,
		gaps: collected?.gaps,
		failure,
		...(process.env.EVALUATION_PROFILE === "1" ? { profile } : {}),
	};
	collector.close();
	f.cleanup();
	console.log(JSON.stringify(result));
} else {
	const output = mkdtempSync(join(tmpdir(), "agent-evaluation-performance-")),
		rows = [],
		comparisons = [];
	for (const workload of ["serial", "parallel", "long"]) {
		for (let round = 0; round < 5; round++)
			for (const mode of ["off", "on"]) {
				const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", workload, mode], {
					encoding: "utf8",
					env: { ...process.env, PI_WEB_SMOKE_PREBUILT: "1" },
					timeout: 60000,
				});
				if (run.status !== 0) throw new Error(run.stderr || run.error?.message || run.stdout);
				rows.push({ round, ...JSON.parse(run.stdout.trim()) });
			}
		const off = rows.filter((r) => r.workload === workload && !r.enabled),
			on = rows.filter((r) => r.workload === workload && r.enabled);
		const wallDelta = median(on.map((r) => r.elapsedMs)) - median(off.map((r) => r.elapsedMs));
		const cpuDelta = median(on.map((r) => r.cpuMs)) - median(off.map((r) => r.cpuMs));
		const wallLimit = Math.max(median(off.map((r) => r.elapsedMs)) * 0.2, 50),
			cpuLimit = Math.max(median(off.map((r) => r.cpuMs)) * 0.25, 50);
		const rssDeltas = on.map((r, i) => r.peakRssBytes - off[i].peakRssBytes);
		const pass =
			!on.some((r) => r.failure) &&
			wallDelta <= wallLimit &&
			cpuDelta <= cpuLimit &&
			rssDeltas.every((n) => n <= 64 * 1024 ** 2) &&
			on.every((r) => r.diskBytes <= r.inputBytes * 2 + 1024 ** 2);
		comparisons.push({ workload, wallDelta, wallLimit, cpuDelta, cpuLimit, rssDeltas, pass });
		console.log(JSON.stringify(comparisons.at(-1)));
	}
	const result = {
		status: comparisons.every((r) => r.pass) ? "PASS" : "FAIL",
		scope: "offline task workload then explicit historical collector; no models/CLI; excludes fixture construction",
		output,
		rows,
		comparisons,
	};
	writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(output);
	if (result.status !== "PASS") process.exitCode = 1;
}
