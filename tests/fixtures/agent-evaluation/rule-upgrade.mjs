/** Trusted test-only extension in an owned plugin copy; seeded calls are not actual tool executions. */
import assert from "node:assert/strict";
import { cp, unlink, symlink, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export async function installRuleUpgradeProbe(repo, dataDir, agentDir, output, workspace) {
	const installed = join(dataDir, "plugins/agent-evaluation"),
		control = join(output, "rule-upgrade-control.json");
	await unlink(installed);
	await cp(join(repo, "plugins/agent-evaluation"), installed, { recursive: true });
	await symlink(join(repo, "node_modules"), join(dataDir, "node_modules"), "dir");
	await writeFile(control, '{"version":null}');
	const path = join(installed, "profiles/internal.mjs"),
		source = await readFile(path, "utf8");
	const injected = `
const upgradeControl = ${JSON.stringify(control)};
const makeUpgradeProbe = version => define("UpgradeProbe", object({}), (_contract, view) =>
 [finding(null,"pass",view.evidence,"Owned pure rule extension V"+version,[],{extensionVersion:version,items:view.evidence.length})]);
function prepareUpgradeProbe(registry) {
 const selected=JSON.parse(upgradeRead(upgradeControl,"utf8")).version;
 const previous=internalEvaluators.findIndex(rule=>rule.manifest.id==="UpgradeProbe");
 if(previous>=0) internalEvaluators.splice(previous,1);
 if(!selected) return;
 const rule=makeUpgradeProbe(selected);rule.manifest.version=selected;
 internalEvaluators.push(rule);
}
function verifyUpgradeRegistry(registry) {
 const selected=JSON.parse(upgradeRead(upgradeControl,"utf8")).version;
 if(!selected) return;
 if(selected==="2") registry.registerEvaluators([makeUpgradeProbe("1")]);
 const rejection=(name,rules,code)=>{
  let observed;try{registry.registerEvaluators(rules);}catch(error){observed=error.code;}
  if(observed!==code)throw new Error("Unexpected registry rejection "+name+":"+observed);
  return {name,code:observed};
 };
 const duplicate=makeUpgradeProbe("1");
 const a=makeUpgradeProbe("1"),b=makeUpgradeProbe("1");
 a.manifest.id="CycleA";b.manifest.id="CycleB";
 a.manifest.dependencies=[{id:"CycleB",version:"1"}];b.manifest.dependencies=[{id:"CycleA",version:"1"}];
 const missing=makeUpgradeProbe("1");missing.manifest.id="MissingProbe";
 missing.manifest.dependencies=[{id:"AbsentProbe",version:"1"}];
 const checks=[rejection("duplicate",[duplicate],"VERSION_CONFLICT"),rejection("cycle",[a,b],"INVALID_INPUT"),rejection("missing",[missing],"INVALID_INPUT")];
 for(const id of ["CycleA","CycleB","MissingProbe"]){let code;try{registry.evaluator(id,"1");}catch(error){code=error.code;}if(code!=="CAPABILITY_UNAVAILABLE")throw new Error("Partial registry publication "+id);}
 upgradeWrite(upgradeControl+".registry-"+selected+".json",JSON.stringify({version:selected,checks,atomicRejection:true}));
}
`;
	await writeFile(
		path,
		'import {readFileSync as upgradeRead,writeFileSync as upgradeWrite} from "node:fs";\n' +
			'import {define,object,finding} from "../evaluators/common.mjs";\n' +
			source
				.replace(
					"export const internalEvaluators = [...basicEvaluators, F08];",
					"export const internalEvaluators = [...basicEvaluators, F08];\n" + injected,
				)
				.replace("F01: { checks: [] },", "UpgradeProbe: {},\n\t\tF01: { checks: [] },")
				.replace(
					"const registry = new EvaluationRegistry();",
					"const registry = new EvaluationRegistry();\n\tprepareUpgradeProbe(registry);",
				)
				.replace(
					"registry.registerEvaluators(internalEvaluators);",
					"registry.registerEvaluators(internalEvaluators);\n\tverifyUpgradeRegistry(registry);",
				),
	);
	const sessionId = "rule-upgrade-seeded",
		sessionPath = join(agentDir, "sessions/rule-upgrade-seeded.jsonl");
	const entries = [{ type: "session", version: 3, id: sessionId, timestamp: "2026-10-26T00:00:00Z", cwd: workspace }];
	let parentId = null,
		index = 0;
	const message = (id, value) => {
		entries.push({
			type: "message",
			id,
			parentId,
			timestamp: new Date(1792972800000 + index++ * 1000).toISOString(),
			message: value,
		});
		parentId = id;
	};
	message("seed-u1", {
		role: "user",
		content: [{ type: "text", text: "Read this synthetic call history; no tool execution requested." }],
	});
	for (const [id, name, args, failed] of [
		["a", "read", { path: "owned.txt" }, true],
		["b", "read", { path: "owned.txt" }, true],
		["fix", "edit", { path: "owned.txt" }, false],
		["c", "read", { path: "owned.txt" }, false],
		["p1", "status", {}, false],
		["p2", "status", {}, false],
	]) {
		message(`call-${id}`, { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] });
		message(`result-${id}`, {
			role: "toolResult",
			toolCallId: id,
			toolName: name,
			isError: failed,
			content: [{ type: "text", text: failed ? "synthetic failure" : "synthetic success" }],
		});
	}
	await writeFile(sessionPath, entries.map(JSON.stringify).join("\n") + "\n");
	return { installed, control, sessionId, sessionPath, lastMessageId: parentId };
}

