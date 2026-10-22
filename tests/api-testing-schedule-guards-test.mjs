/** Deterministic guard tests with explicit host/executor doubles; actual timer tested separately. */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSchedules } from "../plugins/api-testing/schedules.mjs";
const output = mkdtempSync(join(tmpdir(), "api-testing-p3-1-guards-"));
const checks = [];
let executions = 0;
const owner = { cwd: output },
	assetRef = "a".repeat(64);
const make = (manualOnlyOrigin) => {
	const base = mkdtempSync(join(output, "project-"));
	let allowed = true,
		rejectSave = false,
		rejectArm = false,
		hold = false,
		release;
	const previous = [{ runId: "manual", assetRef, status: "passed", startedAt: new Date(0).toISOString() }];
	const p = { cwd: output, base, projectId: "fixture" };
	const callbacks = [],
		declarations = new Map(),
		stopped = new AbortController();
	const host = {
		cwd: output,
		signal: stopped.signal,
		verify() {
			stopped.signal.throwIfAborted();
			if (!allowed) throw new Error("permission revoked");
		},
		declaration: (id) => declarations.get(id),
		schedule(spec, fn, opts) {
			if (rejectArm) throw new Error("host declaration persistence failed");
			declarations.set(opts.id, { spec: String(spec), catchUp: opts.catchUp });
			callbacks.push({ fn, opts });
			return () => {
				declarations.delete(opts.id);
				opts.onStop();
			};
		},
	};
	const schedules = createSchedules({
		manualOnlyOrigin,
		project: () => p,
		load: async () => ({ metadata: { origin: "http://127.0.0.1:9876" } }),
		histories: () => previous,
		read: (file) => readFileSync(file),
		atomic(file, value) {
			if (rejectSave) throw new Error("disk full");
			writeFileSync(file, JSON.stringify(value));
		},
		async run(_owner, _input, signal) {
			let verdict = "passed";
			executions++;
			if (hold)
				await new Promise((r) => {
					release = r;
					signal.addEventListener(
						"abort",
						() => {
							verdict = "unknown";
							r();
						},
						{ once: true },
					);
				});
			return { runId: "new-run", executionVerdict: verdict, modelCalls: { generation: 0, review: 0, analysis: 0 } };
		},
	});
	const create = () =>
		schedules.call(owner, {
			action: "schedule_create",
			assetRef,
			intervalMs: 60000,
			authorizationExpiresAt: new Date(Date.now() + 3600000).toISOString(),
		});
	const list = () => schedules.call(owner, { action: "schedule_list" });
	const tick = (delta = 0) => ({ scheduledAt: Date.now() - delta, firedAt: Date.now() });
	return {
		schedules,
		host,
		p,
		callbacks,
		previous,
		create,
		list,
		tick,
		setAllowed: (v) => {
			allowed = v;
		},
		failSave: () => {
			rejectSave = true;
		},
		failArm: () => {
			rejectArm = true;
		},
		hold: () => {
			hold = true;
		},
		release: () => release(),
		stopped,
		declarations,
	};
};
const check = (name) => checks.push({ name, status: "passed" });
try {
	let t = make();
	await t.schedules.attach(t.host);
	await t.create();
	const at = t.tick(),
		before = executions;
	await t.callbacks[0].fn(at);
	await t.callbacks[0].fn(at);
	assert.equal(executions, before + 1);
	check("duplicate-planned-time-claim-never-reexecutes");
	await t.callbacks[0].fn(t.tick(60000));
	assert((await t.list()).triggers.some((r) => r.reason === "missed-or-clock-changed"));
	check("missed-trigger-skipped-with-evidence");
	t.hold();
	const pending = t.callbacks[0].fn({ ...t.tick(), scheduledAt: Date.now() + 1, firedAt: Date.now() + 1 });
	await new Promise((r) => setImmediate(r));
	await t.callbacks[0].fn({ scheduledAt: Date.now() + 2, firedAt: Date.now() + 2 });
	assert((await t.list()).triggers.some((r) => r.reason === "overlap"));
	t.release();
	await pending;
	check("overlap-skips-without-clearing-active-run");
	t = make();
	await t.schedules.attach(t.host);
	await t.create();
	t.failSave();
	await assert.rejects(t.callbacks[0].fn(t.tick()), /disk full/);
	check("claim-write-failure-sends-no-request-and-stops");
	t = make();
	await t.schedules.attach(t.host);
	t.failSave();
	await assert.rejects(t.create(), /disk full/);
	assert.equal(t.callbacks.length, 0);
	check("business-definition-write-failure-does-not-enable");
	t = make();
	await t.schedules.attach(t.host);
	t.failArm();
	await assert.rejects(t.create(), /persistence/);
	assert.equal((await t.list()).schedules[0].state, "paused");
	check("host-declaration-write-failure-pauses-business-definition");
	t = make();
	await t.schedules.attach(t.host);
	await t.create();
	t.setAllowed(false);
	await t.callbacks[0].fn(t.tick());
	t.setAllowed(true);
	assert.match((await t.list()).schedules[0].reason, /permission revoked/);
	check("permission-revocation-pauses-before-request");
	t = make();
	await t.schedules.attach(t.host);
	await t.create();
	t.previous.push({ status: "unknown", hasWrites: true });
	await t.callbacks[0].fn(t.tick());
	assert.match((await t.list()).schedules[0].reason, /Unknown writes/);
	check("unknown-writes-block-unattended-execution");
	for (const [field, value] of [
		["timezone", "Invalid/Zone"],
		["authorizationExpiresAt", "2000-01-01T00:00:00.000Z"],
		["assetRef", "b".repeat(64)],
	]) {
		t = make();
		await t.schedules.attach(t.host);
		const r = await t.create();
		const file = join(t.p.base, "schedules", r.id + ".json"),
			raw = JSON.parse(readFileSync(file));
		raw[field] = value;
		writeFileSync(file, JSON.stringify(raw));
		await t.callbacks[0].fn(t.tick());
		assert.equal((await t.list()).schedules[0].state, "paused");
		check(`${field}-definition-change-pauses-instead-of-executing`);
	}
	t = make();
	await t.schedules.attach(t.host);
	await t.create();
	t.stopped.abort();
	t.declarations.clear();
	const replacement = { ...t.host, signal: new AbortController().signal, verify() {} };
	await t.schedules.attach(replacement);
	assert.match((await t.list()).schedules[0].reason, /declarations differ/);
	check("restart-missing-host-declaration-pauses-business-record");
	t = make();
	await t.schedules.attach(t.host);
	await t.schedules.call(owner, {
		action: "schedule_create",
		assetRef,
		intervalMs: 60000,
		authorizationExpiresAt: new Date(Date.now() + 30).toISOString(),
	});
	await new Promise((r) => setTimeout(r, 50));
	await t.callbacks[0].fn(t.tick());
	assert.match((await t.list()).schedules[0].reason, /authorization expired/);
	check("authorization-lease-expiry-pauses-before-request");
	t = make();
	await t.schedules.attach(t.host);
	await t.create();
	const previousTZ = process.env.TZ;
	try {
		process.env.TZ = "Etc/GMT+11";
		await t.callbacks[0].fn(t.tick());
	} finally {
		if (previousTZ === undefined) delete process.env.TZ;
		else process.env.TZ = previousTZ;
	}
	assert.match((await t.list()).schedules[0].reason, /timezone changed/);
	check("live-server-timezone-change-pauses-before-request");

	t = make();
	await t.schedules.attach(t.host);
	await t.create();
	t.hold();
	const revokedRun = t.callbacks[0].fn(t.tick());
	await new Promise((r) => setImmediate(r));
	t.setAllowed(false);
	await revokedRun;
	t.setAllowed(true);
	const revokedEvidence = await t.list();
	assert.match(revokedEvidence.schedules[0].reason, /permission revoked/);
	assert.equal(revokedEvidence.triggers[0].executionVerdict, "unknown");
	assert.equal(revokedEvidence.triggers[0].status, "completed");
	check("revocation-during-run-aborts-only-its-signal-and-preserves-unknown-run-link");

	const manualOnly = make("http://127.0.0.1:9876");
	await manualOnly.schedules.attach(manualOnly.host);
	await assert.rejects(manualOnly.create(), /not authorized/);
	assert.equal(manualOnly.callbacks.length, 0);
	const source = make();
	await source.schedules.attach(source.host);
	const sourceSchedule = await source.create();
	const savedManual = JSON.parse(readFileSync(join(source.p.base, "schedules", sourceSchedule.scheduleId + ".json")));
	mkdirSync(join(manualOnly.p.base, "schedules"), { recursive: true });
	writeFileSync(join(manualOnly.p.base, "schedules", savedManual.id + ".json"), JSON.stringify(savedManual));
	manualOnly.declarations.set("api-" + savedManual.id, { spec: "60000", catchUp: "skip" });
	const restartedManual = make("http://127.0.0.1:9876");
	// Reuse the same scheduler's persisted project with a fresh host attachment.
	manualOnly.stopped.abort();
	await manualOnly.schedules.attach(restartedManual.host);
	assert.equal(restartedManual.callbacks.length, 0);
	assert.equal((await manualOnly.list()).schedules[0].state, "paused");
	assert.match((await manualOnly.list()).schedules[0].reason, /manual-only/);
	check("configured-manual-target-cannot-create-or-restore-a-timer");
	const summary = {
		task: "P3-1",
		status: "passed",
		scope: "explicit scheduler/executor doubles; no real timer or MCP in guard test",
		checks,
		output,
	};
	writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2));
	console.log(JSON.stringify(summary, null, 2));
} catch (e) {
	writeFileSync(
		join(output, "summary.json"),
		JSON.stringify({ status: "failed", checks, error: e.stack, output }, null, 2),
	);
	throw e;
}
