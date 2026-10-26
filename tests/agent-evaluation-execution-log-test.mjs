/** EC06 log component against an owned synthetic process. Not VM/product lifecycle acceptance. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { ensureBuild } from "./lib/ensure-build.mjs";
ensureBuild(fileURLToPath(new URL("..", import.meta.url)), "evaluation-execution-log");
const { ExternalEvaluationLog } = await import("../dist/server/external-evaluation-log.js");
const modulePath = fileURLToPath(new URL("../dist/server/external-evaluation-log.js", import.meta.url));
const moduleSha256 = createHash("sha256")
	.update(await fs.readFile(modulePath))
	.digest("hex");
const output = await fs.mkdtemp(path.join(os.tmpdir(), "evaluation-execution-log-"));
const fixture = fileURLToPath(new URL("./fixtures/agent-evaluation/log-producer.mjs", import.meta.url));
const limits = { rawBytes: 65536, lineBytes: 512, entries: 100 };
const stdout = await ExternalEvaluationLog.create(path.join(output, "stdout.raw"), "stdout", limits);
const stderr = await ExternalEvaluationLog.create(path.join(output, "stderr.raw"), "stderr", limits);
const child = spawn(process.execPath, [fixture], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
const exited = once(child, "exit"),
	messages = [],
	runs = [];
child.on("message", (message) => messages.push(message));
const watchdog = setTimeout(() => child.kill("SIGKILL"), 30000);
let pauses = 0;
child.stdout.on("pause", () => pauses++);
const captured = Promise.all([pipeline(child.stdout, stdout), pipeline(child.stderr, stderr)]);
// Observe early errors immediately while assertions inspect the still-running process.
captured.catch(() => {});
const result = { status: "running", output, actualModelCalls: 0, actualAgentCliCalls: 0, syntheticProcesses: 1 };
try {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline && !stdout.snapshot().entries.some((entry) => entry.value?.kind === "final-text"))
		await new Promise((resolve) => setTimeout(resolve, 10));
	assert.ok(stdout.snapshot().entries.some((entry) => entry.value?.kind === "final-text"));
	assert.equal(child.exitCode, null);
	assert.equal(child.signalCode, null);
	assert.equal(stdout.snapshot().streamEnded, false);
	result.finalTextWhileRunning = { exitCode: child.exitCode, streamEnded: stdout.snapshot().streamEnded };
	child.send({ action: "release-trusted-fixture" });
	await captured;
	assert.deepEqual(await exited, [0, null]);
	const expected = Buffer.concat([
		Buffer.from('{"中文":"😀"}\n{"kind":"final-text"}\n'),
		Buffer.alloc(64 * 65536, 120),
		Buffer.from("\n"),
	]);
	const out = await fs.readFile(path.join(output, "stdout.raw"));
	assert.deepEqual(out, expected.subarray(0, limits.rawBytes));
	assert.equal(stdout.snapshot().observedBytes, expected.length);
	assert.equal(stdout.snapshot().sha256, createHash("sha256").update(out).digest("hex"));
	assert.equal(stdout.snapshot().gaps.unrecorded.reason, "raw-limit");
	assert.deepEqual(
		stderr.snapshot().entries.map((entry) => entry.value),
		["warning from stderr", { stderr: true }, { ended: true }],
	);
	assert.ok(pauses > 0);
	assert.ok(messages.find((message) => message.phase === "released")?.drains > 0);
	for (const sink of [stdout, stderr])
		assert.deepEqual([sink.snapshot().streamEnded, sink.snapshot().durable], [true, true]);
	result.status = "PASS";
	result.pauses = pauses;
	result.messages = messages;
	result.stdout = stdout.snapshot();
	result.stderr = stderr.snapshot();
	result.exit = [child.exitCode, child.signalCode];
	result.fixtureSha256 = createHash("sha256")
		.update(await fs.readFile(fixture))
		.digest("hex");
	assert.equal(
		createHash("sha256")
			.update(await fs.readFile(modulePath))
			.digest("hex"),
		moduleSha256,
	);
	result.moduleSha256 = moduleSha256;
} catch (error) {
	result.status = "FAIL";
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	clearTimeout(watchdog);
	if (child.exitCode === null && child.signalCode === null) {
		child.kill("SIGKILL");
		await exited;
	}
	await captured.catch((error) => runs.push(error.message));
	result.captureErrors = runs;
	await fs.writeFile(path.join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result));
}
