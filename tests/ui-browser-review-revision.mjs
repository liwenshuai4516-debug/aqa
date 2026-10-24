/** Apply the two independently reported U05 issues as a new immutable candidate; no browser/model. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ArtifactStore, assetDigest, checkDesign, UiWorkflowService, capabilities } from "pi-ui-testing";
import { readdir } from "node:fs/promises";
const directory = resolve(process.argv[2]);
const store = new ArtifactStore(directory);
const prepared = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));
const response = JSON.parse(await readFile(join(directory, "native-review-7-authorization3.json"), "utf8"));
const reviewed = JSON.parse(response.tool.content.find((c) => c.type === "text").text).output;
const review = await store.load(reviewed.review_ref);
assert.equal(review.data.decision, "revise");
assert.deepEqual(review.data.issues.map((i) => i.id).sort(), [
	"cancel-memory-write-undetected",
	"per-test-origin-not-implemented",
]);
const old = await store.load(prepared.assetRef);
const base = "qa/ui/assets/u05-browser-candidate/revisions/v2";
let code = await readFile(join(directory, old.data.bindings[0].script_ref.path), "utf8");
code = code.replace(
	'import { test, expect } from "playwright/test";',
	'import { expect } from "playwright/test";\nimport { test } from "./origin.fixture.ts";',
);
const before = '\t\tawait expect(page.getByRole("dialog")).toBeHidden();\n\t\tawait page.reload();';
assert.ok(code.includes(before));
code = code.replace(
	before,
	'\t\tawait expect(page.getByRole("dialog")).toBeHidden();\n\t\t// Check current in-memory results before reload can discard an incorrect write.\n\t\tawait page.getByLabel("Query", { exact: true }).fill(ownedName);\n\t\tawait page.getByRole("button", { name: "Search", exact: true }).click();\n\t\tawait expect(page.getByRole("status")).toHaveText("Empty");\n\t\tawait expect(page.getByRole("listitem")).toHaveCount(0);\n\t\tawait page.reload();',
);
const stableFixture = `import { test as base } from "playwright/test";
import { createServer } from "node:http";
// Copy this authorized synthetic deployment's HTML, including any diagnostic mutation.
// Each test owns a new listening origin; fresh browser contexts provide separate storage too.
const usedPorts = new Set<number>();
export const test = base.extend({
 baseURL: async ({ baseURL }, use) => {
  if (!baseURL) throw new Error("Explicit synthetic source baseURL is required");
  const source = new URL(baseURL);
  if (source.protocol !== "http:" || source.hostname !== "127.0.0.1")
   throw new Error("Only the authorized loopback synthetic source is supported");
  const response = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Synthetic source is unavailable");
  const html = await response.text();
  const server = createServer((_request, reply) => {
   reply.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
   reply.end(html);
  });
  do {
  await new Promise<void>((ready, reject) => {
   server.once("error", reject);
   server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); ready(); });
  });
  const address=server.address();
  if (!address || typeof address === "string") throw new Error("No owned loopback origin");
  if (usedPorts.has(address.port)) { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); continue; }
  usedPorts.add(address.port);
  break;
  } while (true);
  const address=server.address();
  if (!address || typeof address === "string") throw new Error("No owned loopback origin");
  try { await use("http://127.0.0.1:" + address.port); }
  finally {
   server.closeAllConnections();
   await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  }
 }
});
`;
const script = await store.putFile(base + "/candidate.spec.ts", code);
const fixtureRef = await store.putFile(base + "/origin.fixture.ts", stableFixture);
const helper = old.data.files.find((f) => f.path.endsWith("/u05-replay-inputs.ts"));
const helperRef = await store.putFile(base + "/u05-replay-inputs.ts", await readFile(join(directory, helper.path)));
const rulesOld = old.data.files.find((f) => f.path.endsWith("/data-rules.json"));
const rules = JSON.parse(await readFile(join(directory, rulesOld.path), "utf8"));
rules.originImplementation =
	"origin.fixture.ts copies only the configured loopback synthetic HTML to a separately owned, per-test server; reused worker ports are rejected, own server closes in finally. No source service mutation or external business requests.";
const rulesRef = await store.putFile(base + "/data-rules.json", JSON.stringify(rules, null, 2));
const cases = structuredClone(await store.load(old.data.cases_ref));
cases.id = "u05-browser-candidate-v2";
cases.created_at = new Date().toISOString();
cases.data.data_rules_ref = rulesRef;
const casesRef = await store.put(cases);
const lineage = await store.putFile(
	base + "/lineage.json",
	JSON.stringify(
		{
			prior_asset_ref: prepared.assetRef,
			independent_review_ref: reviewed.review_ref,
			issues: review.data.issues,
			scope:
				"Same frozen six cases and thirteen assertions; add pre-reload cancel check and implement promised independent test origins. No review budget reset, no approval or execution.",
		},
		null,
		2,
	),
);
const asset = structuredClone(old);
asset.created_at = new Date().toISOString();
asset.data.revision = "v2";
asset.data.cases_ref = casesRef;
asset.data.files = [
	script,
	fixtureRef,
	helperRef,
	rulesRef,
	lineage,
	...old.data.files.filter((f) => !f.path.includes("/revisions/v1/")),
];
asset.data.bindings = asset.data.bindings.map((b) => ({ ...b, script_ref: script }));
asset.data.content_sha256 = assetDigest(asset);
const assetRef = await store.put(asset);
const checked = await checkDesign(directory, assetRef);
const result = {
	status: checked.issues.length ? "FAIL" : "PASS",
	assetRef,
	priorAssetRef: prepared.assetRef,
	reviewRef: reviewed.review_ref,
	staticCheck: checked,
	modelCalls: 0,
	browserStarts: 0,
	formalRunnerCalls: 0,
	reviewStatus:
		"NOT REVIEWED: original task native three-round loop exhausted; additional global authorization does not alter frozen scope",
};
await writeFile(join(directory, "review-revision-v2.json"), JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
assert.deepEqual(checked.issues, []);
const workflow = new UiWorkflowService(directory, join(directory, "ui-review-authority"), {
	tools: ["read", ...capabilities.map((c) => c.tool)],
	skills: await readdir("node_modules/pi-ui-testing/skills"),
});
const task = await workflow.find("u05-tester");
const blocked = await workflow.block(task.task_ref, [
	"Independent gpt/gpt-6.1-sol review returned revise (D4,D8). New immutable v2 fixes saved and statically checked, not re-reviewed; frozen native scope review loop exhausted. Diagnostics/formal execution remain unexecuted.",
]);
await writeFile(join(directory, "gpt-review-blocked-task.json"), JSON.stringify(blocked, null, 2), { flag: "wx" });
