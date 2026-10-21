/** Real SDK discovery and host skill loading in an isolated project; no model calls. */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { makeSkillTool, SKILL_TOOL_FILE_CAP } from "../server/skill-tool.ts";

const repo = fileURLToPath(new URL("..", import.meta.url));
const output = mkdtempSync(join(tmpdir(), "api-testing-p1-4-"));
const project = join(output, "project"),
	agentDir = join(output, "empty-agent");
mkdirSync(project);
mkdirSync(agentDir);
const source = join(repo, "plugins/api-testing/skills");
const expected = ["api-test-analyze", "api-test-review", "api-test-workflow"];
const checks = [];
const before = loadSkills({ cwd: project, agentDir, skillPaths: [], includeDefaults: true });
assert.equal(before.skills.length, 0);
checks.push({ name: "isolated-project-has-no-personal-skills", status: "passed" });
cpSync(source, join(project, ".pi/skills"), { recursive: true, force: false, errorOnExist: true });
const loaded = loadSkills({ cwd: project, agentDir, skillPaths: [], includeDefaults: true });
assert.deepEqual(loaded.diagnostics, []);
assert.deepEqual(loaded.skills.map((s) => s.name).sort(), expected);
checks.push({ name: "distributed-package-discovered-by-real-sdk-project-loader", status: "passed" });
const tool = makeSkillTool({ listSkills: () => loaded.skills });
for (const skill of loaded.skills) {
	const original = readFileSync(join(source, skill.name, "SKILL.md"), "utf8");
	assert.equal(readFileSync(skill.filePath, "utf8"), original);
	assert(Buffer.byteLength(original) <= SKILL_TOOL_FILE_CAP);
	const result = await tool.execute("test", { name: skill.name });
	const text = result.content.find((x) => x.type === "text").text;
	assert(text.includes(`<skill name="${skill.name}"`));
	assert(text.includes(original.trim()));
}
checks.push({ name: "all-three-load-through-real-host-tool-without-truncation", status: "passed" });
const filtered = makeSkillTool({ listSkills: () => loaded.skills.filter((s) => s.name !== "api-test-review") });
const unavailable = await filtered.execute("test", { name: "api-test-review" });
assert(!unavailable.content[0].text.includes('<skill name="api-test-review"'));
checks.push({ name: "disabled-skill-body-not-exposed", status: "passed" });
const explicit = loadSkills({ cwd: project, agentDir, skillPaths: [source], includeDefaults: false });
assert.deepEqual(explicit.diagnostics, []);
assert.deepEqual(explicit.skills.map((s) => s.name).sort(), expected);
checks.push({ name: "explicit-package-path-also-discoverable", status: "passed" });
const summary = {
	task: "P1-4",
	status: "skills-discovery-passed",
	checks,
	environment: "isolated project and empty agentDir; actual SDK and host tool",
	actualModelCalls: 0,
	businessRequests: 0,
	modelAcceptance: "Not exercised by this discovery test; see api-testing-model-test.mjs",
	skills: loaded.skills.map(({ name, filePath }) => ({ name, bytes: Buffer.byteLength(readFileSync(filePath)) })),
};
writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, evidence: join(output, "summary.json") }, null, 2));
