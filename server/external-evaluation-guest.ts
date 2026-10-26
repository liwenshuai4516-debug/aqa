/** Bounded byte framing for the single-use offline guest diagnostic.
 * A nonce separates boot noise/attempts; it does not authenticate an untrusted guest.
 * Guest frames never establish VM stop, artifact correctness or task success.
 */
const MAX_LINE = 2048;
const MAX_STREAM = 64 * 1024;
const MAX_EVENTS = 1024;
const CHANNELS = new Set([
	"ready",
	"ack",
	"version",
	"initial",
	"started",
	"stdout",
	"stderr",
	"stdout-eof",
	"stderr-eof",
	"exit",
	"error",
]);
export type GuestFrame = { channel: string; bytes: Buffer };
function invalid(message: string): never {
	throw Object.assign(new Error(message), { code: "INVALID_INPUT" });
}
export function encodeGuestInput(argv: string[], stdin: Uint8Array): Buffer {
	if (!Array.isArray(argv) || argv.length > 16 || !(stdin instanceof Uint8Array) || stdin.byteLength > MAX_STREAM)
		invalid("Offline guest input exceeds budget");
	let total = 0;
	const lines = ["AE1", String(argv.length)];
	for (const argument of argv) {
		if (typeof argument !== "string" || argument.includes("\0")) invalid("Invalid guest argv");
		const bytes = Buffer.from(argument);
		if (bytes.toString("utf8") !== argument || bytes.length > 1024 || (total += bytes.length) > 8192)
			invalid("Guest argv must be bounded UTF-8");
		lines.push(`A:${bytes.toString("base64")}`);
	}
	for (let offset = 0; offset < stdin.byteLength; offset += 1024)
		lines.push(`S:${Buffer.from(stdin.subarray(offset, offset + 1024)).toString("base64")}`);
	lines.push("GO", "");
	return Buffer.from(lines.join("\n"));
}
export class GuestProtocolDecoder {
	private pending: number[] = [];
	private dropping = false;
	private observed = 0;
	private entries = 0;
	private ended = new Set<string>();
	private totals = { stdout: 0, stderr: 0 };
	private started = false;
	private exited = false;
	readonly gaps: string[] = [];
	constructor(private readonly nonce: string) {
		if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(nonce)) invalid("Guest nonce must be a UUID");
	}
	private gap(reason: string) {
		if (!this.gaps.includes(reason) && this.gaps.length < 16) this.gaps.push(reason);
	}
	push(chunk: Uint8Array): GuestFrame[] {
		const frames: GuestFrame[] = [];
		for (const byte of chunk) {
			if (++this.observed > 1024 * 1024) {
				this.gap("console-budget");
				break;
			}
			if (byte !== 10) {
				if (!this.dropping) this.pending.push(byte);
				if (this.pending.length > MAX_LINE) {
					this.pending = [];
					this.dropping = true;
					this.gap("line-budget");
				}
				continue;
			}
			if (!this.dropping) {
				const line = Buffer.from(this.pending).toString("latin1").replace(/\r$/, "");
				const prefix = `AE1:${this.nonce}:`;
				if (line.startsWith(prefix)) {
					const rest = line.slice(prefix.length),
						split = rest.indexOf(":");
					const channel = rest.slice(0, split),
						payload = rest.slice(split + 1);
					if (split < 0 || !CHANNELS.has(channel)) this.gap("invalid-frame");
					else {
						const plain = ["started", "exit", "error", "ack"].includes(channel);
						const bytes = Buffer.from(payload, plain ? "ascii" : "base64");
						if (!plain && bytes.toString("base64") !== payload) this.gap("invalid-base64");
						else if (++this.entries > MAX_EVENTS) this.gap("event-budget");
						else if (this.exited) this.gap("after-exit");
						else if (channel === "started") {
							if (this.started || !/^[1-9][0-9]{0,8}$/.test(payload)) this.gap("invalid-start");
							else {
								this.started = true;
								frames.push({ channel, bytes });
							}
						} else if (channel === "exit") {
							if (
								!this.started ||
								this.ended.size !== 2 ||
								!/^(0|[1-9][0-9]{0,2})$/.test(payload) ||
								Number(payload) > 255
							)
								this.gap("invalid-exit");
							else {
								this.exited = true;
								frames.push({ channel, bytes });
							}
						} else if (channel === "stdout" || channel === "stderr") {
							this.totals[channel] += bytes.length;
							if (this.ended.has(channel)) this.gap("after-eof");
							else if (bytes.length > 512 || this.totals[channel] > MAX_STREAM) this.gap("stream-budget");
							else frames.push({ channel, bytes });
						} else if (channel.endsWith("-eof")) {
							const stream = channel.slice(0, -4);
							if (payload || this.ended.has(stream)) this.gap("invalid-eof");
							else {
								this.ended.add(stream);
								frames.push({ channel, bytes });
							}
						} else frames.push({ channel, bytes });
					}
				}
			}
			this.pending = [];
			this.dropping = false;
		}
		return frames;
	}
	finish() {
		if (this.pending.length || this.dropping) this.gap("partial-line");
		if (!this.exited) this.gap("missing-exit");
		return { exited: this.exited, gaps: [...this.gaps] };
	}
}
