/** Publish a new immutable file; preserve incomplete bytes on failure for explicit recovery. */
import { openSync, closeSync, writeFileSync, fsyncSync, renameSync, existsSync, constants } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export function publishFile(file, bytes, fault = () => {}) {
	const temp = `${file}.tmp-${randomUUID()}`;
	let fd,
		published = false;
	try {
		fault("beforeWrite");
		fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
		writeFileSync(fd, bytes);
		fsyncSync(fd);
		closeSync(fd);
		fd = undefined;
		fault("beforePublish");
		if (existsSync(file)) throw new Error("Immutable revision already exists");
		renameSync(temp, file);
		published = true;
		const directory = openSync(dirname(file), constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			fsyncSync(directory);
		} finally {
			closeSync(directory);
		}
		fault("afterPublish");
	} catch (error) {
		if (fd !== undefined) closeSync(fd);
		error.published = published;
		throw error;
	}
}
