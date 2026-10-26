/** Host-owned execution log sink. Raw bytes are authoritative; parsed rows only reference stored ranges.
 * Use pipeline/readable.pipe for backpressure, and retain snapshot() after finish/error. No process status is inferred.
 */
import { Writable } from "node:stream";
import { open, type FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

type Channel = "stdout" | "stderr";
type LogEntry = {
	start: number;
	end: number;
	kind: "json" | "text" | "gap";
	value?: unknown;
	reason?:
		| "line-limit"
		| "invalid-utf8"
		| "invalid-json"
		| "json-depth-limit"
		| "json-number-limit"
		| "raw-limit"
		| "interrupted";
};
export type ExecutionLogLimits = { rawBytes: number; lineBytes: number; entries: number };

export class ExternalEvaluationLog extends Writable {
	private readonly hash = createHash("sha256");
	private readonly rows: LogEntry[] = [];
	private readonly line: Buffer;
	private lineLength = 0;
	private lineStart = 0;
	private longLine = false;
	private observed = 0;
	private stored = 0;
	private streamEnded = false;
	private durable = false;
	private closing?: Promise<void>;
	private writing: Promise<void> = Promise.resolve();
	private failure?: string;
	private entryOverflow?: { start: number; end: number; lines: number };
	private constructor(
		private readonly file: FileHandle,
		private readonly directory: FileHandle,
		readonly channel: Channel,
		private readonly limits: Readonly<ExecutionLogLimits>,
	) {
		super({ highWaterMark: 16 * 1024, decodeStrings: true });
		this.line = Buffer.alloc(limits.lineBytes);
	}
	/** file must be in an already-authorized, host-private attempt evidence directory. Never replaces old evidence. */
	static async create(file: string, channel: Channel, limits: ExecutionLogLimits) {
		if (
			!["stdout", "stderr"].includes(channel) ||
			![limits.rawBytes, limits.lineBytes, limits.entries].every((n) => Number.isSafeInteger(n) && n > 0) ||
			limits.rawBytes > 1024 * 1024 ||
			limits.lineBytes > 64 * 1024 ||
			limits.lineBytes > limits.rawBytes ||
			limits.entries > 1000
		)
			throw new Error("Invalid execution log limits");
		const handle = await open(
			file,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			const directory = await open(dirname(file), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
			return new ExternalEvaluationLog(handle, directory, channel, Object.freeze({ ...limits }));
		} catch (error) {
			await handle.close();
			throw error;
		}
	}
	private add(row: LogEntry) {
		if (this.rows.length < this.limits.entries) this.rows.push(row);
		else if (this.entryOverflow) {
			this.entryOverflow.end = row.end;
			this.entryOverflow.lines++;
		} else this.entryOverflow = { start: row.start, end: row.end, lines: 1 };
	}
	private endLine(end: number, interrupted?: "raw-limit" | "interrupted") {
		const start = this.lineStart;
		if (interrupted || this.longLine) {
			this.add({ start, end, kind: "gap", reason: interrupted ?? "line-limit" });
		} else {
			let bytes = this.line.subarray(0, this.lineLength);
			if (bytes.at(-1) === 13) bytes = bytes.subarray(0, -1);
			if (!isUtf8(bytes)) this.add({ start, end, kind: "gap", reason: "invalid-utf8" });
			else {
				const text = bytes.toString("utf8");
				// Bound consumer clone/serialization depth too; JSON.parse alone accepts much deeper input.
				let depth = 0,
					quoted = false,
					escaped = false,
					tooDeep = false;
				for (const character of text) {
					if (escaped) {
						escaped = false;
						continue;
					}
					if (quoted && character === "\\") {
						escaped = true;
						continue;
					}
					if (character === '"') quoted = !quoted;
					else if (!quoted) {
						if ((character === "[" || character === "{") && ++depth > 64) {
							tooDeep = true;
							break;
						}
						if (character === "]" || character === "}") depth--;
					}
				}
				if (tooDeep) {
					this.add({ start, end, kind: "gap", reason: "json-depth-limit" });
					this.lineLength = 0;
					this.longLine = false;
					this.lineStart = end;
					return;
				}
				let numberOverflow = false;
				try {
					const value: unknown = JSON.parse(text, (_key, value: unknown) => {
						if (typeof value === "number" && !Number.isFinite(value)) {
							numberOverflow = true;
							throw new Error("JSON number exceeds finite range");
						}
						return value;
					});
					this.add({ start, end, kind: "json", value });
				} catch {
					this.add(
						numberOverflow
							? { start, end, kind: "gap", reason: "json-number-limit" }
							: this.channel === "stderr"
								? { start, end, kind: "text", value: text }
								: { start, end, kind: "gap", reason: "invalid-json" },
					);
				}
			}
		}
		this.lineLength = 0;
		this.longLine = false;
		this.lineStart = end;
	}
	private parse(bytes: Buffer, offset: number) {
		let at = 0;
		while (at < bytes.length) {
			const newline = bytes.indexOf(10, at);
			const end = newline === -1 ? bytes.length : newline;
			const length = end - at;
			if (length > this.line.length - this.lineLength) this.longLine = true;
			if (!this.longLine) {
				bytes.copy(this.line, this.lineLength, at, end);
				this.lineLength += length;
			}
			if (newline !== -1) this.endLine(offset + end + 1);
			at = end + 1;
		}
	}
	override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
		this.observed += chunk.length;
		const accepted = chunk.subarray(0, Math.max(0, this.limits.rawBytes - this.stored));
		const write = async () => {
			let at = 0;
			while (at < accepted.length) {
				const { bytesWritten } = await this.file.write(accepted, at, accepted.length - at);
				if (!bytesWritten) throw new Error("Execution log write made no progress");
				const bytes = accepted.subarray(at, at + bytesWritten);
				this.hash.update(bytes);
				this.parse(bytes, this.stored);
				this.stored += bytesWritten;
				at += bytesWritten;
			}
			if (this.observed > this.stored && this.lineStart < this.stored) this.endLine(this.stored, "raw-limit");
		};
		this.writing = write();
		void this.writing.then(() => callback(), callback);
	}
	private closeFile() {
		return (this.closing ??= (async () => {
			try {
				await this.file.sync();
				await this.directory.sync();
				this.durable = true;
			} finally {
				try {
					await this.file.close();
				} finally {
					await this.directory.close();
				}
			}
		})());
	}
	override _final(callback: (error?: Error | null) => void) {
		if (this.lineStart < this.stored) this.endLine(this.stored);
		void this.closeFile().then(() => {
			this.streamEnded = !this.destroyed;
			callback();
		}, callback);
	}
	override _destroy(error: Error | null, callback: (error: Error | null) => void) {
		if (error) this.failure = error.message;
		const close = async () => {
			await this.writing.catch(() => {});
			if (this.lineStart < this.stored) this.endLine(this.stored, "interrupted");
			await this.closeFile();
		};
		void close().then(
			() => callback(error),
			(closeError: Error) => {
				this.failure ??= closeError.message;
				callback(error ?? closeError);
			},
		);
	}
	snapshot() {
		return {
			channel: this.channel,
			observedBytes: this.observed,
			storedBytes: this.stored,
			sha256: this.hash.copy().digest("hex"),
			streamEnded: this.streamEnded,
			interrupted: this.destroyed && !this.streamEnded,
			durable: this.durable,
			failure: this.failure,
			entries: structuredClone(this.rows),
			gaps: {
				...(this.destroyed && !this.streamEnded ? { interruption: { afterStoredBytes: this.stored } } : {}),
				...(this.observed > this.stored
					? {
							unrecorded: {
								start: this.stored,
								end: this.observed,
								reason: this.stored >= this.limits.rawBytes ? "raw-limit" : this.failure ? "io-error" : "pending",
							},
						}
					: {}),
				...(this.entryOverflow ? { entryLimit: { ...this.entryOverflow } } : {}),
			},
		};
	}
}
