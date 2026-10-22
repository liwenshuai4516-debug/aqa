/** Atomic durable replacement. Callers publish in-memory state only after success. */
import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export function atomicJson(file, value) {
	mkdirSync(dirname(file), { recursive: true });
	const temp = `${file}.tmp.${randomUUID()}`;
	let fd;
	try {
		fd = openSync(temp, "wx", 0o600);
		writeFileSync(fd, JSON.stringify(value, null, "\t"), "utf8");
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		renameSync(temp, file);
	} finally {
		if (fd !== undefined) closeSync(fd);
		rmSync(temp, { force: true });
	}
}