export async function verifyRuleUpgrade({
	page,
	probe,
	output,
	dataDir,
	until,
	settings,
	closeSettings,
	original,
	originalSessionPath,
}) {
	async function rpc(action, data = {}) {
		const requestId = crypto.randomUUID();
		await page.evaluate(
			(payload) =>
				window.__evaluationSocket.send(
					JSON.stringify({ type: "plugin_message", pluginId: "agent-evaluation", payload }),
				),
			{ action, requestId, ...data },
		);
		let reply;
		await until(async () => {
			reply = await page.evaluate(
				(id) =>
					window.__evaluationFrames.find((frame) => frame.type === "plugin_data" && frame.payload?.requestId === id)
						?.payload,
				requestId,
			);
			return !!reply;
		});
		assert.equal(reply.ok, true, JSON.stringify(reply.error));
		return reply.result;
	}
	async function reload(version) {
		await writeFile(probe.control, JSON.stringify({ version }));
		const before = JSON.parse(await readFile(join(dataDir, "agent-evaluation/writer.lock"), "utf8")).nonce;
		await settings("plugins");
		await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
		await page
			.locator(".settings-modal")
			.getByRole("button", { name: /^(Rescan|重新扫描)$/ })
			.click();
		await until(
			async () => JSON.parse(await readFile(join(dataDir, "agent-evaluation/writer.lock"), "utf8")).nonce !== before,
		);
		await closeSettings();
		await rpc("describe");
		const checks = JSON.parse(await readFile(probe.control + `.registry-${version}.json`, "utf8"));
		assert.equal(checks.atomicRejection, true);
		assert.equal(checks.checks.length, 3);
		return checks;
	}
	const registryChecks = [await reload("1")];
	let originalDescription = await rpc("describe");
	if (originalDescription.sessionId !== "evaluation-desktop") {
		const offset = await page.evaluate(() => window.__evaluationFrames.length);
		await page.evaluate(
			(path) => window.__evaluationSocket.send(JSON.stringify({ type: "switch_session", path })),
			originalSessionPath,
		);
		await until(() =>
			page.evaluate(
				(start) =>
					window.__evaluationFrames
						.slice(start)
						.some((frame) => frame.type === "snapshot" && frame.state?.sessionId === "evaluation-desktop"),
				offset,
			),
		);
		originalDescription = await rpc("describe");
		assert.equal(originalDescription.sessionId, "evaluation-desktop");
	}
	const oldBinding = { conversationId: originalDescription.conversationId, sessionId: originalDescription.sessionId };
	const oldJob = await rpc("evaluate", {
		...oldBinding,
		ref: { kind: original.kind, id: original.id, revision: original.revision },
	});
	let oldStatus;
	await until(async () => {
		oldStatus = await rpc("status", { ...oldBinding, jobId: oldJob.jobId });
		return oldStatus.state === "completed";
	});
	const beforeExtension = await rpc("get", { ...oldBinding, ref: oldStatus.reportRef });
	assert.deepEqual(beforeExtension.data.configuration, original.data.configuration);
	assert.deepEqual(beforeExtension.data.evaluatorVersions, original.data.evaluatorVersions);
	assert.equal(beforeExtension.data.evaluatorVersions.UpgradeProbe, undefined);
	await page.evaluate(
		(path) => window.__evaluationSocket.send(JSON.stringify({ type: "switch_session", path })),
		probe.sessionPath,
	);
	await until(() =>
		page.evaluate(
			(id) => window.__evaluationFrames.some((frame) => frame.type === "snapshot" && frame.state?.sessionId === id),
			probe.sessionId,
		),
	);
	const described = await rpc("describe"),
		bound = { conversationId: described.conversationId, sessionId: described.sessionId };
	const contract = await rpc("createContract", {
		...bound,
		data: {
			scope: {
				source: "pi",
				sessionId: probe.sessionId,
				startMessageId: "seed-u1",
				endMessageId: probe.lastMessageId,
				boundaryPrecision: "exact",
				childPolicy: "exclude",
				childSessionIds: [],
			},
			objective: "Inspect seeded repetition/polling/repair and trusted extension versions",
			conditions: [],
			constraints: [],
			environmentRefs: [],
			provenance: "Seeded synthetic call history; not actual tool/model/business execution",
			evaluationSubject: "agent-task",
		},
	});
	const attempt = await rpc("createAttempt", { ...bound, ref: contract });
	const collected = await rpc("collect", { ...bound, ref: attempt });
	const snapshot = await rpc("seal", { ...bound, ref: collected.checkpointRef });
	const configs = { F07: { pollingToolNames: ["status"], repairToolNames: ["edit"] } };
	async function score(ref, configuration) {
		const job = await rpc("evaluate", { ...bound, ref, ...(configuration ? { configs: configuration } : {}) });
		let status;
		await until(async () => {
			status = await rpc("status", { ...bound, jobId: job.jobId });
			return status.state === "completed";
		});
		return rpc("get", { ...bound, ref: status.reportRef });
	}
	async function show(report, version) {
		await page.getByText("Agent evaluation", { exact: true }).first().click();
		await page.locator(".aev").waitFor();
		const back = page.locator('.aev [data-action="back"]');
		if (await back.isVisible()) await back.click();
		const refresh = page.locator('.aev [data-action="refresh"]:not([disabled])');
		if (await refresh.isVisible()) await refresh.click();
		await page.locator(`.aev [data-action="open"][data-id="${report.id}"]:not([disabled])`).click();
		const finding = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "UpgradeProbe" }) });
		await finding.waitFor();
		assert.match(await finding.innerText(), new RegExp(`Owned pure rule extension V${version}`));
		const behavior = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F07" }) });
		assert.match(await behavior.innerText(), /Pass/);
		await behavior.locator("summary").filter({ hasText: "Inspect structured configuration / metrics" }).click();
		assert.match(await behavior.innerText(), /excludedPolling/);
		await page.screenshot({ path: join(output, `rule-upgrade-v${version}-${report.id}.png`) });
	}
	const old = await score(snapshot, configs),
		oldRef = { kind: old.kind, id: old.id, revision: old.revision };
	assert.equal(old.data.evaluatorVersions.UpgradeProbe, "1");
	const behavior = old.data.findings.find((f) => f.ruleId === "F07");
	assert.equal(behavior.verdict, "pass");
	assert.equal(behavior.metrics.excludedPolling, 2);
	assert.equal(behavior.metrics.candidates.length, 1);
	assert.deepEqual(behavior.metrics.candidates[0].callIds, ["a", "b"]);
	assert.equal(behavior.metrics.candidates[0].repeatedFailures, 2);
	assert.equal(behavior.metrics.candidates[0].nature, "unconfirmed");
	await show(old, "1");
	const originalBytes = await readFile(join(dataDir, "agent-evaluation/evaluations", `${old.id}.1.json`));
	const names = async (kind) => (await readdir(join(dataDir, "agent-evaluation", kind))).sort();
	const before = { attempts: await names("attempts"), snapshots: await names("snapshots") };
	registryChecks.push(await reload("2"));
	const newer = await score(snapshot, configs),
		newRef = { kind: newer.kind, id: newer.id, revision: newer.revision };
	assert.equal(newer.data.evaluatorVersions.UpgradeProbe, "2");
	assert.notEqual(newer.data.configuration.profileId, old.data.configuration.profileId);
	await show(newer, "2");
	await show(old, "1");
	const rescored = [];
	for (const report of [old, newer]) {
		const again = await score(report === old ? oldRef : newRef);
		assert.deepEqual(again.data.configuration, report.data.configuration);
		assert.equal(again.data.configDigest, report.data.configDigest);
		assert.deepEqual(again.data.evaluatorVersions, report.data.evaluatorVersions);
		assert.deepEqual(again.data.snapshotRef, snapshot);
		rescored.push({ id: again.id, versions: again.data.evaluatorVersions });
	}
	assert.deepEqual(await readFile(join(dataDir, "agent-evaluation/evaluations", `${old.id}.1.json`)), originalBytes);
	assert.deepEqual({ attempts: await names("attempts"), snapshots: await names("snapshots") }, before);
	assert.equal((await readdir(join(dataDir, "plugins"))).includes("data-space"), false);
	const result = {
		beforeExtensionReportRescored: oldStatus.reportRef,
		beforeExtensionConfigurationUnchanged: true,
		registryChecks,
		oldReport: oldRef,
		newReport: newRef,
		rescored,
		behavior: behavior.metrics,
		oldReportUnchanged: true,
		noNewAttemptsOrSnapshots: true,
		withoutDataSpace: true,
		actualModelCalls: 0,
		actualCliCalls: 0,
		actualToolExecutions: 0,
		provenance:
			"Actual Electron and original service/registry/engine/store; only owned profile extension injection and seeded SDK history",
	};
	await writeFile(join(output, "rule-upgrade.json"), JSON.stringify(result, null, 2));
	return result;
}
