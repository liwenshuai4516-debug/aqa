import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../../plugins/data-space/index.mjs";
import { normalizeRuns, summarize } from "../../plugins/data-space/runs.mjs";
const roots: string[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
	const root = mkdtempSync(join(tmpdir(), "data-space-integrity-"));
	roots.push(root);
	const routes = new Map<string, Function>(),
		tools = new Map<string, any>();
	const host = {
		dataDir: root,
		route(m: string, p: string, f: Function) {
			routes.set(m + p, f);
			return () => routes.delete(m + p);
		},
		registerAgentTool(t: any) {
			tools.set(t.name, t);
			return () => tools.delete(t.name);
		},
		log() {},
		broadcast() {},
	};
	const call = (method: string, path: string, body = {}) => {
		let status = 200,
			payload: any;
		const res = {
			headersSent: false,
			status(code: number) {
				status = code;
				return this;
			},
			json(value: any) {
				payload = value;
			},
		};
		routes.get(method + path)!({ body }, res);
		return { status, payload };
	};
	const state = () => structuredClone(call("GET", "/state").payload);
	return { root, host, tools, call, state };
}
describe("Data Space persistence and provenance", () => {
	it("rejects failed persistence and keeps the previous in-memory revision", () => {
		const f = setup();
		plugin.activate(f.host);
		const before = f.state();
		const file = join(f.root, "data-space/store.json");
		renameSync(file, file + ".original");
		mkdirSync(file);
		const out = f.call("POST", "/save", { ...before, baseRevision: before.revision, cases: [] });
		expect(out.status).toBe(500);
		expect(f.state().revision).toBe(before.revision);
		expect(f.state().cases).toEqual(before.cases);
	});
	it("stops a destructive migration if its backup cannot be created", () => {
		const f = setup();
		mkdirSync(join(f.root, "data-space"));
		const file = join(f.root, "data-space/store.json"),
			bytes = JSON.stringify({ groups: [{ id: "s", name: "legacy" }], datasets: [{ id: "private-data" }] });
		writeFileSync(file, bytes);
		vi.spyOn(Date, "now").mockReturnValue(123);
		mkdirSync(file + ".v1-123.bak");
		expect(() => plugin.activate(f.host)).toThrow();
		expect(readFileSync(file, "utf8")).toBe(bytes);
	});
	it("preserves AI batch environment and task metadata", async () => {
		const f = setup();
		plugin.activate(f.host);
		const s = f.state();
		const cases = s.cases.filter((c: any) => c.featureId === s.cases[0].featureId).slice(0, 2);
		await f.tools.get("data_space_record_result").execute("probe", {
			results: cases.map((c: any) => ({ case: c.id, verdict: "通过" })),
			task: "exact batch",
			env: s.envs[0].id,
		});
		expect(f.state().runs).toHaveLength(2);
		expect(f.state().runs[0]).toMatchObject({ taskName: "exact batch", envId: s.envs[0].id });
	});
	it("keeps deleted-case history after reload and masks tool details", async () => {
		const f = setup();
		let off = plugin.activate(f.host);
		let s = f.state();
		s.cases[0].preconditions = "token: SYNTHETIC_SECRET";
		f.call("POST", "/save", { ...s, baseRevision: s.revision });
		s = f.state();
		const text = await f.tools
			.get("data_space_cases")
			.execute("probe", { action: "get", ids: [s.cases[0].id], detail: "card" });
		expect(text).not.toContain("SYNTHETIC_SECRET");
		f.call("POST", "/runs", { caseId: s.cases[0].id, verdict: "失败" });
		f.call("POST", "/save", { ...s, baseRevision: s.revision, cases: [] });
		off();
		off = plugin.activate(f.host);
		expect(f.state().runs).toHaveLength(1);
		off();
	});
	it("preserves all native statuses and excludes demo records from current conclusions", () => {
		const c = { id: "c", updatedAt: "2026-01-01" };
		const runs = normalizeRuns(
			{
				runs: [
					{ caseId: "c", verdict: "skipped", source: "automation" },
					{ caseId: "c", verdict: "passed", source: "demo" },
				],
			},
			[c],
		);
		expect(runs.runs.map((r: any) => r.verdict)).toEqual(["跳过", "通过"]);
		expect((summarize(runs.runs, [c]) as Record<string, any>)["通过"]).toBe(0);
	});
});

it("does not accept client-forged automation associations through ordinary case saves", () => {
	const f = setup();
	const off = plugin.activate(f.host);
	const before = f.state();
	before.cases[0].automation = { engine: "api", workspace: "/untrusted", assetRef: "forged", caseVersion: "forged" };
	f.call("POST", "/save", { ...before, baseRevision: before.revision });
	expect(f.state().cases[0].automation).toBeNull();
	off();
});
