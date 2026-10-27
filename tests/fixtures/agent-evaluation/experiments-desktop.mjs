/** Native Electron + original fixed VM + independent verifier. Zero real clients/models. */
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connection } from "./offline-execution.mjs";
const attemptDirectories = async (root) =>
	(await readdir(root, { withFileTypes: true }))
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
const ref = ({ kind, id, revision }) => ({ kind, id, revision });
export async function verifyExperiments({ page, until, output, dataDir, original, openView }) {
	const rpc = connection(page, until);
	await openView();
	if (await page.locator('.aev [data-action="back"]').count()) await page.locator('.aev [data-action="back"]').click();
	await page.locator('.aev [data-action="open"][data-id="' + original.id + '"]').click();
	await page.locator('.aev [data-action="experiments"]').click();
	const datasetForm = page.locator('.aev form[data-form="dataset"]');
	await datasetForm.waitFor();
	await datasetForm.locator('[name="name"]').fill("EC10 confirmed answer 42");
	await datasetForm.locator('[name="mode"]').selectOption("artifacts-pass");
	await datasetForm.locator('[name="stdin"]').fill("frozen input");
	assert.equal(await datasetForm.evaluate((f) => f.checkValidity()), false);
	await datasetForm.locator('[name="confirmed"]').check();
	await datasetForm.locator('button[type="submit"]').click();
	await until(async () => (await rpc("list", { kind: "datasets" })).items.length === 1);
	const dataset = await rpc("get", { ref: ref((await rpc("list", { kind: "datasets" })).items[0]) });
	assert.equal(dataset.data.confirmed, true);
	assert.equal(dataset.data.initialState, "fresh-pinned-ram");
	assert.equal(dataset.data.cases[0].stdin, "frozen input");
	assert.match(dataset.data.rulesDigest, /^[a-f0-9]{64}$/);
	const form = page.locator('.aev form[data-form="experiment"]');
	await form.locator('[name="total"]').fill("120");
	await form.locator('button[type="submit"]').click();
	await page.locator('.aev [data-action="experiment-run"]').waitFor();
	const experiment = ref((await rpc("list", { kind: "experiments" })).items[0]);
	await page.locator('.aev [data-action="experiment-run"]').click();
	async function finish(e) {
		let value;
		await until(async () => {
			value = await rpc("experimentStatus", { ref: e });
			return !value.active;
		});
		return value;
	}
	const repeated = await finish(experiment);
	assert.equal(repeated.data.state, "completed", JSON.stringify(repeated));
	assert.deepEqual(
		repeated.data.entries.map((e) => e.outcome),
		["pass", "pass"],
	);
	assert.equal(repeated.statistics.executedAttempts, 2);
	const attempts = repeated.data.entries.map((e) => e.attemptRef);
	assert.notEqual(attempts[0].id, attempts[1].id);
	assert.equal((await rpc("get", { ref: attempts[1] })).data.previousAttemptRef.id, attempts[0].id);
	const root = join(dataDir, "agent-evaluation-runtime/attempts");
	const directories = await attemptDirectories(root);
	for (const a of attempts) assert.ok(directories.includes(a.id));
	const results = await Promise.all(
		attempts.map((a) => readFile(join(root, a.id, "result.json"), "utf8").then(JSON.parse)),
	);
	assert.notEqual(results[0].instance, results[1].instance);
	assert.notEqual(results[0].nonce, results[1].nonce);
	assert.match(results[0].guest.artifacts.baselineDigest, /^[a-f0-9]{64}$/);
	assert.equal(results[0].guest.artifacts.baselineDigest, results[1].guest.artifacts.baselineDigest);
	for (const r of results) {
		assert.equal(r.stopConfirmed, true);
		assert.equal(r.guest.artifacts.complete, true);
		assert.ok(r.guest.artifacts.entries.some((e) => e.path === "deleted.txt" && e.change === "deleted"));
	}
	await page.locator('.aev [data-action="experiment-status"]').click();
	await page.locator(".aev [data-experiment-status]").filter({ hasText: "2/2" }).waitFor();
	await page.screenshot({ path: join(output, "experiments-en.png"), fullPage: true });
	await page.evaluate(() => {
		document.documentElement.lang = "zh-CN";
	});
	await page.getByRole("heading", { name: "离线数据集与实验", exact: true }).waitFor();
	await page.screenshot({ path: join(output, "experiments-zh.png"), fullPage: true });
	const normalSize = page.viewportSize();
	await page.setViewportSize({ width: 460, height: 850 });
	assert.equal(await page.locator(".aev").evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true);
	await page.screenshot({ path: join(output, "experiments-narrow.png"), fullPage: true });
	await page.setViewportSize(normalSize ?? { width: 1280, height: 850 });
	await page.evaluate(() => {
		document.documentElement.lang = "en";
	});
	const policy = { ...repeated.data.policy, repetitions: 1, retries: 0, totalMs: 120000 };
	const create = async (d, patch = {}) =>
		rpc("createExperiment", { data: { datasetRef: ref(d), policy: { ...policy, ...patch } } });
	const run = async (e) => {
		await rpc("runExperiment", { ref: e });
		return finish(e);
	};
	await rpc(
		"createExperiment",
		{ data: { datasetRef: ref(dataset), policy: { ...policy, hardCostLimitUsd: 1 } } },
		"INVALID_INPUT",
	);
	const failedDataset = await rpc("createDataset", {
		data: {
			name: "EC10 failing version",
			previousDatasetRef: ref(dataset),
			confirmed: true,
			cases: [{ ...dataset.data.cases[0], argv: ["artifacts-fail"] }],
		},
	});
	const failed = await run(await create(failedDataset, { retries: 1 }));
	assert.deepEqual(
		failed.data.entries.map((e) => e.outcome),
		["fail", "fail"],
	);
	assert.equal(failed.data.state, "stopped");
	assert.equal(failed.data.reason, "failure-policy");
	const max = await run(await create(dataset, { repetitions: 2, maxAttempts: 1 }));
	assert.equal(max.data.reason, "attempt-budget-exhausted");
	assert.equal(max.data.entries.length, 1);
	const waiting = await rpc("createDataset", {
		data: {
			name: "EC10 waiting version",
			previousDatasetRef: ref(dataset),
			confirmed: true,
			cases: [{ ...dataset.data.cases[0], argv: ["waiting"] }],
		},
	});
	const budget = await run(await create(waiting, { repetitions: 2, totalMs: 3000 }));
	assert.equal(budget.data.reason, "total-budget-exhausted");
	assert.equal(budget.data.entries.length, 1);
	async function begin() {
		const e = await create(waiting, { repetitions: 2 });
		await rpc("runExperiment", { ref: e });
		let status;
		await until(async () => {
			status = await rpc("experimentStatus", { ref: e });
			const attempt = status.data.entries.at(-1)?.attemptRef;
			return attempt && (await rpc("offlineStatus", { ref: attempt })).state === "waiting-input";
		});
		return status;
	}
	const manual = await begin();
	await rpc("cancelExperiment", { ref: ref(manual) });
	const cancelled = await finish(ref(manual));
	assert.equal(cancelled.data.reason, "user-cancelled");
	assert.equal(cancelled.data.entries.length, 1);

	const result = {
		repeated,
		failed,
		max,
		budget,
		cancelled,
		waitingDataset: waiting,
		policy,
		fixedFakeCliCalls: 7,
		modelCalls: 0,
		costsUsd: { target: 0, verifier: 0, scorer: 0 },
	};
	await writeFile(join(output, "experiments.json"), JSON.stringify(result, null, 2));
	await page.locator('.aev [data-action="experiment-dismiss"]').click();
	return result;
}
export async function beginExperimentsRestart({ page, until, result, output }) {
	const rpc = connection(page, until);
	const pending = await rpc("createExperiment", {
		data: { datasetRef: result.waitingDataset, policy: { ...result.policy, repetitions: 2 } },
	});
	await rpc("runExperiment", { ref: pending });
	let status;
	await until(async () => {
		status = await rpc("experimentStatus", { ref: pending });
		const a = status.data.entries[0]?.attemptRef;
		return a && (await rpc("offlineStatus", { ref: a })).state === "waiting-input";
	});
	result.pending = pending;
	result.pendingAttempt = status.data.entries[0].attemptRef;
	result.fixedFakeCliCalls++;
	await writeFile(join(output, "experiments.json"), JSON.stringify(result, null, 2));
}
export async function reopenExperiments({ page, until, dataDir, result, output }) {
	const rpc = connection(page, until),
		root = join(dataDir, "agent-evaluation-runtime/attempts");
	const before = await attemptDirectories(root);
	const status = await rpc("experimentStatus", { ref: result.pending });
	assert.equal(status.active, false, "Restart must not launch an experiment");
	assert.equal(status.data.entries.length, 1);
	assert.deepEqual(await attemptDirectories(root), before);
	await rpc("runExperiment", { ref: result.pending });
	let resumed;
	await until(async () => {
		resumed = await rpc("experimentStatus", { ref: result.pending });
		return !resumed.active;
	});
	assert.ok(["blocked", "stopped"].includes(resumed.data.state), JSON.stringify(resumed));
	assert.equal(resumed.data.entries.length, 1, "No next attempt with missing required artifact");
	assert.equal(resumed.data.entries[0].attemptRef.id, result.pendingAttempt.id);
	assert.deepEqual(await attemptDirectories(root), before, "Resume must never replay start or allocate a replacement");
	await writeFile(join(output, "experiments-restarted.json"), JSON.stringify(resumed, null, 2));
	return resumed;
}
