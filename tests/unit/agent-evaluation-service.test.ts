import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvaluationService } from "../../plugins/agent-evaluation/service.mjs";
import plugin from "../../plugins/agent-evaluation/index.mjs";
import { readEvaluationEvidence } from "../../server/agent/evaluation-evidence.js";
import { readEvaluationArtifact } from "../../server/agent/evaluation-artifact.js";
import { ClientSession } from "../../server/agent/agent-service.js";
import { digest } from "../../plugins/agent-evaluation/schema.mjs";
const cleanup: Array<() => void> = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const fn of cleanup.splice(0).reverse()) fn();
});
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "evaluation-service-")),
		workspace = join(dir, "workspace");
	mkdirSync(workspace);
	cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
	const entries: any[] = [
		{
			id: "u1",
			parentId: null,
			type: "message",
			timestamp: "2026-10-24T00:00:00Z",
			message: { role: "user", content: "Produce result.json" },
		},
		{
			id: "a1",
			parentId: "u1",
			type: "message",
			timestamp: "2026-10-24T00:00:01Z",
			message: { role: "assistant", content: [{ type: "text", text: "fixture result" }] },
		},
	];
	const host: any = {
		dataDir: dir,
		getActiveConversation: ({ clientId }: any) => ({ clientId, conversationId: "conv1" }),
		readEvaluationEvidence: vi.fn((clientId: string, query: any) => {
			if (clientId !== "owner") throw Object.assign(new Error("Unknown owner"), { code: "PERMISSION_DENIED" });
			return readEvaluationEvidence(
				{
					principalId: clientId,
					workspaceId: digest(workspace),
					workspace,
					conversationId: "conv1",
					sessionId: "session1",
					clientVersion: "fixture-sdk",
					children: [],
					persisted: true,
					isStreaming: false,
					leafId: "a1",
					getEntry: (id) => entries.find((e) => e.id === id),
				},
				query,
			);
		}),
		readEvaluationArtifact: vi.fn((_clientId: string, query: any) => readEvaluationArtifact(workspace, query.path)),
		readEvaluationNative: vi.fn(async () => {
			throw new Error("No native reference in fixture");
		}),
		onRunEvent: vi.fn(() => () => {}),
	};
	const service = new EvaluationService(host);
	cleanup.push(() => service.close());
	const ui = { channel: "ui", clientId: "owner" },
		tool = { channel: "tool", clientId: "owner", conversationId: "conv1" };
	let sequence = 0;
	const request = (action: string, extra: any = {}, trusted: any = ui) =>
		service.dispatch(trusted, { requestId: `r-${++sequence}`, action, ...extra });
	const contract = {
		scope: {
			source: "pi",
			sessionId: "session1",
			startMessageId: "u1",
			endMessageId: "a1",
			boundaryPrecision: "exact",
			childPolicy: "exclude",
			childSessionIds: [],
		},
		objective: "Produce result.json",
		conditions: [
			{
				id: "artifact",
				statement: "Valid JSON result",
				sourceRef: "u1",
				sourceType: "user",
				required: true,
				applicableWhen: "always",
				ruleRef: "F01@1",
			},
		],
		constraints: [],
		environmentRefs: [],
		provenance: "human-confirmed synthetic fixture",
		evaluationSubject: "agent-task",
	};
	return { dir, workspace, entries, host, service, ui, tool, request, contract };
}
async function diagnose(f: ReturnType<typeof fixture>) {
	writeFileSync(join(f.workspace, "result.json"), '{"ok":true,"apiKey":"synthetic-secret"}');
	// Existence is observable even when sensitive bytes were redacted.
	const contractRef = await f.request("createContract", { data: f.contract });
	const attemptRef = await f.request("createAttempt", { ref: contractRef, requestId: "attach" });
	const collected = await f.request("collect", {
		ref: attemptRef,
		artifactPaths: ["result.json"],
		requestId: "collect",
	});
	const snapshotRef = await f.request("seal", { ref: collected.checkpointRef });
	const job = await f.request("evaluate", {
		ref: snapshotRef,
		configs: { F01: { checks: [{ conditionId: "artifact", path: "result.json" }] } },
	});
	let status: any;
	await vi.waitFor(async () => {
		status = await f.request("status", { jobId: job.jobId });
		expect(status.state).toBe("completed");
	});
	const report = await f.request("get", { ref: status.reportRef });
	return { contractRef, attemptRef, collected, snapshotRef, reportRef: status.reportRef, report };
}
describe("EC04 product service", () => {
	it("lazily describes the authorized source, records actual SDK version, and never falls back to another owner", async () => {
		const f = fixture();
		const source = await f.request("describe");
		expect(source.clientVersion).toBe("fixture-sdk");
		expect(existsSync(join(f.dir, "agent-evaluation"))).toBe(false);
		await expect(f.request("describe", {}, { channel: "ui", clientId: "other" })).rejects.toThrow(/owner/);
		await expect(f.request("describe", { conversationId: "other" }, f.tool)).rejects.toThrow(/substituted/);
		await expect(f.request("describe", { sessionId: "changed" })).rejects.toThrow(/session changed/);
	});
	it("runs the product contract/collection/scoring flow, replays durable requests, and appends human reviews", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		expect(scored.report.data.findings.find((r: any) => r.ruleId === "F01").verdict).toBe("pass");
		expect(scored.report.data.summary.counts.errors).toBe(0);
		expect(await f.request("createAttempt", { ref: scored.contractRef, requestId: "attach" })).toEqual(
			scored.attemptRef,
		);
		const replay = await f.request("collect", {
			ref: scored.attemptRef,
			artifactPaths: ["result.json"],
			requestId: "collect",
		});
		expect(replay.checkpointRef).toEqual(scored.collected.checkpointRef);
		expect(f.host.readEvaluationArtifact).toHaveBeenCalledTimes(1);
		const data = {
			evaluationRef: scored.reportRef,
			findingId: scored.report.data.findings[0].findingId,
			decision: "inconclusive",
			reason: "Human requires semantic review",
		};
		const review = await f.request("review", { data });
		const revised = await f.request("review", {
			data: { ...data, previousReviewRef: review, decision: "pass", reason: "Human checked the content" },
		});
		expect(revised.id).not.toBe(review.id);
		expect(scored.report.projection).toBe(true);
		expect(scored.report.digest).toBeUndefined();
		const { context } = f.service.authorize(f.ui, { action: "export" });
		const bundle = f.service.store!.export(context, scored.reportRef);
		expect(
			bundle.records
				.filter((r: any) => r.kind === "reviews")
				.map((r: any) => r.id)
				.sort(),
		).toEqual([review.id, revised.id].sort());
		expect((await f.request("list", { kind: "reviews", ref: scored.reportRef })).items[0].review.evaluationRef).toEqual(
			scored.reportRef,
		);
		expect((await f.request("get", { ref: scored.reportRef })).sourceDigest).toBe(scored.report.sourceDigest);
		expect((await f.request("list", { kind: "reviews" })).items).toHaveLength(2);
		await expect(f.request("review", { data }, f.tool)).rejects.toThrow(/human reviews/);
		await expect(f.request("review", { data, human: true }, f.tool)).rejects.toThrow(/Invalid/);
	});
	it("keeps Agent conditions proposed and rejects unverified message boundaries", async () => {
		const f = fixture();
		await expect(f.request("createContract", { data: f.contract }, f.tool)).rejects.toThrow(/proposals/);
		const proposed = {
			...f.contract,
			conditions: f.contract.conditions.map((c) => ({ ...c, sourceType: "proposed", required: false })),
		};
		expect((await f.request("createContract", { data: proposed }, f.tool)).kind).toBe("contracts");
		await expect(
			f.request("createContract", {
				data: { ...f.contract, scope: { ...f.contract.scope, startMessageId: "missing" } },
			}),
		).rejects.toThrow(/boundaries/);
	});
	it("exports bounded redacted chunks, rejects forged source events, and stops after unload", async () => {
		const f = fixture(),
			scored = await diagnose(f);
		let text = "",
			offset: any = 0,
			manifestDigest: any;
		do {
			const page = await f.request("export", { ref: scored.reportRef, offset });
			manifestDigest ??= page.manifestDigest;
			expect(page.manifestDigest).toBe(manifestDigest);
			expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(48 * 1024);
			text += page.text;
			offset = page.nextOffset;
		} while (offset !== null);
		expect(text).not.toContain("synthetic-secret");
		expect(JSON.parse(text).manifestDigest).toBe(manifestDigest);
		await expect(f.request("collect", { ref: scored.attemptRef, liveEvents: [{ type: "tool_end" }] })).rejects.toThrow(
			/Invalid/,
		);
		f.service.close();
		await expect(f.request("list")).rejects.toThrow(/stopped/);
	});
	it("registers the real tool and enforces query/write gates on retained host definitions", async () => {
		const f = fixture();
		const registered: any[] = [];
		f.host.registerAgentTool = (tool: any) => {
			registered.push({ ...tool, pluginId: "agent-evaluation" });
			return () => registered.splice(0);
		};
		f.host.onMessage = () => () => {};
		f.host.sendTo = vi.fn();
		const stop = plugin.activate(f.host);
		cleanup.push(stop);
		const conv: any = {
			id: "conv1",
			cwd: f.workspace,
			session: {},
			agentPreset: "standard",
			planMode: false,
			delegateMode: false,
			permissionPreset: "read-only",
		};
		const owner: any = {
			clientId: "owner",
			convs: new Map([[conv.id, conv]]),
			settingsSvc: { current: { disabledPlugins: [], disabledPluginTools: [] } },
			pluginToolsProvider: () => registered,
			goalReviewTurnOf: () => false,
		};
		const tool = (ClientSession.prototype as any).enabledPluginToolDefs.call(owner, "standard", conv.id)[0];
		expect((await tool.execute("read", { action: "describe", requestId: "describe" })).isError).not.toBe(true);
		await expect(
			tool.execute("write", { action: "createContract", requestId: "write", data: f.contract }),
		).rejects.toThrow(/read-only/);
		conv.permissionPreset = "workspace-write-never";
		conv.planMode = true;
		await expect(
			tool.execute("write", { action: "createContract", requestId: "write", data: f.contract }),
		).rejects.toThrow(/blocked/);
		conv.planMode = false;
		conv.delegateMode = true;
		await expect(tool.execute("write", { action: "collect", requestId: "collect" })).rejects.toThrow(/blocked/);
		conv.delegateMode = false;
		owner.settingsSvc.current.disabledPlugins = ["agent-evaluation"];
		await expect(tool.execute("read", { action: "describe", requestId: "disabled" })).rejects.toThrow(/disabled/);
	});
});
