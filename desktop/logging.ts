import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { format } from "node:util";
import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export function redactLog(message: string, secrets: string[] = []): string {
	let safe = message;
	for (const secret of secrets.filter(Boolean)) {
		for (const value of new Set([secret, encodeURIComponent(secret)])) safe = safe.split(value).join("[REDACTED]");
	}
	return safe
		.replace(/((?:authorization|cookie)["']?\s*[:=]\s*)[^\n]+/gi, "$1[REDACTED]")
		.replace(
			/((?:authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|token|password)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,
			"$1[REDACTED]",
		)
		.replace(/\b(?:sk|pk)-[\w-]{12,}/g, "[REDACTED]");
}

export function createLogStream(write: (line: string) => void): Transform {
	const decoder = new StringDecoder("utf8");
	let pending = "";
	let oversized = false;
	return new Transform({
		transform(chunk, _encoding, callback) {
			pending += decoder.write(chunk);
			let end: number;
			while ((end = pending.indexOf("\n")) >= 0) {
				write(oversized ? "[oversized log line omitted]" : pending.slice(0, end));
				pending = pending.slice(end + 1);
				oversized = false;
			}
			if (pending.length > 65536) {
				pending = "";
				oversized = true;
			}
			callback();
		},
		flush(callback) {
			pending += decoder.end();
			if (pending) write(oversized ? "[oversized log line omitted]" : pending);
			callback();
		},
	});
}

export function installDesktopLogging(directory: string, secrets: string[]): string {
	mkdirSync(directory, { recursive: true });
	const path = join(directory, `desktop-${Date.now()}.log`);
	for (const level of ["log", "warn", "error"] as const) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			const message = redactLog(format(...args), secrets);
			appendFileSync(path, `${new Date().toISOString()} [${level}] ${message}\n`, { mode: 0o600 });
			original(message);
		};
	}
	return path;
}
