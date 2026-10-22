#!/usr/bin/env node
/** Deterministic tracked-size budgets; local generated data is reported separately. */
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(readFileSync(join(root, "project-budget.json"), "utf8"));
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const treeBytes = (path) => {
	if (!existsSync(path)) return 0;
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) return 0;
	return stat.isDirectory() ? readdirSync(path).reduce((sum, name) => sum + treeBytes(join(path, name)), 0) : stat.size;
};
const report = { tracked: {}, local: {}, checks: [] };
for (const [prefix, limit] of Object.entries(config.trackedBytes)) {
	const bytes = files
		.filter((p) => p === prefix || p.startsWith(prefix + "/"))
		.reduce((sum, p) => sum + (existsSync(join(root, p)) ? lstatSync(join(root, p)).size : 0), 0);
	report.tracked[prefix] = bytes;
	report.checks.push({ name: prefix, bytes, limit, passed: bytes <= limit });
}
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
report.rootLockedPackages = Object.keys(lock.packages).length - 1;
report.checks.push({
	name: "rootLockedPackages",
	count: report.rootLockedPackages,
	limit: config.rootLockedPackages,
	passed: report.rootLockedPackages <= config.rootLockedPackages,
});
// CI uses --check: no filesystem-dependent limits or expensive node_modules walk.
if (!process.argv.includes("--check"))
	for (const path of config.localPaths) report.local[path] = treeBytes(join(root, path));
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--check") && report.checks.some((c) => !c.passed)) process.exitCode = 1;
