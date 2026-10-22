/** Register API skills and the existing host plugin in explicit project/application directories. */
import { access, lstat, mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function enableApiTesting(root, { agentDir, dataDir } = {}) {
	if (!dataDir) throw new Error("An explicit host data directory is required (--data-dir)");
	root = resolve(root);
	const source = join(root, "plugins/api-testing");
	const runtime = createRequire(join(source, "package.json"));
	for (const name of [
		"@apidevtools/swagger-parser",
		"@modelcontextprotocol/sdk/package.json",
		"@postman/postman-mcp-server",
		"newman",
		"ajv",
		"zod",
	])
		runtime.resolve(name);
	const directory = agentDir ? resolve(agentDir) : join(root, ".pi");
	const settingsPath = join(directory, "settings.json");
	let settings = {};
	try {
		settings = JSON.parse(await readFile(settingsPath, "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (!settings || typeof settings !== "object" || Array.isArray(settings))
		throw new Error(`Invalid settings in ${settingsPath}`);
	const skills = settings.skills ?? [];
	if (!Array.isArray(skills)) throw new Error(`Invalid skills in ${settingsPath}`);
	const paths = ["api-test-workflow", "api-test-review", "api-test-analyze"].map((name) =>
		agentDir ? join(root, ".pi/skills", name) : `./skills/${name}`,
	);
	for (let i = 0; i < paths.length; i++) {
		await access(join(root, ".pi/skills", ["api-test-workflow", "api-test-review", "api-test-analyze"][i], "SKILL.md"));
		if (!skills.some((entry) => (typeof entry === "string" ? entry : entry.source) === paths[i])) skills.push(paths[i]);
	}
	settings.skills = skills;
	const pluginPath = join(resolve(dataDir), "plugins/api-testing");
	let existing;
	try {
		existing = await lstat(pluginPath);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (existing && (await realpath(pluginPath)) !== (await realpath(source)))
		throw new Error("Existing API plugin belongs to another installation; preserve it and resolve the conflict first");
	await mkdir(join(resolve(dataDir), "plugins"), { recursive: true });
	await mkdir(directory, { recursive: true });
	const temporary = join(directory, `.api-testing-settings-${randomUUID()}.tmp`);
	let linked = false;
	try {
		if (!existing) {
			await symlink(source, pluginPath, process.platform === "win32" ? "junction" : "dir");
			linked = true;
		}
		await writeFile(temporary, JSON.stringify(settings, null, "\t") + "\n", { mode: 0o600, flag: "wx" });
		await rename(temporary, settingsPath);
	} catch (error) {
		await rm(temporary, { force: true });
		if (linked) await rm(pluginPath, { force: true });
		throw error;
	}
	return { settingsPath, pluginPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2),
		options = {};
	for (let i = 0; i < args.length; i += 2) {
		if (!["--agent-dir", "--data-dir"].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith("--"))
			throw new Error(
				"Usage: enable-api-testing.mjs [--agent-dir <Pi agent directory>] --data-dir <host data directory>",
			);
		options[args[i] === "--agent-dir" ? "agentDir" : "dataDir"] = args[i + 1];
	}
	console.log(await enableApiTesting(fileURLToPath(new URL("..", import.meta.url)), options));
}
