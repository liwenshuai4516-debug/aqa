/** Verify actual project skill discovery and references without credentials, models or business requests. */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { makeSkillTool } from "../server/skill/skill-tool.ts";
import { discoverDiskSkills } from "../server/skill/skill-discovery.ts";

const repo = fileURLToPath(new URL("..", import.meta.url));
const output = mkdtempSync(join(tmpdir(), "capability-layout-"));
const project = join(output, "project"),
	agentDir = join(output, "empty-agent");
mkdirSync(project);
mkdirSync(agentDir);
cpSync(join(repo, ".pi/skills"), join(project, ".pi/skills"), { recursive: true });
cpSync(join(repo, "plugins/api-testing/skills"), join(project, "plugins/api-testing/skills"), { recursive: true });
symlinkSync(join(repo, "node_modules"), join(project, "node_modules"), "junction");
const expected = [
	"api-test-analyze",
	"api-test-review",
	"api-test-workflow",
	"data-space-testing",
	"ui-testing-workflow",
];
const checks = [];
const loaded = loadSkills({
	cwd: project,
	agentDir,
	includeDefaults: true,
	skillPaths: [join(project, "node_modules/pi-ui-testing/skills")],
});
assert.deepEqual(loaded.diagnostics, []);
assert.equal(loaded.skills.length, 13);
for (const name of expected) assert(loaded.skills.some((skill) => skill.name === name));
checks.push("real SDK discovers five project entry skills and eight original UI stages without conflicts");
const disk = discoverDiskSkills({ cwd: project, agentDir, includeHome: false });
assert.deepEqual(disk.map((skill) => skill.name).sort(), expected);
checks.push("host project directory discovery finds all five entry skills without personal skills");
const tool = makeSkillTool({ listSkills: () => loaded.skills });
for (const name of expected) {
	const result = await tool.execute("layout-check", { name });
	assert(result.content.some((block) => block.type === "text" && block.text.includes(`<skill name="${name}"`)));
	const skill = loaded.skills.find((entry) => entry.name === name);
	const body = readFileSync(skill.filePath, "utf8");
	for (const match of body.matchAll(/\]\((\.\.\/[^)]+SKILL\.md)\)/g)) {
		assert(
			existsSync(fileURLToPath(new URL(match[1], pathToFileURL(skill.filePath)))),
			`${name} missing source reference`,
		);
	}
}
checks.push("host skill tool loads each entry and its original implementation skill reference resolves");
const summary = {
	status: "passed",
	checks,
	skills: loaded.skills.map(({ name }) => name).sort(),
	actualModelCalls: 0,
	businessRequests: 0,
	output,
};
writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
