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
		readMs = 0,
		lists = 0,
		listMs = 0,
		resultWrites = 0;
	const options = {
		host: {
			dataDir: d.f.fixture.agentDir,
			testing: {
				inspect: (...args) => reader.inspect(...args),
				list: async (...args) => {
					lists++;
					const started = performance.now();
					try {
						return await reader.list(...args);
					} finally {
						listMs += performance.now() - started;
					}
				},
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
			resultWrites++;
			runs = next;
		},
	};
	automation = createAutomation(options);
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
	// Additional native runs are created before measurement. Recovery itself must never replay them.
	const nativeRuns = [execution.run_ref],
		recovery = [];
	for (const historySize of [1, 8]) {
		while (nativeRuns.length < historySize) {
			const next = await d.service.start({ ...d.request, request_id: "history-" + nativeRuns.length });
			assert.equal(next.run.data.state, "finished");
			nativeRuns.push(next.run_ref);
		}
		for (let round = 0; round < 6; round++) {
			const before = {
				reads,
				readMs,
				lists,
				listMs,
				resultWrites,
				rows: runs.runs.length,
				browserRequests: d.f.fixture.state.browserRequests,
			};
			automation.dispose();
			const started = performance.now();
			automation = createAutomation(options);
			await automation.idle();
			const elapsedMs = performance.now() - started;
			assert.equal(automation.status().error, "");
			assert.equal(lists - before.lists, 1, "Bindings and channel for the same workspace must share one scan");
			assert.equal(reads - before.reads, historySize, "Current recovery revalidates each native run once");
			assert.equal(runs.runs.length, historySize * asset.cases.length);
			assert.ok(
				runs.runs.every((run) => run.verdict === "通过"),
				"All controlled history runs must retain their native passed outcome",
			);
			assert.equal(new Set(runs.runs.map((r) => r.automation.key)).size, runs.runs.length);
			assert.equal(d.f.fixture.state.browserRequests, before.browserRequests, "Recovery must not call the browser");
			if (round > 0 || historySize === 1)
				assert.equal(resultWrites, before.resultWrites, "Already-synced history must not be written again");
			recovery.push({
				historySize,
				round,
				fullReads: reads - before.reads,
				listCalls: lists - before.lists,
				readMs: readMs - before.readMs,
				listMs: listMs - before.listMs,
				elapsedMs,
				resultWrites: resultWrites - before.resultWrites,
				addedRows: runs.runs.length - before.rows,
			});
		}
	}
	console.log(
		JSON.stringify(
			{
				scope:
					"one native run sync, then recovery with one/eight genuine native runs; first recovery separated from five repeated reconstructions",
				preparation:
					"Explicit import and bind before measurement; 0.13.0 contract, separate from historical 0.12.x first-sync intake timing.",
				limitations:
					"Local component reconstruction, not an Electron/process restart or complete Agent workflow. Same-process filesystem caches remain warm; no overall speed or before/after optimization claim.",
				workspace,
				runRef: execution.run_ref,
				actualModelCalls: 0,
				businessRequests: 0,
				samples,
				nativeRuns,
				recovery,
			},
			null,
			2,
		),
	);
} finally {
	automation?.dispose();
	for (const close of cleanup.reverse()) await close();
}
