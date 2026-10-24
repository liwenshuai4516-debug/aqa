/** U04 read-path measurement over archived genuine runs; no browser or model execution. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const args = process.argv.slice(2);
assert.ok(
	args.length === 0 || (args.length === 2 && args[0] === "--runtime"),
	"Usage: [--runtime <extracted native package directory>]",
);
const repo = fileURLToPath(new URL("..", import.meta.url));
const output = join(repo, "tests/scratch/ui-catalog-read", String(Date.now()));
await fs.mkdir(output, { recursive: true });
const original = Object.fromEntries(["readFile", "readdir", "rename"].map((name) => [name, fs[name]]));
let active;
for (const name of Object.keys(original))
	fs[name] = async (...args) => {
		if (active) {
			const path = args[name === "rename" ? 1 : 0];
			const key = typeof path === "string" ? path : path instanceof URL ? fileURLToPath(path) : String(path);
			active[name][key] = (active[name][key] || 0) + 1;
		}
		return original[name](...args);
	};
syncBuiltinESMExports();
const nativeEntry = args.length
	? pathToFileURL(join(resolve(args[1]), "dist/index.js")).href
	: import.meta.resolve("pi-ui-testing");
const nativeDirectory = resolve(dirname(fileURLToPath(nativeEntry)), "..");
const metadata = JSON.parse(await fs.readFile(join(nativeDirectory, "package.json"), "utf8"));
const { ArtifactStore, UiWorkflowService, DesignReviewService, capabilities, sha256 } = await import(nativeEntry);
const result = {
	status: "FAIL",
	nativeVersion: metadata.version,
	nativeEntrySha256: sha256(await fs.readFile(fileURLToPath(nativeEntry))),
	validationSha256: sha256(await fs.readFile(join(nativeDirectory, "dist/validation.js"))),
	samples: [],
	checks: [],
	modelCalls: 0,
	browserStarts: 0,
	formalRunnerCalls: 0,
};
const children = [],
	spawned = ({ process }) => children.push(process.spawnargs);
let observing = false;
try {
	const summary = JSON.parse(
		await fs.readFile(join(repo, "docs/ui-testing-evidence/optimization-u04-history.json"), "utf8"),
	);
	const archive = join(repo, summary.evidence.archive);
	assert.equal(sha256(await fs.readFile(archive)), summary.evidence.archive_sha256);
	const extracted = join(output, "history");
	await fs.mkdir(extracted);
	await promisify(execFile)("tar", ["-xzf", archive, "-C", extracted]);
	const source = join(extracted, "project");
	const historyStore = new ArtifactStore(source),
		index = await historyStore.reindex();
	const runs = index.records.filter((record) => record.kind === "run");
	assert.equal(runs.length, 8);
	result.historicalRuns = runs.map((record) => record.ref);
	result.sourceArchive = summary.evidence;
	const runtime = {
		tools: ["read", ...capabilities.map((c) => c.tool)],
		skills: await fs.readdir(join(nativeDirectory, "skills")),
	};
	const compact = (counts, root) =>
		Object.fromEntries(Object.entries(counts).map(([path, count]) => [relative(root, path), count]));
	const measure = async (root, historySize, operation, round, call) => {
		active = { readFile: {}, readdir: {}, rename: {} };
		const start = performance.now();
		let response;
		try {
			response = await call();
		} finally {
			const elapsedMs = performance.now() - start,
				metrics = active;
			active = undefined;
			result.samples.push({
				historySize,
				operation,
				round,
				elapsedMs,
				reads: compact(metrics.readFile, root),
				directories: compact(metrics.readdir, root),
				replacedFiles: compact(metrics.rename, root),
			});
		}
		return response;
	};
	// Confirm instrumentation observes the actual named builtin export as used by the runtime.
	await measure(output, 0, "instrumentation-control", 0, () => fs.readFile(archive));
	assert.equal(
		Object.values(result.samples.pop().reads).reduce((a, b) => a + b, 0),
		1,
	);
	subscribe("child_process", spawned);
	observing = true;
	for (const historySize of [1, 8]) {
		const root = join(output, `history-${historySize}`);
		await fs.cp(source, root, { recursive: true });
		for (const record of runs.slice(historySize)) await fs.rm(join(root, record.ref.path, ".."), { recursive: true });
		await fs.symlink(join(repo, "node_modules"), join(root, "node_modules"), "dir");
		await fs.writeFile(join(root, "package.json"), '{"type":"module"}');
		const workflow = new UiWorkflowService(root, join(output, `empty-authority-${historySize}`), runtime);
		const run = await workflow.store.load(runs[0].ref, false);
		const review = index.records.find((record) => record.kind === "design-review");
		assert.ok(review);
		await assert.rejects(
			new DesignReviewService(root, workflow.authorityRoot).gate(run.data.asset_ref, review.ref),
			(error) => error.category === "review-rejected" && error.message === "评估没有经独立评估调用路径登记",
		);
		const tasks = {};
		for (const mode of ["view", "analyze", "execute"])
			tasks[mode] = await workflow.start({
				task_id: `measure-${mode}`,
				mode,
				...(mode === "execute" ? { asset_ref: run.data.asset_ref } : { run_ref: runs[0].ref }),
			});
		for (let round = 0; round < 6; round++) {
			const catalog = await measure(root, historySize, "catalog", round, () => workflow.catalog());
			assert.equal(catalog.records.filter((record) => record.kind === "run").length, historySize);
			assert.ok(
				catalog.assets.every((asset) => !asset.runtime_ready),
				"Archived control review lacks private authority; never grant readiness",
			);
			for (const mode of ["view", "analyze", "execute"]) {
				const before = await fs.readFile(join(root, tasks[mode].task_ref.path));
				const state = await measure(root, historySize, `status-${mode}`, round, () =>
					workflow.status(tasks[mode].task_ref),
				);
				assert.equal(state.task_ref.sha256, sha256(before));
				assert.deepEqual(await fs.readFile(join(root, tasks[mode].task_ref.path)), before);
				const sample = result.samples.at(-1);
				assert.ok(Object.keys(sample.replacedFiles).every((path) => path === "qa/ui/catalog.json"));
				if (mode !== "execute") assert.equal(Object.keys(sample.directories).length, 0);
				// Status checks capabilities/active-run conflicts. Approval is separately enforced by gate above.
			}
		}
		for (const record of runs.slice(0, historySize))
			assert.equal(sha256(await fs.readFile(join(root, record.ref.path))), record.ref.sha256);
		if (historySize === 8) {
			const damaged = runs.at(-1).ref,
				path = join(root, damaged.path),
				saved = await fs.readFile(path);
			await fs.writeFile(path, "{broken");
			const invalid = await workflow.catalog();
			assert.ok(invalid.invalid.some((entry) => entry.path === damaged.path));
			assert.equal(invalid.records.filter((r) => r.kind === "run").length, 7);
			await assert.rejects(workflow.store.load(damaged), /JSON|property|position|Expected/i);
			await fs.writeFile(path, saved);
			await fs.rename(join(root, damaged.path, ".."), join(output, "temporarily-removed-run"));
			assert.equal((await workflow.catalog()).records.filter((r) => r.kind === "run").length, 7);
			await fs.rename(join(output, "temporarily-removed-run"), join(root, damaged.path, ".."));
			await fs.writeFile(join(root, "qa/ui/catalog.json"), "{broken-cache");
			const restored = await workflow.catalog();
			assert.equal(restored.records.filter((r) => r.kind === "run").length, 8);
			assert.equal(sha256(await fs.readFile(path)), damaged.sha256);
			result.checks.push(
				"Catalog detects corrupt/removed history, preserves other records, rediscovers restored history and rebuilds a corrupt cache without granting readiness",
			);
		}
	}
	assert.equal(children.length, 0, JSON.stringify(children));
	result.checks.push(
		"One/eight genuine historical runs measured for catalog and view/analyze/execute status; each path has one first and five repeated samples",
	);
	result.checks.push(
		"Read-only status leaves task/run manifests unchanged; no browser, child process, model or formal run is started",
	);
	result.limits = [
		"Archived controlled-review authority is deliberately absent; readiness stays false",
		"Instrumented same-process measurements include observer overhead and warm filesystem caches",
		"First query is not cold desktop startup; these samples do not establish complete Agent workflow speed or a 20% improvement",
	];
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	active = undefined;
	if (observing) unsubscribe("child_process", spawned);
	Object.assign(fs, original);
	syncBuiltinESMExports();
	await fs.writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ ...result, evidence: output }, null, 2));
}
