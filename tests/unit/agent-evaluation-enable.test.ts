import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { enableAgentEvaluation } from "../../scripts/enable-agent-evaluation.mjs";
const paths: string[] = [];
afterEach(async () => {
	for (const p of paths.splice(0)) await rm(p, { recursive: true, force: true });
});
it("registers idempotently while preserving disabled choices and refusing another installation", async () => {
	const dir = await mkdtemp(join(tmpdir(), "evaluation-enable-"));
	paths.push(dir);
	const agentDir = join(dir, "agent"),
		dataDir = join(dir, "data");
	await mkdir(agentDir);
	await writeFile(
		join(agentDir, "settings.json"),
		JSON.stringify({ skills: ["/existing/skill"], disabledPlugins: ["agent-evaluation"], custom: { keep: true } }),
	);
	await expect(enableAgentEvaluation(resolve("."), { agentDir })).rejects.toThrow(/explicit/);
	const result = await enableAgentEvaluation(resolve("."), { agentDir, dataDir });
	const settings = await readFile(result.settingsPath, "utf8");
	await enableAgentEvaluation(resolve("."), { agentDir, dataDir });
	expect(await readFile(result.settingsPath, "utf8")).toBe(settings);
	expect(JSON.parse(settings)).toMatchObject({ disabledPlugins: ["agent-evaluation"], custom: { keep: true } });
	expect(await realpath(result.pluginPath)).toBe(await realpath("plugins/agent-evaluation"));
	await rm(result.pluginPath);
	await mkdir(result.pluginPath);
	await writeFile(join(result.pluginPath, "sentinel"), "keep");
	await expect(enableAgentEvaluation(resolve("."), { agentDir, dataDir })).rejects.toThrow(/another installation/);
	expect(await readFile(join(result.pluginPath, "sentinel"), "utf8")).toBe("keep");
	expect(await readFile(result.settingsPath, "utf8")).toBe(settings);
});
