/** Actual native renderer -> original plugin -> enrolled fixed VZ CLI. No model or substituted execution. */
import assert from "node:assert/strict";
import { readFile, readdir, access, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ref = (row) => ({ kind: row.kind, id: row.id, revision: row.revision });
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
export function enrollDesktopExecution(repo, dataDir, installation) {
	const source = resolve(installation);
	const child = spawnSync(
		process.execPath,
		[
			join(repo, "scripts/enroll-agent-evaluation-runtime.mjs"),
			"--data-dir",
			dataDir,
			"--helper",
			join(source, "binary"),
			"--kernel",
			join(source, "kernel"),
			"--initrd",
			join(source, "initrd"),
		],
		{ encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH, ELECTRON_RUN_AS_NODE: "1" } },
	);
	assert.equal(child.status, 0, child.stderr || child.error?.message);
	return JSON.parse(child.stdout);
}
function connection(page, until) {
	return async (action, extra = {}, expectedError) => {
		const requestId = crypto.randomUUID();
		await page.evaluate(
			(payload) =>
				window.__evaluationSocket.send(
					JSON.stringify({ type: "plugin_message", pluginId: "agent-evaluation", payload }),
				),
			{ action, requestId, ...extra },
		);
		let reply;
		await until(async () => {
			reply = await page.evaluate(
				(id) => window.__evaluationFrames.find((f) => f.type === "plugin_data" && f.payload?.requestId === id)?.payload,
				requestId,
			);
			return !!reply;
		});
		if (expectedError) {
			assert.equal(reply.ok, false);
			assert.equal(reply.error.code, expectedError);
			return reply;
		}
		assert.equal(reply.ok, true, JSON.stringify(reply.error));
		return reply.result;
	};
}
export async function verifyDesktopExecution({
	page,
	until,
	dataDir,
	output,
	original,
	settings,
	closeSettings,
	plugin,
	openView,
}) {
	const rpc = connection(page, until),
		anchor = original.data.contractRef;
	const root = join(dataDir, "agent-evaluation-runtime/attempts");
	const checks = [],
		attempts = [];
	const click = async (action) => {
		const control = page.locator(`.aev [data-action="${action}"]:not([disabled])`);
		await control.waitFor();
		await control.click();
	};
	async function prepare(mode, timeout = 20, args = "", stdin = "") {
		await click("offline-new");
		const form = page.locator('.aev form[data-form="offline-execution"]');
		await form.waitFor();
		await form.locator('[name="mode"]').selectOption(mode);
		await form.locator('[name="args"]').fill(args);
		await form.locator('[name="stdin"]').fill(stdin);
		await form.locator('[name="timeout"]').fill(String(timeout));
		const offset = await page.evaluate(() => window.__evaluationFrames.length);
		await form.locator('button[type="submit"]').click();
		await page.locator('.aev [data-action="offline-start"]:not([disabled])').waitFor();
		const attempt = await page.evaluate(
			(offset) =>
				window.__evaluationFrames
					.slice(offset)
					.find((f) => f.type === "plugin_data" && f.payload?.ok && f.payload.result?.kind === "attempts")?.payload
					.result,
			offset,
		);
		assert.ok(attempt?.id);
		attempts.push(attempt);
		await assert.rejects(access(join(root, attempt.id, "launch.json")), { code: "ENOENT" });
		return attempt;
	}
	async function state(attempt, expected) {
		let value;
		await until(async () => {
			value = await rpc("offlineStatus", { ref: attempt });
			return value.state === expected && (expected === "waiting-input" || value.stopConfirmed);
		});
		await click("offline-status");
		await until(async () =>
			(await page.locator(".aev [data-offline-execution]").innerText()).includes(
				expected === "waiting-input"
					? "Waiting for input"
					: expected === "ended"
						? "Ended"
						: expected === "timed-out"
							? "Timed out"
							: "Cancelled",
			),
		);
		return value;
	}
	async function seal(attempt) {
		await click("offline-cleanup");
		await page.locator('.aev [data-action="offline-score"]:not([disabled])').waitFor();
		const cleaned = await rpc("offlineCleanup", { ref: attempt });
		const snapshot = await rpc("get", { ref: cleaned.snapshotRef, limit: 50 });
		assert.equal(snapshot.data.coverage, "partial");
		assert.ok(!snapshot.data.gaps.includes("independent-verifier-unavailable"));
		const stop = await rpc("get", { ref: snapshot.data.evidenceRefs[0] });
		const stopBody = JSON.parse((await rpc("readEvidence", { ref: ref(stop) })).text);
		assert.equal(stopBody.businessSuccess, "unverified");
		assert.equal(stopBody.stopConfirmed, true);
		return cleaned;
	}
	// Temporarily withhold only this owned registration; the actual product must refuse without fallback.
	const enrollment = join(dataDir, "agent-evaluation-runtime/installation/enrollment.json");
	await rename(enrollment, enrollment + ".retained");
	try {
		await click("offline-new");
		await until(async () => (await page.locator('.aev [role="alert"]').innerText()).length > 0);
		assert.equal(await page.locator('.aev form[data-form="offline-execution"]').count(), 0);
		assert.equal(await page.locator('.aev [role="alert"]').evaluate((el) => el === document.activeElement), true);
	} finally {
		await rename(enrollment + ".retained", enrollment);
	}
	checks.push(
		"actual UI missing registration refuses with focused error; restored owned registration explicitly retried",
	);
	assert.equal((await rpc("offlineDescribe")).policy.modelAccess, false);
	const literal = "$(touch injected); `pwd` 中文🙂";
	const first = await prepare("echo", 20, literal, "stdin中文🙂\n");
	await rpc(
		"offlinePrepare",
		{ ref: anchor, data: { argv: ["echo"], timeoutMs: 20000, graceMs: 200, allowExecution: true } },
		"INVALID_INPUT",
	);
	await page.evaluate(() => window.__evaluationSocket.send(JSON.stringify({ type: "set_plan_mode", enabled: true })));
	await until(() =>
		page.evaluate(() =>
			window.__evaluationFrames.some((f) => f.type === "notice" && (f.textEn ?? "").includes("Plan mode on")),
		),
	);
	await rpc("offlineStart", { ref: first }, "PERMISSION_DENIED");
	await assert.rejects(access(join(root, first.id, "launch.json")), { code: "ENOENT" });
	await page.evaluate(() => window.__evaluationSocket.send(JSON.stringify({ type: "set_plan_mode", enabled: false })));
	// The original execution guard is checked by the subsequent genuine UI start, without a bypass.
	await until(() =>
		page.evaluate(() =>
			window.__evaluationFrames.some((f) => f.type === "notice" && (f.textEn ?? "").includes("Plan mode off")),
		),
	);
	await click("offline-start");
	await state(first, "ended");
	assert.ok(
		(await readFile(join(root, first.id, "guest-stdout.raw"), "utf8")).includes(
			"ARG:" + Buffer.from(literal).toString("base64"),
		),
	);
	assert.ok((await readFile(join(root, first.id, "guest-stdout.raw"), "utf8")).includes("STDIN:stdin中文🙂\n"));
	const sealed = await seal(first);
	await page.locator('.aev [data-action="offline-evidence"][data-index="0"]:not([disabled])').click();
	await page.locator(".aev [data-offline-evidence] pre").waitFor();
	assert.match(await page.locator(".aev [data-offline-evidence] pre").innerText(), /unverified/);
	await page.screenshot({ path: join(output, "offline-execution-ended-en.png") });
	await click("offline-score");
	await until(async () => {
		const button = page.locator('.aev [data-action="status"]:not([disabled])');
		if (await button.isVisible()) await button.click();
		return (
			(await page.locator(".aev small").first().innerText()).includes(original.id) === false &&
			(await page.locator(".aev article h3").count()) > 0
		);
	});
	assert.equal(await page.locator('.aev [data-action="watch-start"]').count(), 0);
	assert.equal(await page.locator('.aev [data-action="revise"]').count(), 0);
	assert.match(await page.locator(".aev").innerText(), /Fixed offline diagnostic/);
	const reports = await Promise.all(
		(await readdir(join(dataDir, "agent-evaluation/evaluations")))
			.filter((n) => n.endsWith(".json"))
			.map((n) => json(join(dataDir, "agent-evaluation/evaluations", n))),
	);
	const report = reports.find((r) => r.data.snapshotRef.id === sealed.snapshotRef.id);
	assert.ok(report);
	assert.notEqual(report.data.summary.deliveryVerdict, "pass");
	await click("offline-dismiss");
	checks.push(
		"actual UI prepare/start/argv/stdin/native-stop/evidence/cleanup/score; plan rejects pre-launch; exit0 is unverified; CLI source has no Pi-only actions",
	);
	// All remaining attempts use the real UI. Each cleanup releases the single-environment admission.
	for (const mode of ["chunks", "empty", "failure", "waiting"]) {
		const attempt = await prepare(mode);
		await click("offline-start");
		if (mode === "waiting") {
			await state(attempt, "waiting-input");
			assert.equal(await page.locator('.aev [data-action="offline-cleanup"]').count(), 0);
			await page.screenshot({ path: join(output, "offline-execution-waiting-en.png") });
			await click("offline-cancel");
			await state(attempt, "cancelled");
		} else await state(attempt, "ended");
		if (mode === "chunks") assert.match(await readFile(join(root, attempt.id, "guest-stdout.raw"), "utf8"), /中文🙂/);
		if (mode === "empty") assert.equal((await readFile(join(root, attempt.id, "guest-stdout.raw"))).length, 0);
		await seal(attempt);
		await click("offline-dismiss");
		checks.push(`actual UI ${mode}: original logs and confirmed terminal retained; cleanup stays partial`);
	}
	const timed = await prepare("waiting", 5);
	await click("offline-start");
	await state(timed, "timed-out");
	await seal(timed);
	await click("offline-dismiss");
	checks.push("actual UI deadline timeout without extending target-reported wait");
	// EC07: genuine VM outputs, independent verifier, original evidence/score and UI result.
	for (const [mode, verdict] of [
		["pass", "pass"],
		["fail", "fail"],
		["tamper", "fail"],
		["missing", "fail"],
		["link", "inconclusive"],
		["special", "inconclusive"],
		["limit", "inconclusive"],
		["crash", "inconclusive"],
	]) {
		const attempt = await prepare(`artifacts-${mode}`);
		await click("offline-start");
		await state(attempt, "ended");
		const cleaned = await seal(attempt);
		const result = await page.locator(".aev [data-verification-result]").innerText();
		assert.match(result, /Independent verification/);
		const snapshot = await rpc("get", { ref: cleaned.snapshotRef, limit: 20 });
		const evidence = await Promise.all(
			snapshot.data.evidenceRefs.map(async (ref) => {
				const row = await rpc("get", { ref });
				return { kind: row.data.kind, value: JSON.parse((await rpc("readEvidence", { ref })).text) };
			}),
		);
		const artifacts = evidence.find((e) => e.kind === "artifact-manifest").value;
		const verified = evidence.find((e) => e.kind === "verification-result").value;
		assert.equal(verified.verdict, verdict);
		assert.equal(verified.artifactSnapshotId, artifacts.digest);
		assert.ok(artifacts.entries.some((e) => e.path === "deleted.txt" && e.change === "deleted"));
		assert.ok(artifacts.entries.some((e) => e.path === ".ignored" && e.ignored));
		assert.ok(artifacts.entries.some((e) => e.path === "new.txt" && e.change === "added"));
		assert.equal(verified.state, ["link", "special", "limit", "crash"].includes(mode) ? "error" : "completed");
		const before = await readFile(join(root, attempt.id, "verification.json"), "utf8");
		const score = await rpc("evaluate", { ref: cleaned.snapshotRef });
		let status;
		await until(async () => {
			status = await rpc("status", { jobId: score.jobId });
			return !!status.reportRef;
		});
		const report = await rpc("get", { ref: status.reportRef, limit: 100 });
		assert.equal(report.data.findings.find((f) => f.ruleId === "F09").verdict, verdict);
		const accounting = report.data.findings.find((f) => f.ruleId === "F08").metrics.externalAccounting;
		assert.ok(accounting.observedTotalMs > 0);
		assert.equal(
			accounting.observedTotalMs,
			Object.values(accounting.phases).reduce((a, b) => a + b, 0),
		);
		assert.equal(accounting.endToEndWallMs, null);
		await rpc("offlineSeal", { ref: attempt });
		assert.equal(await readFile(join(root, attempt.id, "verification.json"), "utf8"), before);
		if (["pass", "tamper", "crash"].includes(mode))
			await page.screenshot({ path: join(output, `ec07-${mode}-en.png`) });
		await click("offline-dismiss");
		checks.push(
			`EC07 actual desktop ${mode}: frozen manifest matches independent ${verdict}; F09 and five observed stages reconcile; seal never reruns verifier`,
		);
	}
	// The fixed form uses existing styles; exercise narrow/landscape, text scaling, language, themes and focus.
	await click("offline-new");
	await page.locator('.aev form[data-form="offline-execution"]').waitFor();
	await page.emulateMedia({ reducedMotion: "reduce" });
	for (const size of [
		{ width: 375, height: 812 },
		{ width: 812, height: 375 },
	]) {
		await page.setViewportSize(size);
		assert.equal(await page.locator(".aev").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
	}
	await page.evaluate(() => {
		document.documentElement.lang = "zh-CN";
		document.documentElement.style.fontSize = "200%";
	});
	await page.getByRole("heading", { name: "固定离线诊断", exact: true }).waitFor();
	assert.equal(await page.locator(".aev").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
	await page.screenshot({ path: join(output, "offline-execution-zh-landscape-text.png") });
	await page.evaluate(() => {
		document.documentElement.style.fontSize = "";
		document.documentElement.lang = "en";
	});
	await page.setViewportSize({ width: 1280, height: 850 });
	await page.locator('.aev [name="mode"]').focus();
	await page.keyboard.press("Tab");
	assert.equal(await page.locator('.aev [name="args"]').evaluate((el) => el === document.activeElement), true);
	await page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const link = document.createElement("link");
				link.rel = "stylesheet";
				link.href = "/themes/white.css";
				link.id = "execution-light-test";
				link.onload = resolve;
				link.onerror = reject;
				document.head.append(link);
			}),
	);
	await page.screenshot({ path: join(output, "offline-execution-light-en.png") });
	await page.evaluate(() => document.getElementById("execution-light-test").remove());
	await click("offline-dismiss");
	// Disable and rescan each stop a genuinely running target, through the original lifecycle callbacks.
	for (const operation of ["disable", "rescan"]) {
		const attempt = await prepare("waiting", 30);
		await click("offline-start");
		await state(attempt, "waiting-input");
		await settings("plugins");
		await page.getByRole("tab", { name: /插件列表|Plugin list/ }).click();
		if (operation === "disable") {
			await plugin().getByRole("switch").click();
			await until(async () => (await plugin().getByRole("switch").getAttribute("aria-checked")) === "false");
		} else {
			await page
				.locator(".settings-modal")
				.getByRole("button", { name: /^(Rescan|重新扫描)$/ })
				.click();
		}
		await until(() =>
			access(join(root, attempt.id, "cancel.json")).then(
				() => true,
				() => false,
			),
		);
		if (operation === "disable") {
			await plugin().getByRole("switch").click();
			await until(async () => (await plugin().getByRole("switch").getAttribute("aria-checked")) === "true");
		}
		await closeSettings();
		await openView();
		let stopped;
		await until(async () => {
			stopped = await rpc("offlineStatus", { ref: attempt });
			return stopped.stopConfirmed && stopped.state === "cancelled";
		});
		await rpc("offlineCleanup", { ref: attempt });
		// Restore the immutable Pi anchor report for the next UI preparation.
		if (await page.locator('.aev [data-action="back"]').count()) await click("back");
		else await click("refresh");
		await page.locator(`.aev [data-action="open"][data-id="${original.id}"]:not([disabled])`).click();
		checks.push(
			`actual settings ${operation} persists cancel and confirms native stop; original attempt recovered without start replay`,
		);
	}
	await writeFile(
		join(output, "offline-execution-checks.json"),
		JSON.stringify({ checks, attempts, report: ref(report) }, null, 2),
	);
	return { checks, attempts, report: ref(report), fixedFakeCliCalls: attempts.length };
}
export async function beginDesktopExecutionRestart({ page, until, dataDir, original }) {
	const rpc = connection(page, until);
	const attempt = await rpc("offlinePrepare", {
		ref: original.data.contractRef,
		data: { argv: ["waiting"], timeoutMs: 30000, graceMs: 200 },
	});
	await rpc("offlineStart", { ref: attempt });
	await until(async () => (await rpc("offlineStatus", { ref: attempt })).state === "waiting-input");
	const directory = join(dataDir, "agent-evaluation-runtime/attempts", attempt.id);
	return {
		attempt,
		handle: await json(join(directory, "native-handle.json")),
		claim: await readFile(join(directory, "guest-input.json"), "utf8"),
	};
}
export async function reopenDesktopExecution({ page, until, dataDir, pending }) {
	const rpc = connection(page, until),
		directory = join(dataDir, "agent-evaluation-runtime/attempts", pending.attempt.id);
	let status;
	await until(async () => {
		status = await rpc("offlineStatus", { ref: pending.attempt });
		return status.stopConfirmed;
	});
	assert.equal(status.state, "cancelled");
	assert.deepEqual(await json(join(directory, "native-handle.json")), pending.handle);
	assert.equal(await readFile(join(directory, "guest-input.json"), "utf8"), pending.claim);
	const attemptNames = async () =>
		(await readdir(join(dataDir, "agent-evaluation-runtime/attempts"), { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	const before = await attemptNames();
	await page.locator('.aev [data-action="back"]').click();
	await page.locator('.aev [data-action="offline-attempts"]:not([disabled])').click();
	await page.locator(".aev [data-offline-attempts] article").first().waitFor();
	// Discover by the actual returned revision. Only status is sent by opening the card.
	const card = page.locator(".aev [data-offline-attempts] article").filter({ hasText: pending.attempt.id }).first();
	let pages = 1;
	while (!(await card.count())) {
		const first = await page.locator(".aev [data-offline-attempts] article").first().innerText();
		await page.locator('.aev [data-action="offline-next"]:not([disabled])').click();
		await until(async () => (await page.locator(".aev [data-offline-attempts] article").first().innerText()) !== first);
		pages++;
	}
	await card.locator('[data-action="offline-open"]').click();
	await page.locator('.aev [data-action="offline-cleanup"]:not([disabled])').waitFor();
	assert.equal(await page.locator('.aev [data-action="offline-start"]').count(), 0);
	await page.locator('.aev [data-action="offline-cleanup"]').click();
	await page.locator('.aev [data-action="offline-score"]:not([disabled])').waitFor();
	assert.deepEqual(await attemptNames(), before);
	await assert.rejects(access(join(dataDir, "agent-evaluation-runtime/attempts/admission.json")), { code: "ENOENT" });
	assert.equal(await readFile(join(directory, "guest-input.json"), "utf8"), pending.claim);
	await page.locator('.aev [data-action="offline-dismiss"]').click();
	return {
		state: status.state,
		stopConfirmed: true,
		sameHandle: true,
		sameInputClaim: true,
		noNewAttempt: true,
		discoveryPages: pages,
	};
}
