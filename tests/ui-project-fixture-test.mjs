/** Repeat/interrupt lifecycle checks against the actual isolated project server. */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createProjectEnvironment,
	cleanupAbandonedEnvironment,
	processAlive,
	waitUntil,
} from "../qa/ui/project-environment.mjs";
import { ensureBuild } from "./lib/ensure-build.mjs";
import { portUp } from "./lib/port-utils.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
ensureBuild(repo, "ui-project-fixture");
const evidence = join(repo, "tests/scratch/ui-project-fixture", String(Date.now()));
await mkdir(evidence, { recursive: true });
const checks = [];
const roots = new Set();
let passed = false;
// An unrelated listener must survive every cleanup.
const unrelated = createServer((socket) => socket.end());
await new Promise((ok) => unrelated.listen(0, "127.0.0.1", ok));
try {
	for (let round = 0; round < 2; round++) {
		const fixture = await createProjectEnvironment();
		roots.add(fixture.root);
		try {
			assert.ok(fixture.port >= 8900);
			assert.equal(fixture.preflight.status, "completed");
			assert.equal((await fetch(`${fixture.url}/`)).status, 401);
			assert.equal(
				(await fetch(`${fixture.url}/`, { headers: { Authorization: `Bearer ${fixture.token}` } })).status,
				200,
			);
			const item = await fixture.createOwnedData({ round });
			const sentinel = join(fixture.workDir, "fixture-data/other-owner.json");
			await writeFile(sentinel, "preserve other ownership");
			const records = await fixture.cleanupData();
			assert.equal(existsSync(item.value), false);
			assert.equal(await readFile(sentinel, "utf8"), "preserve other ownership");
			assert.equal(records[0].cleanup_state, "cleaned");
			await fixture.createOwnedData({ afterCleanup: true }); // reusable data scope
		} finally {
			const report = await fixture.dispose();
			assert.deepEqual(report.residual, []);
			assert.equal(existsSync(fixture.root), false);
			assert.equal(processAlive(fixture.serverPid), false);
			assert.equal(await portUp(fixture.port), false);
			assert.deepEqual(await fixture.dispose(), report);
		}
		checks.push(
			`repeat ${round + 1}: authenticated initial state, owned cleanup, idempotent dispose, no server/port/files left`,
		);
	}
	assert.equal(roots.size, 2);
	let failedRoot;
	await assert.rejects(
		() =>
			createProjectEnvironment({
				prepare: async (fixture) => {
					failedRoot = fixture.root;
					throw new Error("fixture startup probe");
				},
			}),
		/fixture startup probe/,
	);
	assert.equal(existsSync(failedRoot), false);
	checks.push("failed startup removes owned partial directories");
	for (const signal of ["SIGTERM", "SIGKILL"]) {
		const worker = fork(join(repo, "tests/fixtures/ui-environment-worker.mjs"), [], {
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		});
		let state;
		try {
			const message = Promise.race([
				once(worker, "message"),
				once(worker, "exit").then(() => {
					throw new Error("Fixture worker exited before readiness");
				}),
			]);
			const timeout = setTimeout(() => worker.kill("SIGTERM"), 40000);
			try {
				[state] = await message;
			} finally {
				clearTimeout(timeout);
			}
			assert.ok(existsSync(state.data));
			const exited = once(worker, "exit");
			worker.kill(signal);
			await exited;
			await waitUntil(() => !processAlive(state.serverPid), "interrupted owned server exits");
			assert.equal(await portUp(state.port), false);
			if (signal === "SIGTERM") assert.equal(existsSync(state.root), false);
			else {
				assert.ok(existsSync(join(state.root, "owner.json")), "forced kill must retain an honest ownership ledger");
				const owner = JSON.parse(await readFile(join(state.root, "owner.json"), "utf8"));
				assert.equal(owner.serverPid, state.serverPid);
				await cleanupAbandonedEnvironment(state.root);
				assert.equal(existsSync(state.root), false);
			}
			checks.push(
				`${signal}: owned process/port stopped; ${signal === "SIGTERM" ? "teardown removed files" : "retained ledger reconciled only after owner/server exit"}`,
			);
		} finally {
			if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGTERM");
		}
	}
	await assert.rejects(() => cleanupAbandonedEnvironment(repo), /Not an owned/);
	assert.equal(await portUp(unrelated.address().port), true);
	checks.push("foreign root cleanup rejected and unrelated listener preserved");
	passed = true;
} finally {
	await new Promise((ok) => unrelated.close(ok));
	await writeFile(
		join(evidence, "result.json"),
		JSON.stringify({ status: passed ? "PASS" : "FAIL", checks, actualModelCalls: 0 }, null, 2),
	);
	console.log(JSON.stringify({ status: passed ? "PASS" : "FAIL", checks, evidence }));
}
