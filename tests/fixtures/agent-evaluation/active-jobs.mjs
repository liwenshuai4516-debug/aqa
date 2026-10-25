/** Controlled rule delay in an isolated plugin copy. Never changes installed/personal sources. */
import assert from "node:assert/strict";
import { cp, readFile, writeFile, unlink, symlink, access } from "node:fs/promises";
import { join } from "node:path";
export async function installActiveJobProbe(repo, dataDir, output) {
	const installed = join(dataDir, "plugins/agent-evaluation");
	await unlink(installed);
	await cp(join(repo, "plugins/agent-evaluation"), installed, { recursive: true });
	await symlink(join(repo, "node_modules"), join(dataDir, "node_modules"), "dir");
	const control = join(output, "active-rule-control.json"),
		profile = join(installed, "profiles/internal.mjs");
	const source = await readFile(profile, "utf8");
	const injection = `
// TEST ONLY: delay one trusted rule to expose cancellation/reload, including a late result.
const probeControl = ${JSON.stringify(control)};
const probeRule = internalEvaluators.find(r => r.manifest.id === "F01");
const probeEvaluate = probeRule.evaluate;
probeRule.manifest.timeoutMs = 10000;
probeRule.evaluate = async (...args) => {
 if (!probeExists(probeControl)) return probeEvaluate(...args);
 const {gate, mode} = JSON.parse(probeRead(probeControl, "utf8"));
 if (mode === "timeout" || mode === "exception") return probeEvaluate(...args);
 if (!gate) return probeEvaluate(...args);
 const signal = args[3];
 probeWrite(gate + ".started", JSON.stringify({at:Date.now(),aborted:signal.aborted}));
 signal.addEventListener("abort", () => probeWrite(gate + ".aborted", String(Date.now())), {once:true});
 await new Promise(resolve => {
  const timer=setInterval(() => {if(probeExists(gate + ".release")){clearInterval(timer);resolve();}},10);
  timer.unref();
 });
 probeWrite(gate + ".late", String(Date.now()));
 return probeEvaluate(...args);
};
const faultRule = internalEvaluators.find(r => r.manifest.id === "F02");
const faultEvaluate = faultRule.evaluate;
faultRule.manifest.timeoutMs = 500;
faultRule.evaluate = async (...args) => {
 if (!probeExists(probeControl)) return faultEvaluate(...args);
 const {gate, mode} = JSON.parse(probeRead(probeControl, "utf8"));
 if (!gate || !["timeout", "exception"].includes(mode)) return faultEvaluate(...args);
 const signal = args[3];
 probeWrite(gate + ".started", JSON.stringify({at:Date.now(),aborted:signal.aborted}));
 signal.addEventListener("abort", () => probeWrite(gate + ".aborted", String(Date.now())), {once:true});
 if (mode === "exception") {
  probeWrite(gate + ".exception", "synthetic evaluator exception");
  throw new Error("synthetic evaluator exception");
 }
 await new Promise(resolve => {
  const timer=setInterval(() => {if(probeExists(gate + ".release")){clearInterval(timer);resolve();}},10);
  timer.unref();
 });
 probeWrite(gate + ".late", String(Date.now()));
 return faultEvaluate(...args);
};
`;
	const needle = "export const internalEvaluators = [...basicEvaluators, F08];";
	assert.ok(source.includes(needle));
	await writeFile(
		profile,
		'import {existsSync as probeExists, readFileSync as probeRead, writeFileSync as probeWrite} from "node:fs";\n' +
			source.replace(needle, needle + injection),
	);
	return { control, installed, injectedRule: "F01", injectedTimeoutMs: 10000, faultRule: "F02", faultTimeoutMs: 500 };
}
const exists = async (path) =>
	access(path).then(
		() => true,
		() => false,
	);
