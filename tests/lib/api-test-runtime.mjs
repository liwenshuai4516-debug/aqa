/** Shared immutable dependencies; each test gets its own mutable module snapshot. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function apiTestRuntime() {
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const source = join(root, "plugins/api-testing");
	if (!existsSync(join(source, "node_modules/newman/package.json")))
		throw new Error("Shared API test dependencies missing. Run npm run install:api-tests");
	const dependencies = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).dependencies;
	for (const [name, version] of Object.entries(dependencies)) {
		const installed = JSON.parse(readFileSync(join(source, "node_modules", name, "package.json"), "utf8"));
		if (installed.version !== version)
			throw new Error(`API test dependency mismatch: ${name}; run npm run install:api-tests`);
	}
	const parent = join(root, "tests/scratch/api-testing-shared");
	mkdirSync(parent, { recursive: true });
	const runtime = mkdtempSync(join(parent, "run-"));
	for (const file of ["package.json", "package-lock.json"]) cpSync(join(source, file), join(runtime, file));
	symlinkSync(
		join(source, "node_modules"),
		join(runtime, "node_modules"),
		process.platform === "win32" ? "junction" : "dir",
	);
	return runtime;
}
