/** Isolated 75-case intake through the original channel; no network, model or business tests. */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutomation } from "../../../plugins/data-space/automation.mjs";
import { createEvaluationInterface } from "../../../plugins/data-space/evaluation.mjs";
import { normalizeStore } from "../../../plugins/data-space/model.mjs";
export async function dataSpaceFixture() {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "evaluation-data-space-")));
	let state = normalizeStore({
			revision: 1,
			systems: [
				{ id: "p1", name: "EC09 isolated project" },
				{ id: "p2", name: "Other project" },
			],
			modules: [],
			features: [],
			cases: [],
			envs: [{ id: "e1", systemId: "p1", name: "test", baseUrl: "http://localhost:18999" }],
		}),
		runs = { revision: 1, runs: [] };
	const asset = {
		engine: "ui",
		workspace: directory,
		assetRef: { path: "qa/ui/cases/ec09/manifest.json", sha256: "a".repeat(64) },
		revision: "batch-v1",
		environment: { id: "test", baseUrl: "http://localhost:18999" },
		cases: Array.from({ length: 75 }, (_, i) => ({
			id: `N${i + 1}`,
			title: `EC09 isolated ${i + 1}`,
			priority: i < 28 ? "P0" : "P1",
			steps: [{ action: "Read isolated value", expect: "Expected isolated value" }],
		})),
	};
	const host = {
		dataDir: directory,
		testing: {
			inspect: async () => structuredClone(asset),
			list: async () => [],
			read: async () => ({
				...asset,
				runId: "r1",
				rows: asset.cases.map((c) => ({ caseId: c.id, status: "passed", evidenceComplete: true })),
				evidence: [],
				complete: true,
			}),
		},
		onToolEvent: () => () => {},
		broadcast: () => {},
		log: () => {},
	};
	state.revision = 1;
	let commits = 0;
	const automation = createAutomation({
		host,
		store: () => state,
		runs: () => runs,
		commitStore: (s) => {
			state = s;
			commits++;
		},
		commitRuns: (r) => {
			runs = r;
			commits++;
		},
	});
	await automation.idle();
	await automation.call(directory, { action: "initialize", engine: "ui", envId: "e1" });
	let provider = createEvaluationInterface({ host, store: () => state, automation });
	const binding = { principalId: "fixture", workspaceId: "workspace", workspace: directory };
	/** @returns {Promise<any>} */
	const call = (q) => provider(q, binding, () => {});
	const describe = await call({ action: "describe" }),
		project = describe.projects[0],
		environment = project.environments[0];
	const query = {
		projectRef: project.projectRef,
		environmentRef: { environmentId: environment.environmentId, revision: environment.revision },
		engine: "ui",
		assetRef: asset.assetRef,
	};
	return {
		directory,
		host,
		asset,
		binding,
		query,
		call,
		automation,
		state: () => state,
		runs: () => runs,
		commits: () => commits,
		intake: () => automation.call(directory, { action: "import", engine: "ui", assetRef: asset.assetRef, envId: "e1" }),
		observe: () => call({ ...query, action: "observe" }),
		restart: () => {
			provider = createEvaluationInterface({ host, store: () => state, automation });
		},
		cleanup: () => {
			automation.dispose();
			rmSync(directory, { recursive: true, force: true });
		},
	};
}
