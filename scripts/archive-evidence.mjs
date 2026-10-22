#!/usr/bin/env node
/** Copy a project evidence directory to an explicit external archive; keep originals. */
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
export function archiveEvidence(root, source, output) {
	root = realpathSync(root);
	source = realpathSync(source);
	output = join(realpathSync(dirname(resolve(output))), basename(resolve(output)));
	const inside = (parent, path) => path === parent || path.startsWith(parent + sep);
	if (!inside(root, source) || !["docs", "tests"].includes(relative(root, source).split(sep)[0]))
		throw new Error("Source must be a project docs/tests evidence directory");
	if (inside(root, output) || existsSync(output))
		throw new Error("Archive must be a new directory outside the repository");
	const files = [];
	const scan = (directory) => {
		for (const name of readdirSync(directory)) {
			const path = join(directory, name),
				stat = lstatSync(path);
			if (stat.isSymbolicLink() || name === "node_modules") throw new Error(`Not evidence: ${path}`);
			if (stat.isDirectory()) scan(path);
			else
				files.push({
					path: relative(source, path).split(sep).join("/"),
					bytes: stat.size,
					sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
				});
		}
	};
	scan(source);
	mkdirSync(output, { recursive: true });
	cpSync(source, join(output, "files"), { recursive: true, errorOnExist: true });
	for (const file of files) {
		const hash = createHash("sha256")
			.update(readFileSync(join(output, "files", file.path)))
			.digest("hex");
		if (hash !== file.sha256) throw new Error(`Archive verification failed: ${file.path}`);
	}
	const manifest = { schemaVersion: 1, source: relative(root, source).split(sep).join("/"), files };
	writeFileSync(join(output, "index.json"), JSON.stringify(manifest, null, 2) + "\n");
	return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [source, output] = process.argv.slice(2);
	if (!source || !output)
		throw new Error("Usage: node scripts/archive-evidence.mjs <project evidence directory> <new external directory>");
	const manifest = archiveEvidence(fileURLToPath(new URL("../", import.meta.url)), resolve(source), output);
	console.log(
		`Verified archive: ${manifest.files.length} files. Originals retained. Index: ${join(resolve(output), "index.json")}`,
	);
}
