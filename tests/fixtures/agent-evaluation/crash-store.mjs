/** Actual owned Electron sidecar exits at a test-only partial-manifest boundary; original store/recovery remain intact. */
import assert from "node:assert/strict";
import { cp, lstat, mkdir, readFile, readdir, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { join, relative, basename } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import electron from "electron";
import { launchNativeApp } from "../../desktop/native-app.mjs";
import { EvaluationStore } from "../../../plugins/agent-evaluation/store.mjs";
import { digest } from "../../../plugins/agent-evaluation/schema.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ref = ({ kind, id, revision }) => ({ kind, id, revision });
async function manifest(root) {
	const rows = [];
	async function scan(dir) {
		for (const name of (await readdir(dir)).sort()) {
			const file = join(dir, name),
				stat = await lstat(file);
			assert.ok(!stat.isSymbolicLink(), `Unexpected link: ${file}`);
			if (stat.isDirectory()) await scan(file);
			else {
				assert.ok(stat.isFile());
				const bytes = await readFile(file);
				rows.push({ path: relative(root, file), bytes: bytes.length, sha256: sha(bytes) });
			}
		}
	}
	await scan(root);
	return rows;
}
export async function verifyCrashStore({
	app: initialApp,
	repo,
	output,
	dataDir,
	env,
	sessionPath,
	original,
	until,
	reportCrash = false,
}) {
	const directory = join(output, "crash-store");
	await mkdir(directory);
	const root = join(dataDir, "agent-evaluation"),
		installed = join(dataDir, "plugins/agent-evaluation"),
		control = join(directory, "armed"),
		marker = join(directory, reportCrash ? "partial-report.json" : "partial-manifest.json");
	const originalPath = join(root, "evaluations", `${original.id}.1.json`),
		originalBytes = await readFile(originalPath),
		sourceBytes = await readFile(sessionPath);
	const contract = JSON.parse(
		await readFile(join(root, "contracts", `${original.data.contractRef.id}.1.json`), "utf8"),
	);
	const identity = { domain: original.domain, sessionIds: [contract.data.scope.sessionId], allowWrite: true };
	let app = initialApp,
		page;
	const stop = async (name, crashed = false) => {
		await writeFile(join(directory, `${name}-app.log`), app.getLogs());
		const process = app.process();
		if (crashed) {
			process.kill("SIGKILL");
			await until(() => process.exitCode !== null || process.signalCode !== null);
		}
		await app.close();
		assert.ok(process.exitCode !== null || process.signalCode !== null);
		result.nativeStops.push({ name, pid: process.pid, exitCode: process.exitCode, signalCode: process.signalCode });
		app = undefined;
	};
	async function launch() {
		app = await launchNativeApp({
			executablePath: electron,
			packaged: false,
			env,
			mainPath: join(repo, "dist/desktop/main.js"),
		});
		page = await app.firstWindow();
		await page.waitForSelector(".app");
		await page.addInitScript(() => {
			const Native = window.WebSocket;
			window.__crashFrames = [];
			window.WebSocket = class extends Native {
				constructor(...args) {
					super(...args);
					if (String(args[0]).includes("/ws")) {
						window.__crashSocket = this;
						this.addEventListener("message", (e) => {
							try {
								window.__crashFrames.push(JSON.parse(e.data));
							} catch {}
						});
					}
				}
			};
		});
		await page.reload();
		await until(() =>
			page.evaluate(() =>
				window.__crashFrames.some(
					(f) =>
						f.type === "plugins" &&
						f.plugins.some((p) => p.id === "agent-evaluation" && p.active && p.version === "0.4.34"),
				),
			),
		);
	}
	async function send(action, data = {}, requestId = crypto.randomUUID()) {
		const offset = await page.evaluate(() => window.__crashFrames.length);
		await page.evaluate(
			(payload) =>
				window.__crashSocket.send(JSON.stringify({ type: "plugin_message", pluginId: "agent-evaluation", payload })),
			{ action, requestId, ...data },
		);
		return { offset, requestId };
	}
	async function reply(pending) {
		let value;
		await until(async () => {
			value = await page.evaluate(
				({ offset, requestId }) =>
					window.__crashFrames.slice(offset).find((f) => f.type === "plugin_data" && f.payload?.requestId === requestId)
						?.payload,
				pending,
			);
			return !!value;
		});
		return value;
	}
	async function rpc(action, data = {}) {
		const value = await reply(await send(action, data));
		assert.equal(value.ok, true, JSON.stringify(value.error));
		return value.result;
	}
	async function source() {
		if ((await rpc("describe")).sessionId !== identity.sessionIds[0]) {
			const offset = await page.evaluate(() => window.__crashFrames.length);
			await page.evaluate(
				(path) => window.__crashSocket.send(JSON.stringify({ type: "switch_session", path })),
				sessionPath,
			);
			await until(() =>
				page.evaluate(
					({ offset, id }) =>
						window.__crashFrames.slice(offset).some((f) => f.type === "snapshot" && f.state?.sessionId === id),
					{ offset, id: identity.sessionIds[0] },
				),
			);
		}
		const value = await rpc("describe");
		assert.equal(value.sessionId, identity.sessionIds[0]);
		return { sessionId: value.sessionId, conversationId: value.conversationId };
	}
	const result = {
		status: "running",
		nativeStops: [],
		mode: reportCrash ? "partial-report" : "partial-evidence-manifest",
		actualModelCalls: 0,
		actualCliCalls: 0,
		actualToolCalls: 0,
		provenance: reportCrash
			? "Test-only isolated durable.mjs injection syncs23 actual report JSON bytes and exits actual sidecar before publication; not physical power loss/ENOSPC. Original store/service/collector/engine unchanged."
			: "Test-only injection in isolated durable.mjs exits actual sidecar after real body sync and partial manifest sync; not power-loss or physical ENOSPC simulation. Original store/service/collector/engine unchanged.",
	};
	try {
		await stop("baseline");
		await assert.rejects(lstat(join(root, "writer.lock")), { code: "ENOENT" });
		const before = await manifest(root),
			backup = join(directory, "clean-store-backup");
		await cp(root, backup, { recursive: true, errorOnExist: true, force: false });
		assert.deepEqual(await manifest(backup), before);
		await writeFile(join(directory, "baseline-store-manifest.json"), JSON.stringify(before, null, 2));
		assert.ok((await lstat(installed)).isSymbolicLink());
		await unlink(installed);
		await cp(join(repo, "plugins/agent-evaluation"), installed, { recursive: true });
		await symlink(join(repo, "node_modules"), join(dataDir, "node_modules"), "dir");
		const durable = join(installed, "durable.mjs"),
			originalDurable = await readFile(durable, "utf8");
		const needle = 'fault("afterBodySync");';
		assert.equal(originalDurable.split(needle).length, 2);
		const injection = `${needle}
// TEST ONLY: arm after desktop initialization; leave actual durable partial bytes and writer lock.
if (existsSync(${JSON.stringify(control)})) {
 const partial = manifest[0].slice(0, 23);
 writeFileSync(fd, partial); fsyncSync(fd);
 writeFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,file,temp,partialBytes:Buffer.byteLength(partial),code:83,stage:"body-and-partial-manifest-synced"}));
 process.exit(83);
}`;
		let injected = originalDurable.replace(needle, injection);
		if (reportCrash) {
			const reportNeedle = "for (const chunk of Array.isArray(bytes) ? bytes : [bytes]) writeFileSync(fd, chunk);";
			assert.equal(originalDurable.split(reportNeedle).length, 2);
			injected = originalDurable.replace(
				reportNeedle,
				`
// TEST ONLY: leave an actual synchronized incomplete report, with no final rename.
if (dirname(file).endsWith("/evaluations") && existsSync(${JSON.stringify(control)})) {
 const partial = bytes.slice(0,23);
 writeFileSync(fd,partial); fsyncSync(fd);
 writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,file,temp,partialBytes:Buffer.byteLength(partial),code:83,stage:"partial-report-json-synced"}));
 process.exit(83);
}
${reportNeedle}`,
			);
		}
		await writeFile(durable, injected);

		const tracked = execFileSync("git", ["-C", repo, "ls-files", "plugins/agent-evaluation"], { encoding: "utf8" })
				.trim()
				.split("\n"),
			installedRows = [];
		for (const name of tracked) {
			const path = join(installed, relative("plugins/agent-evaluation", name)),
				source = await readFile(join(repo, name)),
				bytes = await readFile(path);
			installedRows.push({
				path,
				source: name,
				sourceSha256: sha(source),
				installedSha256: sha(bytes),
				same: source.equals(bytes),
			});
		}
		assert.deepEqual(
			installedRows.filter((r) => !r.same).map((r) => r.source),
			["plugins/agent-evaluation/durable.mjs"],
		);
		await writeFile(join(directory, "injected-plugin-manifest.json"), JSON.stringify(installedRows, null, 2));
		await writeFile(join(directory, "injected-durable.mjs"), await readFile(durable));
		await launch();
		const bound = await source();
		await rpc("get", { ...bound, ref: ref(original) });
		const requestId = crypto.randomUUID();
		let attemptRef, checkpointRequestId, pending;
		if (reportCrash) {
			await writeFile(control, "Only report JSON publication is armed\n");
			pending = await send("evaluate", { ...bound, ref: ref(original) }, requestId);
		} else {
			const contractRef = await rpc("createContract", {
				...bound,
				data: {
					...contract.data,
					objective: "Synthetic partial-manifest crash; no task execution",
					provenance: "Owned offline crash fixture",
				},
			});
			attemptRef = await rpc("createAttempt", { ...bound, ref: contractRef });
			checkpointRequestId = `checkpoint-${digest([attemptRef.id, requestId])}`;
			await writeFile(control, "Only the next actual pack publication is armed\n");
			pending = await send("collect", { ...bound, ref: attemptRef }, requestId);
		}
		let crashed;
		await until(async () => {
			try {
				crashed = JSON.parse(await readFile(marker, "utf8"));
				return true;
			} catch (e) {
				if (e.code === "ENOENT") return false;
				throw e;
			}
		});
		await until(() => app.getLogs().includes("server 提前退出（code=83"));
		assert.throws(() => process.kill(crashed.pid, 0), { code: "ESRCH" });
		assert.equal(crashed.stage, reportCrash ? "partial-report-json-synced" : "body-and-partial-manifest-synced");
		assert.equal(crashed.partialBytes, 23);
		const crashBytes = await readFile(crashed.temp);
		await assert.rejects(lstat(crashed.file), { code: "ENOENT" });
		let bodyLength;
		if (reportCrash) {
			assert.equal(crashBytes.length, 23);
			assert.throws(() => JSON.parse(crashBytes.toString("utf8")));
		} else {
			bodyLength = Number(crashBytes.readBigUInt64LE(8));
			assert.equal(crashBytes.subarray(0, 8).toString(), "AEVPACK1");
			assert.equal(crashBytes.length, 16 + bodyLength + 23);
		}
		const lockBytes = await readFile(join(root, "writer.lock"));
		assert.equal(JSON.parse(lockBytes).pid, crashed.pid);
		// The native recovery dialog requires a choice. End only this owned shell, then explicitly relaunch.
		await stop("crashed-native-shell", true);
		await launch();
		const rejected = await reply(await send("list", { kind: "evaluations", limit: 50 }));
		assert.equal(rejected.ok, false);
		assert.equal(rejected.error.code, "STORE_LOCKED");
		await page.getByText("Agent evaluation", { exact: true }).first().click();
		await page.locator(".aev").waitFor();
		const refresh = page.locator('.aev [data-action="refresh"]:not([disabled])');
		if (await refresh.isVisible()) await refresh.click();
		await until(async () => /Writer lock|STORE_LOCKED/i.test(await page.locator(".aev").innerText()));
		await page.screenshot({ path: join(directory, "writer-lock-retained.png") });
		await stop("crashed-and-native-restarted");
		assert.deepEqual(await readFile(join(root, "writer.lock")), lockBytes);
		assert.deepEqual(await readFile(crashed.temp), crashBytes);
		await unlink(control);
		const crashedManifest = await manifest(root);
		await writeFile(join(directory, "crashed-store-manifest.json"), JSON.stringify(crashedManifest, null, 2));
		for (const item of before)
			assert.deepEqual(
				crashedManifest.find((r) => r.path === item.path),
				item,
			);
		let interruptedJob;
		const store = new EvaluationStore({ dataDir, readOnly: true, authorize: () => identity });
		try {
			assert.deepEqual(store.get({}, ref(original)), original);
			assert.ok(store.issues.some((i) => i.code === "EVIDENCE_GAP" && i.file === basename(crashed.temp)));
			if (reportCrash) {
				interruptedJob = store.lookupRequest({}, `eval-job-${digest(requestId)}`);
				assert.equal(interruptedJob.data.kind, "evaluation-job");
				for (const e of store.index.values())
					if (e.ref.kind === "evaluations") assert.notEqual(store.get({}, e.ref).data.job?.jobId, interruptedJob.id);
				result.readOnlyRecovery = {
					issues: store.issues,
					records: store.index.size,
					partialReportPublished: false,
					jobReceiptRef: ref(interruptedJob),
					jobReceiptDigest: interruptedJob.digest,
					originalReportExact: true,
				};
			} else {
				assert.equal(store.lookupRequest({}, checkpointRequestId), undefined);
				const recovered = [];
				for (const e of store.index.values()) if (e.ref.kind === "evidence") recovered.push(store.get({}, e.ref));
				assert.equal(recovered.filter((r) => r.data.attemptRef.id === attemptRef.id).length, 0);
				result.readOnlyRecovery = {
					issues: store.issues,
					records: store.index.size,
					checkpointPublished: false,
					partialEvidencePublished: false,
					originalReportExact: true,
				};
			}
		} finally {
			store.close();
		}
		assert.deepEqual(await manifest(root), crashedManifest);
		let recoverySource = backup,
			expectedRestored = before;
		if (reportCrash) {
			const excluded = new Set(["writer.lock", join("evaluations", basename(crashed.temp))]);
			const recoveryDirectory = join(directory, "confirmed-recovery");
			await mkdir(recoveryDirectory);
			recoverySource = join(recoveryDirectory, "agent-evaluation");
			await cp(root, recoverySource, {
				recursive: true,
				errorOnExist: true,
				force: false,
				filter: (src) => !excluded.has(relative(root, src)),
			});
			expectedRestored = crashedManifest.filter((r) => !excluded.has(r.path));
			assert.deepEqual(await manifest(recoverySource), expectedRestored);
			const audit = new EvaluationStore({ dataDir: recoveryDirectory, readOnly: true, authorize: () => identity });
			try {
				assert.deepEqual(audit.issues, []);
				assert.deepEqual(audit.get({}, ref(interruptedJob)), interruptedJob);
			} finally {
				audit.close();
			}
			await writeFile(join(directory, "confirmed-recovery-manifest.json"), JSON.stringify(expectedRestored, null, 2));
		}
		const retained = join(directory, "retained-crashed-store");
		await rename(root, retained);
		await cp(recoverySource, root, { recursive: true, errorOnExist: true, force: false });
		assert.deepEqual(await manifest(root), expectedRestored);
		await writeFile(durable, originalDurable);
		const restoredRows = [];
		for (const name of tracked) {
			const path = join(installed, relative("plugins/agent-evaluation", name)),
				bytes = await readFile(path),
				source = await readFile(join(repo, name));
			assert.deepEqual(bytes, source);
			restoredRows.push({ path, source: name, sha256: sha(bytes) });
		}
		await writeFile(join(directory, "restored-plugin-manifest.json"), JSON.stringify(restoredRows, null, 2));
		await launch();
		const restoredBound = await source();
		const restored = await rpc("get", { ...restoredBound, ref: ref(original) });
		assert.deepEqual(restored.data, original.data);
		if (reportCrash) {
			const probes = [];
			for (const action of ["status", "cancel", "evaluate", "status"]) {
				const response = await reply(
					await send(
						action,
						action === "evaluate"
							? { ...restoredBound, ref: ref(original) }
							: { ...restoredBound, jobId: interruptedJob.id },
						action === "evaluate" ? requestId : crypto.randomUUID(),
					),
				);
				if (action === "status") {
					assert.equal(response.ok, true);
					assert.equal(response.result.state, "unknown");
					assert.equal(response.result.reportRef, undefined);
				} else {
					assert.equal(response.ok, false);
					assert.equal(response.error.code, "EXECUTION_UNKNOWN");
				}
				probes.push({ action, response });
			}
			const receipt = await rpc("get", { ...restoredBound, ref: ref(interruptedJob) });
			assert.equal(receipt.sourceDigest, interruptedJob.digest);
			result.interruptedJob = {
				jobId: interruptedJob.id,
				state: "unknown",
				probes,
				receiptUnchanged: true,
				originalRequestNotRerun: true,
				newAttemptOrSnapshot: false,
			};
		}

		await page.getByText("Agent evaluation", { exact: true }).first().click();
		await page.locator(".aev").waitFor();
		const back = page.locator('.aev [data-action="back"]');
		if (await back.isVisible()) await back.click();
		await page.locator('.aev [data-action="refresh"]:not([disabled])').click();
		if (reportCrash) {
			for (let refresh = 0; refresh < 2; refresh++) {
				await page.locator('.aev [data-action="jobs"]:not([disabled])').click();
				await page.locator(".aev [data-jobs]").waitFor();
				let pages = 0;
				const openJob = page.locator(`.aev [data-action="job-open"][data-id="${interruptedJob.id}"]:not([disabled])`);
				while (!(await openJob.isVisible())) {
					assert.ok(++pages < 100, "Interrupted job must be discoverable in bounded pages");
					await page.locator('.aev [data-action="jobs-next"]:not([disabled])').click();
				}
				await openJob.click();
				const card = page.locator(`.aev [data-job="${interruptedJob.id}"]`);
				await until(async () => (await card.innerText()).includes("Unknown"));
				assert.ok((await card.innerText()).includes("not automatically replayed"));
				assert.equal(await card.locator('[data-action="cancel"]').count(), 0);
				await card.locator('[data-action="status"]:not([disabled])').click();
				await page.locator(`.aev [data-job="${interruptedJob.id}"] [data-action="status"]:not([disabled])`).waitFor();
				await page.screenshot({ path: join(directory, `unknown-job-discovered-${refresh}.png`) });
				if (!refresh) await page.locator('.aev [data-action="refresh"]:not([disabled])').click();
			}
			await page.evaluate(() => {
				document.documentElement.lang = "zh-CN";
			});
			const card = page.locator(`.aev [data-job="${interruptedJob.id}"]`);
			await until(async () => (await card.innerText()).includes("不会自动重放"));
			await page.emulateMedia({ reducedMotion: "reduce" });
			await page.setViewportSize({ width: 375, height: 812 });
			await page.locator(".aev").evaluate((el) => {
				el.style.fontSize = "24px";
			});
			assert.equal(await page.locator(".aev").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
			await page.screenshot({ path: join(directory, "unknown-job-zh-narrow.png") });
			await page.evaluate(
				() =>
					new Promise((resolve, reject) => {
						const link = document.createElement("link");
						link.rel = "stylesheet";
						link.href = "/themes/white.css";
						link.id = "job-light-test";
						link.onload = resolve;
						link.onerror = reject;
						document.head.append(link);
					}),
			);
			await page.screenshot({ path: join(directory, "unknown-job-zh-light.png") });
			await page.evaluate(() => {
				document.getElementById("job-light-test").remove();
				document.documentElement.lang = "en";
			});
			await page.locator(".aev").evaluate((el) => {
				el.style.fontSize = "";
			});
			await page.setViewportSize({ width: 1280, height: 850 });
			await page.emulateMedia({ reducedMotion: "no-preference" });
			await until(async () => (await card.innerText()).includes("not automatically replayed"));
			result.interruptedJob.desktopDiscovery = {
				afterNativeRestart: true,
				afterRefresh: true,
				languages: ["en", "zh-CN"],
				themes: ["dark", "white stylesheet"],
				narrowWidth: 375,
				simulatedTextSizePx: 24,
				reducedMotion: true,
				queriedState: "unknown",
				cancellationOffered: false,
				scoringReplayed: false,
			};
		}
		if (reportCrash) {
			await page.locator(`.aev [data-action="job-open"][data-id="${original.data.job.jobId}"]:not([disabled])`).click();
			result.interruptedJob.desktopDiscovery.completedJobOpensOriginalReport = true;
		} else await page.locator(`.aev [data-action="open"][data-id="${original.id}"]:not([disabled])`).click();
		await until(async () =>
			(await page.locator(".aev section h2").first().innerText()).includes(contract.data.objective),
		);
		await page.screenshot({ path: join(directory, "backup-restored-original-report.png") });
		await stop("restored-current");
		assert.deepEqual(await manifest(root), expectedRestored);
		assert.deepEqual(await readFile(originalPath), originalBytes);
		const currentSource = await readFile(sessionPath);
		assert.deepEqual(currentSource.subarray(0, sourceBytes.length), sourceBytes);
		result.status = "PASS";
		result.crash = {
			...crashed,
			tempSha256: sha(crashBytes),
			tempBytes: crashBytes.length,
			bodyLength,
			sidecarPid: crashed.pid,
			originalRequest: pending,
			originalRequestReplayed: false,
			originalRequestCheckedForReplay: reportCrash,
			writerLockRetained: true,
			writeRejection: rejected.error,
		};
		result.backup = {
			path: backup,
			recoverySource,
			recoveryMode: reportCrash
				? "explicit audited copy of confirmed records excluding exact owned dead lock and incomplete report; originals retained"
				: "exact clean pre-crash backup",
			recordsFiles: before.length,
			restoredFiles: expectedRestored.length,
			exactBeforeLaunch: true,
			exactAfterRead: true,
			retainedCrashStore: retained,
		};
		result.restoredPluginFiles = restoredRows.length;
		result.sourceBytesUnchanged = currentSource.equals(sourceBytes);
		result.sourceOriginalPrefixUnchanged = true;
		result.originalReportBytesUnchanged = true;
		await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2));
		// Return an ordinary current app for the shared development URL identity check.
		await launch();
		return { app, page, result };
	} catch (error) {
		result.status = "FAIL";
		result.error = { message: error.message, stack: error.stack };
		await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2));
		if (app) {
			await writeFile(join(directory, "failed-app.log"), app.getLogs());
			await page?.screenshot({ path: join(directory, "failure.png") }).catch(() => {});
			await app.close();
		}
		throw error;
	}
}
