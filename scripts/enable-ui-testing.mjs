/** Register existing package resources for this project without changing personal settings. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export async function enableUiTesting(root) {
	const directory = join(root, ".pi");
	const path = join(directory, "settings.json");
	let settings = {};
	try {
		settings = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const resources = {
		packages: "../node_modules/pi-ui-testing",
		extensions: "../capabilities/ui-testing/mcp-extension.mjs",
	};
	for (const [field, resource] of Object.entries(resources)) {
		const entries = settings[field] ?? [];
		if (!Array.isArray(entries)) throw new Error(`Invalid ${field} in ${path}`);
		if (!entries.some((entry) => (typeof entry === "string" ? entry : entry.source) === resource)) {
			settings[field] = [...entries, resource];
		}
	}
	await mkdir(directory, { recursive: true });
	await writeFile(path, JSON.stringify(settings, null, "\t") + "\n");
	return path;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	console.log(await enableUiTesting(fileURLToPath(new URL("..", import.meta.url))));
}
