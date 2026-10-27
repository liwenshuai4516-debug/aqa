/** Host-private lifecycle for one enrolled, diskless/no-network VZ environment at a time.
 * The independent worker owns the native ChildProcess. No saved PID is ever used for control.
 * This is not yet a CLI ExecutionAdapter or a plugin API; callers must supply an authenticated owner digest.
 */
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { redactEvaluationArtifactText } from "./agent/evaluation-evidence.js";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { artifactDigest, type ArtifactSnapshot } from "./external-evaluation-artifacts.js";
import { verifyArtifacts, verifierCodeDigest, verifierManifest } from "./external-evaluation-verifier.js";
import { ExternalEvaluationLog } from "./external-evaluation-log.js";
import {
	ExternalEvaluationGuestSession,
	guestAssets,
	guestInput,
	type OfflineGuestSpec,
} from "./external-evaluation-guest-session.js";

type Identity = { path: string; sha256: string };
export type VZEnrollment = { version: "vz-offline-1"; binary: Identity; kernel: Identity; initrd: Identity };
/** Frozen offline policy; backend --describe must report the actual VZ configuration below. */
export const OFFLINE_EXECUTION_POLICY = Object.freeze({
	cpuCount: 2,
	memoryBytes: 512 * 1024 * 1024,
	networkDevices: 0,
	shares: 0,
	disks: 0,
	sockets: 0,
	watchdogSeconds: 45,
	timeoutMsMax: 30000,
	graceMsMax: 2000,
	guestStreamBytes: 65536,
	stdinBytes: 65536,
	argvItems: 16,
	argvBytes: 8192,
	concurrentEnvironments: 1,
	waitingInput: "cancel-or-original-timeout",
	interactiveResponse: false,
	modelAccess: false,
});

type Intent = {
	version: 1;
	attemptId: string;
	owner: string;
	nonce: string;
	fingerprint: string;
	backend: VZEnrollment;
	timeoutMs: number;
	graceMs: number;
	guest?: OfflineGuestSpec;
};
type EnvironmentState =
	| "prepared"
	| "blocked"
	| "starting"
	| "running"
	| "waiting-input"
	| "cancelling"
	| "ended"
	| "cancelled"
	| "timed-out"
	| "start-failed"
	| "unknown";
