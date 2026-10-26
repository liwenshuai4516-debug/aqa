import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import {
	ExternalEvaluationGuestSession,
	guestAssets,
	guestInput,
	type OfflineGuestSpec,
} from "../../server/external-evaluation-guest-session.js";
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function spec(): OfflineGuestSpec {
	const asset = (name: string) => {
		const path = fileURLToPath(new URL(`../../plugins/agent-evaluation/runtime/${name}`, import.meta.url));
		return { path, sha256: createHash("sha256").update(fs.readFileSync(path)).digest("hex") };
	};
	return {
		version: "ae-offline-fake-cli-1",
		target: asset("guest-cli.sh"),
		runner: asset("guest-cli-runner.sh"),
		argv: ["echo"],
		stdinBase64: "",
	};
}
async function fixture() {
	const root = fs.mkdtempSync(join(tmpdir(), "evaluation-guest-session-")),
		stdin = new PassThrough(),
		nonce = randomUUID(),
		claims: string[] = [];
	roots.push(root);
	stdin.resume();
	const session = await ExternalEvaluationGuestSession.create(root, stdin, nonce, spec(), (hash) => {
		claims.push(hash);
	});
	session.serial.on("error", () => {});
	session.serial.resume();
	const send = async (channel: string, payload = "") =>
		new Promise<void>((resolve, reject) =>
			session.serial.write(Buffer.from(`\nAE1:${nonce}:${channel}:${payload}\n`), (error) =>
				error ? reject(error) : resolve(),
			),
		);
	return { root, stdin, nonce, session, claims, send };
}
describe("worker-owned trusted guest session", () => {
	it("rejects changed profiles/assets and noncanonical stdin before any execution", () => {
		const s = spec();
		expect(guestAssets(s).target.length).toBeGreaterThan(0);
		expect(() => guestInput({ ...s, stdinBase64: "YQ" })).toThrow("canonical");
		expect(() => guestAssets({ ...s, target: { ...s.target, sha256: "a".repeat(64) } })).toThrow("enrollment");
		expect(() => guestInput({ ...s, version: "arbitrary" as any })).toThrow("enrolled");
	});
	it("claims bootstrap once and sends at most one input line until exact acknowledgement", async () => {
		const f = await fixture();
		const writes: string[] = [];
		f.stdin.on("data", (bytes) => writes.push(bytes.toString()));
		await new Promise<void>((resolve, reject) =>
			f.session.serial.write(Buffer.from("~ #"), (error) => (error ? reject(error) : resolve())),
		);
		f.session.poll();
		f.session.poll();
		expect(f.claims).toHaveLength(1);
		expect(writes).toHaveLength(1);
		await f.send("ready");
		f.session.poll();
		f.session.poll();
		expect(writes).toHaveLength(2);
		expect(writes[1]).toBe("AE1\n");
		await f.send("ack", "1");
		f.session.poll();
		expect(writes[2]).toBe("1\n");
		await expect(f.send("ack", "9")).rejects.toThrow("acknowledgement");
		const final = await f.session.finish();
		expect(final.logs.stdout.interrupted).toBe(true);
		expect(final.protocol.gaps).toContain("missing-exit");
	});
	it("marks actual guest EOF separately from VM closure and retains exact output hashes", async () => {
		const f = await fixture();
		await f.send("stdout", Buffer.from("中文🙂\0").toString("base64"));
		await f.send("stderr", "eA==");
		await f.send("stdout-eof");
		const final = await f.session.finish();
		expect(final.logs.stdout.streamEnded).toBe(true);
		expect(final.logs.stderr.streamEnded).toBe(false);
		expect(final.logs.stderr.interrupted).toBe(true);
		expect(final.logs.stdout.durable).toBe(true);
		expect(fs.readFileSync(join(f.root, "guest-stdout.raw"))).toEqual(Buffer.from("中文🙂\0"));
		expect(await f.session.finish()).toEqual(final);
	});
	it("uses only the exact stderr wait marker during an active pinned target and clears it on exit", async () => {
		const f = await fixture();
		await f.send("version", Buffer.from("ae-offline-fake-cli 1").toString("base64"));
		await f.send("ready");
		const records = guestInput(spec()).toString().trimEnd().split("\n").length;
		for (let n = 1; n <= records; n++) {
			f.session.poll();
			await f.send("ack", String(n));
		}
		await f.send("started", "22");
		await f.send("stdout", Buffer.from("waiting-input\n").toString("base64"));
		await f.send("stderr", Buffer.from("still waiting-input\n").toString("base64"));
		expect(f.session.snapshot().waitingInput).toBe(false);
		await f.send("stderr", Buffer.from("waiting-").toString("base64"));
		expect(f.session.snapshot().waitingInput).toBe(false);
		await f.send("stderr", Buffer.from("input\n").toString("base64"));
		expect(f.session.snapshot()).toMatchObject({
			waitingInput: true,
			waitingInputSource: "fixed-fixture stderr; target-reported",
		});
		await f.send("stdout-eof");
		await f.send("stderr-eof");
		await f.send("exit", "0");
		expect(f.session.snapshot().waitingInput).toBe(false);
		await f.session.finish();
	});
	it("refuses target start before frozen version/input completion", async () => {
		const f = await fixture();
		await expect(f.send("started", "22")).rejects.toThrow("preflight");
		await f.session.finish();
		expect(f.session.snapshot().started).toBe(false);
	});
});
