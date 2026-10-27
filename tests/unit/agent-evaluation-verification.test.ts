import { describe, it, expect } from "vitest";
import { ArtifactCollector, artifactBaseline } from "../../server/external-evaluation-artifacts.js";
const record = (path: string, type: string, data = "") =>
	Buffer.from([Buffer.from(path).toString("base64"), type, Buffer.from(data).toString("base64")].join(":"));
describe("EC07 bounded frozen artifacts", () => {
	it("includes tracked modifications, deletion, untracked and agreed ignored files", () => {
		const c = new ArtifactCollector(true);
		c.add(record("old.txt", "file", "changed"));
		c.add(record(".ignored", "file", "included"));
		c.add(record("new.txt", "file", "new"));
		c.end("3");
		const s = c.freeze();
		expect(s.complete).toBe(true);
		expect(s.entries.find((e) => e.path === "deleted.txt")?.change).toBe("deleted");
		expect(s.entries.find((e) => e.path === "old.txt")?.change).toBe("modified");
		expect(s.entries.find((e) => e.path === "new.txt")?.change).toBe("added");
		expect(s.entries.find((e) => e.path === ".ignored")?.ignored).toBe(true);
		expect(s.baselineDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(artifactBaseline).toHaveProperty("deleted.txt");
	});
	it.each(["../escape", "/absolute", "a/../b", "a//b"])("rejects unsafe path %s", (path) => {
		const c = new ArtifactCollector(false);
		c.add(record(path, "file", "x"));
		c.end("1");
		expect(c.freeze().complete).toBe(false);
	});
	it("rejects links, special files, duplicates, truncation and byte limits", () => {
		for (const [type, data] of [
			["link", "/etc/passwd"],
			["special", ""],
			["file", "x".repeat(513)],
		]) {
			const c = new ArtifactCollector(false);
			c.add(record("x", type, data));
			c.end("1");
			expect(c.freeze().complete).toBe(false);
		}
		const c = new ArtifactCollector(false);
		c.add(record("x", "file"));
		c.add(record("x", "file"));
		c.end("2");
		expect(c.freeze().complete).toBe(false);
		expect(new ArtifactCollector(false).freeze().complete).toBe(false);
	});
});
import { verifyArtifacts } from "../../server/external-evaluation-verifier.js";
function snapshot(answer: string) {
	const c = new ArtifactCollector(false);
	c.add(record("result.json", "file", answer));
	c.end("1");
	return c.freeze();
}
describe("EC07 independent registered verifier", () => {
	it("runs trusted JSON checks and enforces file/network/process restrictions", async () => {
		const result = await verifyArtifacts(snapshot('{"answer":42}'));
		expect(result.error, result.log).toBeUndefined();
		expect(result.verdict).toBe("pass");
		expect(result.exitCode).toBe(0);
		expect((await verifyArtifacts(snapshot('{"pass":true}'))).verdict).toBe("fail");
	});
	it("keeps crash, timeout, cancellation and snapshot corruption inconclusive", async () => {
		const s = snapshot('{"answer":42}');
		expect((await verifyArtifacts(s, "crash")).state).toBe("error");
		expect((await verifyArtifacts(s, "timeout")).error).toBe("verifier-timeout");
		expect((await verifyArtifacts({ ...s, digest: "changed" })).error).toContain("changed");
		const c = new AbortController();
		c.abort();
		expect((await verifyArtifacts(s, "normal", c.signal)).error).toBe("verifier-cancelled");
	});
});

import { F09 } from "../../plugins/agent-evaluation/evaluators/verification.mjs";
import { costMetrics, externalAccounting } from "../../plugins/agent-evaluation/evaluators/metrics.mjs";
describe("EC07 immutable verification consumers", () => {
	const row = (kind: string, value: any, origin = "externally-verified") => ({
		ref: { kind: "evidence", id: kind, revision: 1 },
		data: { kind, origin, producer: "vz-offline-store-1", availability: "available", truncated: false },
		value,
	});
	it("does not accept self-report, wrong snapshot, conflicting or crashed verifier as artifact failure", () => {
		const s = snapshot('{"answer":42}');
		const good = row("verification-result", {
			verifierId: "offline-json",
			verifierVersion: "1",
			artifactSnapshotId: s.digest,
			state: "completed",
			verdict: "pass",
		});
		const manifest = row("artifact-manifest", s, "harness-observed");
		const run = (rows: any[], conflicting: string[] = []) =>
			F09.evaluate(
				{},
				{ evidence: rows, conflicting },
				{ checks: [{ conditionId: "c", verifierId: "offline-json" }] },
			)[0];
		expect(run([good, manifest]).verdict).toBe("pass");
		expect(run([{ ...good, data: { ...good.data, origin: "target-reported" } }, manifest]).verdict).toBe(
			"inconclusive",
		);
		expect(run([{ ...good, value: { ...good.value, artifactSnapshotId: "other" } }, manifest]).verdict).toBe(
			"inconclusive",
		);
		expect(run([{ ...good, value: { ...good.value, state: "error", verdict: "fail" } }, manifest]).verdict).toBe(
			"inconclusive",
		);
		expect(run([good, manifest], ["evidence:verification-result:1"]).verdict).toBe("inconclusive");
	});
	it("reconciles five measured phases while keeping unknown wall time and repeated cost sources separate", () => {
		const a = externalAccounting(
			{
				phases: { setup: { wallMs: 10 }, agent: { wallMs: 20 }, verification: { wallMs: 30 }, cleanup: { wallMs: 40 } },
			},
			5,
		);
		expect(a.observedTotalMs).toBe(105);
		expect(a.endToEndWallMs).toBeNull();
		const actual = {
			callId: "attempt:model-call",
			phase: "agent",
			source: "provider-measured",
			amount: 2,
			currency: "USD",
		};
		const estimated = {
			callId: "verifier:call",
			phase: "verification",
			source: "estimated",
			amount: 1,
			currency: "USD",
			priceVersion: "frozen-v1",
		};
		const costs: any = costMetrics([
			actual,
			{ ...actual, adapter: "sdk" },
			estimated,
			estimated,
			{ callId: "unpriced", phase: "evaluation", source: "unknown" },
		]);
		expect(costs.phases.agent.calls).toBe(1);
		expect(costs.phases.agent.knownActualByCurrency.USD).toBe(2);
		expect(costs.phases.verification.knownEstimatedByCurrency.USD).toBe(1);
		expect(costs.phases.evaluation.unknownCalls).toBe(1);
	});
});

describe("EC07 additional resource boundaries", () => {
	it("rejects record count and total bytes without treating a prefix as complete", () => {
		const count = new ArtifactCollector(false);
		for (let i = 0; i < 33; i++) count.add(record(`f${i}`, "file", "x"));
		count.end("33");
		expect(count.freeze().complete).toBe(false);
		const bytes = new ArtifactCollector(false);
		for (let i = 0; i < 17; i++) bytes.add(record(`f${i}`, "file", "x".repeat(512)));
		bytes.end("17");
		expect(bytes.freeze().complete).toBe(false);
		const directory = new ArtifactCollector(false);
		directory.add(record("folder", "directory"));
		directory.add(record("folder/child", "file", ""));
		directory.end("2");
		expect(directory.freeze().complete).toBe(true);
	});
	it("stops an active verifier and rejects unregistered checks", async () => {
		const s = snapshot('{"answer":42}'),
			c = new AbortController();
		const running = verifyArtifacts(s, "timeout", c.signal);
		setTimeout(() => c.abort(), 50);
		expect((await running).error).toBe("verifier-cancelled");
		expect((await verifyArtifacts(s, "unregistered" as any)).error).toBe("verifier-not-registered");
	});
});
