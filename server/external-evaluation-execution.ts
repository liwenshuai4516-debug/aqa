/** Host-private bridge from the pinned offline runtime to the existing evaluation store.
 * The Pi contract is an authorization/task anchor, never a claim that guest output came from the SDK.
 * No transport is enrolled here. The store's trusted authorizer must grant execution separately.
 */
import { createHash } from "node:crypto";
import {
	ExternalEvaluationRuntime,
	offlineExecutionConfiguration,
	type VZEnrollment,
} from "./external-evaluation-runtime.js";
import { supportsArtifacts } from "./external-evaluation-guest-session.js";
import type { OfflineGuestSpec } from "./external-evaluation-guest-session.js";

type Ref = { kind: string; id: string; revision: number };
type RecordValue = Ref & { createdAt: string; data: any };
export interface ExecutionStore {
	identity(
		context: object,
		write?: boolean,
	): {
		domain: { principalId: string; workspaceId: string };
		sessionIds?: string[];
		human?: boolean;
		allowWrite?: boolean;
		allowExecution?: boolean;
		reconciled?: boolean;
	};
	get(context: object, ref: Ref): RecordValue;
	write(context: object, input: { kind: string; data: any; requestId: string; previousRef?: Ref }): RecordValue;
	list(
		context: object,
		input: { kind: string; cursor: string; limit: number },
		project?: undefined,
		accept?: (record: RecordValue) => boolean,
	): { items: Ref[]; nextCursor: string | null };
}
export type OfflineExecutionInput = {
	requestId: string;
	contractRef: Ref;
	previousAttemptRef?: Ref;
	backend: VZEnrollment;
	guest: OfflineGuestSpec;
	timeoutMs: number;
	graceMs: number;
};
const refOf = (record: Ref): Ref => ({ kind: record.kind, id: record.id, revision: record.revision });
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const terminal = new Set(["ended", "blocked", "start-failed", "cancelled", "timed-out"]);
function check(ok: unknown, code: string, message: string): asserts ok {
	if (!ok) throw Object.assign(new Error(message), { code });
}
export class ExternalEvaluationExecution {
	constructor(
		private readonly store: ExecutionStore,
		private readonly runtimeRoot: string,
	) {}
	private owner(context: object) {
		const identity = this.store.identity(context, true);
		check(identity.allowExecution === true, "PERMISSION_DENIED", "Separate trusted execution authorization required");
		return hash([identity.domain.principalId, identity.domain.workspaceId]);
	}
	private latest(context: object, ref: Ref) {
		const first = this.store.get(context, ref);
		check(first.kind === "attempts", "INVALID_INPUT", "An execution attempt reference is required");
		let selected = refOf(first),
			cursor = "";
		const began = performance.now();
		do {
			check(performance.now() - began < 2000, "LIMIT_EXCEEDED", "Attempt revision lookup deadline exceeded");
			const page = this.store.list(
				context,
				{ kind: "attempts", cursor, limit: 100 },
				undefined,
				(record) => record.id === first.id,
			);
			for (const row of page.items) if (row.revision > selected.revision) selected = refOf(row);
			cursor = page.nextCursor ?? "";
		} while (cursor);
		return this.store.get(context, selected);
	}
	private bound(context: object, ref: Ref) {
		const owner = this.owner(context),
			attempt = this.latest(context, ref);
		const target = this.store.get(context, attempt.data.targetRef);
		check(
			target.data.kind === "cli" &&
				target.data.adapterVersion === "vz-offline-store-1" &&
				target.data.clientVersion === "ae-offline-fake-cli-1",
			"INVALID_INPUT",
			"Only enrolled offline attempts are accepted",
		);
		const runtime = new ExternalEvaluationRuntime(this.runtimeRoot, owner);
		check(
			runtime.configurationFingerprint(attempt.id) === attempt.data.configDigest,
			"VERSION_CONFLICT",
			"Runtime configuration differs from the frozen attempt",
		);
		return { owner, attempt, runtime };
	}
	private move(context: object, attempt: RecordValue, state: string, reason: string) {
		if (attempt.data.state === state) return attempt;
		return this.store.write(context, {
			kind: "attempts",
			previousRef: refOf(attempt),
			requestId: `execution-state-${hash([attempt.id, attempt.revision, state])}`,
			data: { ...attempt.data, state, terminationReason: reason },
		});
	}
	prepare(context: object, input: OfflineExecutionInput) {
		const owner = this.owner(context);
		check(/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId), "INVALID_INPUT", "Invalid execution request ID");
		const contract = this.store.get(context, input.contractRef);
		check(
			contract.kind === "contracts" && contract.data.scope.source === "pi",
			"INVALID_INPUT",
			"A selected Pi task is required as the authorization anchor",
		);
		check(
			input.guest?.version === "ae-offline-fake-cli-1",
			"CAPABILITY_UNAVAILABLE",
			"Only the pinned offline fake CLI is enrolled",
		);
		const config = offlineExecutionConfiguration(input.backend, input.timeoutMs, input.graceMs, input.guest);
		const request = (part: string) => `execution-prepare-${hash([input.requestId, part])}`;
		const target = this.store.write(context, {
			kind: "targets",
			requestId: request("target"),
			data: {
				kind: "cli",
				clientVersion: input.guest.version,
				executableIdentity: `sha256:${input.guest.target.sha256}`,
				adapterVersion: "vz-offline-store-1",
				configRef: `sha256:${config.fingerprint}`,
				capabilities: {
					history: "unsupported",
					live: "partial",
					toolIO: "unsupported",
					childAgents: "unsupported",
					permissions: "unsupported",
					artifacts: supportsArtifacts(input.guest) ? "partial" : "unsupported",
					usage: "unsupported",
					waitingInput: "partial",
					localCancel: "supported",
					remoteCancel: "unsupported",
					networkRestriction: "supported",
					sessionIsolation: "supported",
					configIsolation: "supported",
					memoryIsolation: "supported",
					repeatableInitialState: "supported",
					modelSubstitution: "unsupported",
					import: "unsupported",
					export: "partial",
					resume: "unsupported",
				},
				isolation: "pinned-vz-no-disk-network-share; trusted-offline-fixture-only",
			},
		});
		let attempt = this.store.write(context, {
			kind: "attempts",
			requestId: request("attempt"),
			data: {
				contractRef: refOf(contract),
				targetRef: refOf(target),
				configDigest: config.fingerprint,
				state: "queued",
				...(input.previousAttemptRef ? { previousAttemptRef: input.previousAttemptRef } : {}),
			},
		});
		attempt = this.latest(context, refOf(attempt));
		if (attempt.data.state === "queued")
			attempt = this.move(context, attempt, "preparing", "offline-environment-preparation");
		const runtime = new ExternalEvaluationRuntime(this.runtimeRoot, owner);
		runtime.prepare(attempt.id, config.backend, config.timeoutMs, config.graceMs, config.guest);
		return refOf(attempt);
	}
	async start(context: object, ref: Ref) {
		const { attempt, runtime } = this.bound(context, ref);
		check(
			!["unknown", "interrupted"].includes(attempt.data.state),
			"EXECUTION_UNKNOWN",
			"Reconcile explicitly; never replay unknown execution",
		);
		if (attempt.data.state === "preparing") await runtime.start(attempt.id);
		return this.status(context, ref);
	}
	async status(context: object, ref: Ref) {
		const binding = this.bound(context, ref),
			raw = await binding.runtime.status(binding.attempt.id);
		check(this.owner(context) === binding.owner, "PERMISSION_DENIED", "Execution authorization changed");
		let attempt = this.latest(context, ref);
		const move = (state: string, reason = `runtime:${raw.state}`) => {
			attempt = this.move(context, attempt, state, reason);
		};
		if (!terminal.has(attempt.data.state)) {
			if (raw.state === "unknown" || (terminal.has(raw.state) && !raw.stopConfirmed)) move("unknown");
			else if (raw.state === "running" && attempt.data.state !== "running") move("running");
			else if (raw.state === "waiting-input") {
				if (["preparing", "unknown", "interrupted"].includes(attempt.data.state))
					move("running", "environment-activity-observed");
				if (attempt.data.state === "running") move("waiting-input", "target-reported-input-wait; no-response-channel");
			} else if (raw.state === "cancelling") {
				if (attempt.data.state === "preparing") move("running", "environment-activity-observed");
				if (
					["running", "waiting-input"].includes(attempt.data.state) &&
					!["ended", "start-failed"].includes(String(raw.stopReason))
				)
					move("cancelling");
			} else if (terminal.has(raw.state) && raw.stopConfirmed) {
				if (raw.noEnvironmentStarted) move(raw.state);
				else {
					// Native lifecycle, not guest exit text, proves that an environment ran and stopped.
					if (attempt.data.state === "preparing") move("running", "native-start-and-stop-confirmed");
					const state = raw.state === "start-failed" ? "ended" : raw.state;
					if (["cancelled", "timed-out"].includes(state) && ["running", "waiting-input"].includes(attempt.data.state))
						move("cancelling");
					// A user cancellation may race with a native natural stop. Keep the race explicit.
					if (state === "ended" && attempt.data.state === "cancelling")
						move("unknown", "cancel-and-end-race-needs-reconciliation");
					move(state);
				}
			}
		}
		return {
			attemptRef: refOf(attempt),
			state: attempt.data.state,
			environmentState: raw.state,
			stopConfirmed: raw.stopConfirmed,
			logCursors: raw.logCursors ?? (raw.guest as any)?.logCursors ?? null,
		};
	}
	async cancel(context: object, ref: Ref) {
		const { attempt, runtime } = this.bound(context, ref);
		if (["running", "waiting-input"].includes(attempt.data.state))
			this.move(context, attempt, "cancelling", "user-cancel-requested");
		await runtime.cancel(attempt.id);
		return this.status(context, ref);
	}
	async seal(context: object, ref: Ref, signal?: AbortSignal) {
		await this.status(context, ref);
		const { attempt, runtime, owner } = this.bound(context, ref);
		check(terminal.has(attempt.data.state), "EXECUTION_UNKNOWN", "Unresolved attempt cannot be sealed");
		const bundle = await runtime.terminalEvidence(attempt.id);
		check(this.owner(context) === owner, "PERMISSION_DENIED", "Execution authorization changed");
		check(bundle.fingerprint === attempt.data.configDigest, "VERSION_CONFLICT", "Terminal configuration differs");
		const verification = bundle.artifacts ? await runtime.verify(attempt.id, signal) : undefined;
		check(this.owner(context) === owner, "PERMISSION_DENIED", "Execution authorization changed");
		const gaps = [
			"live-trajectory-unavailable",
			...(bundle.artifacts ? bundle.artifacts.gaps : ["artifact-snapshot-unavailable"]),
			...(verification
				? verification.state === "completed"
					? []
					: [verification.error ?? "verifier-error"]
				: [bundle.artifacts ? "independent-verifier-not-selected" : "independent-verifier-unavailable"]),
		];
		const evidenceRefs: Ref[] = [];
		const writeEvidence = (
			name: string,
			content: unknown,
			origin: string,
			extraGaps: string[] = [],
			redaction: string[] = [],
			truncated = false,
			kind = name,
		) => {
			evidenceRefs.push(
				refOf(
					this.store.write(context, {
						kind: "evidence",
						requestId: `execution-evidence-${hash([attempt.id, name])}`,
						data: {
							attemptRef: refOf(attempt),
							sourceId: `external-execution:${attempt.id}`,
							sourceEventId: name,
							sourceLocator: `external-execution:${attempt.id}#${name}`,
							sourceRevision: attempt.data.configDigest,
							producer: "vz-offline-store-1",
							origin,
							kind,
							observedAt: bundle.observedAt,
							availability: extraGaps.length ? "partial" : "available",
							content: JSON.stringify(content),
							redaction,
							truncated,
						},
					}),
				),
			);
		};
		writeEvidence(
			"environment-stop",
			{
				state: bundle.state,
				stopConfirmed: bundle.stopConfirmed,
				noEnvironmentStarted: bundle.noEnvironmentStarted,
				configDigest: bundle.fingerprint,
				businessSuccess: "unverified",
			},
			"harness-observed",
		);
		for (const log of bundle.logs) {
			gaps.push(...log.gaps.map((gap) => `${log.channel}:${gap}`));
			writeEvidence(
				`guest-${log.channel}`,
				{
					...log,
					reportedExit: bundle.reportedExit,
					trust: "target-reported; raw bytes retained privately; exit code is not a verdict",
				},
				"target-reported",
				log.gaps,
				log.redaction,
				log.droppedBytes > 0,
			);
		}
		if (bundle.artifacts)
			writeEvidence("artifact-manifest", bundle.artifacts, "harness-observed", bundle.artifacts.gaps);
		if (verification) writeEvidence("verification-result", verification, "externally-verified");
		for (const interval of bundle.timings ?? [])
			writeEvidence(`timing-${interval.phase}`, interval, "harness-observed", [], [], false, "timing-interval");
		if (verification)
			writeEvidence(
				"timing-verification",
				{
					id: "verification",
					phase: "verification",
					kind: "span",
					clockEpoch: `verification:${attempt.id}`,
					startMs: 0,
					endMs: verification.elapsedMs,
				},
				"harness-observed",
				[],
				[],
				false,
				"timing-interval",
			);
		const snapshot = this.store.write(context, {
			kind: "snapshots",
			requestId: `execution-snapshot-${attempt.id}`,
			data: {
				contractRef: attempt.data.contractRef,
				attemptRefs: [refOf(attempt)],
				evidenceRefs,
				sourceWatermarks: { [`external-execution:${attempt.id}`]: hash(bundle) },
				coverage: "partial",
				gaps: [...new Set(gaps)],
				sealedAt: bundle.observedAt,
			},
		});
		return refOf(snapshot);
	}
	async cleanup(context: object, ref: Ref, signal?: AbortSignal) {
		const snapshotRef = await this.seal(context, ref, signal);
		const { runtime, attempt } = this.bound(context, ref);
		return { snapshotRef, ...(await runtime.cleanup(attempt.id)) };
	}
}
