/** Explicit administrator enrollment of the pinned offline backend. Never grants execution.
 * Installation is immutable; failed staging directories and abandoned locks are retained.
 */
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { probeOfflineBackend, type VZEnrollment } from "./external-evaluation-runtime.js";
import { guestAssets, type OfflineGuestSpec } from "./external-evaluation-guest-session.js";

const names = ["binary", "kernel", "initrd", "target", "runner"] as const;
type Name = (typeof names)[number];
const budgets: Record<Name, number> = {
	binary: 8 * 1024 ** 2,
	kernel: 40 * 1024 ** 2,
	initrd: 16 * 1024 ** 2,
	target: 16384,
	runner: 16384,
};
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
function check(ok: unknown, code: string, message: string): asserts ok {
	if (!ok) throw Object.assign(new Error(message), { code });
}
function privateDirectory(path: string) {
	const s = fs.lstatSync(path);
	check(
		s.isDirectory() && fs.realpathSync(path) === path && !(s.mode & 0o077),
		"PERMISSION_DENIED",
		"Enrollment directory must be private and real",
	);
}
function read(path: string, maximum: number, installed = false) {
	const before = fs.lstatSync(path);
	check(before.isFile(), "INVALID_INPUT", "Enrollment asset must be a regular file");
	check(fs.realpathSync(path) === path, "VERSION_CONFLICT", "Enrollment asset must be a real path");
	const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
	try {
		const s = fs.fstatSync(fd);
		check(s.isFile() && s.size <= maximum, "LIMIT_EXCEEDED", "Enrollment asset exceeds budget");
		check(!installed || !(s.mode & 0o077), "PERMISSION_DENIED", "Installed resource must be private");
		const bytes = Buffer.alloc(maximum + 1),
			size = fs.readSync(fd, bytes);
		check(size === s.size && size <= maximum, "VERSION_CONFLICT", "Enrollment asset changed during read");
		return bytes.subarray(0, size);
	} finally {
		fs.closeSync(fd);
	}
}
function sync(path: string) {
	const fd = fs.openSync(path, "r");
	try {
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
}
function write(path: string, bytes: Uint8Array | string, mode = 0o600) {
	const fd = fs.openSync(path, "wx", mode);
	try {
		fs.writeFileSync(fd, bytes);
		fs.fsyncSync(fd);
	} finally {
		fs.closeSync(fd);
	}
}
function configuration(directory: string, hashes: Record<Name, string>) {
	const identity = (name: Name) => ({ path: join(directory, name), sha256: hashes[name] });
	const backend: VZEnrollment = {
		version: "vz-offline-1",
		binary: identity("binary"),
		kernel: identity("kernel"),
		initrd: identity("initrd"),
	};
	const guest: OfflineGuestSpec = {
		version: "ae-offline-fake-cli-1",
		target: identity("target"),
		runner: identity("runner"),
		argv: [],
		stdinBase64: "",
	};
	return { backend, guest };
}
function rootOf(dataDir: string) {
	check(
		typeof dataDir === "string" && dataDir.length > 0,
		"INVALID_INPUT",
		"Explicit application data directory required",
	);
	return join(fs.realpathSync(resolve(dataDir)), "agent-evaluation-runtime");
}
export function readOfflineEnrollment(dataDir: string) {
	const root = rootOf(dataDir),
		directory = join(root, "installation");
	privateDirectory(root);
	privateDirectory(directory);
	let manifest;
	try {
		manifest = JSON.parse(read(join(directory, "enrollment.json"), 8192, true).toString("utf8"));
	} catch (error) {
		if (error instanceof SyntaxError) check(false, "EVIDENCE_GAP", "Enrollment manifest is invalid JSON");
		throw error;
	}
	check(
		manifest &&
			typeof manifest === "object" &&
			!Array.isArray(manifest) &&
			manifest.version === 1 &&
			manifest.hashes &&
			Object.keys(manifest.hashes).sort().join() === [...names].sort().join(),
		"SCHEMA_UNSUPPORTED",
		"Unknown offline enrollment",
	);
	const { version, hashes, enrolledAt, fingerprint } = manifest;
	check(
		Object.keys(manifest).sort().join() === ["version", "hashes", "enrolledAt", "fingerprint"].sort().join() &&
			typeof enrolledAt === "string" &&
			fingerprint === hash(JSON.stringify({ version, hashes, enrolledAt })),
		"EVIDENCE_GAP",
		"Enrollment manifest changed",
	);
	for (const name of names) {
		check(
			/^[a-f0-9]{64}$/.test(hashes[name]) && hash(read(join(directory, name), budgets[name], true)) === hashes[name],
			"EVIDENCE_GAP",
			"Installed offline asset changed",
		);
	}
	const config = configuration(directory, hashes);
	guestAssets(config.guest);
	probeOfflineBackend(config.backend);
	privateDirectory(join(root, "attempts"));
	return { ...config, runtimeRoot: join(root, "attempts"), fingerprint, enrolledAt };
}
export function enrollOfflineRuntime(
	dataDir: string,
	sources: { binary: string; kernel: string; initrd: string },
	guestDirectory: string,
) {
	const root = rootOf(dataDir);
	const bytes = {} as Record<Name, Buffer>,
		hashes = {} as Record<Name, string>;
	for (const name of names) {
		const source =
			name === "target"
				? join(guestDirectory, "guest-cli.sh")
				: name === "runner"
					? join(guestDirectory, "guest-cli-runner.sh")
					: sources[name];
		bytes[name] = read(source, budgets[name]);
		hashes[name] = hash(bytes[name]);
	}
	if (!fs.existsSync(root)) fs.mkdirSync(root, { mode: 0o700 });
	privateDirectory(root);
	const directory = join(root, "installation");
	if (fs.existsSync(directory)) {
		const current = readOfflineEnrollment(dataDir);
		check(
			names.every(
				(name) =>
					(name === "target" || name === "runner" ? current.guest[name] : current.backend[name]).sha256 ===
					hashes[name],
			),
			"VERSION_CONFLICT",
			"A different offline installation already exists; preserve it",
		);
		return current;
	}
	const lock = join(root, "enrollment.lock");
	const lockContents = JSON.stringify({ requestId: randomUUID(), at: new Date().toISOString() });
	try {
		write(lock, lockContents);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			check(false, "STORE_LOCKED", "Offline enrollment is locked; inspect the retained installation first");
		throw error;
	}
	try {
		const staging = fs.mkdtempSync(join(root, ".enroll-"));
		for (const name of names) write(join(staging, name), bytes[name], name === "binary" ? 0o700 : 0o600);
		const config = configuration(staging, hashes);
		guestAssets(config.guest);
		probeOfflineBackend(config.backend);
		const payload = { version: 1, hashes, enrolledAt: new Date().toISOString() };
		write(
			join(staging, "enrollment.json"),
			JSON.stringify({ ...payload, fingerprint: hash(JSON.stringify(payload)) }) + "\n",
		);
		sync(staging);
		if (!fs.existsSync(join(root, "attempts"))) fs.mkdirSync(join(root, "attempts"), { mode: 0o700 });
		privateDirectory(join(root, "attempts"));
		fs.renameSync(staging, directory);
		sync(root);
		return readOfflineEnrollment(dataDir);
	} finally {
		check(read(lock, 1024, true).toString() === lockContents, "EVIDENCE_GAP", "Enrollment lock changed; preserve it");
		fs.unlinkSync(lock);
		sync(root);
	}
}
