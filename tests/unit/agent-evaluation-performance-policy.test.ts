import { describe, expect, it } from "vitest";
import { comparePerformance, PERFORMANCE_POLICY } from "../fixtures/agent-evaluation/performance-policy.mjs";
const fixture = (workload = "long") => {
	const row = { workload, elapsedMs: 0, cpuMs: 0, peakRssBytes: 1024, diskBytes: 0, inputBytes: 20000000 };
	return {
		off: Array.from({ length: 5 }, (_, round) => ({ ...row, round, enabled: false })),
		on: Array.from({ length: 5 }, (_, round) => ({
			...row,
			round,
			enabled: true,
			evidenceCount: 200,
			gaps: [] as string[],
			failure: undefined as unknown,
		})),
	};
};
describe("versioned historical batch performance gate", () => {
	it.each(["serial", "parallel", "long"] as const)(
		"accepts the %s boundary and retains the legacy failure",
		(workload) => {
			const { off, on } = fixture(workload);
			const budget = PERFORMANCE_POLICY[workload];
			for (const r of on)
				Object.assign(r, { elapsedMs: budget.wallMs, cpuMs: budget.cpuMs, evidenceCount: budget.evidenceCount });
			expect(comparePerformance(workload, off, on)).toMatchObject({ pass: true, legacyPass: false });
			for (const r of on) r.elapsedMs += 0.001;
			expect(comparePerformance(workload, off, on).pass).toBe(false);
			for (const r of on) {
				r.elapsedMs = budget.wallMs;
				r.cpuMs += 0.001;
			}
			expect(comparePerformance(workload, off, on).pass).toBe(false);
		},
	);
	it("rejects missing/duplicate pairs, lost evidence, gaps, errors and invalid or mismatched telemetry", () => {
		const changes = [
			({ on }: ReturnType<typeof fixture>) => {
				on.pop();
			},
			({ on }: ReturnType<typeof fixture>) => {
				on[0].round = 1;
			},
			({ on }: ReturnType<typeof fixture>) => {
				on[0].evidenceCount--;
			},
			({ on }: ReturnType<typeof fixture>) => {
				on[0].gaps.push("missing-source");
			},
			({ on }: ReturnType<typeof fixture>) => {
				on[0].failure = { code: "IO_ERROR" };
			},
			({ on }: ReturnType<typeof fixture>) => {
				on[0].cpuMs = NaN;
			},
			({ on }: ReturnType<typeof fixture>) => {
				on[0].elapsedMs = -1;
			},
			({ on }: ReturnType<typeof fixture>) => {
				on[0].inputBytes--;
			},
		];
		for (const change of changes) {
			const rows = fixture();
			change(rows);
			expect(comparePerformance("long", rows.off, rows.on).pass).toBe(false);
		}
	});
	it("keeps per-pair RSS and per-run disk caps even below time budgets", () => {
		const { off, on } = fixture();
		on[0].peakRssBytes = off[0].peakRssBytes + 64 * 1024 ** 2;
		on[0].diskBytes = on[0].inputBytes * 2 + 1024 ** 2;
		expect(comparePerformance("long", off, on).pass).toBe(true);
		on[0].peakRssBytes++;
		expect(comparePerformance("long", off, on).pass).toBe(false);
		on[0].peakRssBytes--;
		on[0].diskBytes++;
		expect(comparePerformance("long", off, on).pass).toBe(false);
	});
});
