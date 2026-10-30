/** Register original resources in the project or an explicitly selected Pi agent directory. */
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizeExtension(entries, directory, resource, aliases) {
	const isRegistration = (entry) => {
		const source = typeof entry === "string" ? entry : entry?.source;
		return (
			typeof source === "string" &&
			[resource, ...aliases].some((path) => resolve(directory, source) === resolve(directory, path))
		);
	};
	const index = entries.findIndex(isRegistration);
	const filtered = entries.find((entry) => typeof entry === "object" && isRegistration(entry));
	const result = entries.filter((entry) => !isRegistration(entry));
	result.splice(index < 0 ? entries.length : index, 0, filtered ? { ...filtered, source: resource } : resource);
	return result;
}

export async function enableUiTesting(root, agentDir) {
	root = resolve(root);
	const directory = agentDir ? resolve(agentDir) : join(root, ".pi");
	const path = join(directory, "settings.json");
	let settings = {};
	try {
		settings = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const resources = {
		packages: agentDir ? join(root, "node_modules/pi-ui-testing") : "../node_modules/pi-ui-testing",
		extensions: agentDir
			? join(root, ".pi/skills/ui-testing-workflow/assets/mcp-extension.mjs")
			: "../.pi/skills/ui-testing-workflow/assets/mcp-extension.mjs",
		skills: agentDir ? join(root, ".pi/skills/ui-testing-workflow") : "./skills/ui-testing-workflow",
	};
	for (const [field, resource] of Object.entries(resources)) {
		const entries = settings[field] ?? [];
		if (!Array.isArray(entries)) throw new Error(`Invalid ${field} in ${path}`);
		const legacy = {
			extensions: agentDir
				? join(root, "capabilities/ui-testing/mcp-extension.mjs")
				: "../capabilities/ui-testing/mcp-extension.mjs",
			skills: agentDir
				? join(root, "capabilities/ui-testing/ui-testing-workflow")
				: "../capabilities/ui-testing/ui-testing-workflow",
		};
		if (field === "extensions") {
			settings[field] = normalizeExtension(entries, directory, resource, [legacy.extensions]);
			continue;
		}
		if (
			!entries.some((entry) => {
				const source = typeof entry === "string" ? entry : entry.source;
				return source === resource || source === legacy[field];
			})
		) {
			settings[field] = [...entries, resource];
		}
	}
	const logicalRuntime = join(root, "node_modules/pi-ui-testing/dist/extension.js");
	try {
		// Pin the physical entry so SDK/Jiti cannot fall back to the symlink's root dependencies.
		const runtime = await realpath(logicalRuntime);
		settings.extensions = normalizeExtension(
			settings.extensions,
			directory,
			agentDir ? runtime : relative(directory, runtime),
			[logicalRuntime],
		);
		const host = join(root, ".pi/skills/ui-testing-workflow/assets/review-budget-host.mjs");
		// Use a separate extension identity so reload does not reuse the canonical MCP module's cached hooks.
		await realpath(host);
		settings.extensions = normalizeExtension(
			settings.extensions,
			directory,
			agentDir ? host : relative(directory, host),
			[],
		);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	await mkdir(directory, { recursive: true });
	await writeFile(path, JSON.stringify(settings, null, "\t") + "\n");
	return path;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	if (args.length && (args.length !== 2 || args[0] !== "--agent-dir")) {
		throw new Error("Usage: enable-ui-testing.mjs [--agent-dir <Pi agent directory>]");
	}
	console.log(await enableUiTesting(fileURLToPath(new URL("..", import.meta.url)), args[1]));
}
