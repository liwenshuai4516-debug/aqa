import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { trustedUiEvidenceAuthority } from "../../server/test-asset-reader";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

it("uses only the host's active session for the same real workspace", () => {
	const root = mkdtempSync(join(tmpdir(), "ui-authority-"));
	roots.push(root);
	const workspace = join(root, "workspace"),
		other = join(root, "other"),
		sessionDir = join(root, "session");
	mkdirSync(workspace);
	mkdirSync(other);
	expect(trustedUiEvidenceAuthority(workspace, { cwd: workspace, sessionDir })).toBe(
		join(sessionDir, "ui-review-authority"),
	);
	expect(trustedUiEvidenceAuthority(workspace, { cwd: other, sessionDir })).toBeUndefined();
	expect(trustedUiEvidenceAuthority(workspace, { cwd: workspace })).toBeUndefined();
	expect(trustedUiEvidenceAuthority(workspace, { cwd: join(root, "missing"), sessionDir })).toBeUndefined();
});
