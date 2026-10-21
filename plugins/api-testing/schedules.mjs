/** P3-1: single-host fixture leases, durable planned-time claims; no chat/model on fire. */
import { mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function createSchedules({ project, load, histories, read, atomic, run }) {
	let host;
	const timers = new Map();
	const identity = () => ({
		cwd: host.cwd,
		pluginId: "api-testing",
		toolName: "api_test_execute",
		clientId: "host-schedule",
		conversationId: "unattended-fixture",
	});
	const records = (p) =>
		existsSync(join(p.base, "schedules"))
			? readdirSync(join(p.base, "schedules"))
					.filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
					.map((n) => JSON.parse(read(join(p.base, "schedules", n))))
			: [];
	const path = (p, id) => join(p.base, "schedules", id + ".json");
	const persist = (p, record) => atomic(path(p, record.id), record);
	const pause = (p, record, reason) => {
		record.state = "paused";
		record.reason = reason;
		persist(p, record); // A failed write never leaves a live timer; caller stops it first.
	};
	const stop = (p, record, reason) => {
		const active = timers.get(record.id);
		timers.delete(record.id);
		active?.controller?.abort(new Error(reason));
		try {
			pause(p, record, reason);
		} finally {
			active?.off();
		}
	};
	const arm = (p, record, restoring = false) => {
		if (restoring) {
			const declaration = host.declaration("api-" + record.id);
			if (!declaration || declaration.spec !== String(record.intervalMs) || declaration.catchUp !== "skip")
				throw new Error("Business and host schedule declarations differ");
		}
		if (timers.has(record.id)) return;
		const active = { controller: undefined, off: undefined };
		const claimDir = join(p.base, "triggers");
		mkdirSync(claimDir, { recursive: true, mode: 0o700 });
		active.off = host.schedule(
			record.intervalMs,
			async (tick) => {
				const dueAtUTC = new Date(tick.scheduledAt).toISOString();
				const key = `${record.id}-${record.revision}-${tick.scheduledAt}`;
				const file = join(claimDir, key + ".json");
				if (existsSync(file)) return; // Original claim/result is immutable; no second request.
				let ownController, permissionTimer, guardFailure;
				const claim = {
					schemaVersion: 1,
					projectId: p.projectId,
					scheduleId: record.id,
					revision: record.revision,
					dueAtUTC,
					firedAt: new Date(tick.firedAt).toISOString(),
					status: "claimed",
				};
				const skip = (reason) => {
					atomic(file, { ...claim, status: "skipped", reason });
				};
				try {
					host.verify();
					const saved = JSON.parse(read(path(p, record.id)));
					if (
						saved.state !== "enabled" ||
						saved.revision !== record.revision ||
						saved.assetRef !== record.assetRef ||
						saved.origin !== record.origin ||
						saved.intervalMs !== record.intervalMs ||
						saved.authorizationExpiresAt !== record.authorizationExpiresAt ||
						saved.timezone !== record.timezone
					)
						throw new Error("Business and host schedule declarations differ");
					if (Date.now() >= Date.parse(record.authorizationExpiresAt))
						throw new Error("Fixture authorization expired; real credentials are unsupported");
					if (Intl.DateTimeFormat().resolvedOptions().timeZone !== record.timezone)
						throw new Error("Server timezone changed");
					if (tick.firedAt - tick.scheduledAt > 30_000 || tick.scheduledAt > tick.firedAt)
						return skip("missed-or-clock-changed");
					if (active.controller) return skip("overlap");
					const previous = histories(p);
					if (previous.some((r) => r.hasWrites && ["running", "unknown"].includes(r.status)))
						throw new Error("Unknown writes require reconciliation");
					atomic(file, claim); // Claim before any async work.
					active.controller = ownController = new AbortController();
					const { metadata } = await load(p, record.assetRef);
					if (metadata.origin !== record.origin) throw new Error("Frozen environment differs");
					const prior = previous
						.filter((r) => r.assetRef === record.assetRef && !["running", "unknown"].includes(r.status))
						.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
					permissionTimer = setInterval(() => {
						try {
							host.verify();
							if (Date.now() >= Date.parse(record.authorizationExpiresAt))
								throw new Error("Fixture authorization expired during run");
							if (Intl.DateTimeFormat().resolvedOptions().timeZone !== record.timezone)
								throw new Error("Server timezone changed during run");
						} catch (e) {
							guardFailure = String(e.message).slice(0, 300);
							ownController.abort(e);
						}
					}, 50);
					const result = await run(
						identity(),
						{ action: "asset_run", assetRef: record.assetRef, ...(prior ? { priorRunId: prior.runId } : {}) },
						AbortSignal.any([host.signal, active.controller.signal]),
					);
					atomic(file, {
						...claim,
						status: "completed",
						runId: result.runId,
						executionVerdict: result.executionVerdict,
						modelCalls: result.modelCalls,
					});
					if (guardFailure || result.executionVerdict === "unknown")
						stop(p, record, guardFailure ?? "Unknown scheduled execution requires reconciliation");
				} catch (e) {
					const reason = String(e.message).slice(0, 300);
					try {
						atomic(file, { ...claim, status: ownController ? "unknown" : "skipped", reason });
					} finally {
						if (!reason.includes("already has an active")) stop(p, record, reason);
					}
				} finally {
					clearInterval(permissionTimer);
					if (active.controller === ownController) active.controller = undefined;
				}
			},
			{
				id: "api-" + record.id,
				persistent: true,
				catchUp: "skip",
				strictPersistence: true,
				label: `API fixture ${record.id.slice(0, 8)}`,
				onStop() {
					timers.delete(record.id);
					active.controller?.abort(new Error("Schedule stopped"));
					if (record.state !== "paused") pause(p, record, "stopped; explicit new authorization required");
				},
			},
		);
		timers.set(record.id, active);
	};
	return {
		async attach(nextHost) {
			if (host === nextHost) return;
			if (host && !host.signal.aborted) throw new Error("A scheduling host is already attached");
			timers.clear();
			host = nextHost;
			host.verify();
			const p = project(identity(), false);
			const savedRecords = records(p);
			if (savedRecords.some((r) => r.state === "enabled")) project(identity());
			for (const record of savedRecords) {
				if (record.state !== "enabled") continue;
				try {
					if (
						record.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone ||
						Date.now() >= Date.parse(record.authorizationExpiresAt)
					)
						throw new Error("Timezone changed or fixture authorization expired");
					await load(p, record.assetRef);
					if (
						existsSync(join(p.base, "triggers")) &&
						readdirSync(join(p.base, "triggers")).some((name) =>
							["claimed", "unknown"].includes(JSON.parse(read(join(p.base, "triggers", name))).status),
						)
					)
						throw new Error("Interrupted trigger requires operator reconciliation");
					if (histories(p).some((r) => ["running", "unknown"].includes(r.status)))
						throw new Error("Interrupted run requires operator reconciliation");
					arm(p, record, true); // skip: no replay of missed intervals on restart.
				} catch (e) {
					pause(p, record, String(e.message).slice(0, 300));
				}
			}
		},
		close() {
			for (const active of timers.values()) {
				active.controller?.abort(new Error("API scheduler closed"));
				if (!host.signal.aborted) active.off();
			}
			timers.clear();
		},
		async call(owner, input) {
			const keys = {
				schedule_create: ["action", "assetRef", "intervalMs", "authorizationExpiresAt"],
				schedule_list: ["action"],
				schedule_stop: ["action", "scheduleId"],
			};
			if (!keys[input.action] || Object.keys(input).some((k) => !keys[input.action].includes(k)))
				throw new Error("Unsupported schedule argument");
			if (!host) throw new Error("Host scheduling is unavailable");
			host.verify();
			const p = project(owner);
			if (p.cwd !== project(identity(), false).cwd) throw new Error("Only the fixed host project can schedule");
			if (input.action === "schedule_list")
				return {
					scope: "anonymous loopback fixture only; no real unattended authority",
					schedules: records(p).slice(0, 20),
					triggers: existsSync(join(p.base, "triggers"))
						? readdirSync(join(p.base, "triggers"))
								.sort()
								.slice(-20)
								.map((n) => JSON.parse(read(join(p.base, "triggers", n))))
						: [],
				};
			if (input.action === "schedule_stop") {
				const record = records(p).find((r) => r.id === input.scheduleId);
				if (!record) throw new Error("Unknown schedule");
				stop(p, record, "explicit stop");
				return { scheduleId: record.id, state: "paused" };
			}
			if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 60_000 || input.intervalMs > 2_147_483_647)
				throw new Error("Schedule interval must be 60000..2147483647 ms");
			const expiry = Date.parse(input.authorizationExpiresAt);
			if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 7 * 86400_000)
				throw new Error("Fixture authorization needs a future expiry within seven days");
			if (records(p).filter((r) => r.state === "enabled").length >= 5)
				throw new Error("At most five fixture schedules per project");
			const { metadata } = await load(p, input.assetRef);
			const origin = new URL(metadata.origin);
			if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:" || Number(origin.port) < 8900)
				throw new Error("Real unattended targets are not authorized");
			if (!histories(p).some((r) => r.assetRef === input.assetRef && r.status === "passed"))
				throw new Error("Same-version manual execution must pass first");
			const record = {
				schemaVersion: 1,
				id: randomUUID(),
				revision: 1,
				assetRef: input.assetRef,
				origin: metadata.origin,
				intervalMs: input.intervalMs,
				authorizationExpiresAt: new Date(expiry).toISOString(),
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				credentialMode: "anonymous-fixture",
				state: "enabled",
				createdAt: new Date().toISOString(),
			};
			mkdirSync(join(p.base, "schedules"), { recursive: true, mode: 0o700 });
			persist(p, record);
			try {
				arm(p, record);
			} catch (e) {
				pause(p, record, String(e.message));
				throw e;
			}
			return { scheduleId: record.id, state: "enabled", ...record };
		},
	};
}
