/** U00 measured approved regression/read-only paths. No model calls or synthetic approval. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const [directory, option] = process.argv.slice(2);
assert.ok(
	directory && (!option || option === "--observe-children"),
	"Usage: <original approved U05 evidence directory> [--observe-children]",
);
const observeChildren = option === "--observe-children";
assert.ok(!observeChildren || !process.env.NODE_OPTIONS, "Isolated observer requires no inherited NODE_OPTIONS");
assert.ok(!observeChildren || !process.env.PI_UI_BASELINE_OBSERVER_DIR, "Do not replace another observer");
const root = resolve(directory),
	repo = fileURLToPath(new URL("..", import.meta.url));
const output = join(repo, "tests/scratch/ui-approved-baseline", String(Date.now()));
await fs.mkdir(output, { recursive: true });
const load = async (name) => JSON.parse(await fs.readFile(join(root, name), "utf8"));
const revision = await load("browser-v4-diagnostics.json"),
	delivered = await load("browser-v4-delivery.json");
assert.equal(revision.status, "PASS");
assert.equal(delivered.status, "APPROVED_DELIVERED");
const original = Object.fromEntries(["readFile", "readdir", "writeFile", "rename"].map((name) => [name, fs[name]]));
let active;
for (const name of Object.keys(original))
	fs[name] = async (...args) => {
		if (active) {
			const value = args[name === "rename" ? 1 : 0];
			const path = value instanceof URL ? fileURLToPath(value) : String(value);
			// Never expose private authority, credentials, environment variables or file contents.
			const key = path.includes("ui-review-authority") ? "<private-authority>" : relative(root, path);
			active.files[name][key] = (active.files[name][key] ?? 0) + 1;
		}
		return original[name](...args);
	};
syncBuiltinESMExports();
const native = await import("pi-ui-testing");
const installed = dirname(fileURLToPath(import.meta.resolve("pi-ui-testing")));
const authority = join(root, "ui-review-authority");
const workflow = new native.UiWorkflowService(root, authority, {
	tools: ["read", ...native.capabilities.map((c) => c.tool)],
	skills: await fs.readdir(join(installed, "../skills")),
});
const observer = join(repo, "tests/lib/ui-baseline-child-observer.mjs");
const childDirectory = join(output, "children");
if (observeChildren) await fs.mkdir(childDirectory);
const plan = {
	created_at: new Date().toISOString(),
	scope: "Original six-case U05 v4 approved asset, scope, roles and exact origins; no scope changes",
	asset_ref: revision.assetRef,
	review_ref: (await load("native-review-10-authorization4.json")).tool.details.artifact_refs[0],
	report_ref: delivered.report_ref,
	original_run_ref: (await load("browser-v4-formal.json")).execution.run_ref,
	native_version: JSON.parse(await fs.readFile(join(installed, "../package.json"), "utf8")).version,
	harness_sha256: native.sha256(await fs.readFile(fileURLToPath(import.meta.url))),
	child_observer: observeChildren
		? {
				sha256: native.sha256(await fs.readFile(observer)),
				scope:
					"NODE_OPTIONS preload limited to runner invocation and inherited Node workers; aggregate counters, no private data",
			}
		: null,
	measurement:
		"One current-version regression to native run terminal; one first and five repeated view/status and report reconciliation samples. Host FS counts are separate from optional inherited Node preload records; each process observes only its direct children. Setup-warmed, not cold OS/Electron startup. Observer overhead included.",
	acceptance:
		"Trusted approval/current diagnostic gate; formal six cases and thirteen reached assertions unchanged; same request readback causes no child launches; read-only samples do not start children or change original task/run/report; no paid review calls.",
	missing: [
		"Fresh first-generation full baseline",
		"Old failed-batch complete analysis/rerun baseline",
		observeChildren
			? "Browser-internal navigation/trace snapshot and OS-level I/O counters (not observed)"
			: "Nested runner browser launch/navigation/snapshot/FS counters",
		"Before/after paired full-workflow comparison",
		"Electron business end-to-end",
	],
};
await fs.writeFile(join(output, "plan.json"), JSON.stringify(plan, null, 2), { flag: "wx" });
const result = { status: "FAIL", plan, samples: [], modelCalls: 0, planComplete: false };
const measure = async (operation, round, call) => {
	assert.equal(active, undefined);
	const sample = {
		operation,
		round,
		files: Object.fromEntries(Object.keys(original).map((k) => [k, {}])),
		directChildren: [],
	};
	active = sample;
	const started = performance.now();
	try {
		return await call();
	} catch (error) {
		sample.error = error.message;
		throw error;
	} finally {
		active = undefined;
		sample.elapsed_ms = performance.now() - started;
		result.samples.push(sample);
	}
};
const spawned = ({ process: child }) => {
	if (!active) return;
	const event = { kind: "unknown", started: false, pid: null };
	active.directChildren.push(event);
	child.once("spawn", () => {
		const args = child.spawnargs ?? [];
		event.kind = args.some((a) => /playwright.*cli|cli.*playwright/.test(a))
			? "playwright-cli"
			: args.some((a) => /chrome|chromium/i.test(a))
				? "browser"
				: "other";
		event.started = true;
		event.pid = child.pid;
	});
};
let running, task, hostApi;
subscribe("child_process", spawned);
try {
	await measure("instrumentation-control", 0, () => fs.readFile(join(root, "browser-v4-delivery.json")));
	assert.equal(
		Object.values(result.samples.pop().files.readFile).reduce((a, b) => a + b, 0),
		1,
	);
	await measure("trusted-design-gate", 0, () =>
		new native.DesignReviewService(root, authority).gate(revision.assetRef, plan.review_ref),
	);
	const diagnostic = await measure("current-diagnostic-status", 0, () =>
		new native.RuntimeAdmissionService(root, authority).status("u05-native-diagnostic-1"),
	);
	assert.equal(diagnostic.runtime_ready, true);
	const id = "u00-approved-" + Date.now();
	task = await measure("execute-task-start", 0, () =>
		workflow.start({ task_id: id, mode: "execute", asset_ref: revision.assetRef }),
	);
	assert.equal(task.task.data.state, "running");
	const { startProbeServers } = await import(
		pathToFileURL(join(root, dirname(revision.assetRef.path), "ui-probe-replay.mjs")).href
	);
	running = await startProbeServers(revision.deployments);
	const spec = JSON.parse(await fs.readFile(join(root, revision.diagnosticSpecRef.path), "utf8"));
	const runner = new native.UiRunService(root, authority);
	const request = {
		task_id: id,
		request_id: id,
		asset_ref: revision.assetRef,
		review_ref: plan.review_ref,
		environment_ref: spec.environment_ref,
		config_ref: spec.config_ref,
		timeout_ms: 120000,
	};
	try {
		if (observeChildren) {
			const { observePlaywrightApi } = await import(pathToFileURL(observer).href);
			hostApi = observePlaywrightApi(root);
			process.env.NODE_OPTIONS = `--import=${pathToFileURL(observer).href}`;
			process.env.PI_UI_BASELINE_OBSERVER_DIR = childDirectory;
		}
		result.execution = await measure("existing-asset-to-run-terminal", 0, () => runner.start(request));
	} finally {
		if (observeChildren) {
			hostApi?.stop();
			result.hostPlaywrightApi = { version: hostApi?.version, calls: hostApi?.calls };
			delete process.env.NODE_OPTIONS;
			delete process.env.PI_UI_BASELINE_OBSERVER_DIR;
		}
	}
	if (observeChildren) {
		result.childProcesses = await Promise.all(
			(await fs.readdir(childDirectory)).map(async (name) =>
				JSON.parse(await fs.readFile(join(childDirectory, name), "utf8")),
			),
		);
		const ids = new Set(result.childProcesses.map((p) => p.pid));
		const nodeChildren = result.childProcesses.flatMap((p) => p.children).filter((p) => p.kind === "node" && p.started);
		assert.ok(result.childProcesses.length > 0, "Runner preload must emit real counters");
		const cliProcesses = result.samples.at(-1).directChildren.filter((p) => p.kind === "playwright-cli" && p.started);
		assert.ok(
			cliProcesses.length > 0 && cliProcesses.every((p) => ids.has(p.pid)),
			"The observed top-level runner must emit its final counters",
		);
		assert.ok(
			nodeChildren.every((p) => ids.has(p.pid)),
			"Every observed Node worker must emit final counters; absent processes are unknown, never zero",
		);
		result.nestedBrowserStarts = result.childProcesses
			.flatMap((p) => p.children)
			.filter((p) => p.kind === "browser" && p.started).length;
		assert.ok(result.nestedBrowserStarts > 0, "Actual nested browser launch must be observed");
	}
	assert.equal(result.execution.run.data.state, "finished");
	result.results = await measure("formal-reconcile", 0, () =>
		native.collectResults(root, result.execution.run_ref, id),
	);
	assert.equal(result.results.data.counts.passed, 6);
	assert.equal(result.results.details.assertion_reached_attempt_count, 13);
	assert.equal(result.results.details.complete, true);
	const readback = await measure("same-request-status", 0, () => runner.status(id, id));
	assert.deepEqual(readback.run_ref, result.execution.run_ref);
	assert.equal(readback.replayed, true);
	assert.equal(result.samples.at(-1).directChildren.length, 0);
	await running.close();
	running = undefined;
	// The benchmark's terminal is the run, not independently approved report delivery.
	// Retain the execution task and its real next stage; no completion or approval is fabricated.
	task = await workflow.find(id);
	result.task = await workflow.block(task.task_ref, [
		"U00 regression measurement ended at native run terminal. New report analysis/review/delivery not performed; original approved report remains unchanged.",
	]);
	const view = await workflow.start({ task_id: id + "-view", mode: "view", run_ref: plan.original_run_ref });
	const immutable = [plan.original_run_ref, plan.report_ref, delivered.review_ref, delivered.delivery_ref];
	const hashes = await Promise.all(
		immutable.map(async (ref) => native.sha256(await fs.readFile(join(root, ref.path)))),
	);
	for (let round = 0; round < 6; round++) {
		const state = await measure("view-status", round, () => workflow.status(view.task_ref));
		assert.equal(state.next_skill, null);
		assert.equal(result.samples.at(-1).directChildren.length, 0);
		const checked = await measure("old-report-reconciliation", round, () => native.checkReport(root, plan.report_ref));
		assert.deepEqual(checked.check.issues, []);
		assert.equal(result.samples.at(-1).directChildren.length, 0);
	}
	for (let i = 0; i < immutable.length; i++)
		assert.equal(native.sha256(await fs.readFile(join(root, immutable[i].path))), hashes[i]);
	result.immutable_refs = immutable;
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	active = undefined;
	unsubscribe("child_process", spawned);
	Object.assign(fs, original);
	syncBuiltinESMExports();
	await running?.close();
	await fs.writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(
		JSON.stringify(
			{
				status: result.status,
				evidence: output,
				error: result.error,
				operations: result.samples.map((s) => ({
					operation: s.operation,
					round: s.round,
					elapsed_ms: s.elapsed_ms,
					host_reads: Object.values(s.files.readFile).reduce((a, b) => a + b, 0),
					host_scans: Object.values(s.files.readdir).reduce((a, b) => a + b, 0),
					directChildren: s.directChildren.length,
				})),
			},
			null,
			2,
		),
	);
}
