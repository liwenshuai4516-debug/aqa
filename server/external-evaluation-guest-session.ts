/** Worker-owned connection to the pinned trusted fake CLI. No arbitrary guest program enrollment.
 * The serial protocol is guest-reported data, never authentication or VM stop authority.
 */
import * as fs from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { Transform, type Writable } from "node:stream";
import { encodeGuestInput, GuestProtocolDecoder } from "./external-evaluation-guest.js";
import { ArtifactCollector } from "./external-evaluation-artifacts.js";
import { ExternalEvaluationLog } from "./external-evaluation-log.js";

type Asset = { path: string; sha256: string };
export type OfflineGuestSpec = {
	version: "ae-offline-fake-cli-1";
	target: Asset;
	runner: Asset;
	argv: string[];
	stdinBase64: string;
};
const HASHES = {
	target: "0417f66bcf192fe8eb7e0034cba5e1b7dd72a79fc43d3ea82da1ac1c796aa141",
	runner: "9f979b6d3f89308ad8806c23913d85a35cc12f9f564c7ace06e1ab52a9341a87",
};
export const ARTIFACT_GUEST_HASHES = {
	target: "46cce53db08241997244d3f003cbf1a8d86b494938190502aed1e8e20864b4d1",
	runner: "3ce1b7355250246fde581ab19b1c0a636e0eed3d28f686e6f9047e97928d1d37",
};
export const supportsArtifacts = (spec: OfflineGuestSpec) =>
	spec.target.sha256 === ARTIFACT_GUEST_HASHES.target && spec.runner.sha256 === ARTIFACT_GUEST_HASHES.runner;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function fail(code: string, message: string): never {
	throw Object.assign(new Error(message), { code });
}
export function guestInput(spec: OfflineGuestSpec) {
	if (spec?.version !== "ae-offline-fake-cli-1")
		fail("SCHEMA_UNSUPPORTED", "Only the trusted offline fake CLI is enrolled");
	if (typeof spec.stdinBase64 !== "string" || spec.stdinBase64.length > 87384)
		fail("INVALID_INPUT", "Guest stdin exceeds budget");
	const stdin = Buffer.from(spec.stdinBase64, "base64");
	if (stdin.toString("base64") !== spec.stdinBase64) fail("INVALID_INPUT", "Guest stdin must be canonical base64");
	return encodeGuestInput(spec.argv, stdin);
}
export function guestAssets(spec: OfflineGuestSpec) {
	guestInput(spec);
	const result = {} as Record<"target" | "runner", Buffer>;
	for (const name of ["target", "runner"] as const) {
		const asset = spec[name];
		if (
			!asset ||
			asset.sha256 !== (supportsArtifacts(spec) ? ARTIFACT_GUEST_HASHES[name] : HASHES[name]) ||
			typeof asset.path !== "string"
		)
			fail("VERSION_CONFLICT", "Guest fixture enrollment changed");
		if (fs.realpathSync(asset.path) !== asset.path) fail("VERSION_CONFLICT", "Guest asset must be a real path");
		const fd = fs.openSync(asset.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
		try {
			const stat = fs.fstatSync(fd);
			if (!stat.isFile() || stat.size > 16 * 1024) fail("VERSION_CONFLICT", "Guest asset exceeds budget");
			const bytes = Buffer.alloc(16 * 1024 + 1),
				size = fs.readSync(fd, bytes);
			result[name] = bytes.subarray(0, size);
			if (size !== stat.size || digest(result[name]) !== asset.sha256)
				fail("VERSION_CONFLICT", "Guest asset bytes changed");
		} finally {
			fs.closeSync(fd);
		}
	}
	return result;
}
export class ExternalEvaluationGuestSession {
	readonly serial: Transform;
	failure?: string;
	reportedExit: number | null = null;
	reportedError?: string;
	private shell = "";
	private readonly artifacts: ArtifactCollector;
	private readonly artifactSupport: boolean;
	private agentStart: number | null = null;
	private agentEnd: number | null = null;
	private bootstrapped = false;
	private ready = false;
	private sent = 0;
	private acked = 0;
	private started = false;
	private versionChecked = false;
	private eof = new Set<string>();
	private decoder: GuestProtocolDecoder;
	private input: Buffer;
	private lines: string[];
	private finished = false;
	private closing?: Promise<void>;
	private stdinError = (error: Error) => {
		if (!this.finished) this.failure = error.message.slice(0, 200);
	};
	private constructor(
		private readonly stdin: Writable,
		private readonly nonce: string,
		private readonly assets: Record<"target" | "runner", Buffer>,
		private readonly logs: Record<"stdout" | "stderr", ExternalEvaluationLog>,
		spec: OfflineGuestSpec,
		private readonly claimInput: (sha256: string) => void,
	) {
		this.artifactSupport = supportsArtifacts(spec);
		this.artifacts = new ArtifactCollector(spec.argv[0]?.startsWith("artifacts-") === true);
		this.input = guestInput(spec);
		this.lines = this.input.toString().trimEnd().split("\n");
		this.decoder = new GuestProtocolDecoder(nonce);
		stdin.on("error", this.stdinError);
		for (const log of Object.values(logs))
			log.on("error", (error) => {
				this.failure = error.message.slice(0, 200);
			});
		this.serial = new Transform({
			transform: (chunk: Buffer, _encoding, done) => {
				void this.consume(chunk).then(() => done(null, chunk), done);
			},
		});
	}
	static async create(
		directory: string,
		stdin: Writable,
		nonce: string,
		spec: OfflineGuestSpec,
		claimInput: (sha256: string) => void,
	) {
		const assets = guestAssets(spec);
		const stdout = await ExternalEvaluationLog.create(join(directory, "guest-stdout.raw"), "stdout", {
			rawBytes: 65536,
			lineBytes: 16384,
			entries: 256,
		});
		try {
			const stderr = await ExternalEvaluationLog.create(join(directory, "guest-stderr.raw"), "stderr", {
				rawBytes: 65536,
				lineBytes: 16384,
				entries: 256,
			});
			return new ExternalEvaluationGuestSession(stdin, nonce, assets, { stdout, stderr }, spec, claimInput);
		} catch (error) {
			stdout.destroy();
			await once(stdout, "close");
			throw error;
		}
	}
	private async consume(bytes: Buffer) {
		if (!this.bootstrapped) this.shell = (this.shell + bytes.toString("latin1")).slice(-512);
		for (const frame of this.decoder.push(bytes)) {
			const value = frame.bytes.toString("utf8");
			if (frame.channel === "ready") this.ready = true;
			else if (frame.channel === "ack") {
				if (!/^[1-9][0-9]{0,2}$/.test(value) || Number(value) !== this.sent || Number(value) !== this.acked + 1)
					throw new Error("Guest input acknowledgement changed");
				this.acked = Number(value);
			} else if (frame.channel === "version") {
				if (value !== "ae-offline-fake-cli 1") throw new Error("Guest reported an unexpected fixture version");
				this.versionChecked = true;
			} else if (frame.channel === "initial" && frame.bytes.length)
				throw new Error("Guest work directory is not empty");
			else if (frame.channel === "started") {
				if (!this.versionChecked || this.acked !== this.lines.length)
					throw new Error("Guest started before preflight/input completion");
				this.started = true;
				this.agentStart = Number(process.hrtime.bigint()) / 1e6;
			} else if (frame.channel === "stdout" || frame.channel === "stderr") {
				await new Promise<void>((resolve, reject) =>
					this.logs[frame.channel as "stdout" | "stderr"].write(frame.bytes, (error) =>
						error ? reject(error) : resolve(),
					),
				);
			} else if (frame.channel === "artifact") this.artifacts.add(frame.bytes);
			else if (frame.channel === "artifact-end") this.artifacts.end(value);
			else if (frame.channel === "artifact-error") this.artifacts.reject(value.slice(0, 64));
			else if (frame.channel.endsWith("-eof")) this.eof.add(frame.channel.slice(0, -4));
			else if (frame.channel === "exit") {
				this.reportedExit = Number(value);
				this.agentEnd = Number(process.hrtime.bigint()) / 1e6;
			} else if (frame.channel === "error") this.reportedError = value.slice(0, 64);
		}
		if (this.decoder.gaps.length) throw new Error(`Guest protocol gap: ${this.decoder.gaps.join(",")}`);
	}
	/** Called only by the owned worker after a native running event. One outstanding control record at most. */
	poll() {
		if (this.failure) throw new Error(this.failure);
		if (!this.bootstrapped && this.shell.includes("~ #")) {
			this.claimInput(digest(this.input));
			this.bootstrapped = true;
			const upload = (name: string, bytes: Buffer) =>
				`base64 -d > /ae/${name} <<'AE_END'\n${bytes
					.toString("base64")
					.match(/.{1,76}/g)!
					.join("\n")}\nAE_END\n`;
			this.stdin.write(
				"/bin/busybox --install -s /bin; export PATH=/bin; mount -t devtmpfs devtmpfs /dev; mount -t proc proc /proc; stty -echo; mkdir /ae\n" +
					upload("target", this.assets.target) +
					upload("runner", this.assets.runner) +
					`stty raw -echo; exec /bin/sh /ae/runner ${this.nonce}\n`,
			);
		}
		if (this.ready && this.sent === this.acked && this.sent < this.lines.length) {
			const line = this.lines[this.sent++];
			this.stdin.write(line + "\n");
		}
	}
	snapshot() {
		const stderr = this.logs.stderr.snapshot();
		const waitingInput =
			!this.finished &&
			this.started &&
			this.reportedExit === null &&
			stderr.entries.some((entry) => entry.kind === "text" && entry.value === "waiting-input");
		return {
			waitingInput,
			waitingInputSource: "fixed-fixture stderr; target-reported",
			source: "guest-reported; trusted fixture only",
			agentTiming: { startMs: this.agentStart, endMs: this.agentEnd },
			...(this.artifactSupport ? { artifacts: this.artifacts.freeze() } : {}),
			inputRecordsSent: this.sent,
			inputRecordsAcknowledged: this.acked,
			started: this.started,
			reportedExit: this.reportedExit,
			reportedError: this.reportedError,
			logCursors: {
				stdout: this.logs.stdout.snapshot().storedBytes,
				stderr: stderr.storedBytes,
				durable: this.finished,
			},
		};
	}
	async finish() {
		this.closing ??= (async () => {
			this.stdin.off("error", this.stdinError);
			const results = await Promise.allSettled(
				(["stdout", "stderr"] as const).map(async (channel) => {
					const log = this.logs[channel];
					if (this.eof.has(channel)) {
						log.end();
						await once(log, "finish");
					} else {
						log.destroy();
						await once(log, "close");
					}
				}),
			);
			this.finished = true;
			for (const result of results) if (result.status === "rejected") throw result.reason;
		})();
		await this.closing;
		return {
			...this.snapshot(),
			protocol: this.decoder.finish(),
			logs: { stdout: this.logs.stdout.snapshot(), stderr: this.logs.stderr.snapshot() },
		};
	}
}
