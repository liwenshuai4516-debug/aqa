/** Exact test-only crash injections in a copied built runtime; original launch/recovery behavior is preserved. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureBuild } from "./lib/ensure-build.mjs";
const repo = fileURLToPath(new URL("..", import.meta.url));
const controller = process.argv[2] === "--controller";
if (!controller) ensureBuild(repo, "evaluation-launch-window");
const { ExternalEvaluationRuntime } = await import("../dist/server/external-evaluation-runtime.js");
const { readOfflineEnrollment } = await import("../dist/server/external-evaluation-enrollment.js");
const owner = "a".repeat(64),
	read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
if (controller) {
	const spec = read(process.argv[3]);
	const { ExternalEvaluationRuntime: Injected } = await import(pathToFileURL(spec.module).href);
	const runtime = new Injected(spec.root, owner);
	runtime.prepare(spec.id, spec.backend, 5000, 100);
	await runtime.start(spec.id);
} else {
	const output = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "evaluation-launch-window-")));
	console.log(output);
	const result = { status: "RUNNING", output, actualModelCalls: 0, actualAgentCliCalls: 0, checks: [], ledger: [] };
	let bystander;
	try {
		assert.ok(process.argv[2], "Explicit previously enrolled application dataDir required");
		const { backend } = readOfflineEnrollment(process.argv[2]);
		const sourcePath = path.join(repo, "dist/server/external-evaluation-runtime.js"),
			source = fs.readFileSync(sourcePath, "utf8");
		result.sourceSha256 = createHash("sha256").update(source).digest("hex");
		bystander = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
		await once(bystander, "spawn");
		for (const [phase, needle] of [
			["controller-before-spawn", "const descriptors = [];"],
			["worker-claim-before-handle", 'publish(directory, "supervisor.json", {'],
			["native-spawn-before-handle", 'publish(directory, "native-handle.json", {'],
		]) {
			const directory = path.join(output, phase);
			fs.mkdirSync(directory, { mode: 0o700 });
			const root = path.join(directory, "attempts");
			fs.mkdirSync(root, { mode: 0o700 });
			fs.writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
			assert.equal(source.split(needle).length, 2, "One exact injection boundary required");
			const marker =
				phase === "controller-before-spawn"
					? 'publish(directory,"crash-window.json",{phase:"controller-before-spawn"});'
					: phase === "worker-claim-before-handle"
						? 'publish(directory,"crash-window.json",{phase:"worker-claim-before-handle",pid:process.pid});'
						: 'publish(directory,"crash-window.json",{phase:"native-spawn-before-handle",pid:child.pid,nativeStart:nativeStart(child.pid)});';
			const injected = source
				.replace(needle, marker + 'process.kill(process.pid,"SIGKILL");\n' + needle)
				.replace(
					/from "(\.\/[^"\n]+)"/g,
					(_all, name) => "from " + JSON.stringify(pathToFileURL(path.resolve(path.dirname(sourcePath), name)).href),
				);
			const module = path.join(directory, "external-evaluation-runtime.js");
			fs.writeFileSync(module, injected);
			const id = randomUUID(),
				spec = path.join(directory, "spec.json");
			fs.writeFileSync(spec, JSON.stringify({ id, root, backend, module }));
			const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--controller", spec], {
				stdio: ["ignore", "pipe", "pipe"],
				env: process.env,
			});
			let logs = "";
			child.stdout.on("data", (d) => (logs += d));
			child.stderr.on("data", (d) => (logs += d));
			const exit = await once(child, "exit");
			fs.writeFileSync(path.join(directory, "controller.log"), logs);
			assert.deepEqual(exit, phase === "controller-before-spawn" ? [null, "SIGKILL"] : [0, null], logs);
			const attempt = path.join(root, id),
				markerPath = path.join(attempt, "crash-window.json");
			const until = Date.now() + 10000;
			while (!fs.existsSync(markerPath) && Date.now() < until) await new Promise((done) => setTimeout(done, 25));
			const observed = read(markerPath),
				runtime = new ExternalEvaluationRuntime(root, owner);
			assert.equal(fs.existsSync(path.join(attempt, "native-handle.json")), false);
			assert.equal(fs.existsSync(path.join(attempt, "worker-claim.json")), phase !== "controller-before-spawn");
			const before = fs.readFileSync(path.join(attempt, "launch.json"));
			assert.equal((await runtime.status(id)).state, "unknown");
			assert.equal((await runtime.start(id)).state, "unknown");
			await assert.rejects(runtime.cleanup(id), { code: "EXECUTION_UNKNOWN" });
			assert.deepEqual(fs.readFileSync(path.join(attempt, "launch.json")), before);
			const conflict = randomUUID();
			runtime.prepare(conflict, backend, 1000, 100);
			await assert.rejects(runtime.start(conflict), { code: "EXECUTION_UNKNOWN" });
			await runtime.cleanup(conflict);
			assert.equal(read(path.join(root, "admission.json")).attemptId, id);
			process.kill(bystander.pid, 0);
			result.ledger.push({
				phase,
				id,
				exit,
				observed,
				state: "unknown",
				stopConfirmed: false,
				admissionRetained: true,
				originalStartNotReplayed: true,
				scope: "test-only exact copied-runtime crash; original recovery queried with original runtime",
			});
		}
		// The spawned native helper has its unchanged 45s watchdog. Observe only; never signal a saved PID.
		const last = result.ledger.at(-1),
			deadline = Date.now() + 55000;
		let observation;
		do {
			const ps = spawnSync("/bin/ps", ["-p", String(last.observed.pid), "-o", "lstart=,command="], {
				encoding: "utf8",
				timeout: 5000,
			});
			observation = ps.stdout.trim();
			if (!observation || /defunct|<exiting>/.test(observation)) break;
			await new Promise((done) => setTimeout(done, 250));
		} while (Date.now() < deadline);
		assert.ok(
			!observation || /defunct|<exiting>/.test(observation),
			"Native helper must exit under its original watchdog/broken-pipe policy",
		);
		result.nativeReadOnlyObservation = observation;
		result.checks.push(
			"three exact actual SIGKILL launch windows retain unknown/admission, block conflict and cleanup, never replay; native helper absence does not upgrade stop confirmation; bystander survives",
		);
		result.status = "PASS";
	} catch (error) {
		result.status = "FAIL";
		result.error = error.stack;
		process.exitCode = 1;
	} finally {
		if (bystander) {
			const done = once(bystander, "exit");
			bystander.kill("SIGTERM");
			await done;
		}
		fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
		console.log(JSON.stringify(result, null, 2));
	}
}
