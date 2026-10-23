/** Narrow U04 mechanical baseline: real native artifacts, controlled reviews, no model/business calls. */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { realpath } from "node:fs/promises";
import { ready } from "./fixtures/data-space/ui-run-fixture.mjs";
import { TestAssetReader } from "../server/test-asset-reader.ts";
import { createAutomation } from "../plugins/data-space/automation.mjs";

const cleanup = [];
let automation;
try {
	const d = await ready({ after: (fn) => cleanup.push(fn) });
	const execution = await d.service.start(d.request);
	assert.equal(execution.run.data.state, "finished");
	const workspace = await realpath(d.f.root);
	const reader = new TestAssetReader(d.f.fixture.agentDir);
	const asset = await reader.inspect("ui", workspace, d.assetRef);
	let store = {
		revision: 1,
		systems: [{ id: "u04", name: "Synthetic" }],
		modules: [],
		features: [],
		cases: [],
		envs: [{ id: "u04-env", systemId: "u04", name: "isolated", baseUrl: asset.environment.baseUrl }],
	};
	let runs = { revision: 1, runs: [] };
	let reads = 0,
		readMs = 0;
	automation = createAutomation({
		host: {
			dataDir: d.f.fixture.agentDir,
			testing: {
				inspect: (...args) => reader.inspect(...args),
				list: async () => [],
				read: async (...args) => {
					reads++;
					const started = performance.now();
					try {
						return await reader.read(...args);
					} finally {
						readMs += performance.now() - started;
					}
				},
			},
			log() {},
			broadcast() {},
		},
		store: () => store,
		runs: () => runs,
		commitStore: (next) => {
			store = next;
		},
		commitRuns: (next) => {
			runs = next;
		},
	});
	await automation.idle();
	assert.equal(
		(
			await automation.call(workspace, {
				action: "initialize",
				engine: "ui",
				targetUrl: asset.environment.baseUrl,
			})
		).ok,
		true,
	);
	// 0.13.0 requires explicit archival consent and a separate binding before result sync.
	const imported = await automation.call(workspace, {
		action: "import",
		engine: "ui",
		assetRef: d.assetRef,
		envId: "u04-env",
	});
	assert.equal(imported.imported, asset.cases.length);
	for (let i = 0; i < asset.cases.length; i++) {
		assert.equal(
			(
				await automation.call(workspace, {
					action: "bind",
					caseId: imported.caseIds[i],
					engine: "ui",
					assetRef: d.assetRef,
					nativeCaseId: asset.cases[i].id,
					envId: "u04-env",
				})
			).ok,
			true,
		);
	}
	const samples = [];
	for (let round = 0; round < 6; round++) {
		const beforeReads = reads,
			beforeReadMs = readMs,
			started = performance.now();
		const receipt = await automation.sync(workspace, "ui", execution.run_ref);
		assert.equal(receipt.ok, true);
		assert.equal(store.cases.length, asset.cases.length);
		assert.equal(runs.runs.length, asset.cases.length);
		samples.push({
			round,
			fullReads: reads - beforeReads,
			readMs: readMs - beforeReadMs,
			syncMs: performance.now() - started,
			imported: receipt.imported,
			duplicate: receipt.duplicate,
		});
	}
	console.log(
		JSON.stringify(
			{
				scope: "one native successful run; first sync then five repeated syncs; cold process separated from warm calls",
				preparation:
					"Explicit import and bind before measurement; 0.13.0 contract, separate from historical 0.12.x first-sync intake timing.",
				limitations: "Not an Agent workflow or expanded history benchmark; no overall speed claim.",
				workspace,
				runRef: execution.run_ref,
				actualModelCalls: 0,
				businessRequests: 0,
				samples,
			},
			null,
			2,
		),
	);
} finally {
	automation?.dispose();
	for (const close of cleanup.reverse()) await close();
}
