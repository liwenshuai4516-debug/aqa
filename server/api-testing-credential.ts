/** One explicitly configured dedicated test token reference; never persisted in run inputs. */
import { openSync, closeSync, fstatSync, statSync, readFileSync, constants, realpathSync, type Stats } from "node:fs";

const signature = (s: Stats): string => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(":");

export function loadApiTestCredential(path: string, origin: string, projectRoot: string) {
	let descriptor: number | undefined;
	try {
		descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const info = fstatSync(descriptor);
		if (!info.isFile() || info.size > 16384 || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
			throw new Error();
		const value = JSON.parse(readFileSync(descriptor, "utf8"));
		const expiresAt = Date.parse(value.expiresAt);
		if (
			value.origin !== origin ||
			typeof value.projectRoot !== "string" ||
			realpathSync(value.projectRoot) !== projectRoot ||
			typeof value.token !== "string" ||
			!value.token.length ||
			value.token.length > 8192 ||
			/[^\x20-\x7e]/.test(value.token) ||
			!Number.isFinite(expiresAt) ||
			expiresAt <= Date.now()
		)
			throw new Error();
		const initial = signature(info);
		return {
			token: value.token as string,
			expiresAt,
			verify(): void {
				if (Date.now() >= expiresAt || signature(statSync(path)) !== initial)
					throw new Error("API test credential expired or changed");
			},
		};
	} catch {
		// JSON parser and filesystem exceptions may contain file contents or private paths.
		throw new Error("Dedicated API test credential is unavailable, unsafe, mismatched or expired");
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
}
