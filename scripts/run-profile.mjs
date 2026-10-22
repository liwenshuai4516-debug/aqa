#!/usr/bin/env node
/** Run a local optional tool without npx downloads or changing the application's cwd. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const [profile, tool, ...args] = process.argv.slice(2);
const allowed = { desktop: ["electron", "electron-builder"], e2e: ["playwright"] };
if (!allowed[profile]?.includes(tool)) throw new Error("Unsupported profile/tool");
const directory = profile === "desktop" ? "desktop" : "tools/e2e";
const packageRoot = join(root, directory, "node_modules", tool);
let pkg;
try {
	pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
} catch {
	throw new Error(`Optional tools missing. Run npm run install:${profile}`);
}
if (tool === "electron-builder") {
	// Builder still packages the root app and its production dependencies.
	const electron = JSON.parse(readFileSync(join(root, "desktop/node_modules/electron/package.json"), "utf8"));
	args.push(
		`--config.electronVersion=${electron.version}`,
		`--config.electronDist=${join(root, "desktop/node_modules/electron/dist")}`,
	);
}
const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin[tool];
const child = spawnSync(process.execPath, [join(packageRoot, bin), ...args], {
	cwd: root,
	stdio: "inherit",
	env: process.env,
});
if (child.error) throw child.error;
process.exitCode = child.status ?? 1;
