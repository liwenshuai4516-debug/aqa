/** Five alternating native-version pairs; mechanical query costs only, no browser/model. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, cpus, loadavg, platform } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sha256 } from "pi-ui-testing";

const execute = promisify(execFile);
const repo = fileURLToPath(new URL("..", import.meta.url));
const output = join(repo, "tests/scratch/ui-catalog-paired", String(Date.now()));
await mkdir(output, { recursive: true });
const history = JSON.parse(
	await readFile(join(repo, "docs/ui-testing-evidence/optimization-u04-history.json"), "utf8"),
);
const beforeEvidence = JSON.parse(
	await readFile(join(repo, "docs/ui-testing-evidence/optimization-u02-private-capture.json"), "utf8"),
);
const installedEntry = import.meta.resolve("pi-ui-testing");
const installedPackage = JSON.parse(await readFile(new URL("../package.json", installedEntry), "utf8"));
const afterPackage = `.pi/skills/ui-testing-workflow/assets/pi-ui-testing-${installedPackage.version}.tgz`;
const afterBytes = await readFile(join(repo, afterPackage));
const baselineCommit = "210280602e50f52f5b35ef04d9c711755b7ab3c0";
const packagePath = ".pi/skills/ui-testing-workflow/assets/pi-ui-testing-0.1.3.tgz";
const packageBytes = (
	await execute("git", ["show", `${baselineCommit}:${packagePath}`], {
		cwd: repo,
		encoding: "buffer",
		maxBuffer: 8 * 1024 * 1024,
	})
).stdout;
assert.equal(sha256(packageBytes), beforeEvidence.package_sha256);
const packedEntry = (
	await execute("tar", ["-xOf", join(repo, afterPackage), "package/dist/index.js"], { encoding: "buffer" })
).stdout;
const packedValidation = (
	await execute("tar", ["-xOf", join(repo, afterPackage), "package/dist/validation.js"], { encoding: "buffer" })
).stdout;
assert.equal(sha256(packedEntry), sha256(await readFile(new URL(installedEntry))));
assert.equal(sha256(packedValidation), sha256(await readFile(new URL("validation.js", installedEntry))));
const archive = join(output, "before.tgz"),
	before = join(output, "before");
await writeFile(archive, packageBytes);
await mkdir(before);
await execute("tar", ["-xzf", archive, "-C", before]);
const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};
const plan = {
	schema_version: "1.0",
	scope: "U04 single-request reference-read deduplication; archived genuine runs, no valid private approval authority",
	started_at: new Date().toISOString(),
	pairs: 5,
	order: Array.from({ length: 5 }, (_, i) => (i % 2 ? ["after", "before"] : ["before", "after"])),
	versions: {
		before: { version: "0.1.3", commit: baselineCommit, package_sha256: sha256(packageBytes) },
		after: {
			version: installedPackage.version,
			package_path: afterPackage,
			package_sha256: sha256(afterBytes),
			entry_sha256: sha256(packedEntry),
			validation_sha256: sha256(packedValidation),
		},
	},
	source_archive_sha256: history.evidence.archive_sha256,
	harness_sha256: sha256(await readFile(join(repo, "tests/ui-catalog-read-benchmark.mjs"))),
	environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
	measurement:
		"Each fresh Node worker prepares the same one/eight-run corpus, then measures catalog/view/analyze/execute status once plus five repeats. First measured query is already setup-warmed, not cold OS/desktop startup. No overlapping workers.",
	acceptance:
		"Preserve original run/task bytes and readiness rejection; same script reads 16 to 2 for catalog/execute status, all scans unchanged. Report all timings including regressions; do not assert a speed threshold or claim full-workflow 20% improvement.",
};
await writeFile(join(output, "plan.json"), JSON.stringify(plan, null, 2), { flag: "wx" });
const result = {
	status: "FAIL",
	plan,
	workers: [],
	comparisons: [],
	modelCalls: 0,
	browserStarts: 0,
	formalRunnerCalls: 0,
};
try {
	for (let pair = 0; pair < plan.pairs; pair++)
		for (const version of plan.order[pair]) {
			const args = [
				join(repo, "tests/ui-catalog-read-benchmark.mjs"),
				...(version === "before" ? ["--runtime", join(before, "package")] : []),
			];
			const started = Date.now(),
				load = loadavg();
			const worker = await execute(process.execPath, args, { cwd: repo, maxBuffer: 16 * 1024 * 1024, timeout: 60000 });
			await writeFile(join(output, `pair-${pair + 1}-${version}.stdout.json`), worker.stdout);
			await writeFile(join(output, `pair-${pair + 1}-${version}.stderr.log`), worker.stderr);
			const data = JSON.parse(worker.stdout);
			assert.equal(data.status, "PASS");
			assert.equal(data.nativeVersion, plan.versions[version].version);
			if (version === "after") {
				assert.equal(data.nativeEntrySha256, plan.versions.after.entry_sha256);
				assert.equal(data.validationSha256, plan.versions.after.validation_sha256);
			}
			assert.equal(data.samples.length, 48);
			assert.equal(data.sourceArchive.archive_sha256, plan.source_archive_sha256);
			assert.equal(data.modelCalls + data.browserStarts + data.formalRunnerCalls, 0);
			if (result.workers.length) assert.deepEqual(data.historicalRuns, result.workers[0].data.historicalRuns);
			result.workers.push({
				pair: pair + 1,
				version,
				elapsed_ms: Date.now() - started,
				load_average_before: load,
				data,
			});
			await writeFile(join(output, "progress.json"), JSON.stringify(result, null, 2));
			console.log(`pair ${pair + 1}/5 ${version}: PASS (${Date.now() - started}ms)`);
		}
	for (const size of [1, 8])
		for (const operation of ["catalog", "status-view", "status-analyze", "status-execute"]) {
			const pairs = [];
			for (let pair = 1; pair <= 5; pair++) {
				const versions = {};
				for (const version of ["before", "after"]) {
					const worker = result.workers.find((w) => w.pair === pair && w.version === version);
					const samples = worker.data.samples.filter((s) => s.historySize === size && s.operation === operation);
					const count = (s) => Object.values(s.reads).reduce((a, b) => a + b, 0);
					versions[version] = {
						first_measured_ms: samples[0].elapsedMs,
						repeated_median_ms: median(samples.slice(1).map((s) => s.elapsedMs)),
						repeated_max_ms: Math.max(...samples.slice(1).map((s) => s.elapsedMs)),
						read_calls: samples.map(count),
						directory_calls: samples.map((s) => Object.values(s.directories).reduce((a, b) => a + b, 0)),
						script_reads: samples.map((s) =>
							Object.entries(s.reads)
								.filter(([p]) => p === "qa/ui/assets/names/revisions/v1/name.spec.ts")
								.reduce((n, [, c]) => n + c, 0),
						),
					};
				}
				assert.deepEqual(versions.after.directory_calls, versions.before.directory_calls);
				if (["catalog", "status-execute"].includes(operation)) {
					assert.deepEqual(versions.before.script_reads, Array(6).fill(16));
					assert.deepEqual(versions.after.script_reads, Array(6).fill(2));
					assert.deepEqual(
						versions.after.read_calls,
						versions.before.read_calls.map((n) => n - 16),
					);
				} else assert.deepEqual(versions.after.read_calls, versions.before.read_calls);
				pairs.push({
					pair,
					...versions,
					change_percent: (versions.after.repeated_median_ms / versions.before.repeated_median_ms - 1) * 100,
				});
			}
			result.comparisons.push({
				history_size: size,
				operation,
				pairs,
				before_median_ms: median(pairs.map((p) => p.before.repeated_median_ms)),
				after_median_ms: median(pairs.map((p) => p.after.repeated_median_ms)),
				median_pair_change_percent: median(pairs.map((p) => p.change_percent)),
				pair_change_range_percent: [
					Math.min(...pairs.map((p) => p.change_percent)),
					Math.max(...pairs.map((p) => p.change_percent)),
				],
				before_repeated_max_ms: Math.max(...pairs.map((p) => p.before.repeated_max_ms)),
				after_repeated_max_ms: Math.max(...pairs.map((p) => p.after.repeated_max_ms)),
			});
		}
	result.status = "PASS";
	result.limits = [
		"Mechanical queries only; archived control-review authority absent, all runtime readiness stays false.",
		"Fresh Node processes use warm filesystem/cache after setup; not cold startup or Electron acceptance.",
		"First measured queries and all five repeats retained; process-level repeated medians form five pairs, not 25 independent process pairs.",
		"Input parsing, extraction, process startup and corpus construction are outside per-query elapsed times and separately included in worker elapsed_ms.",
		"Instrumentation overhead is identical in both versions; no concurrent benchmark worker, machine background load is uncontrolled and recorded.",
		"A local query timing change does not prove complete Agent/workflow speed, model adherence or M1/M2 acceptance.",
	];
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	result.finished_at = new Date().toISOString();
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(
		JSON.stringify(
			{
				status: result.status,
				workers: result.workers.length,
				comparisons: result.comparisons,
				evidence: output,
				error: result.error,
			},
			null,
			2,
		),
	);
}
