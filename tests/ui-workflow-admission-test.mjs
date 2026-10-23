/** Native prerequisite gates; diagnostic-channel calibration proves zero child-process launches. */
import test from "node:test";
import assert from "node:assert/strict";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, rm, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UiWorkflowService, capabilities } from "pi-ui-testing";
import { ready } from "./fixtures/data-space/ui-run-fixture.mjs";
import { artifact } from "./fixtures/data-space/ui-artifacts.mjs";

test(
	"U01: all prerequisite failures leave dependent stages unexecuted, with zero formal runner processes",
	{ timeout: 90000 },
	async (t) => {
		const d = await ready(t),
			{ f } = d;
		let launches = 0;
		const observer = () => launches++;
		subscribe("child_process", observer);
		await promisify(execFile)(process.execPath, ["-e", ""]);
		assert.equal(launches, 1, "Instrumentation must observe a real child process before asserting zero");
		unsubscribe("child_process", observer);
		const runtime = {
			tools: [
				"read",
				...capabilities.map((c) => c.tool),
				...[
					"generator_setup_page",
					"generator_read_log",
					"generator_write_test",
					"browser_snapshot",
					"browser_type",
					"browser_click",
					"browser_close",
				].map((name) => `mcp__playwright_test__${name}`),
			],
			skills: [
				"ui-discover-record",
				"ui-case-design",
				"ui-design-review",
				"ui-test-run",
				"ui-result-analysis",
				"ui-result-review",
			],
		};
		const workflow = new UiWorkflowService(f.root, f.authority, runtime);
		const request = (id) => ({ ...d.request, request_id: id });
		const refused = async (task, input, reason) => {
			// Registration is not execution; the native runner is the admission authority.
			assert.deepEqual(task.task.data.completed_stages, []);
			let rejection;
			await assert.rejects(d.service.start(input), (error) => {
				assert.match(error.message, reason);
				rejection = error.message;
				return true;
			});
			const stopped = await workflow.block(task.task_ref, [rejection]);
			assert.equal(stopped.task.data.state, "blocked");
			assert.equal(stopped.next_stage, "execute");
			assert.deepEqual(stopped.task.data.completed_stages, []);
			assert.deepEqual(stopped.task.data.run_ids, []);
		};
		const zero = async (name, run) => {
			launches = 0;
			const before = f.fixture.state.browserRequests;
			subscribe("child_process", observer);
			try {
				await run();
			} finally {
				unsubscribe("child_process", observer);
			}
			assert.equal(launches, 0, `${name}: no child process (including formal runner) may launch`);
			assert.equal(f.fixture.state.browserRequests, before, `${name}: no target navigation or business action`);
			assert.equal((await f.store.reindex()).records.filter((r) => r.kind === "run").length, 0);
			t.diagnostic(`${name}: child_processes=0, target_requests=0, formal_runs=0`);
		};
		await t.test("partial recording cannot advance to design or execution", async () =>
			zero("partial-recording", async () => {
				const cases = await f.store.load(f.asset.data.cases_ref);
				const log = await f.store.putFile("qa/ui/recordings/incomplete/log.json", "[]");
				const partial = await f.store.put(
					artifact(
						"recording",
						{
							scope_ref: f.asset.data.scope_ref,
							inventory_ref: f.asset.data.inventory_ref,
							initial_state: "Synthetic incomplete recording, never executed",
							status: "partial",
							initial_state_ref: log,
							data_rules_ref: cases.data.data_rules_ref,
							log_ref: log,
							script_refs: [],
							steps: [],
							data_refs: [],
							completion: {
								initial_state_rebuildable: false,
								replaceable_data: false,
								stable_locators: false,
								assertion_sources: false,
								cleanup_owned: false,
							},
							gaps: ["Recording incomplete; no business actions may follow"],
						},
						"incomplete",
					),
				);
				let task = await workflow.start({
					task_id: "partial-recording",
					mode: "record",
					scope_ref: f.asset.data.scope_ref,
					discovery: "browser",
				});
				assert.equal(task.task.data.state, "running");
				await assert.rejects(workflow.checkpoint(task.task_ref, "discover-record", [partial]), /录制未完整登记/);
				task = await workflow.block(task.task_ref, ["Recording incomplete"]);
				assert.equal(task.task.data.state, "blocked");
				assert.deepEqual(task.task.data.completed_stages, []);
				assert.equal(task.next_stage, "discover-record");
			}),
		);
		await t.test("unapproved asset cannot use approval from another revision", async () =>
			zero("unapproved-design", async () => {
				const candidate = await f.make("unapproved");
				const task = await workflow.start({ task_id: "unapproved", mode: "execute", asset_ref: candidate.assetRef });
				await refused(task, { ...request("unapproved"), asset_ref: candidate.assetRef }, /批准|摘要|不匹配/);
			}),
		);
		await t.test("design approval without runtime readiness cannot launch a runner", async () => {
			const path = join(f.authority, "runtime", "accepted");
			await rename(path, `${path}.retained`);
			try {
				await zero("runtime-not-ready", async () => {
					const task = await workflow.start({ task_id: "not-ready", mode: "execute", asset_ref: d.assetRef });
					await refused(task, request("not-ready"), /运行就绪证明尚未登记/);
				});
			} finally {
				await rename(`${path}.retained`, path);
			}
		});
		await t.test("missing prerequisite evidence cannot launch a runner", async () => {
			const script = join(f.root, f.asset.data.files.find((ref) => ref.path.endsWith(".spec.ts")).path);
			const bytes = await readFile(script);
			await rm(script);
			try {
				await zero("missing-evidence", async () => {
					await assert.rejects(
						workflow.start({ task_id: "missing-evidence", mode: "execute", asset_ref: d.assetRef }),
						/引用不存在|不可读取|ENOENT/,
					);
					await assert.rejects(d.service.start(request("missing-evidence")), /引用不存在|不可读取|ENOENT/);
					assert.equal(
						(await f.store.reindex()).records.some((r) => r.kind === "task" && r.id === "missing-evidence"),
						false,
					);
				});
			} finally {
				await writeFile(script, bytes);
			}
		});
	},
);
