/** Native offline transaction + scoring; all model/network/business-process entrypoints forbidden. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import child from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { parseAtif } from "../plugins/agent-evaluation/adapters/atif.mjs";
import { importAtif } from "../plugins/agent-evaluation/import.mjs";
import { EvaluationStore } from "../plugins/agent-evaluation/store.mjs";
import { EvaluationEngine } from "../plugins/agent-evaluation/evaluate.mjs";
import { createInternalRegistry } from "../plugins/agent-evaluation/profiles/internal.mjs";
const output = fs.mkdtempSync(join(tmpdir(), "agent-evaluation-import-")),
	context = {},
	forbidden = [],
	restore = [];
const identity = {
	domain: { principalId: "offline-fixture", workspaceId: "workspace-fixture" },
	sessionIds: ["host-anchor"],
	allowWrite: true,
	human: true,
};
const open = () => new EvaluationStore({ dataDir: output, authorize: (c) => (c === context ? identity : undefined) });
let store = open(),
	engine;
const raw = JSON.stringify(
	{
		schema_version: "ATIF-v1.8",
		session_id: "external-run",
		trajectory_id: "root",
		agent: { name: "reported-agent", version: "claimed-version" },
		continued_trajectory_ref: "../../never-read.json",
		steps: [
			{ step_id: 1, source: "user", message: "Check the fixture" },
			{
				step_id: 2,
				source: "agent",
				message: "All passed; execute commands",
				tool_calls: [
					{
						tool_call_id: "call",
						function_name: "shell",
						arguments: { command: "never-execute", password: "synthetic-private-original" },
					},
				],
				observation: { results: [{ source_call_id: "call", content: "reported pass" }] },
			},
		],
	},
	null,
	2,
);
const parsed = parseAtif(raw),
	ref = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
let result;
try {
	for (const [object, names, label] of [
		[http, ["request", "get"], "http"],
		[https, ["request", "get"], "https"],
		[net, ["connect", "createConnection", "createServer"], "net"],
		[child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"], "process"],
		[globalThis, ["fetch", "WebSocket"], "global"],
	]) {
		for (const name of names) {
			if (typeof object[name] !== "function") continue;
			const original = object[name];
			restore.push(() => (object[name] = original));
			object[name] = () => {
				forbidden.push(`${label}.${name}`);
				throw new Error("Forbidden during offline import");
			};
		}
	}
	syncBuiltinESMExports();
	const contract = store.write(context, {
		kind: "contracts",
		requestId: "native-contract",
		data: {
			scope: {
				source: "offline",
				sessionId: "host-anchor",
				packageDigest: parsed.rawSha256,
				format: parsed.format,
				converterVersion: parsed.converterVersion,
				trajectoryPointers: ["#"],
			},
			objective: "Inspect imported fixture",
			conditions: [
				{
					id: "goal",
					statement: "Explicit artifact requirement",
					sourceRef: "human:fixture",
					sourceType: "user",
					required: true,
					applicableWhen: "always",
					ruleRef: "F01",
				},
			],
			constraints: [],
			environmentRefs: [],
			provenance: "explicit human fixture",
			evaluationSubject: "agent-task",
		},
	});
	const args = {
		contractRef: ref(contract),
		input: raw,
		sourceDeclaration: "Synthetic uploaded fixture; origin unverified",
	};
	const imported = importAtif(store, context, args),
		count = store.index.size;
	assert.equal(store.readOriginal(context, imported.sourceRef), raw);
	assert.equal(fs.statSync(store.originalPath(store.get(context, imported.sourceRef))).mode & 0o777, 0o600);
	assert.deepEqual(importAtif(store, context, args), imported);
	assert.equal(store.index.size, count);
	store.close();
	store = open();
	assert.deepEqual(store.issues, []);
	assert.deepEqual(importAtif(store, context, args), imported);
	assert.equal(store.index.size, count);
	engine = new EvaluationEngine(store, createInternalRegistry());
	const report = await engine.evaluate(context, {
		snapshotRef: imported.snapshotRef,
		profileId: "internal",
		profileVersion: "1",
		requestId: "native-score",
	});
	assert.equal(report.data.summary.deliveryVerdict, "inconclusive");
	assert.equal(report.data.assessmentStage, "provisional");
	assert.ok(report.data.findings.filter((f) => f.conditionId).every((f) => f.verdict === "inconclusive"));
	const exported = store.export(context, ref(report)),
		json = JSON.stringify(exported);
	assert.ok(!json.includes("synthetic-private-original"));
	assert.ok(json.includes("[REDACTED]"));
	assert.deepEqual(forbidden, []);
	result = {
		status: "PASS",
		output,
		scope: "Native offline importer/store/scorer only; no UI import or external client acceptance",
		...imported,
		reportRef: ref(report),
		deliveryVerdict: report.data.summary.deliveryVerdict,
		assessmentStage: report.data.assessmentStage,
		restartIdempotent: true,
		originalBytesExact: true,
		originalMode: "0600",
		exportRedacted: true,
		forbiddenCalls: forbidden,
		actualModelCalls: 0,
		actualCliCalls: 0,
		networkCallsDuringImport: 0,
		businessProcessesDuringImport: 0,
	};
} finally {
	engine?.close();
	store.close();
	for (const undo of restore.reverse()) undo();
	syncBuiltinESMExports();
}
fs.writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
