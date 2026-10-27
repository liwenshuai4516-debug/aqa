/** Guarded host port over the original store and fixed enrolled offline backend.
 * Transient store identities recheck the original sender/tool and source. Raw cancellation
 * bindings remain usable after plugin/store teardown; unknown execution is never replayed.
 */
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ExternalEvaluationExecution, type ExecutionStore } from "./external-evaluation-execution.js";
import { ExternalEvaluationRuntime, OFFLINE_EXECUTION_POLICY } from "./external-evaluation-runtime.js";
import { readOfflineEnrollment } from "./external-evaluation-enrollment.js";
import { supportsArtifacts } from "./external-evaluation-guest-session.js";
import { encodeGuestInput } from "./external-evaluation-guest.js";
import { verifyPluginInvocation, type PluginToolContext } from "./mcp/plugin-mcp.js";

type Ref = { kind: string; id: string; revision: number };
export type OfflineExecutionBinding = {
	clientId: string;
	conversationId: string;
	sessionId: string;
	invocation?: PluginToolContext;
};
export type OfflineExecutionAction =
	| "offlineDescribe"
	| "offlinePrepare"
	| "offlineStart"
	| "offlineStatus"
	| "offlineReconcile"
	| "offlineCancel"
	| "offlineSeal"
	| "offlineCleanup";