const LOG_LIMITS = { rawBytes: 256 * 1024, lineBytes: 16 * 1024, entries: 256 };
type EnvironmentStatus = {
	attemptId: string;
	state: EnvironmentState;
	stopConfirmed: boolean;
	noEnvironmentStarted?: boolean;
	[key: string]: unknown;
};
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const uuid = (s: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
function fail(code: string, message: string): never {
	throw Object.assign(new Error(message), { code });
}
function privateDirectory(directory: string) {
	const stat = fs.lstatSync(directory);
	if (!stat.isDirectory() || stat.uid !== process.getuid?.() || stat.mode & 0o077)
		fail("PERMISSION_DENIED", "Host-private directory required");
}
function readBytes(file: string): Buffer {
	const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
	try {
		const stat = fs.fstatSync(fd);
		if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.mode & 0o077 || stat.size > 2 * 1024 ** 2)
			fail("EVIDENCE_GAP", "Invalid private runtime record");
		return fs.readFileSync(fd);
	} finally {
		fs.closeSync(fd);
	}
}
function read(file: string): any {
	return JSON.parse(readBytes(file).toString("utf8"));
}
function readIntent(directory: string): Intent {
	const value = read(join(directory, "intent.json"));
	if (
		value.version !== 1 ||
		!uuid(value.attemptId) ||
		!uuid(value.nonce) ||
		!/^[a-f0-9]{64}$/.test(value.owner) ||
		!Number.isInteger(value.timeoutMs) ||
		value.timeoutMs < 1000 ||
		value.timeoutMs > 30000 ||
		!Number.isInteger(value.graceMs) ||
		value.graceMs < 50 ||
		value.graceMs > 2000 ||
		hash(
			JSON.stringify({
				backend: value.backend,
				timeoutMs: value.timeoutMs,
				graceMs: value.graceMs,
				...(value.guest ? { guest: value.guest } : {}),
			}),
		) !== value.fingerprint
	)
		fail("EVIDENCE_GAP", "Launch configuration or identity changed");
	if (value.guest) guestInput(value.guest);
	return value;
}
function syncDirectory(directory: string) {
	const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
	try {
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
}
function withAdmissionLock<T>(root: string, action: () => T): T {
	const file = join(root, "admission.lock");
	let fd: number;
	try {
		fd = fs.openSync(
			file,
			fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
			0o600,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			fail("EXECUTION_UNKNOWN", "Admission mutation is locked; never clear a stale lock automatically");
		throw error;
	}
	try {
		fs.writeFileSync(fd, randomUUID());
		fs.fsyncSync(fd);
		syncDirectory(root);
		return action();
	} finally {
		fs.closeSync(fd);
		fs.unlinkSync(file);
		syncDirectory(root);
	}
}
function publish(directory: string, name: string, value: unknown, replace = false) {
	const bytes = Buffer.from(JSON.stringify(value));
	if (bytes.length > 2 * 1024 ** 2) fail("LIMIT_EXCEEDED", "Runtime record exceeds budget");
	const temporary = join(directory, `.pending-${randomUUID()}`),
		file = join(directory, name);
	const fd = fs.openSync(
		temporary,
		fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
		0o600,
	);
	try {
		fs.writeFileSync(fd, bytes);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
	// link publishes immutable records without a check-then-rename overwrite window. Failed temporaries remain evidence.
	if (replace) fs.renameSync(temporary, file);
	else {
		fs.linkSync(temporary, file);
		fs.unlinkSync(temporary);
	}
	syncDirectory(directory);
}
function nativeStart(pid: number) {
	return execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", timeout: 5000 }).trim();
}
export function probeOfflineBackend(backend: VZEnrollment) {
	if (process.platform !== "darwin" || process.arch !== "arm64")
		fail("CAPABILITY_UNAVAILABLE", "Offline VZ requires macOS arm64");
	if (backend?.version !== "vz-offline-1") fail("SCHEMA_UNSUPPORTED", "Unknown VZ enrollment version");
	const expected = [backend.binary, backend.kernel, backend.initrd];
	const maximums = [8, 40, 16];
	for (let i = 0; i < expected.length; i++) {
		const item = expected[i];
		if (!item || typeof item.path !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256))
			fail("INVALID_INPUT", "Invalid enrolled identity");
		const stat = fs.lstatSync(item.path);
		if (
			!stat.isFile() ||
			fs.realpathSync(item.path) !== item.path ||
			stat.size > maximums[i] * 1024 ** 2 ||
			hash(fs.readFileSync(item.path)) !== item.sha256
		)
			fail("VERSION_CONFLICT", "Enrolled binary or boot input changed");
	}
	if (
		backend.kernel.sha256 !== "42a15047f7cfc785e008b43f48c090f6340f34ead8446d7568126bb5cb9bc9f1" ||
		backend.initrd.sha256 !== "aee79b02c16c87fb0b6180a4d652d51b0115d2f2c8a69c20f8e917ff602fe26e"
	)
		fail("VERSION_CONFLICT", "Only the pinned offline Alpine boot inputs are enrolled");
	if (execFileSync("/usr/sbin/sysctl", ["-n", "kern.hv_support"], { encoding: "utf8", timeout: 5000 }).trim() !== "1")
		fail("CAPABILITY_UNAVAILABLE", "Hardware virtualization unavailable");
	execFileSync("/usr/bin/codesign", ["--verify", "--strict", backend.binary.path], { stdio: "pipe", timeout: 5000 });
	const entitlement = execFileSync("/usr/bin/codesign", ["-d", "--entitlements", ":-", backend.binary.path], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 5000,
	});
	if (!/<key>com\.apple\.security\.virtualization<\/key>\s*<true\s*\/>/.test(entitlement))
		fail("CAPABILITY_UNAVAILABLE", "Enrolled helper lacks virtualization entitlement");
	const profile = JSON.parse(
		execFileSync(backend.binary.path, ["--describe"], {
			encoding: "utf8",
			timeout: 5000,
			maxBuffer: 4096,
			env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
		}),
	);
	if (
		profile.event !== "profile" ||
		profile.helperVersion !== "ae-vz-offline-1" ||
		["cpuCount", "memoryBytes", "networkDevices", "shares", "disks", "sockets", "watchdogSeconds"].some(
			(key) => profile[key] !== OFFLINE_EXECUTION_POLICY[key as keyof typeof OFFLINE_EXECUTION_POLICY],
		)
	)
		fail("CAPABILITY_UNAVAILABLE", "Enrolled helper resource policy differs");
	return { helperVersion: "ae-vz-offline-1", policy: OFFLINE_EXECUTION_POLICY };
}

/** Exact persisted configuration bytes; validation still occurs at prepare/start. */
export function offlineExecutionConfiguration(
	backend: VZEnrollment,
	timeoutMs: number,
	graceMs: number,
	guest?: OfflineGuestSpec,
) {
	const frozen = {
		version: backend.version,
		binary: { ...backend.binary },
		kernel: { ...backend.kernel },
		initrd: { ...backend.initrd },
	};
	const frozenGuest = guest
		? {
				version: guest.version,
				target: { ...guest.target },
				runner: { ...guest.runner },
				argv: [...guest.argv],
				stdinBase64: guest.stdinBase64,
			}
		: undefined;
	const fingerprint = hash(
		JSON.stringify({ backend: frozen, timeoutMs, graceMs, ...(frozenGuest ? { guest: frozenGuest } : {}) }),
	);
	return { backend: frozen, timeoutMs, graceMs, ...(frozenGuest ? { guest: frozenGuest } : {}), fingerprint };
}

export class ExternalEvaluationRuntime {
	private static readonly probes = new Map<string, Promise<EnvironmentStatus>>();
	readonly root: string;
	constructor(
		root: string,
		private readonly owner: string,
	) {
		if (!/^[a-f0-9]{64}$/.test(owner)) fail("PERMISSION_DENIED", "Authenticated owner digest required");
		this.root = fs.realpathSync(root);
		privateDirectory(this.root);
	}
	private intent(attemptId: string): { directory: string; intent: Intent } {
		if (!uuid(attemptId)) fail("INVALID_INPUT", "A server-generated attempt UUID is required");
		const directory = join(this.root, attemptId);
		privateDirectory(directory);
		const intent = readIntent(directory);
		if (intent.owner !== this.owner) fail("PERMISSION_DENIED", "Attempt belongs to a different owner");
		if (intent.version !== 1 || intent.attemptId !== attemptId || !uuid(intent.nonce))
			fail("EVIDENCE_GAP", "Invalid launch intent");
		return { directory, intent };
	}
	configurationFingerprint(attemptId: string) {
		return this.intent(attemptId).intent.fingerprint;
	}
	prepare(attemptId: string, backend: VZEnrollment, timeoutMs: number, graceMs: number, guest?: OfflineGuestSpec) {
		if (
			!uuid(attemptId) ||
			!Number.isInteger(timeoutMs) ||
			timeoutMs < 1000 ||
			timeoutMs > 30000 ||
			!Number.isInteger(graceMs) ||
			graceMs < 50 ||
			graceMs > 2000
		)
			fail("INVALID_INPUT", "Invalid offline environment limits");
		probeOfflineBackend(backend);
		const capacity = fs.statfsSync(this.root);
		if (capacity.bavail * capacity.bsize < 32 * 1024 ** 2)
			fail("LIMIT_EXCEEDED", "Insufficient environment evidence capacity");
		if (guest) guestAssets(guest);
		const configuration = offlineExecutionConfiguration(backend, timeoutMs, graceMs, guest);
		const { backend: frozen, guest: frozenGuest, fingerprint } = configuration;
		const directory = join(this.root, attemptId);
		if (fs.existsSync(directory)) {
			const prior = this.intent(attemptId).intent;
			if (prior.fingerprint !== fingerprint) fail("VERSION_CONFLICT", "Prepared attempt configuration changed");
			return { attemptId, fingerprint };
		}
		fs.mkdirSync(directory, { mode: 0o700 });
		syncDirectory(this.root);
		publish(directory, "intent.json", {
			version: 1,
			attemptId,
			owner: this.owner,
			nonce: randomUUID(),
			fingerprint,
			backend: frozen,
			...(frozenGuest ? { guest: frozenGuest } : {}),
			timeoutMs,
			graceMs,
		});
		return { attemptId, fingerprint };
	}
	async start(attemptId: string) {
		const { directory, intent } = this.intent(attemptId);
		if (fs.existsSync(join(directory, "launch.json"))) return this.status(attemptId);
		if (!fileURLToPath(import.meta.url).endsWith(".js"))
			fail("CAPABILITY_UNAVAILABLE", "Build the host runtime before launching an offline environment");
		probeOfflineBackend(intent.backend);
		if (intent.guest) guestAssets(intent.guest);
		try {
			publish(directory, "launch.json", {
				action: "start",
				attemptId,
				nonce: intent.nonce,
				at: new Date().toISOString(),
			});
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") return this.status(attemptId);
			throw error;
		}
		try {
			withAdmissionLock(this.root, () => publish(this.root, "admission.json", { attemptId, nonce: intent.nonce }));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			publish(directory, "result.json", {
				attemptId,
				nonce: intent.nonce,
				state: "blocked",
				stopConfirmed: true,
				noEnvironmentStarted: true,
			});
			fail("EXECUTION_UNKNOWN", "An unreleased environment admission blocks this launch");
		}
		const descriptors: number[] = [];
		try {
			const out = fs.openSync(join(directory, "worker.stdout"), "wx", 0o600);
			descriptors.push(out);
			const err = fs.openSync(join(directory, "worker.stderr"), "wx", 0o600);
			descriptors.push(err);
			const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), "--supervise", directory], {
				detached: true,
				stdio: ["ignore", out, err],
				env: {
					PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
					...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
				},
			});
			await once(worker, "spawn");
			worker.unref();
		} finally {
			for (const fd of descriptors) fs.closeSync(fd);
		}
		return { state: "starting" as EnvironmentState, attemptId, stopConfirmed: false };
	}
	async status(attemptId: string): Promise<EnvironmentStatus> {
		// Recheck ownership/frozen input before sharing an in-flight probe in this host.
		const { directory } = this.intent(attemptId);
		const existing = ExternalEvaluationRuntime.probes.get(directory);
		if (existing) return existing;
		const pending = this.observeStatus(attemptId).finally(() => ExternalEvaluationRuntime.probes.delete(directory));
		ExternalEvaluationRuntime.probes.set(directory, pending);
		return pending;
	}
	private async observeStatus(attemptId: string): Promise<EnvironmentStatus> {
		const { directory, intent } = this.intent(attemptId);
		const terminal = join(directory, "result.json");
		if (fs.existsSync(terminal)) {
			const value = read(terminal);
			if (
				value.attemptId !== attemptId ||
				value.nonce !== intent.nonce ||
				typeof value.stopConfirmed !== "boolean" ||
				!["blocked", "cancelled", "timed-out", "ended", "start-failed", "unknown"].includes(value.state)
			)
				fail("EVIDENCE_GAP", "Invalid terminal record");
			if (
				value.noEnvironmentStarted === true &&
				(fs.existsSync(join(directory, "native-handle.json")) ||
					!["blocked", "cancelled", "start-failed"].includes(value.state))
			)
				fail("EVIDENCE_GAP", "No-start claim conflicts with native launch evidence");
			if (value.stopConfirmed && value.noEnvironmentStarted !== true) {
				for (const [name, file] of [
					["console", "console.raw"],
					["native", "native.raw"],
				]) {
					const bytes = readBytes(join(directory, file)),
						manifest = value.logs?.[name];
					if (
						bytes.length > LOG_LIMITS.rawBytes ||
						manifest?.storedBytes !== bytes.length ||
						hash(bytes) !== manifest.sha256 ||
						manifest.durable !== true ||
						manifest.streamEnded !== true
					)
						fail("EVIDENCE_GAP", "Terminal log proof is missing or changed");
				}
				const native = readBytes(join(directory, "native.raw")).toString("utf8").split("\n");
				const confirmed = native.some((line) => {
					try {
						const event = JSON.parse(line);
						return event.event === "guest-stopped" || (event.event === "force-stopped" && event.state === 0);
					} catch {
						return false;
					}
				});
				if (!confirmed || value.exit?.[0] !== 0 || value.exit?.[1] !== null)
					fail("EVIDENCE_GAP", "Native stop was not confirmed");
			}
			if (intent.guest && value.stopConfirmed && !value.noEnvironmentStarted) {
				for (const channel of ["stdout", "stderr"]) {
					const bytes = readBytes(join(directory, `guest-${channel}.raw`)),
						manifest = value.guest?.logs?.[channel];
					if (
						bytes.length > 65536 ||
						manifest?.storedBytes !== bytes.length ||
						hash(bytes) !== manifest.sha256 ||
						manifest.durable !== true ||
						typeof manifest.streamEnded !== "boolean" ||
						manifest.interrupted !== !manifest.streamEnded
					)
						fail("EVIDENCE_GAP", "Guest log proof is missing or changed");
				}
			}
			return value;
		}
		if (!fs.existsSync(join(directory, "launch.json")))
			return { state: "prepared" as EnvironmentState, attemptId, stopConfirmed: true };
		const requestId = randomUUID();
		publish(directory, "probe.json", { requestId, nonce: intent.nonce }, true);
		const deadline = performance.now() + 1500;
		while (performance.now() < deadline) {
			const file = join(directory, "probe-response.json");
			if (fs.existsSync(file)) {
				const response = read(file);
				if (response.requestId === requestId && response.nonce === intent.nonce && response.attemptId === attemptId) {
					const handle = read(join(directory, "supervisor.json"));
					if (response.instance !== handle.instance || handle.nonce !== intent.nonce || handle.attemptId !== attemptId)
						fail("EVIDENCE_GAP", "Live supervisor identity mismatch");
					if (fs.existsSync(join(directory, "unknown.json")) && !fs.existsSync(join(directory, "reconciled.json")))
						publish(directory, "reconciled.json", {
							nonce: intent.nonce,
							instance: response.instance,
							at: new Date().toISOString(),
							state: response.state,
						});
					return response;
				}
			}
			if (fs.existsSync(terminal)) return this.observeStatus(attemptId);
			await pause(25);
		}
		if (!fs.existsSync(join(directory, "unknown.json")))
			publish(directory, "unknown.json", { nonce: intent.nonce, at: new Date().toISOString(), requestId });
		return {
			state: "unknown" as EnvironmentState,
			attemptId,
			stopConfirmed: false,
			reason: "No fresh supervisor response; never replay automatically",
		};
	}
	async cancel(attemptId: string) {
		const { directory, intent } = this.intent(attemptId);
		if (!fs.existsSync(join(directory, "launch.json"))) {
			try {
				publish(directory, "launch.json", { action: "cancel-before-start", attemptId, nonce: intent.nonce });
				publish(directory, "result.json", {
					attemptId,
					nonce: intent.nonce,
					state: "cancelled",
					stopConfirmed: true,
					noEnvironmentStarted: true,
				});
				return this.status(attemptId);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
		}
		try {
			publish(directory, "cancel.json", { nonce: intent.nonce, at: new Date().toISOString() });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		return this.status(attemptId);
	}

	/** Terminal, redacted projection for the unified store. Private raw bytes never leave this boundary. */
	async terminalEvidence(attemptId: string) {
		const status = await this.status(attemptId);
		const { directory, intent } = this.intent(attemptId);
		if (!status.stopConfirmed || !fs.existsSync(join(directory, "result.json")))
			fail("EXECUTION_UNKNOWN", "Terminal evidence requires confirmed stop");
		const logs = [];
		if (intent.guest && !status.noEnvironmentStarted) {
			for (const channel of ["stdout", "stderr"] as const) {
				const bytes = readBytes(join(directory, `guest-${channel}.raw`));
				const manifest = (status.guest as any)?.logs?.[channel];
				if (hash(bytes) !== manifest?.sha256 || bytes.length !== manifest.storedBytes)
					fail("EVIDENCE_GAP", "Guest log changed during evidence read");
				const gaps: string[] = [];
				if (!manifest.streamEnded) gaps.push("interrupted");
				if (manifest.observedBytes > bytes.length) gaps.push(manifest.gaps?.unrecorded?.reason ?? "unrecorded-bytes");
				for (const entry of manifest.entries ?? [])
					if (entry.kind === "gap" && typeof entry.reason === "string") gaps.push(entry.reason);
				if (manifest.gaps?.entryLimit) gaps.push("entry-limit");
				if (!isUtf8(bytes)) gaps.push("invalid-utf8");
				let text: string | undefined;
				const redaction = new Set<string>();
				if (isUtf8(bytes)) {
					try {
						// Whole JSON and JSONL both use the existing artifact credential projection.
						const whole = redactEvaluationArtifactText(bytes.toString("utf8"));
						whole.redaction.forEach((item) => redaction.add(item));
						text = whole.text
							.split("\n")
							.map((line) => {
								const clean = redactEvaluationArtifactText(line);
								clean.redaction.forEach((item) => redaction.add(item));
								// A partial structured credential cannot safely fall back to plain text.
								if (/"(?:password|secret|token|api[-_]?key|authorization|cookie|credential)"\s*:/i.test(line))
									JSON.parse(line);
								return clean.text;
							})
							.join("\n");
					} catch {
						gaps.push("redaction-unavailable");
						text = undefined;
					}
				}
				logs.push({
					channel,
					sha256: manifest.sha256 as string,
					storedBytes: bytes.length,
					observedBytes: manifest.observedBytes as number,
					droppedBytes: Math.max(0, manifest.observedBytes - bytes.length),
					streamEnded: manifest.streamEnded as boolean,
					gaps: [...new Set(gaps)],
					redaction: [...redaction],
					...(text === undefined ? {} : { text }),
				});
			}
		}
		return {
			fingerprint: intent.fingerprint,
			state: status.state,
			stopConfirmed: true,
			noEnvironmentStarted: status.noEnvironmentStarted === true,
			observedAt: fs.statSync(join(directory, "result.json")).mtime.toISOString(),
			reportedExit: (status.guest as any)?.reportedExit ?? null,
			logs,
			artifacts: (status.guest as any)?.artifacts as ArtifactSnapshot | undefined,
			timings: (status as any).timings ?? [],
		};
	}

	async verify(attemptId: string, signal?: AbortSignal) {
		const bundle = await this.terminalEvidence(attemptId);
		const { directory, intent } = this.intent(attemptId);
		if (!bundle.artifacts || !intent.guest?.argv[0]?.startsWith("artifacts-")) return undefined;
		const { digest, ...body } = bundle.artifacts;
		if (artifactDigest(body) !== digest) fail("EVIDENCE_GAP", "Frozen artifact manifest changed");
		const binding = {
			artifactSnapshotId: digest,
			fixtureDigest: verifierManifest.fixtureDigest,
			verifierCodeDigest,
			configDigest: intent.fingerprint,
		};
		const filename = join(directory, "verification.json");
		if (fs.existsSync(filename)) {
			const saved = read(filename);
			if (JSON.stringify(saved.binding) !== JSON.stringify(binding))
				fail("VERSION_CONFLICT", "Verification input or trusted version changed");
			return saved.result;
		}
		// Claim before launching. A crashed controller is unknown and never silently reruns verification.
		try {
			publish(directory, "verification-intent.json", binding);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST")
				fail("EXECUTION_UNKNOWN", "Verification was interrupted or is active; do not replay");
			throw error;
		}
		const checked = await verifyArtifacts(
			bundle.artifacts,
			intent.guest?.argv[0] === "artifacts-crash" ? "crash" : "normal",
			signal,
		);
		const result = { ...checked, verificationId: artifactDigest([attemptId, binding]), attemptId };
		publish(directory, "verification.json", { binding, result });
		return result;
	}

	async cleanup(attemptId: string) {
		const { directory, intent } = this.intent(attemptId);
		const status = await this.status(attemptId);
		if (status.stopConfirmed !== true || !fs.existsSync(join(directory, "result.json")))
			fail("EXECUTION_UNKNOWN", "Unconfirmed stop blocks cleanup and subsequent launches");
		withAdmissionLock(this.root, () => {
			const admissionFile = join(this.root, "admission.json");
			const admission = fs.existsSync(admissionFile) ? read(admissionFile) : undefined;
			const ownsAdmission = admission?.attemptId === attemptId && admission.nonce === intent.nonce;
			if (!ownsAdmission && !status.noEnvironmentStarted && !fs.existsSync(join(directory, "cleanup.json")))
				fail("EVIDENCE_GAP", "Environment admission was lost");
			if (!fs.existsSync(join(directory, "cleanup.json")))
				publish(directory, "cleanup.json", { attemptId, nonce: intent.nonce, evidenceRetained: true });
			if (ownsAdmission) {
				fs.unlinkSync(admissionFile);
				syncDirectory(this.root);
			}
		});
		return { attemptId, released: true, evidenceRetained: true };
	}
}

async function supervise(directory: string) {
	privateDirectory(directory);
	const intent = readIntent(directory);
	const launch = read(join(directory, "launch.json")),
		admission = read(join(dirname(directory), "admission.json"));
	if (
		launch.action !== "start" ||
		launch.nonce !== intent.nonce ||
		admission.attemptId !== intent.attemptId ||
		admission.nonce !== intent.nonce
	)
		fail("PERMISSION_DENIED", "Worker lacks an admitted launch intent");
	const instance = randomUUID();
	publish(directory, "worker-claim.json", { nonce: intent.nonce, instance });
	publish(directory, "supervisor.json", {
		attemptId: intent.attemptId,
		nonce: intent.nonce,
		instance,
		pid: process.pid,
		nativeStart: nativeStart(process.pid),
	});
	const workerBegan = Number(process.hrtime.bigint()) / 1e6;
	let child: ChildProcess | undefined, timer: ReturnType<typeof setInterval> | undefined;
	let stdout: ExternalEvaluationLog | undefined, stderr: ExternalEvaluationLog | undefined;
	let guest: ExternalEvaluationGuestSession | undefined;
	let cancellation: { reason: "cancelled" | "timed-out" | "ended" | "start-failed"; at: number } | undefined,
		forced = false,
		childStarted = false;
	let runtimeFailure: string | undefined;
	let childExit: Promise<[number | null, NodeJS.Signals | null]> | undefined;
	try {
		probeOfflineBackend(intent.backend);
		stdout = await ExternalEvaluationLog.create(join(directory, "console.raw"), "stdout", LOG_LIMITS);
		stderr = await ExternalEvaluationLog.create(join(directory, "native.raw"), "stderr", LOG_LIMITS);
		child = spawn(intent.backend.binary.path, [intent.backend.kernel.path, intent.backend.initrd.path], {
			stdio: ["pipe", "pipe", "pipe"],
			env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
		});
		const spawned = once(child, "spawn");
		childExit = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
		childExit.catch(() => {});
		await spawned;
		childStarted = true;
		// stderr belongs to the enrolled native helper; guest console output is never lifecycle authority.
		if (intent.guest)
			guest = await ExternalEvaluationGuestSession.create(
				directory,
				child.stdin!,
				intent.nonce,
				intent.guest,
				(sha256) => publish(directory, "guest-input.json", { nonce: intent.nonce, instance, sha256 }),
			);
		const captured = Promise.all([
			guest ? pipeline(child.stdout!, guest.serial, stdout) : pipeline(child.stdout!, stdout),
			pipeline(child.stderr!, stderr),
		]);
		captured.catch((error) => {
			runtimeFailure = String(error).slice(0, 1000);
			child!.kill("SIGUSR1");
		});
		publish(directory, "native-handle.json", {
			pid: child.pid,
			nativeStart: nativeStart(child.pid!),
			instance,
			nonce: intent.nonce,
		});
		const began = performance.now();
		let seenProbe = "";
		timer = setInterval(() => {
			try {
				const events = stderr!.snapshot().entries;
				const running = events.some((entry) => (entry.value as any)?.event === "running");
				const cancelFile = join(directory, "cancel.json");
				const requested = fs.existsSync(cancelFile) && read(cancelFile).nonce === intent.nonce;
				if (running && !cancellation && !requested && performance.now() - began < intent.timeoutMs) guest?.poll();
				if (
					!cancellation &&
					(requested ||
						performance.now() - began >= intent.timeoutMs ||
						(guest?.reportedExit !== null && guest?.reportedExit !== undefined) ||
						guest?.reportedError)
				) {
					cancellation = {
						reason: requested
							? "cancelled"
							: performance.now() - began >= intent.timeoutMs
								? "timed-out"
								: guest?.reportedError
									? "start-failed"
									: "ended",
						at: performance.now(),
					};
					publish(directory, "cancelling.json", { ...cancellation, nonce: intent.nonce, instance });
					child!.kill("SIGUSR2");
				}
				if (cancellation && !forced && performance.now() - cancellation.at >= intent.graceMs) {
					forced = true;
					publish(directory, "force-stop.json", { nonce: intent.nonce, instance, at: performance.now() });
					child!.kill("SIGUSR1");
				}
				const probeFile = join(directory, "probe.json");
				if (fs.existsSync(probeFile)) {
					const probe = read(probeFile);
					if (probe.nonce === intent.nonce && uuid(probe.requestId) && probe.requestId !== seenProbe) {
						seenProbe = probe.requestId;
						publish(
							directory,
							"probe-response.json",
							{
								requestId: probe.requestId,
								nonce: intent.nonce,
								attemptId: intent.attemptId,
								instance,
								state: cancellation
									? "cancelling"
									: guest?.snapshot().waitingInput
										? "waiting-input"
										: running
											? "running"
											: "starting",
								stopReason: cancellation?.reason,
								stopConfirmed: false,
								...(guest ? { guest: guest.snapshot() } : {}),
								logCursors: {
									console: stdout!.snapshot().storedBytes,
									native: stderr!.snapshot().storedBytes,
									durable: false,
								},
							},
							true,
						);
					}
				}
			} catch (error) {
				// A write/control failure must not leave an uncontrolled VM or invent a terminal result.
				clearInterval(timer);
				runtimeFailure = String(error).slice(0, 1000);
				child!.kill("SIGUSR1");
			}
		}, 50);
		const exit = await childExit;
		clearInterval(timer);
		await captured;
		const guestResult = await guest?.finish();
		const events = stderr.snapshot().entries;
		const stopConfirmed =
			exit[0] === 0 &&
			events.some((entry) => {
				const value = entry.value as any;
				return value?.event === "guest-stopped" || (value?.event === "force-stopped" && value.state === 0);
			});
		publish(directory, "result.json", {
			attemptId: intent.attemptId,
			nonce: intent.nonce,
			instance,
			exit,
			stopConfirmed,
			state: stopConfirmed && !runtimeFailure ? (cancellation?.reason ?? "ended") : "unknown",
			forced,
			error: runtimeFailure,
			logs: { console: stdout.snapshot(), native: stderr.snapshot() },
			timings: (() => {
				const end = Number(process.hrtime.bigint()) / 1e6,
					start = guestResult?.agentTiming.startMs,
					stop = guestResult?.agentTiming.endMs;
				return start !== null && start !== undefined && stop !== null && stop !== undefined
					? [
							{ id: "setup", phase: "setup", kind: "span", clockEpoch: instance, startMs: workerBegan, endMs: start },
							{ id: "agent", phase: "agent", kind: "span", clockEpoch: instance, startMs: start, endMs: stop },
							{ id: "cleanup", phase: "cleanup", kind: "span", clockEpoch: instance, startMs: stop, endMs: end },
						]
					: [];
			})(),
			...(guestResult ? { guest: guestResult } : {}),
		});
	} catch (error) {
		if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGUSR1");
		if (stdout && !stdout.destroyed) stdout.destroy();
		if (stderr && !stderr.destroyed) stderr.destroy();
		if (guest) await guest.finish().catch(() => {});
		if (!fs.existsSync(join(directory, "result.json")))
			publish(directory, "result.json", {
				attemptId: intent.attemptId,
				nonce: intent.nonce,
				instance,
				state: childStarted ? "unknown" : "start-failed",
				stopConfirmed: !childStarted,
				noEnvironmentStarted: !childStarted,
				error: String(error).slice(0, 1000),
			});
	} finally {
		clearInterval(timer);
	}
}

if (process.argv[2] === "--supervise" && resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	void supervise(process.argv[3]).catch((error) => {
		process.stderr.write(String(error).slice(0, 1000));
		process.exitCode = 1;
	});
}
