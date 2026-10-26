import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { enrollOfflineRuntime, readOfflineEnrollment } from "../../server/external-evaluation-enrollment.js";
const probe = vi.hoisted(() => vi.fn());
vi.mock("../../server/external-evaluation-runtime.js", () => ({ probeOfflineBackend: probe }));
const roots: string[] = [];
afterEach(() => {
	probe.mockReset();
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "offline-enrollment-unit-")));
	roots.push(root);
	const dataDir = join(root, "data"),
		source = join(root, "source");
	fs.mkdirSync(dataDir, { mode: 0o700 });
	fs.mkdirSync(source, { mode: 0o700 });
	const sources = { binary: join(source, "helper"), kernel: join(source, "kernel"), initrd: join(source, "initrd") };
	for (const [name, path] of Object.entries(sources)) fs.writeFileSync(path, name, { mode: 0o600 });
	const assets = fileURLToPath(new URL("../../plugins/agent-evaluation/runtime", import.meta.url));
	const install = () => enrollOfflineRuntime(dataDir, sources, assets);
	return {
		root,
		dataDir,
		sources,
		source,
		assets,
		install,
		directory: join(dataDir, "agent-evaluation-runtime/installation"),
	};
}
it("publishes one private, self-contained installation and reuses it without rewriting or running a VM", () => {
	const f = fixture(),
		result = f.install();
	const manifest = fs.readFileSync(join(f.directory, "enrollment.json"));
	expect(manifest.toString()).not.toContain(f.source);
	expect(fs.readdirSync(f.directory).sort()).toEqual([
		"binary",
		"enrollment.json",
		"initrd",
		"kernel",
		"runner",
		"target",
	]);
	expect(result.backend.binary.path).toBe(join(f.directory, "binary"));
	expect(fs.statSync(result.backend.binary.path).mode & 0o777).toBe(0o700);
	expect(fs.readdirSync(result.runtimeRoot)).toEqual([]);
	const inode = fs.statSync(join(f.directory, "enrollment.json")).ino;
	expect(f.install()).toEqual(result);
	expect(fs.statSync(join(f.directory, "enrollment.json")).ino).toBe(inode);
	expect(fs.readFileSync(join(f.directory, "enrollment.json"))).toEqual(manifest);
	fs.rmSync(f.source, { recursive: true });
	expect(readOfflineEnrollment(f.dataDir)).toEqual(result);
	expect(probe.mock.calls.every(([backend]) => !backend.binary.path.startsWith(f.source))).toBe(true);
});
it("refuses a different requested binary and preserves the original installation", () => {
	const f = fixture(),
		original = f.install();
	const manifest = fs.readFileSync(join(f.directory, "enrollment.json"));
	fs.writeFileSync(f.sources.binary, "other");
	expect(() => f.install()).toThrow("different offline installation");
	expect(fs.readFileSync(join(f.directory, "enrollment.json"))).toEqual(manifest);
	expect(readOfflineEnrollment(f.dataDir)).toEqual(original);
});
it("retains failed staging, publishes nothing and releases only its own lock", () => {
	const f = fixture();
	probe.mockImplementationOnce(() => {
		throw Object.assign(new Error("wrong policy"), { code: "CAPABILITY_UNAVAILABLE" });
	});
	expect(() => f.install()).toThrow("wrong policy");
	const root = join(f.dataDir, "agent-evaluation-runtime");
	expect(fs.existsSync(f.directory)).toBe(false);
	expect(fs.readdirSync(root)).toHaveLength(1);
	expect(fs.readdirSync(root)[0]).toMatch(/^\.enroll-/);
	f.install();
	expect(fs.readdirSync(root).filter((name) => name.startsWith(".enroll-"))).toHaveLength(1);
});
it("leaves an abandoned enrollment lock untouched and refuses another publication", () => {
	const f = fixture(),
		root = join(f.dataDir, "agent-evaluation-runtime");
	fs.mkdirSync(root, { mode: 0o700 });
	fs.writeFileSync(join(root, "enrollment.lock"), "retained", { mode: 0o600 });
	expect(() => f.install()).toThrow("locked");
	expect(fs.readdirSync(root)).toEqual(["enrollment.lock"]);
	expect(fs.readFileSync(join(root, "enrollment.lock"), "utf8")).toBe("retained");
});
it("does not remove a substituted lock on failure", () => {
	const f = fixture(),
		lock = join(f.dataDir, "agent-evaluation-runtime/enrollment.lock");
	probe.mockImplementationOnce(() => {
		fs.writeFileSync(lock, "another owner");
		throw new Error("injected failure");
	});
	expect(() => f.install()).toThrow("lock changed");
	expect(fs.readFileSync(lock, "utf8")).toBe("another owner");
	expect(fs.existsSync(f.directory)).toBe(false);
});
it.each(["null", "{", '{"version":2}', "[1]"])("rejects malformed/unsupported manifest %s without writing", (value) => {
	const f = fixture();
	f.install();
	fs.writeFileSync(join(f.directory, "enrollment.json"), value);
	expect(() => readOfflineEnrollment(f.dataDir)).toThrow();
	expect(fs.readFileSync(join(f.directory, "enrollment.json"), "utf8")).toBe(value);
});
it("rejects changed bytes, injected paths and permissive permissions", () => {
	const f = fixture();
	f.install();
	const target = join(f.directory, "target"),
		original = fs.readFileSync(target);
	fs.writeFileSync(target, "tampered");
	expect(() => readOfflineEnrollment(f.dataDir)).toThrow("asset changed");
	fs.writeFileSync(target, original);
	fs.chmodSync(target, 0o644);
	expect(() => readOfflineEnrollment(f.dataDir)).toThrow("private");
	fs.chmodSync(target, 0o600);
	const manifest = JSON.parse(fs.readFileSync(join(f.directory, "enrollment.json"), "utf8"));
	manifest.paths = { binary: "/arbitrary" };
	fs.writeFileSync(join(f.directory, "enrollment.json"), JSON.stringify(manifest));
	expect(() => readOfflineEnrollment(f.dataDir)).toThrow("manifest changed");
});
it("rejects links/special source types and nonprivate installation roots", () => {
	const f = fixture(),
		link = join(f.source, "link");
	fs.symlinkSync(f.sources.binary, link);
	expect(() => enrollOfflineRuntime(f.dataDir, { ...f.sources, binary: link }, f.assets)).toThrow();
	expect(() => enrollOfflineRuntime(f.dataDir, { ...f.sources, binary: f.source }, f.assets)).toThrow("regular file");
	const root = join(f.dataDir, "agent-evaluation-runtime");
	fs.mkdirSync(root, { mode: 0o755 });
	expect(() => f.install()).toThrow("private");
	expect(fs.readdirSync(root)).toEqual([]);
});
