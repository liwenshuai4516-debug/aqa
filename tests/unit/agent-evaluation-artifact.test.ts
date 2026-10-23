import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { readEvaluationArtifact } from "../../server/agent/evaluation-artifact.js";
vi.mock("node:fs", async (original) => {
	const actual = await original<typeof import("node:fs")>();
	return { ...actual, readSync: vi.fn(actual.readSync) };
});
const dirs: string[] = [];
const workspace = () => {
	const dir = fs.mkdtempSync(join(tmpdir(), "evaluation-artifact-"));
	dirs.push(dir);
	return dir;
};
afterEach(() => {
	vi.restoreAllMocks();
	for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
describe("EC03 bounded artifact observation", () => {
	it("reads actual bytes, records absence and keeps binary digests without inventing text", () => {
		const dir = workspace();
		fs.writeFileSync(join(dir, "report.json"), '{"ok":true}');
		const result = readEvaluationArtifact(dir, "report.json");
		expect(result).toMatchObject({
			exists: true,
			text: '{"ok":true}',
			truncated: false,
			redaction: [],
			sha256: createHash("sha256").update('{"ok":true}').digest("hex"),
		});
		expect(readEvaluationArtifact(dir, "missing.txt").exists).toBe(false);
		fs.writeFileSync(join(dir, "image.bin"), Buffer.from([0xff, 0xfe]));
		expect(readEvaluationArtifact(dir, "image.bin")).toMatchObject({ exists: true, size: 2 });
		expect(readEvaluationArtifact(dir, "image.bin").text).toBeUndefined();
	});
	it.each(["../outside", "/outside", "a/../b", "", ".env", "private.key", "auth.json"])(
		"rejects unsafe or credential path %s",
		(path) => {
			expect(() => readEvaluationArtifact(workspace(), path)).toThrow(/artifact|Credential/);
		},
	);
	it("rejects final and ancestor symlinks, and non-regular artifacts", () => {
		const dir = workspace(),
			other = workspace();
		fs.writeFileSync(join(other, "secret"), "outside fixture");
		fs.symlinkSync(join(other, "secret"), join(dir, "link"));
		fs.symlinkSync(other, join(dir, "folder"));
		expect(() => readEvaluationArtifact(dir, "link")).toThrow(/symlink/);
		expect(() => readEvaluationArtifact(dir, "folder/secret")).toThrow(/symlink/);
		execFileSync("mkfifo", [join(dir, "pipe")]);
		expect(() => readEvaluationArtifact(dir, "pipe")).toThrow(/regular/);
		fs.mkdirSync(join(dir, "directory"));
		expect(() => readEvaluationArtifact(dir, "directory")).toThrow(/regular/);
	});
	it("redacts actual secret fields and hashes the derived text explicitly", () => {
		const dir = workspace();
		fs.writeFileSync(
			join(dir, "report.json"),
			JSON.stringify({ apiKey: "fixture-sensitive", note: "Bearer fixture-bearer" }),
		);
		const result = readEvaluationArtifact(dir, "report.json");
		expect(JSON.stringify(result)).not.toContain("fixture-sensitive");
		expect(JSON.stringify(result)).not.toContain("fixture-bearer");
		expect(result.redaction).toContain("credentials-v1");
		expect(result.sha256).toBe(createHash("sha256").update(result.text!).digest("hex"));
	});
	it("bounds both raw bytes and escaped JSON envelopes", () => {
		const dir = workspace();
		fs.writeFileSync(join(dir, "big"), "x".repeat(1024 * 1024 + 1));
		expect(readEvaluationArtifact(dir, "big")).toMatchObject({ exists: true, truncated: true });
		fs.writeFileSync(join(dir, "escaped"), "\n".repeat(600000));
		const result = readEvaluationArtifact(dir, "escaped");
		expect(result.truncated).toBe(true);
		expect(result.text).toBeUndefined();
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024 * 1024);
	});
	it("rejects file replacement observed while reading", () => {
		const dir = workspace();
		fs.writeFileSync(join(dir, "file"), "before");
		const original = vi.mocked(fs.readSync).getMockImplementation()!;
		vi.mocked(fs.readSync).mockImplementation(((...args: any[]) => {
			const n = (original as any)(...args);
			fs.renameSync(join(dir, "file"), join(dir, "old"));
			fs.writeFileSync(join(dir, "file"), "after!");
			return n;
		}) as any);
		expect(() => readEvaluationArtifact(dir, "file")).toThrow(/changed/);
	});
});
