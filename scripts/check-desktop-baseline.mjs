import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, "docs/desktop-delivery");
const manifest = JSON.parse(readFileSync(join(directory, "source-manifest.json"), "utf8"));
const supplement = JSON.parse(readFileSync(join(directory, "supplemental-manifest.json"), "utf8"));
const protectedRoots = ["server/", "web/src/", "web/public/", "themes/", "plugins/", "plugin-sdk/", "extensions/"];
const sourceMode = process.argv.includes("--source");
const target = sourceMode ? manifest.sourceRoot : root;
const known = new Set([...manifest.files, ...supplement].map((file) => file.path));
const changes = [];
for (const file of [...manifest.files, ...supplement]) {
	if (!sourceMode && !protectedRoots.some((prefix) => file.path.startsWith(prefix))) continue;
	try {
		const contents = readFileSync(resolve(target, file.path));
		if (createHash("sha256").update(contents).digest("hex") !== file.sha256)
			changes.push({ path: file.path, status: "MODIFIED" });
	} catch {
		changes.push({ path: file.path, status: "MISSING" });
	}
}
function scan(directory, relative = "") {
	for (const name of readdirSync(directory)) {
		if (manifest.excludedDirectoryNames.includes(name)) continue;
		const path = join(directory, name);
		const key = relative + name;
		if (statSync(path).isDirectory()) scan(path, key + "/");
		else if (!known.has(key)) changes.push({ path: key, status: "ADDED" });
	}
}
if (!sourceMode) for (const prefix of protectedRoots) scan(join(target, prefix), prefix);
console.log(JSON.stringify({ status: changes.length ? "FAIL" : "PASS", target, changes }, null, 2));
process.exitCode = changes.length ? 1 : 0;
