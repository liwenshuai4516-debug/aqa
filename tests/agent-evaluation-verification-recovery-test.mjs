/** Actual fixed VM, then SIGKILL in a copied verifier controller. Original recovery must not replay. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { ensureBuild } from "./lib/ensure-build.mjs";
const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "EC07-recovery");
const { enrollOfflineRuntime } = await import("../dist/server/external-evaluation-enrollment.js");
const { ExternalEvaluationRuntime } = await import("../dist/server/external-evaluation-runtime.js");
assert.ok(process.argv[2], "Trusted installation required");
const source = resolve(process.argv[2]),
	output = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "evaluation-verification-recovery-")));
const data = join(output, "data");
fs.mkdirSync(data, { mode: 0o700 });
const enrolled = enrollOfflineRuntime(
	data,
	{ binary: join(source, "binary"), kernel: join(source, "kernel"), initrd: join(source, "initrd") },
	join(repo, "plugins/agent-evaluation/runtime"),
);
const owner = createHash("sha256").update("EC07-recovery-owner").digest("hex"),
	id = randomUUID();
const runtime = new ExternalEvaluationRuntime(enrolled.runtimeRoot, owner);
const result = {
	status: "RUNNING",
	output,
	actualModelCalls: 0,
	actualAgentCliCalls: 0,
	fixedFakeCliCalls: 1,
	checks: [],
};
console.log(output);
try {
	runtime.prepare(id, enrolled.backend, 20000, 200, { ...enrolled.guest, argv: ["artifacts-pass"], stdinBase64: "" });
	await runtime.start(id);
	const deadline = performance.now() + 30000;
	let status;
	while (performance.now() < deadline) {
		status = await runtime.status(id);
		if (status.stopConfirmed) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	assert.equal(status.state, "ended");
	assert.equal(status.stopConfirmed, true);
	const bundle = await runtime.terminalEvidence(id);
	assert.equal(bundle.artifacts.complete, true);
	await runtime.cleanup(id);
	const modulePath = join(repo, "dist/server/external-evaluation-runtime.js");
	const original = fs.readFileSync(modulePath, "utf8");
	const injection = 'publish(directory, "verification.json", { binding, result });';
	assert.equal(original.split(injection).length, 2, "Exact compiled injection location");
	let copied = original.replace(
		injection,
		'if(result.verdict!=="pass")throw Error(JSON.stringify(result));process.kill(process.pid,"SIGKILL");' + injection,
	);
	copied = copied.replace(
		/from "(\.\/[^"]+)"/g,
		(_m, path) => `from "${new URL(path, pathToFileURL(modulePath)).href}"`,
	);
	const fault = join(output, "fault-runtime.mjs");
	fs.writeFileSync(fault, copied);
	const child = spawn(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import {ExternalEvaluationRuntime} from ${JSON.stringify(pathToFileURL(fault).href)};await new ExternalEvaluationRuntime(${JSON.stringify(enrolled.runtimeRoot)},${JSON.stringify(owner)}).verify(${JSON.stringify(id)});`,
		],
		{ stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin" } },
	);
	let log = "";
	child.stdout.on("data", (c) => (log += c));
	child.stderr.on("data", (c) => (log += c));
	const [code, signal] = await once(child, "exit");
	fs.writeFileSync(join(output, "crashed-controller.log"), log);
	assert.equal(code, null);
	assert.equal(signal, "SIGKILL");
	const directory = join(enrolled.runtimeRoot, id),
		claim = fs.readFileSync(join(directory, "verification-intent.json"));
	assert.equal(fs.existsSync(join(directory, "verification.json")), false);
	await assert.rejects(runtime.verify(id), { code: "EXECUTION_UNKNOWN" });
	assert.deepEqual(fs.readFileSync(join(directory, "verification-intent.json")), claim);
	assert.equal(fs.existsSync(join(directory, "verification.json")), false);
	assert.equal((await runtime.terminalEvidence(id)).artifacts.digest, bundle.artifacts.digest);
	result.checks.push(
		"actual fixed VM exports frozen artifacts; verifier completes in its sandbox before controller SIGKILL; original recovery preserves claim and reports unknown without replay or result fabrication",
	);
	result.status = "PASS";
} catch (error) {
	result.status = "FAIL";
	result.error = String(error.stack ?? error);
	process.exitCode = 1;
} finally {
	fs.writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