export type OfflineExecutionRequest = {
	action: OfflineExecutionAction;
	requestId: string;
	ref?: Ref;
	data?: { argv: string[]; stdin?: string; timeoutMs: number; graceMs: number };
};
export interface OfflineExecutionAuthority {
	verify(binding: OfflineExecutionBinding): void;
	readSource(
		clientId: string,
		conversationId: string,
	): {
		principalId: string;
		workspaceId: string;
		workspace: string;
		sessionId: string;
		conversationId: string;
		children: { sessionId: string }[];
	};
	log(message: string): void;
}
const modes = [
	"echo",
	"binary",
	"chunks",
	"waiting",
	"empty",
	"failure",
	"artifacts-pass",
	"artifacts-fail",
	"artifacts-tamper",
	"artifacts-missing",
	"artifacts-link",
	"artifacts-special",
	"artifacts-limit",
	"artifacts-crash",
];
const actions = new Set<OfflineExecutionAction>([
	"offlineDescribe",
	"offlinePrepare",
	"offlineStart",
	"offlineStatus",
	"offlineReconcile",
	"offlineCancel",
	"offlineSeal",
	"offlineCleanup",
]);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function check(ok: unknown, code: string, message: string): asserts ok {
	if (!ok) throw Object.assign(new Error(message), { code });
}
function keys(value: object, allowed: string[]) {
	check(
		Object.keys(value).every((key) => allowed.includes(key)),
		"INVALID_INPUT",
		"Unknown offline execution field",
	);
}
export class OfflineEvaluationPort {
	private readonly bridge: ExternalEvaluationExecution;
	private readonly runtimeRoot: string;
	private readonly identities = new WeakMap<
		object,
		{ identity: ReturnType<ExecutionStore["identity"]>; verify(): void }
	>();
	private readonly owned = new Map<string, { clientId: string; runtime: ExternalEvaluationRuntime }>();
	private closed = false;
	private readonly verifications = new Map<AbortController, string>();
	constructor(
		private readonly store: ExecutionStore,
		private readonly dataDir: string,
		private readonly authority: OfflineExecutionAuthority,
	) {
		this.runtimeRoot = join(realpathSync(dataDir), "agent-evaluation-runtime", "attempts");
		this.bridge = new ExternalEvaluationExecution(store, this.runtimeRoot);
	}
	/** Only the original store authorizer consumes this; request fields cannot grant authority. */
	identity(context: object) {
		const entry = this.identities.get(context);
		if (!entry || this.closed) return undefined;
		entry.verify();
		return entry.identity;
	}
	private stop(id: string, entry: { runtime: ExternalEvaluationRuntime }) {
		// cancel persists its marker synchronously before its first await. Never reopen the store here.
		void entry.runtime.cancel(id).catch((error: unknown) => {
			this.authority.log(
				`Offline cancellation unresolved for ${id}: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	}
	stopClient(clientId: string) {
		for (const [controller, client] of this.verifications) if (client === clientId) controller.abort();
		for (const [id, entry] of this.owned) if (entry.clientId === clientId) this.stop(id, entry);
	}
	close() {
		if (this.closed) return;
		this.closed = true;
		for (const controller of this.verifications.keys()) controller.abort();
		for (const [id, entry] of this.owned) this.stop(id, entry);
	}
	async dispatch(baseContext: object, binding: OfflineExecutionBinding, request: OfflineExecutionRequest) {
		check(!this.closed, "CAPABILITY_UNAVAILABLE", "Offline execution port is stopped");
		check(
			request && typeof request === "object" && actions.has(request.action),
			"INVALID_INPUT",
			"Invalid offline action",
		);
		keys(request, ["action", "requestId", "ref", "data"]);
		check(
			typeof request.requestId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(request.requestId),
			"INVALID_INPUT",
			"Invalid request ID",
		);
		const preparing = request.action === "offlinePrepare",
			describing = request.action === "offlineDescribe";
		check(
			describing ? !request.ref : request.ref && typeof request.ref === "object",
			"INVALID_INPUT",
			"Select the contract or attempt",
		);
		check(preparing || request.data === undefined, "INVALID_INPUT", "Input is only accepted when preparing");
		if (preparing) {
			const data = request.data;
			check(data && typeof data === "object", "INVALID_INPUT", "Offline input required");
			keys(data, ["argv", "stdin", "timeoutMs", "graceMs"]);
			check(
				Array.isArray(data.argv) && modes.includes(data.argv[0]),
				"INVALID_INPUT",
				"Select a fixed offline diagnostic mode",
			);
			check(data.stdin === undefined || typeof data.stdin === "string", "INVALID_INPUT", "stdin must be UTF-8 text");
			const stdin = Buffer.from(data.stdin ?? "");
			check(stdin.toString("utf8") === (data.stdin ?? ""), "INVALID_INPUT", "stdin must be valid UTF-8");
			encodeGuestInput(data.argv, stdin);
			check(
				Number.isInteger(data.timeoutMs) &&
					data.timeoutMs >= 1000 &&
					data.timeoutMs <= 30000 &&
					Number.isInteger(data.graceMs) &&
					data.graceMs >= 50 &&
					data.graceMs <= 2000,
				"INVALID_INPUT",
				"Offline limits exceed the enrolled policy",
			);
		}
		this.authority.verify(binding);
		const original = this.store.identity(baseContext, true);
		const base = { domain: { ...original.domain }, human: original.human };
		const source = this.authority.readSource(binding.clientId, binding.conversationId);
		const verify = () => {
			check(!this.closed, "CAPABILITY_UNAVAILABLE", "Offline execution port is stopped");
			this.authority.verify(binding);
			const currentBase = this.store.identity(baseContext, true);
			check(
				currentBase.domain.principalId === base.domain.principalId &&
					currentBase.domain.workspaceId === base.domain.workspaceId &&
					currentBase.human === base.human,
				"PERMISSION_DENIED",
				"Evaluation identity changed",
			);
			if (base.human !== true) {
				check(
					binding.invocation &&
						binding.invocation.clientId === binding.clientId &&
						binding.invocation.conversationId === binding.conversationId &&
						binding.invocation.toolName === "agent_evaluation" &&
						binding.invocation.cwd === source.workspace,
					"PERMISSION_DENIED",
					"A bound evaluation tool invocation is required",
				);
				verifyPluginInvocation("agent-evaluation", binding.invocation);
			} else check(!binding.invocation, "PERMISSION_DENIED", "Tool invocations cannot become human requests");
			const fresh = this.authority.readSource(binding.clientId, binding.conversationId);
			check(
				fresh.principalId === binding.clientId &&
					fresh.principalId === base.domain.principalId &&
					fresh.workspaceId === base.domain.workspaceId &&
					fresh.conversationId === binding.conversationId &&
					fresh.sessionId === binding.sessionId &&
					fresh.sessionId === source.sessionId &&
					currentBase.sessionIds?.includes(fresh.sessionId),
				"PERMISSION_DENIED",
				"Offline execution source selection changed",
			);
		};
		verify();
		const context = Object.freeze({ clientId: binding.clientId });
		this.identities.set(context, {
			verify,
			identity: {
				domain: { ...base.domain },
				sessionIds: [source.sessionId],
				human: base.human === true,
				allowExecution: true,
				allowWrite: true,
				reconciled: request.action === "offlineReconcile",
			},
		});
		let trackedId: string | undefined;
		const verificationController = new AbortController();
		this.verifications.set(verificationController, binding.clientId);
		const signal = binding.invocation ? verifyPluginInvocation("agent-evaluation", binding.invocation) : undefined;
		const abort = () => {
			verificationController.abort();
			const entry = trackedId ? this.owned.get(trackedId) : undefined;
			if (trackedId && entry) this.stop(trackedId, entry);
		};
		signal?.addEventListener("abort", abort, { once: true });
		const track = (reference: Ref) => {
			const attempt = this.store.get(context, reference);
			check(attempt.kind === "attempts", "INVALID_INPUT", "An offline attempt is required");
			const target = this.store.get(context, attempt.data.targetRef);
			check(
				target.data.kind === "cli" &&
					target.data.adapterVersion === "vz-offline-store-1" &&
					target.data.clientVersion === "ae-offline-fake-cli-1",
				"INVALID_INPUT",
				"Only fixed offline attempts are accepted",
			);
			const runtime = new ExternalEvaluationRuntime(
				this.runtimeRoot,
				hash([base.domain.principalId, base.domain.workspaceId]),
			);
			check(
				runtime.configurationFingerprint(attempt.id) === attempt.data.configDigest,
				"VERSION_CONFLICT",
				"Frozen runtime changed",
			);
			trackedId = attempt.id;
			this.owned.set(attempt.id, { clientId: binding.clientId, runtime });
		};
		try {
			if (describing || preparing) {
				let enrollment;
				try {
					enrollment = readOfflineEnrollment(this.dataDir);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ENOENT")
						check(
							false,
							"CAPABILITY_UNAVAILABLE",
							"The fixed offline backend has not been enrolled by an administrator",
						);
					throw error;
				}
				verify();
				if (describing)
					return {
						available: true,
						target: "ae-offline-fake-cli-1",
						modes: modes.filter((mode) => supportsArtifacts(enrollment.guest) || !mode.startsWith("artifacts-")),
						policy: OFFLINE_EXECUTION_POLICY,
						businessSuccess: "unverified",
						artifacts: supportsArtifacts(enrollment.guest) ? "partial" : "unsupported",
						verifier: supportsArtifacts(enrollment.guest) ? "partial" : "unsupported",
					};
				const data = request.data!;
				check(
					!data.argv[0].startsWith("artifacts-") || supportsArtifacts(enrollment.guest),
					"CAPABILITY_UNAVAILABLE",
					"The immutable old enrollment has no artifact export; explicit new enrollment required",
				);
				const reference = this.bridge.prepare(context, {
					requestId: request.requestId,
					contractRef: request.ref!,
					backend: enrollment.backend,
					guest: {
						...enrollment.guest,
						argv: [...data.argv],
						stdinBase64: Buffer.from(data.stdin ?? "").toString("base64"),
					},
					timeoutMs: data.timeoutMs,
					graceMs: data.graceMs,
				});
				track(reference);
				return reference;
			}
			track(request.ref!);
			switch (request.action) {
				case "offlineStart":
					return await this.bridge.start(context, request.ref!);
				case "offlineStatus":
				case "offlineReconcile":
					return await this.bridge.status(context, request.ref!);
				case "offlineCancel":
					return await this.bridge.cancel(context, request.ref!);
				case "offlineSeal":
					return await this.bridge.seal(context, request.ref!, verificationController.signal);
				case "offlineCleanup": {
					const result = await this.bridge.cleanup(context, request.ref!, verificationController.signal);
					this.owned.delete(trackedId!);
					return result;
				}
			}
		} catch (error) {
			try {
				verify();
			} catch {
				abort();
			}
			throw error;
		} finally {
			signal?.removeEventListener("abort", abort);
			this.identities.delete(context);
			this.verifications.delete(verificationController);
		}
	}
}
