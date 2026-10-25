/** Actual native scale matrix. Synthetic records are seeded only with the owned app stopped. */
import assert from "node:assert/strict";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import electron from "electron";
import { launchNativeApp } from "../../desktop/native-app.mjs";
import { EvaluationStore } from "../../../plugins/agent-evaluation/store.mjs";
import { EvaluationEngine } from "../../../plugins/agent-evaluation/evaluate.mjs";
import { createInternalRegistry } from "../../../plugins/agent-evaluation/profiles/internal.mjs";
import { digest } from "../../../plugins/agent-evaluation/schema.mjs";
import { paintedAction } from "./evidence-matrix.mjs";
const ref = (r) => ({ kind: r.kind, id: r.id, revision: r.revision });
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
export async function verifyScale({
	app: originalApp,
	repo,
	output,
	userData,
	dataDir,
	env,
	sessionPath,
	original,
	until,
}) {
	let app;
	const bytes = await readFile(sessionPath);
	await writeFile(join(output, "scale-before-app.log"), originalApp.getLogs());
	const process = originalApp.process();
	await originalApp.close();
	assert.ok(process.exitCode !== null || process.signalCode !== null);
	await assert.rejects(lstat(join(dataDir, "agent-evaluation/writer.lock")), { code: "ENOENT" });
	const contractRecord = JSON.parse(
		await readFile(
			join(
				dataDir,
				"agent-evaluation/contracts",
				`${original.data.contractRef.id}.${original.data.contractRef.revision}.json`,
			),
			"utf8",
		),
	);
	assert.equal((await readFile(join(userData, "client-identity"), "utf8")).trim(), original.domain.principalId);
	const context = {},
		identity = { domain: original.domain, sessionIds: [contractRecord.data.scope.sessionId], allowWrite: true };
	const store = new EvaluationStore({ dataDir, authorize: (c) => (c === context ? identity : undefined) });
	const engine = new EvaluationEngine(store, createInternalRegistry());
	let sequence = 0;
	const write = (kind, data) => store.write(context, { kind, data, requestId: `scale-${++sequence}` });
	const reports = [],
		generationMs = [];
	let snapshot, items;
	try {
		const contract = write("contracts", {
			...contractRecord.data,
			objective: "Synthetic scale fixture: 1000 evidence / 50 reports; no SDK collection or task execution",
			conditions: [],
			constraints: [],
			environmentRefs: [],
			provenance: "synthetic",
		});
		const target = write("targets", {
			kind: "pi",
			clientVersion: "synthetic-scale",
			executableIdentity: "no-executable",
			adapterVersion: "1",
			configRef: "synthetic",
			capabilities: { history: "supported" },
			isolation: "synthetic",
		});
		const attempt = write("attempts", {
			contractRef: ref(contract),
			targetRef: ref(target),
			sourceSessionId: identity.sessionIds[0],
			configDigest: digest({}),
			state: "unknown",
		});
		items = store.writeEvidenceBatch(
			context,
			Array.from({ length: 1000 }, (_, index) => ({
				kind: "evidence",
				requestId: `scale-evidence-${index}`,
				data: {
					attemptRef: ref(attempt),
					sourceId: "synthetic-scale",
					sourceEventId: String(index),
					sourceRevision: digest({ index }),
					sourceLocator: `synthetic-scale:${index}`,
					producer: "synthetic-scale-v1",
					availability: "available",
					origin: "harness-observed",
					kind: "fixture-evidence",
					observedAt: new Date().toISOString(),
					content: JSON.stringify({ index, text: "offline scale fixture" }),
					redaction: [],
					truncated: false,
				},
			})),
		);
		snapshot = write("snapshots", {
			contractRef: ref(contract),
			attemptRefs: [ref(attempt)],
			sourceWatermarks: {},
			evidenceRefs: items.map(ref),
			coverage: "partial",
			gaps: ["synthetic-scale-fixture; not SDK collection"],
			sealedAt: new Date().toISOString(),
		});
		for (let index = 0; index < 50; index++) {
			const started = performance.now();
			const report = await engine.evaluate(context, {
				snapshotRef: ref(snapshot),
				profileId: "internal",
				profileVersion: "1",
				requestId: `scale-report-${index}`,
			});
			assert.equal(report.data.state, "completed");
			reports.push(ref(report));
			generationMs.push(performance.now() - started);
			if (index % 10 === 0) console.log(`scale: generated ${index + 1}/50 synthetic reports`);
		}
	} finally {
		engine.close();
		store.close();
	}
	await writeFile(
		join(output, "scale-seed.json"),
		JSON.stringify({ snapshotRef: ref(snapshot), evidenceItems: items.length, reports, generationMs }, null, 2),
	);
	try {
		app = await launchNativeApp({
			executablePath: electron,
			packaged: false,
			env,
			mainPath: join(repo, "dist/desktop/main.js"),
		});
		const page = await app.firstWindow();
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
						f.plugins.some((p) => p.id === "agent-evaluation" && p.active && p.version === "0.4.22"),
				),
			),
		);
		const offset = await page.evaluate(() => window.__evaluationFrames.length);
		await page.evaluate(
			(path) => window.__evaluationSocket.send(JSON.stringify({ type: "switch_session", path })),
			sessionPath,
		);
		await until(() =>
			page.evaluate(
				({ offset, path }) =>
					window.__evaluationFrames
						.slice(offset)
						.some((f) => f.type === "transition_progress" && f.phase === "done" && f.target === path),
				{ offset, path: sessionPath },
			),
		);
		await page.getByText("Agent evaluation", { exact: true }).first().click();
		await page.locator(".aev").waitFor();
		await page.locator('.aev [data-action="refresh"]:not([disabled])').waitFor();
		await paintedAction(page, '[data-action="refresh"]', '[data-action="open"]');
		const listPages = [],
			seen = [];
		for (;;) {
			const ids = await page
				.locator('.aev [data-action="open"]')
				.evaluateAll((buttons) => buttons.map((b) => b.dataset.id));
			assert.ok(ids.length > 0 && ids.length <= 20);
			listPages.push(ids);
			seen.push(...ids);
			if (!(await page.locator('.aev [data-action="next"]').count())) break;
			assert.ok(listPages.length < 10);
			await paintedAction(page, '[data-action="next"]', '[data-action="open"]');
		}
		const filenames = (await readdir(join(dataDir, "agent-evaluation/evaluations"))).filter((f) => f.endsWith(".json"));
		assert.equal(new Set(seen).size, seen.length);
		assert.deepEqual([...seen].sort(), filenames.map((f) => f.split(".")[0]).sort());
		for (const r of reports) assert.ok(seen.includes(r.id));
		await paintedAction(page, '[data-action="first"]', '[data-action="open"]');
		const selected = (
			await page.locator('.aev [data-action="open"]').evaluateAll((buttons) => buttons.map((b) => b.dataset.id))
		).find((id) => reports.some((r) => r.id === id));
		assert.ok(selected);
		const durations = { report: [], list: [] };
		for (let round = 0; round < 5; round++) {
			durations.report.push(
				await paintedAction(page, `[data-action="open"][data-id="${selected}"]`, '[data-action="back"]'),
			);
			assert.match(await page.locator(".aev").innerText(), /synthetic-scale-fixture; not SDK collection/);
			assert.equal(await page.locator(".aev article").count(), 7);
			assert.equal(await page.locator(".aev [role=alert]").innerText(), "");
			if (round === 4) await page.screenshot({ path: join(output, "scale-report.png") });
			durations.list.push(
				await paintedAction(page, '[data-action="back"]', `[data-action="open"][data-id="${selected}"]`),
			);
		}
		const projection = await page.evaluate(
			(id) =>
				window.__evaluationFrames
					.filter((f) => f.type === "plugin_data" && f.payload?.ok && f.payload.result?.id === id)
					.at(-1)?.payload.result,
			snapshot.id,
		);
		assert.equal(projection.pages.evidenceRefs.total, 1000);
		assert.equal(projection.data.evidenceRefs.length, 20);
		assert.equal(projection.pages.evidenceRefs.nextOffset, 20);
		// Read every reference through the real native authorized service, without projecting all evidence into the UI.
		async function rpc(action, data = {}) {
			const requestId = randomUUID();
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
						window.__evaluationFrames.find((f) => f.type === "plugin_data" && f.payload?.requestId === id)?.payload,
					requestId,
				);
				return !!reply;
			});
			assert.equal(reply.ok, true, JSON.stringify(reply.error));
			return reply.result;
		}
		const returned = [];
		for (let offset = 0; offset < 1000; offset += 50) {
			const part = await rpc("get", { ref: ref(snapshot), offset, limit: 50 });
			assert.equal(part.sourceDigest, projection.sourceDigest);
			assert.equal(part.pages.evidenceRefs.total, 1000);
			returned.push(...part.data.evidenceRefs);
		}
		assert.deepEqual(returned, items.map(ref));
		assert.deepEqual(await readFile(sessionPath), bytes);
		assert.deepEqual(
			(await readdir(join(dataDir, "agent-evaluation/evaluations"))).filter((f) => f.endsWith(".json")),
			filenames,
		);
		await page.screenshot({ path: join(output, "scale-list.png") });
		const result = {
			status: "PASS",
			scope:
				"actual macOS arm64 Electron; 50 synthetic reports, 1000 evidence shared snapshot, seven findings per report; 20 visible list rows per page",
			snapshotRef: ref(snapshot),
			listPages,
			evidenceReferencePages: 20,
			evidenceItems: 1000,
			projection: { total: projection.pages.evidenceRefs.total, returned: projection.data.evidenceRefs.length },
			generationMs,
			durations,
			mediansMs: Object.fromEntries(Object.entries(durations).map(([key, values]) => [key, median(values)])),
			thresholds: "UI render timings are descriptive, not frozen server latency gates",
			sessionBytesUnchanged: true,
			reportCountUnchangedDuringReads: true,
			actualModelCalls: 0,
			actualCliCalls: 0,
		};
		await writeFile(join(output, "scale.json"), JSON.stringify(result, null, 2));
		return { app, page, result };
	} catch (error) {
		if (app) {
			await writeFile(join(output, "scale-failed-app.log"), app.getLogs());
			const page = await app.firstWindow().catch(() => undefined);
			await page?.screenshot({ path: join(output, "scale-failure.png") }).catch(() => {});
			if (page)
				await writeFile(
					join(output, "scale-failure-frames.json"),
					JSON.stringify(await page.evaluate(() => window.__evaluationFrames ?? []).catch(() => []), null, 2),
				);
			await app.close();
		}
		throw error;
	}
}
