import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { linkProfile } from "../../scripts/install-profile.mjs";
import { archiveEvidence } from "../../scripts/archive-evidence.mjs";

const roots: string[] = [];
const temp = () => {
	const p = mkdtempSync(join(tmpdir(), "aqa-slim-test-"));
	roots.push(p);
	return p;
};
const file = (root: string, path: string, text = "{}") => {
	mkdirSync(join(root, path, ".."), { recursive: true });
	writeFileSync(join(root, path), text);
};
afterEach(() => {
	for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe("optional dependency compatibility links", () => {
	it("restores imports from a profile and supports repeated linking", () => {
		const root = temp();
		for (const [name, version] of [
			["electron", "44.4.2"],
			["electron-builder", "26.15.3"],
		])
			file(root, `desktop/node_modules/${name}/package.json`, JSON.stringify({ name, version }));
		linkProfile(root, "desktop");
		linkProfile(root, "desktop");
		expect(JSON.parse(readFileSync(join(root, "node_modules/electron/package.json"), "utf8")).name).toBe("electron");
	});
	it("reuses exact-version root dependencies without replacing them", () => {
		const root = temp();
		for (const [name, version] of [
			["electron", "44.4.2"],
			["electron-builder", "26.15.3"],
		]) {
			const content = JSON.stringify({ name, version });
			file(root, `desktop/node_modules/${name}/package.json`, content);
			file(root, `node_modules/${name}/package.json`, content);
		}
		linkProfile(root, "desktop");
		expect(readFileSync(join(root, "node_modules/electron/package.json"), "utf8")).toContain('"version":"44.4.2"');
		expect(existsSync(join(root, "node_modules/electron"))).toBe(true);
	});
	it("refuses to overwrite unrelated installed dependencies without partial linking", () => {
		const root = temp();
		for (const name of ["electron", "electron-builder"])
			file(root, `desktop/node_modules/${name}/package.json`, JSON.stringify({ name, version: "44.4.2" }));
		file(root, "node_modules/electron-builder/package.json", '{"untouched":true}');
		expect(() => linkProfile(root, "desktop")).toThrow("not owned");
		expect(existsSync(join(root, "node_modules/electron"))).toBe(false);
		expect(readFileSync(join(root, "node_modules/electron-builder/package.json"), "utf8")).toContain("untouched");
	});
});

describe("evidence archive", () => {
	it("copies and verifies evidence without deleting originals", () => {
		const root = temp(),
			outside = temp();
		file(root, "docs/evidence/log.json", '{"result":"failed"}');
		const result = archiveEvidence(root, join(root, "docs/evidence"), join(outside, "archive"));
		expect(result.files).toHaveLength(1);
		expect(result.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(readFileSync(join(root, "docs/evidence/log.json"), "utf8")).toContain("failed");
		expect(existsSync(join(outside, "archive/index.json"))).toBe(true);
		expect(() => archiveEvidence(root, join(root, "docs/evidence"), join(outside, "archive"))).toThrow("new directory");
	});
	it("rejects archives inside the repository and dependency directories", () => {
		const root = temp(),
			outside = temp();
		file(root, "docs/evidence/node_modules/package.json");
		expect(() => archiveEvidence(root, join(root, "docs/evidence"), join(root, "archive"))).toThrow("outside");
		expect(() => archiveEvidence(root, join(root, "docs/evidence"), join(outside, "archive"))).toThrow("Not evidence");
	});
});
