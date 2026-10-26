import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { ExternalEvaluationRuntime, type VZEnrollment } from "../../server/external-evaluation-runtime.js";

const roots: string[] = [],
	owner = "a".repeat(64);
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = fs.mkdtempSync(join(tmpdir(), "evaluation-runtime-unit-"));
	roots.push(root);
	const runtime = new ExternalEvaluationRuntime(root, owner),
		attemptId = randomUUID();
	const directory = join(root, attemptId);
	fs.mkdirSync(directory, { mode: 0o700 });
	const intent = {
		version: 1,
		attemptId,
		owner,
		nonce: randomUUID(),
		fingerprint: "f".repeat(64),
		backend: {},
		timeoutMs: 1000,
		graceMs: 100,
	};
	intent.fingerprint = createHash("sha256")
		.update(JSON.stringify({ backend: intent.backend, timeoutMs: intent.timeoutMs, graceMs: intent.graceMs }))
		.digest("hex");
	const write = (name: string, value: unknown, at = directory) =>
		fs.writeFileSync(join(at, name), JSON.stringify(value), { mode: 0o600 });
	write("intent.json", intent);
	return { root, runtime, attemptId, directory, intent, write };
}
describe("EC06 host VM lifecycle persistence", () => {
	it("refuses mutated frozen guest input before any probe or execution", async () => {
		const f = fixture();
		const guest = { version: "ae-offline-fake-cli-1", target: {}, runner: {}, argv: ["echo"], stdinBase64: "" };
		const intent = { ...f.intent, guest };
		intent.fingerprint = createHash("sha256")
			.update(JSON.stringify({ backend: intent.backend, timeoutMs: intent.timeoutMs, graceMs: intent.graceMs, guest }))
			.digest("hex");
		f.write("intent.json", intent);
		expect((await f.runtime.status(f.attemptId)).state).toBe("prepared");
		f.write("intent.json", { ...intent, guest: { ...guest, stdinBase64: "YQ==" } });
		await expect(f.runtime.status(f.attemptId)).rejects.toMatchObject({ code: "EVIDENCE_GAP" });
		expect(fs.readdirSync(f.directory)).toEqual(["intent.json"]);
	});
	it("refuses a changed frozen timeout before any probe or execution", async () => {
		const f = fixture();
		f.write("intent.json", { ...f.intent, timeoutMs: 2000 });
		await expect(f.runtime.status(f.attemptId)).rejects.toMatchObject({ code: "EVIDENCE_GAP" });
		expect(fs.readdirSync(f.directory)).toEqual(["intent.json"]);
	});
	it("requires an owner digest/private root and refuses path traversal before filesystem effects", async () => {
		const f = fixture();
		expect(() => new ExternalEvaluationRuntime(f.root, "user supplied title")).toThrow("owner");
		fs.chmodSync(f.root, 0o755);
		expect(() => new ExternalEvaluationRuntime(f.root, owner)).toThrow("private");
		fs.chmodSync(f.root, 0o700);
		await expect(f.runtime.start("../escape")).rejects.toMatchObject({ code: "INVALID_INPUT" });
	});
	it("rejects a changed/unsupported enrollment before creating a new attempt", () => {
		const f = fixture(),
			id = randomUUID();
		expect(() => f.runtime.prepare(id, { version: "other" } as unknown as VZEnrollment, 1000, 100)).toThrow();
		expect(fs.existsSync(join(f.root, id))).toBe(false);
		expect(fs.existsSync(join(f.root, "admission.json"))).toBe(false);
	});
	it("refuses foreign-owner status/start/cancel/cleanup without writing a probe or cancellation", async () => {
		const f = fixture(),
			other = new ExternalEvaluationRuntime(f.root, "b".repeat(64));
		for (const action of ["status", "start", "cancel", "cleanup"] as const)
			await expect(other[action](f.attemptId)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(fs.readdirSync(f.directory)).toEqual(["intent.json"]);
	});
	it("durably cancels a prepared environment and never launches it on a later start call", async () => {
		const f = fixture();
		expect(await f.runtime.status(f.attemptId)).toMatchObject({ state: "prepared" });
		expect(await f.runtime.cancel(f.attemptId)).toMatchObject({ state: "cancelled", noEnvironmentStarted: true });
		expect(await f.runtime.start(f.attemptId)).toMatchObject({ state: "cancelled" });
		expect(await f.runtime.cleanup(f.attemptId)).toMatchObject({ released: true, evidenceRetained: true });
		expect(fs.existsSync(join(f.directory, "worker-claim.json"))).toBe(false);
		expect(fs.existsSync(join(f.directory, "intent.json"))).toBe(true);
	});
	it("does not treat old running replies or a saved PID as fresh identity and blocks unconfirmed cleanup", async () => {
		const f = fixture();
		f.write("launch.json", { nonce: f.intent.nonce });
		f.write("admission.json", { attemptId: f.attemptId, nonce: f.intent.nonce }, f.root);
		f.write("native-handle.json", { pid: process.pid, nativeStart: "synthetic replacement" });
		f.write("probe-response.json", {
			state: "running",
			nonce: f.intent.nonce,
			requestId: randomUUID(),
			attemptId: f.attemptId,
		});
		expect(await f.runtime.status(f.attemptId)).toMatchObject({ state: "unknown", stopConfirmed: false });
		expect(fs.existsSync(join(f.directory, "unknown.json"))).toBe(true);
		await expect(f.runtime.cleanup(f.attemptId)).rejects.toMatchObject({ code: "EXECUTION_UNKNOWN" });
		expect(fs.existsSync(join(f.root, "admission.json"))).toBe(true);
		expect(fs.existsSync(join(f.directory, "worker-claim.json"))).toBe(false);
	}, 10000);
	it("keeps a stale mutation lock and refuses cleanup without guessing its owner is dead", async () => {
		const f = fixture();
		await f.runtime.cancel(f.attemptId);
		f.write("admission.lock", { marker: "unknown owner" }, f.root);
		const before = fs.readFileSync(join(f.root, "admission.lock"));
		await expect(f.runtime.cleanup(f.attemptId)).rejects.toMatchObject({ code: "EXECUTION_UNKNOWN" });
		expect(fs.readFileSync(join(f.root, "admission.lock"))).toEqual(before);
	});
	it("reconciles cleanup after ledger publication, releases only its own admission and preserves the next owner's guard", async () => {
		const f = fixture();
		await f.runtime.cancel(f.attemptId);
		f.write("cleanup.json", { attemptId: f.attemptId, nonce: f.intent.nonce, evidenceRetained: true });
		f.write("admission.json", { attemptId: f.attemptId, nonce: f.intent.nonce }, f.root);
		await f.runtime.cleanup(f.attemptId);
		expect(fs.existsSync(join(f.root, "admission.json"))).toBe(false);
		const other = { attemptId: randomUUID(), nonce: randomUUID() };
		f.write("admission.json", other, f.root);
		await f.runtime.cleanup(f.attemptId);
		expect(JSON.parse(fs.readFileSync(join(f.root, "admission.json"), "utf8"))).toEqual(other);
	});
	it("refuses a symlinked terminal record and string-valued stop confirmation", async () => {
		const f = fixture();
		f.write("forged.json", { attemptId: f.attemptId, nonce: f.intent.nonce, state: "ended", stopConfirmed: "true" });
		fs.symlinkSync(join(f.directory, "forged.json"), join(f.directory, "result.json"));
		await expect(f.runtime.status(f.attemptId)).rejects.toThrow();
		fs.unlinkSync(join(f.directory, "result.json"));
		fs.copyFileSync(join(f.directory, "forged.json"), join(f.directory, "result.json"));
		await expect(f.runtime.status(f.attemptId)).rejects.toMatchObject({ code: "EVIDENCE_GAP" });
		f.write("result.json", {
			attemptId: f.attemptId,
			nonce: f.intent.nonce,
			state: "ended",
			stopConfirmed: true,
			noEnvironmentStarted: true,
		});
		await expect(f.runtime.status(f.attemptId)).rejects.toMatchObject({ code: "EVIDENCE_GAP" });
	});
});
