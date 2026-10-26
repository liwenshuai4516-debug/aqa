/** Explicit authorized preparation against the selected Electron project.
 * No business runner, browser, model, Data Space store mutation or public secret capture.
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, access, cp } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { authState, sha256 } from "pi-ui-testing";
import { preparePmsSession } from "./lib/pms-private-session.mjs";

assert.ok(process.argv.includes("--refresh"), "Explicit --refresh required; this sends the configured login request");
assert.equal(process.platform, "darwin", "This entry targets the selected macOS Electron Data Space");
const repo = fileURLToPath(new URL("..", import.meta.url));
const output = join(repo, "tests/scratch/ui-pms-private-preparation", String(Date.now()));
await mkdir(output, { recursive: true });
await cp(fileURLToPath(import.meta.url), join(output, "harness.mjs"));
await cp(join(repo, "tests/lib/pms-private-session.mjs"), join(output, "adapter.mjs"));
const file = join(homedir(), "Library/Application Support/Pi Agent Desktop/data/data-space/store.json");
const before = await readFile(file),
	store = JSON.parse(before);
const result = {
	createdAt: new Date().toISOString(),
	status: "blocked",
	adapterSha256: sha256(await readFile(join(output, "adapter.mjs"))),
	browserSessions: 0,
	modelCalls: 0,
	businessWrites: 0,
	dataSpaceStoreWrites: 0,
	limitations: [
		"Test harness adapter, not an installed Agent capability",
		"Fresh login only; does not refresh persisted Data Space dynamic cache",
		"Recording privacy, actual browser identity/role/data and formal tests remain unverified",
	],
};
let session;
try {
	session = await preparePmsSession({
		store,
		systemId: "e2f5d42d-2781-4e68-a452-4c87c7d1d346",
		envId: "f46a32da-2eac-43ca-86b8-2fa5eca5385c",
		refresh: true,
	});
	const path = await authState({ auth: session.auth });
	assert.ok(path);
	result.status = "private-reference-prepared-browser-unverified";
	result.preparation = session.receipt;
	result.nativeReferenceReadable = true;
} catch (error) {
	// Only adapter-owned constant codes may become public. Never print native transport errors.
	result.blocker = /^PMS private preparation blocked: [a-z-]+$/.test(error.message)
		? error.code
		: "private-preparation-failed";
} finally {
	if (session) {
		const path = process.env[session.auth.reference];
		await session.dispose();
		await assert.rejects(access(path), { code: "ENOENT" });
		await assert.rejects(access(dirname(path)), { code: "ENOENT" });
		assert.equal(process.env[session.auth.reference], undefined);
		result.privateStateRemoved = true;
	}
	result.storeUnchanged = sha256(before) === sha256(await readFile(file));
	await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
}
console.log(JSON.stringify({ output, ...result }, null, 2));
assert.equal(result.storeUnchanged, true, "Selected Data Space changed concurrently; reconcile before continuing");
assert.equal(
	result.status,
	"private-reference-prepared-browser-unverified",
	"Preparation blocked; see sanitized result",
);