export async function verifyActiveJobs({
	page,
	output,
	dataDir,
	probe,
	until,
	settings,
	closeSettings,
	plugin,
	reports,
	names,
	originalFile,
	originalBytes,
	openView,
}) {
	const results = [];
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
				(id) => window.__evaluationFrames.find((f) => f.type === "plugin_data" && f.payload?.requestId === id)?.payload,
				requestId,
			);
			return !!reply;
		});
		assert.equal(reply.ok, true, JSON.stringify(reply.error));
		return reply.result;
	}
	const attempts = await names("attempts"),
		snapshots = await names("snapshots");
	for (const action of ["cancel", "reload", "disable"]) {
		const gate = join(output, `active-${action}`);
		await writeFile(probe.control, JSON.stringify({ gate }));
		const frameOffset = await page.evaluate(() => window.__evaluationFrames.length);
		await page.locator('.aev [data-action="reevaluate"]:not([disabled])').click();
		await until(() => exists(gate + ".started"));
		const job = await page.evaluate(
			(offset) =>
				window.__evaluationFrames
					.slice(offset)
					.filter((f) => f.type === "plugin_data" && f.payload?.result?.jobId)
					.at(-1)?.payload.result,
			frameOffset,
		);
		assert.ok(job?.jobId);
		assert.equal((await rpc("status", { jobId: job.jobId })).state, "running");
		let watch;
		if (action === "disable") {
			const attemptRef = (await reports())[0].data.snapshotRef;
			const snapshot = await rpc("get", { ref: attemptRef });
			watch = await rpc("watchStart", { ref: snapshot.data.attemptRefs[0], watchId: "disable-watch" });
			assert.equal(watch.state, "observing");
		}
		const oldLock = JSON.parse(await readFile(join(dataDir, "agent-evaluation/writer.lock"), "utf8"));
		if (action === "cancel") {
			await page.locator('.aev [data-action="cancel"]:not([disabled])').click();
		} else {
			await settings("plugins");
			await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
			if (action === "disable") {
				await plugin().getByRole("switch").click();
				await until(async () => (await plugin().getByRole("switch").getAttribute("aria-checked")) === "false");
			} else
				await page
					.locator(".settings-modal")
					.getByRole("button", { name: /^(Rescan|重新扫描)$/ })
					.click();
		}
		let terminal;
		await until(async () => {
			terminal = (await reports()).find((r) => r.data.job?.jobId === job.jobId);
			return !!terminal;
		});
		assert.equal(terminal.data.state, "cancelled");
		assert.equal(terminal.data.assessmentStage, "provisional");
		assert.equal(terminal.data.job.generation, 2);
		assert.ok(terminal.data.job.cancellationConfirmedAt);
		assert.ok(
			terminal.data.findings.some((f) => f.ruleId === "F01" && f.error === "CANCELLED" && f.verdict === "inconclusive"),
		);
		await until(() => exists(gate + ".aborted"));
		if (action === "disable") {
			await plugin().getByRole("switch").click();
			await until(async () => (await plugin().getByRole("switch").getAttribute("aria-checked")) === "true");
		}
		if (action !== "cancel") {
			await closeSettings();
			await openView();
			await page.locator('.aev [data-action="open"]:not([disabled])').first().waitFor();
			assert.equal((await rpc("status", { jobId: job.jobId })).state, "cancelled");
		} else {
			await until(async () => {
				const status = page.locator('.aev [data-action="status"]:not([disabled])');
				if (await status.isVisible()) await status.click();
				return page.locator('.aev [data-action="reevaluate"]:not([disabled])').isVisible();
			});
		}
		if (action === "disable") assert.equal((await rpc("watchStatus", { watchId: watch.watchId })).state, "stopped");
		const before = await reports();
		const lock = await readFile(join(dataDir, "agent-evaluation/writer.lock"), "utf8");
		if (action === "reload") assert.notEqual(JSON.parse(lock).nonce, oldLock.nonce);
		await writeFile(gate + ".release", "release intentionally late result");
		await until(() => exists(gate + ".late"));
		// Read through the host again after the old rule returned, not just before its promise resolved.
		assert.equal((await rpc("status", { jobId: job.jobId })).state, "cancelled");
		assert.deepEqual(await reports(), before);
		assert.equal(await readFile(join(dataDir, "agent-evaluation/writer.lock"), "utf8"), lock);
		assert.equal(await readFile(originalFile, "utf8"), originalBytes);
		assert.deepEqual(await names("attempts"), attempts);
		assert.deepEqual(await names("snapshots"), snapshots);
		results.push({
			action,
			jobId: job.jobId,
			reportId: terminal.id,
			state: terminal.data.state,
			lateResultIgnored: true,
			oldReportUnchanged: true,
			writerReplaced: action === "reload",
			observationStopped: action === "disable" ? true : undefined,
			replacementLockPreserved: true,
		});
		await writeFile(probe.control, "{}");
		if (action !== "cancel") {
			await page.locator(`.aev [data-action="open"][data-id="${terminal.id}"]:not([disabled])`).click();
		}
	}
	await page.locator('.aev [data-action="reevaluate"]:not([disabled])').waitFor();
	const header = page.locator(".aev main > section").first();
	assert.match(await header.innerText(), /Scoring state/);
	assert.match(await header.innerText(), /Cancelled/);
	await page.locator(".aev").evaluate((el) => el.querySelector("main > section").scrollIntoView({ block: "start" }));
	await page.screenshot({ path: join(output, "active-job-cancelled.png") });
	for (const mode of ["timeout", "exception"]) {
		const gate = join(output, `rule-${mode}`);
		await writeFile(probe.control, JSON.stringify({ gate, mode }));
		const frameOffset = await page.evaluate(() => window.__evaluationFrames.length);
		await page.locator('.aev [data-action="reevaluate"]:not([disabled])').click();
		await until(() => exists(gate + ".started"));
		const job = await page.evaluate(
			(offset) =>
				window.__evaluationFrames
					.slice(offset)
					.filter((frame) => frame.type === "plugin_data" && frame.payload?.result?.jobId)
					.at(-1)?.payload.result,
			frameOffset,
		);
		assert.ok(job?.jobId);
		let state;
		await until(async () => {
			state = await rpc("status", { jobId: job.jobId });
			return state.state === "completed";
		});
		const report = (await reports()).find((record) => record.data.job?.jobId === job.jobId),
			code = mode === "timeout" ? "RULE_TIMEOUT" : "EVALUATOR_ERROR",
			finding = report.data.findings.find((row) => row.ruleId === "F02");
		assert.equal(report.data.state, "completed");
		assert.equal(report.data.assessmentStage, "provisional");
		assert.equal(finding.error, code);
		assert.equal(finding.verdict, "inconclusive");
		assert.ok(finding.attributions.some((row) => row.category === "evaluator"));
		assert.ok(report.data.findings.some((row) => row.ruleId === "F06" && !row.error));
		assert.ok(report.data.summary.counts.errors >= 1);
		await until(() => exists(gate + ".aborted"));
		const frozen = await reports(),
			lock = await readFile(join(dataDir, "agent-evaluation/writer.lock"), "utf8");
		if (mode === "timeout") {
			await writeFile(gate + ".release", "release result after timeout report publication");
			await until(() => exists(gate + ".late"));
		} else assert.equal(await exists(gate + ".exception"), true);
		assert.equal((await rpc("status", { jobId: job.jobId })).state, "completed");
		assert.deepEqual(await reports(), frozen);
		assert.equal(await readFile(join(dataDir, "agent-evaluation/writer.lock"), "utf8"), lock);
		assert.equal(await readFile(originalFile, "utf8"), originalBytes);
		assert.deepEqual(await names("attempts"), attempts);
		assert.deepEqual(await names("snapshots"), snapshots);
		await until(async () => {
			const status = page.locator('.aev [data-action="status"]:not([disabled])');
			if (await status.isVisible()) await status.click();
			return page.locator('.aev [data-action="reevaluate"]:not([disabled])').isVisible();
		});
		const article = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F02" }) });
		assert.match(await article.innerText(), new RegExp(code));
		await article.scrollIntoViewIfNeeded();
		await page.screenshot({ path: join(output, `rule-${mode}.png`) });
		results.push({
			action: mode,
			jobId: job.jobId,
			reportId: report.id,
			state: report.data.state,
			code,
			verdict: finding.verdict,
			independentF06Completed: true,
			lateResultIgnored: mode === "timeout",
			oldReportUnchanged: true,
			attemptsAndSnapshotsUnchanged: true,
		});
		await writeFile(probe.control, "{}");
	}
	return results;
}
