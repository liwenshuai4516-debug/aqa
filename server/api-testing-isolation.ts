/** macOS fixture process boundary. Host-only profile generation; no model-supplied paths or targets. */
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Included in stored approval policy; change when the OS execution boundary changes. */
export const API_FIXTURE_ISOLATION_POLICY = "darwin-seatbelt-loopback-v1";

export function prepareApiFixtureIsolation(runRoot: string, pluginRoot: string, port: number): string[] {
	if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))
		throw new Error("API fixture OS isolation requires verified macOS sandbox-exec; no unsandboxed fallback");
	if (!Number.isSafeInteger(port) || port < 8900 || port > 65535) throw new Error("Invalid fixture isolation port");
	const run = realpathSync(runRoot);
	const modules = realpathSync(join(pluginRoot, "node_modules"));
	const packageFile = realpathSync(join(pluginRoot, "package.json"));
	// JSON string quoting is data for SBPL, never interpolated into a shell command.
	const quoted = (path: string): string => {
		if (/[\x00-\x1f\x7f]/.test(path)) throw new Error("Unsupported isolation path characters");
		return JSON.stringify(path);
	};
	const profile = `(version 1)
(deny default)
(allow process* sysctl-read mach-lookup signal file-map-executable)
(allow file-read-metadata)
(allow file-read* (literal "/") (literal "/private") (literal "/private/var") (literal "/opt")
 (subpath "/System") (subpath "/usr") (subpath "/private/preboot") (subpath "/private/var/db/dyld")
 (subpath "/private/var/db/timezone") (subpath "/private/etc") (subpath "/Library/Apple") (subpath "/dev")
 (subpath "/opt/homebrew") (literal ${quoted(realpathSync(process.execPath))})
 (subpath ${quoted(run)}) (subpath ${quoted(modules)}) (literal ${quoted(packageFile)}))
(allow file-write* (subpath ${quoted(run)}) (literal "/dev/null"))
(allow network-outbound (remote ip "localhost:${port}"))
`;
	const path = join(run, "isolation.sb");
	writeFileSync(path, profile, { flag: "wx", mode: 0o600 });
	return ["/usr/bin/sandbox-exec", "-f", path];
}
