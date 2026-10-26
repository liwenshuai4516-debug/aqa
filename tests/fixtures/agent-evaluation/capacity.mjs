/** Default-limit probes in actual Electron. Only owned seed packs are removed, with the app stopped. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, lstat, mkdir, copyFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import electron from "electron";
import { launchNativeApp } from "../../desktop/native-app.mjs";
import { EvaluationStore } from "../../../plugins/agent-evaluation/store.mjs";
import { LIMITS, digest } from "../../../plugins/agent-evaluation/schema.mjs";
const ref = ({ kind, id, revision }) => ({ kind, id, revision });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function installCapacityFixture(agentDir, workspace) {
	const sessionId = "evaluation-oversized",
		sessionPath = join(agentDir, "sessions/evaluation-oversized.jsonl");
	const entries = [
		{ type: "session", version: 3, id: sessionId, timestamp: "2026-10-26T00:00:00Z", cwd: workspace },
		{
			type: "message",
			id: "size-user",
			parentId: null,
			timestamp: "2026-10-26T00:00:01Z",
			message: { role: "user", content: [{ type: "text", text: "Owned oversized source probe; no model execution." }] },
		},
		{
			type: "message",
			id: "size-output",
			parentId: "size-user",
			timestamp: "2026-10-26T00:00:02Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "x".repeat(LIMITS.evidenceBytes + 1) }],
				stopReason: "stop",
			},
		},
	];
	await writeFile(sessionPath, entries.map(JSON.stringify).join("\n") + "\n");
	return { sessionId, sessionPath };
}
export async function verifyCapacity({
	app: originalApp,
	page: originalPage,
	fixture,
	byteCapacity = false,
	repo,
	output,
	dataDir,
	env,
	sessionPath,
	original,
	until,
}) {
	let app = originalApp,
		page = originalPage;
	const root = join(dataDir, "agent-evaluation"),
		originalFile = join(root, "evaluations", `${original.id}.1.json`),
		originalBytes = await readFile(originalFile);
	const records = async (kind) => (await readdir(join(root, kind))).filter((n) => n.endsWith(".json")).sort();
	async function files() {
		const result = {};
		async function scan(dir, prefix = "") {
			for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
				if (item.name === "writer.lock") continue;
				const path = join(dir, item.name),
					name = prefix + item.name;
				if (item.isDirectory()) await scan(path, name + "/");
				else {
					assert.ok(item.isFile() && !item.isSymbolicLink());
					result[name] = sha(await readFile(path));
				}
			}
		}
		await scan(root);
		return result;
	}
	async function rpc(action, data = {}) {
		const requestId = crypto.randomUUID(),
			offset = await page.evaluate(() => window.__evaluationFrames.length);
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
				({ offset, requestId }) =>
					window.__evaluationFrames
						.slice(offset)
						.find((f) => f.type === "plugin_data" && f.payload?.requestId === requestId)?.payload,
				{ offset, requestId },
			);
			return !!reply;
		});
		assert.equal(reply.ok, true, JSON.stringify(reply.error));
		return reply.result;
	}
	async function select(path, sessionId) {
		const current = await rpc("describe");
		if (current.sessionId !== sessionId) {
			const offset = await page.evaluate(() => window.__evaluationFrames.length);
			await page.evaluate(
				(path) => window.__evaluationSocket.send(JSON.stringify({ type: "switch_session", path })),
				path,
			);
			await until(() =>
				page.evaluate(
					({ offset, sessionId }) =>
						window.__evaluationFrames
							.slice(offset)
							.some((f) => f.type === "snapshot" && f.state?.sessionId === sessionId),
					{ offset, sessionId },
				),
			);
		}
		assert.equal((await rpc("describe")).sessionId, sessionId);
	}
	async function list() {
		await page.getByText("Agent evaluation", { exact: true }).first().click();
		await page.locator(".aev").waitFor();
		const back = page.locator('.aev [data-action="back"]');
		if (await back.isVisible()) await back.click();
		const refresh = page.locator('.aev [data-action="refresh"]:not([disabled])');
		await refresh.waitFor();
		await refresh.click();
		await page.locator('.aev [data-action="new"]:not([disabled])').waitFor();
	}
	async function form(objective, start, end) {
		await list();
		await page.locator('.aev [data-action="new"]:not([disabled])').click();
		await page.locator('.aev [name="start"]').selectOption(start);
		await page.locator('.aev [name="end"]').selectOption(end);
		await page.locator('.aev [name="objective"]').fill(objective);
		await page.locator('.aev [name="conditions"]').fill("");
		await page.locator('.aev [name="paths"]').fill("");
	}
	async function submittedReport(before) {
		await page.locator('.aev button[type="submit"]').click();
		let report;
		await until(async () => {
			const alert = await page.locator('.aev [role="alert"]').innerText();
			if (alert) throw new Error(alert);
			const button = page.locator('.aev [data-action="status"]:not([disabled])');
			if (await button.isVisible()) await button.click();
			const names = (await records("evaluations")).filter((n) => !before.includes(n));
			if (names.length !== 1 || !(await page.locator(".aev article h3").count())) return false;
			report = JSON.parse(await readFile(join(root, "evaluations", names[0]), "utf8"));
			return true;
		});
		return report;
	}
	async function openOriginal() {
		await list();
		await page.locator(`.aev [data-action="open"][data-id="${original.id}"]:not([disabled])`).click();
		await until(async () => (await page.locator(".aev section small").first().innerText()).includes(original.id));
		assert.equal(await page.locator('.aev [role="alert"]').innerText(), "");
		assert.deepEqual(await readFile(originalFile), originalBytes);
	}
	async function stop(label) {
		await writeFile(join(output, `capacity-${label}-app.log`), app.getLogs());
		const process = app.process();
		await app.close();
		app = undefined;
		assert.ok(process.exitCode !== null || process.signalCode !== null);
		await assert.rejects(lstat(join(root, "writer.lock")), { code: "ENOENT" });
	}
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
			window.__evaluationFrames = [];
			window.WebSocket = class extends Native {
				constructor(...args) {
					super(...args);
					if (String(args[0]).includes("/ws")) {
						window.__evaluationSocket = this;
						this.addEventListener("message", (e) => {
							try {
								window.__evaluationFrames.push(JSON.parse(e.data));
							} catch {}
						});
					}
				}
			};
		});
		await page.reload();
		await page.waitForSelector(".app");
		await until(() =>
			page.evaluate(() =>
				window.__evaluationFrames.some(
					(f) =>
						f.type === "plugins" &&
						f.plugins.some((p) => p.id === "agent-evaluation" && p.active && p.version === "0.4.32"),
				),
			),
		);
	}
	try {
		const sourceBytes = await readFile(fixture.sessionPath);
		async function checkSource() {
			const current = await readFile(fixture.sessionPath);
			assert.deepEqual(current.subarray(0, sourceBytes.length), sourceBytes);
			const appended = current.subarray(sourceBytes.length).toString("utf8").trim();
			const types = appended ? appended.split("\n").map((line) => JSON.parse(line).type) : [];
			assert.ok(
				types.every((type) => ["thinking_level_change", "model_change"].includes(type)),
				JSON.stringify(types),
			);
			return types;
		}
		await select(fixture.sessionPath, fixture.sessionId);
		await form("Owned oversized source diagnosis", "size-user", "size-output");
		const oversized = await submittedReport(await records("evaluations"));
		assert.equal(oversized.data.summary.goal, "undetermined");
		const bound = { sessionId: fixture.sessionId, conversationId: (await rpc("describe")).conversationId };
		const snapshot = await rpc("get", { ...bound, ref: oversized.data.snapshotRef });
		assert.equal(snapshot.data.coverage, "partial");
		assert.ok(snapshot.data.gaps.includes("oversized-source-entry:size-output"));
		const evidence = await Promise.all(snapshot.data.evidenceRefs.map((ref) => rpc("get", { ...bound, ref })));
		const missing = evidence.find((r) => r.data.sourceEventId === "size-output");
		assert.ok(missing);
		assert.equal(missing.data.availability, "unavailable");
		assert.equal(missing.data.truncated, true);
		assert.equal(missing.contentRef, undefined);
		assert.match(await page.locator(".aev").innerText(), /oversized-source-entry:size-output/);
		await page.screenshot({ path: join(output, "capacity-oversized-source.png") });
		await checkSource();
		const contract = JSON.parse(
			await readFile(join(root, "contracts", `${original.data.contractRef.id}.1.json`), "utf8"),
		);
		await select(sessionPath, contract.data.scope.sessionId);
		await openOriginal();
		await stop("before-seed");
		const before = await files(),
			context = {},
			identity = { domain: original.domain, sessionIds: [contract.data.scope.sessionId], allowWrite: true };
		const store = new EvaluationStore({ dataDir, authorize: (c) => (c === context ? identity : undefined) });
		let seedCount = 0;
		const byteFill = { rejectedBodySizes: [] };
		assert.equal(store.limits.records, LIMITS.records);
		assert.equal(store.limits.capacityBytes, LIMITS.capacityBytes);
		try {
			const snapshot = JSON.parse(
				await readFile(join(root, "snapshots", `${original.data.snapshotRef.id}.1.json`), "utf8"),
			);
			const attemptRef = snapshot.data.attemptRefs[0];
			const input = (index, bodyBytes) => ({
				kind: "evidence",
				requestId: `capacity-owned-${String(index).padStart(6, "0")}`,
				data: {
					attemptRef,
					sourceId: "capacity-owned-seed",
					sourceEventId: String(index).padStart(6, "0"),
					sourceRevision: digest(index),
					sourceLocator: `capacity-owned-seed:${String(index).padStart(6, "0")}`,
					producer: "capacity-fixture-v1",
					availability: "available",
					origin: "harness-observed",
					kind: "synthetic-capacity",
					observedAt: "2026-10-26T00:00:00Z",
					redaction: [],
					truncated: false,
					...(bodyBytes === undefined ? {} : { content: String(index).padStart(6, "0") + "x".repeat(bodyBytes - 6) }),
				},
			});
			if (byteCapacity) {
				const remaining = () => store.limits.capacityBytes - store.usedBytes;
				while (remaining() > 8 * LIMITS.evidenceBytes) {
					store.writeEvidenceBatch(
						context,
						Array.from({ length: 7 }, (_, i) => input(seedCount + i, LIMITS.evidenceBytes)),
					);
					seedCount += 7;
				}
				while (remaining() > LIMITS.evidenceBytes + 4096) {
					store.writeEvidenceBatch(context, [input(seedCount++, LIMITS.evidenceBytes)]);
				}
				const beforeTail = { bytes: store.usedBytes, records: store.index.size };
				// Fill to within64 bytes through the original API. Rejected candidates must publish no receipt.
				let bodyBytes = Math.min(LIMITS.evidenceBytes, remaining() - 512),
					filled = false;
				for (let i = 0; i < 64 && bodyBytes >= 6; i++, bodyBytes -= 64) {
					const tail = input(seedCount, bodyBytes);
					try {
						store.writeEvidenceBatch(context, [tail]);
						filled = true;
						seedCount++;
						break;
					} catch (error) {
						assert.equal(error.code, "LIMIT_EXCEEDED");
						assert.match(error.message, /capacity/);
						assert.equal(store.usedBytes, beforeTail.bytes);
						assert.equal(store.index.size, beforeTail.records);
						assert.equal(store.lookupRequest(context, tail.requestId), undefined);
						byteFill.rejectedBodySizes.push(bodyBytes);
					}
				}
				assert.ok(filled);
				assert.ok(remaining() >= 0 && remaining() < 256);
				assert.ok(store.index.size < LIMITS.records);
				Object.assign(byteFill, { usedBytes: store.usedBytes, remainingBytes: remaining(), records: store.index.size });
			} else {
				seedCount = store.limits.records - store.index.size;
				assert.ok(seedCount > 0);
				for (let offset = 0; offset < seedCount; offset += LIMITS.snapshotItems)
					store.writeEvidenceBatch(
						context,
						Array.from({ length: Math.min(LIMITS.snapshotItems, seedCount - offset) }, (_, i) => input(offset + i)),
					);
				assert.equal(store.index.size, LIMITS.records);
			}
		} finally {
			store.close();
		}
		const full = await files(),
			seeds = Object.keys(full).filter((name) => !(name in before));
		assert.ok(seeds.length > 0);
		assert.ok(seeds.every((n) => /^evidence\/batch-[a-f0-9-]+\.pack$/.test(n)));
		await writeFile(
			join(output, "capacity-file-manifests.json"),
			JSON.stringify(
				{
					before,
					full,
					seeds,
					seedCount,
					recordLimit: LIMITS.records,
					capacityBytes: LIMITS.capacityBytes,
					...(byteCapacity ? { byteFill } : {}),
				},
				null,
				2,
			),
		);
		await launch();
		await select(sessionPath, contract.data.scope.sessionId);
		await openOriginal();
		assert.deepEqual(await files(), full);
		await form("Owned capacity rejection; keep this draft", "u1", "a1");
		await page.locator('.aev button[type="submit"]').click();
		await until(async () => /capacity/i.test(await page.locator('.aev [role="alert"]').innerText()));
		const error = await page.locator('.aev [role="alert"]').innerText();
		assert.equal(
			await page.locator('.aev [name="objective"]').inputValue(),
			"Owned capacity rejection; keep this draft",
		);
		assert.deepEqual(await files(), full);
		await page.screenshot({ path: join(output, "capacity-rejected-draft.png") });
		await openOriginal();
		await page.screenshot({ path: join(output, "capacity-old-report-readable.png") });
		assert.deepEqual(await files(), full);
		await stop("full");
		await mkdir(join(output, "capacity-seed-packs"));
		for (const name of seeds) {
			assert.equal(sha(await readFile(join(root, name))), full[name]);
			await copyFile(join(root, name), join(output, "capacity-seed-packs", name.split("/")[1]));
			await unlink(join(root, name));
		}
		assert.deepEqual(await files(), before);
		await launch();
		await select(sessionPath, contract.data.scope.sessionId);
		await openOriginal();
		await form("Owned capacity recovery positive control", "u1", "a1");
		const recovered = await submittedReport(await records("evaluations"));
		assert.equal(recovered.data.state, "completed");
		assert.equal(recovered.data.summary.goal, "undetermined");
		await page.screenshot({ path: join(output, "capacity-recovered.png") });
		await openOriginal();
		await checkSource();
		const result = {
			status: "PASS",
			defaultRecordLimit: LIMITS.records,
			defaultByteLimit: LIMITS.capacityBytes,
			mode: byteCapacity ? "bytes" : "records",
			...(byteCapacity ? { byteFill } : {}),
			syntheticSeedRecords: seedCount,
			ownedSeedPacks: seeds,
			oversized: {
				reportRef: ref(oversized),
				snapshotRef: oversized.data.snapshotRef,
				coverage: snapshot.data.coverage,
				gaps: snapshot.data.gaps,
				missingEvidenceRef: ref(missing),
				sourceStringBytes: LIMITS.evidenceBytes + 1,
				originalSourcePrefixUnchanged: true,
				sdkMetadataAppendTypes: await checkSource(),
			},
			rejection: { error, draftPreserved: true, storeBytesUnchanged: true, originalReportReadable: true },
			recovery: {
				ownPacksRemovedOnlyWhileStopped: true,
				originalStoreRestoredExactly: true,
				reportRef: ref(recovered),
				originalReportBytesUnchanged: true,
			},
			actualModelCalls: 0,
			actualCliCalls: 0,
			scope: byteCapacity
				? "Actual macOS arm64 Electron; original256MiB byte capacity, below10000records, original1MiB source-item defaults; synthetic owned history/packs. Not physical disk-full/ENOSPC, retention UI or production cleanup."
				: "Actual macOS arm64 Electron; original10000record and1MiB source-item defaults, synthetic offline history/packs. Record-count saturation is not physical disk-full or256MiB byte-capacity testing. No retention UI or production cleanup implementation claimed.",
		};
		await writeFile(join(output, "capacity.json"), JSON.stringify(result, null, 2));
		return { app, page, result };
	} catch (error) {
		if (app) {
			await writeFile(join(output, "capacity-failed-app.log"), app.getLogs());
			await page?.screenshot({ path: join(output, "capacity-failure.png") }).catch(() => {});
			await app.close();
		}
		throw error;
	}
}
