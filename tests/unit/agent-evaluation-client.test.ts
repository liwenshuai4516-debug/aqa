// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import client from "../../plugins/agent-evaluation/client/entry.mjs";
import { transport } from "../../plugins/agent-evaluation/client/transport.mjs";
const stops: Array<() => void> = [];
afterEach(() => {
	for (const stop of stops.splice(0)) stop();
	document.body.replaceChildren();
	vi.useRealTimers();
});
function harness() {
	let receive: any;
	const sent: any[] = [];
	const ctx = {
		send: (m: any) => {
			sent.push(m);
		},
		onData: (fn: any) => {
			receive = fn;
			return vi.fn();
		},
	};
	return {
		ctx,
		sent,
		reply: (m: any, result: any, ok = true) =>
			receive({ requestId: m.requestId, ok, ...(ok ? { result } : { error: result }) }),
	};
}
async function openReport() {
	document.documentElement.lang = "en";
	const root = document.createElement("div");
	document.body.append(root);
	const h = harness();
	const contractRef = { kind: "contracts", id: "contract", revision: 1 };
	const snapshotRef = { kind: "snapshots", id: "snapshot", revision: 1 };
	const reportRef = { kind: "evaluations", id: "report", revision: 1 };
	const conditions = Array.from({ length: 21 }, (_, index) => ({
		id: `c-${index}`,
		statement: `Condition ${index}`,
		sourceType: index === 20 ? "proposed" : "user",
		sourceRef: "u",
		required: index !== 20,
		applicableWhen: "always",
		...(index === 0 ? { ruleRef: "F01@1" } : {}),
	}));
	const records: any = {
		contract: {
			...contractRef,
			sourceDigest: "contract-digest",
			data: {
				objective: "Original objective",
				conditions,
				constraints: [
					{
						id: "constraint",
						statement: "Read-only task",
						sourceType: "user",
						sourceRef: "u",
						required: true,
						applicableWhen: "always",
					},
				],
				scope: {
					sessionId: "session",
					startMessageId: "u",
					endMessageId: "a",
					childPolicy: "exclude",
					childSessionIds: [],
				},
				environmentRefs: ["environment-1", "environment-2"],
				provenance: "fixture",
				evaluationSubject: "agent-task",
			},
		},
		snapshot: {
			...snapshotRef,
			data: { coverage: "partial", gaps: [], attemptRefs: [{ kind: "attempts", id: "attempt", revision: 1 }] },
		},
		report: {
			...reportRef,
			data: {
				contractRef,
				snapshotRef,
				findings: [],
				summary: { deliveryVerdict: "inconclusive", goal: "unknown" },
				configuration: {
					rules: [
						{
							id: "F01",
							version: "1",
							config: { checks: [{ conditionId: "c-0", path: "result.json", format: "json" }] },
						},
					],
				},
			},
		},
	};
	h.ctx.send = (message: any) => {
		h.sent.push(message);
		let result: any;
		if (message.action === "describe")
			result = { conversationId: "conv", sessionId: "session", choices: [{ id: "u", preview: "Task", role: "user" }] };
		if (message.action === "list")
			result = {
				items: message.kind === "reviews" ? [] : [{ ...reportRef, objectivePreview: "Original objective" }],
				nextCursor: null,
			};
		if (message.action === "get") {
			const record = records[message.ref.id];
			result = { ...record, data: { ...record.data }, pages: {} };
			for (const [field, value] of Object.entries(record.data))
				if (Array.isArray(value)) {
					const offset = message.offset ?? 0,
						limit = message.limit ?? 20;
					result.data[field] = value.slice(offset, offset + limit);
					result.pages[field] = {
						total: value.length,
						nextOffset: offset + limit < value.length ? offset + limit : null,
					};
				}
		}
		if (result) queueMicrotask(() => h.reply(message, result));
	};
	stops.push(client.mount(root, h.ctx));
	await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>("[data-action=open]")?.disabled).toBe(false));
	root.querySelector<HTMLButtonElement>("[data-action=open]")!.click();
	await vi.waitFor(() =>
		expect(root.querySelector<HTMLButtonElement>("[data-action=reevaluate]")?.disabled).toBe(false),
	);
	return { root, h, records, contractRef, snapshotRef, reportRef };
}
describe("evaluation client lifecycle", () => {
	it("keeps observation scoped, scores the stopped durable checkpoint and allows dismissing it", async () => {
		const { root, h, records } = await openReport();
		root.querySelector<HTMLButtonElement>("[data-action=watch-start]")!.click();
		const start = h.sent.at(-1);
		expect(start).toMatchObject({
			action: "watchStart",
			conversationId: "conv",
			sessionId: "session",
			artifactPaths: ["result.json"],
			ref: { kind: "attempts", id: "attempt" },
		});
		const checkpointRef = { kind: "evidence", id: "latest", revision: 1 };
		h.reply(start, {
			watchId: start.watchId,
			state: "observing",
			latest: { checkpointRef, evidenceCount: 2, gapCount: 1 },
		});
		await vi.waitFor(() =>
			expect(root.querySelector<HTMLButtonElement>("[data-action=watch-score]")?.disabled).toBe(false),
		);
		root.querySelector<HTMLButtonElement>("[data-action=watch-score]")!.click();
		const stop = h.sent.at(-1);
		expect(stop).toMatchObject({
			action: "watchStop",
			watchId: start.watchId,
			conversationId: "conv",
			sessionId: "session",
		});
		h.reply(stop, { watchId: start.watchId, state: "stopped", latest: { checkpointRef } });
		await vi.waitFor(() => expect(h.sent.at(-1).action).toBe("seal"));
		expect(h.sent.at(-1).ref).toEqual(checkpointRef);
		const sealed = { kind: "snapshots", id: "new-snapshot", revision: 1 };
		h.reply(h.sent.at(-1), sealed);
		await vi.waitFor(() => expect(h.sent.at(-1).action).toBe("evaluate"));
		expect(h.sent.at(-1)).toMatchObject({
			ref: sealed,
			configs: { F01: records.report.data.configuration.rules[0].config },
		});
		h.reply(h.sent.at(-1), { jobId: "watch-score" });
		await vi.waitFor(() => expect(h.sent.at(-1).action).toBe("status"));
		h.reply(h.sent.at(-1), { state: "queued", jobId: "watch-score" });
		await vi.waitFor(() =>
			expect(root.querySelector<HTMLButtonElement>("[data-action=watch-dismiss]")?.disabled).toBe(false),
		);
		root.querySelector<HTMLButtonElement>("[data-action=watch-dismiss]")!.click();
		await vi.waitFor(() => expect(root.querySelector("[data-observation]")).toBeNull());
	});
	it("renews observation, renders status faults and stops polling after unmount", async () => {
		vi.useFakeTimers();
		const { root, h } = await openReport();
		root.querySelector<HTMLButtonElement>("[data-action=watch-start]")!.click();
		const start = h.sent.at(-1);
		h.reply(start, { state: "observing", watchId: start.watchId });
		await vi.advanceTimersByTimeAsync(15000);
		expect(h.sent.at(-1)).toMatchObject({
			action: "watchStatus",
			conversationId: "conv",
			sessionId: "session",
			watchId: start.watchId,
		});
		h.reply(h.sent.at(-1), { code: "IO_ERROR", message: "Status unavailable" }, false);
		await vi.advanceTimersByTimeAsync(0);
		expect(root.querySelector("[data-observation]")?.textContent).toContain("Status unavailable");
		stops.pop()!();
		const count = h.sent.length;
		await vi.advanceTimersByTimeAsync(60000);
		expect(h.sent.length).toBe(count);
	});
	it("allows a rejected start to be corrected and retried", async () => {
		const { root, h } = await openReport();
		root.querySelector<HTMLButtonElement>("[data-action=watch-start]")!.click();
		h.reply(h.sent.at(-1), { code: "PERMISSION_DENIED", message: "Source unavailable" }, false);
		await vi.waitFor(() =>
			expect(root.querySelector<HTMLButtonElement>("[data-action=watch-start]")?.disabled).toBe(false),
		);
		expect(root.querySelector("[role=alert]")?.textContent).toContain("Source unavailable");
		expect(root.querySelector("[data-observation]")).toBeNull();
	});

	it("stops a known observation identity even when unmounted before start replies", async () => {
		const { root, h } = await openReport();
		root.querySelector<HTMLButtonElement>("[data-action=watch-start]")!.click();
		const start = h.sent.at(-1);
		stops.pop()!();
		expect(h.sent.at(-1)).toMatchObject({
			action: "watchStop",
			watchId: start.watchId,
			conversationId: "conv",
			sessionId: "session",
		});
		h.reply(start, { state: "observing", watchId: start.watchId });
		await Promise.resolve();
		expect(h.sent.filter((m) => m.action === "evaluate")).toHaveLength(0);
	});

	it("invalidates old-source replies and releases pending requests on unmount", async () => {
		const h = harness(),
			rpc = transport(h.ctx);
		const old = rpc.request("describe");
		const stale = expect(old).rejects.toMatchObject({ stale: true });
		rpc.select({ conversationId: "new", sessionId: "new-session" });
		await stale;
		h.reply(h.sent[0], { secret: "old-source" });
		const current = rpc.request("list");
		expect(h.sent[1]).toMatchObject({ conversationId: "new", sessionId: "new-session" });
		h.reply(h.sent[1], { items: [] });
		await expect(current).resolves.toEqual({ items: [] });
		const pending = rpc.request("get"),
			rejected = expect(pending).rejects.toMatchObject({ stale: true });
		rpc.close();
		await rejected;
		await expect(rpc.request("list")).rejects.toMatchObject({ stale: true });
	});
	it("retries a timed-out write with the same identity and never replaces its active callback", async () => {
		vi.useFakeTimers();
		const h = harness(),
			rpc = transport(h.ctx);
		stops.push(() => rpc.close());
		const first = rpc.request("review", { data: { reason: "checked" } });
		const timedOut = expect(first).rejects.toMatchObject({ code: "TIMEOUT" });
		await expect(rpc.request("review", { data: { reason: "checked" } })).rejects.toMatchObject({ code: "IN_PROGRESS" });
		await vi.advanceTimersByTimeAsync(30000);
		await timedOut;
		const retry = rpc.request("review", { data: { reason: "checked" } });
		expect(h.sent[1].requestId).toBe(h.sent[0].requestId);
		h.reply(h.sent[1], { id: "saved-once" });
		await expect(retry).resolves.toEqual({ id: "saved-once" });
	});

	it("preserves form input after errors, escapes hostile previews and sends explicit boundaries", async () => {
		document.documentElement.lang = "en";
		const root = document.createElement("div");
		document.body.append(root);
		const h = harness();
		stops.push(client.mount(root, h.ctx));
		h.reply(h.sent[0], {
			conversationId: "conv",
			sessionId: "session",
			sourceId: "pi:session",
			clientVersion: "fixture",
			choices: [
				{ id: "u", role: "user", preview: '<img src=x onerror="alert(1)">' },
				{ id: "a", role: "assistant", preview: "done" },
			],
		});
		await vi.waitFor(() => expect(h.sent[1]?.action).toBe("list"));
		h.reply(h.sent[1], { items: [], nextCursor: null });
		await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>("[data-action=new]")?.disabled).toBe(false));
		root.querySelector<HTMLButtonElement>("[data-action=new]")!.click();
		expect(root.querySelector("img")).toBeNull();
		const objective = root.querySelector<HTMLTextAreaElement>("[name=objective]")!;
		objective.value = "Keep this objective after errors";
		root.querySelector<HTMLTextAreaElement>("[name=paths]")!.value = "result.json";
		root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		await vi.waitFor(() => expect(h.sent[2]?.action).toBe("createContract"));
		expect(h.sent[2].data.scope).toMatchObject({
			sessionId: "session",
			startMessageId: "u",
			endMessageId: "a",
			childPolicy: "exclude",
		});
		h.reply(h.sent[2], { code: "EVIDENCE_GAP", message: "Source unavailable" }, false);
		await vi.waitFor(() => expect(root.querySelector("[role=alert]")?.textContent).toContain("EVIDENCE_GAP"));
		expect(root.querySelector<HTMLTextAreaElement>("[name=objective]")?.value).toBe(objective.value);
		expect(document.activeElement).toBe(root.querySelector("[role=alert]"));
		expect(root.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(false);
	});
	it("requests a new score for the exact frozen snapshot and configuration without collecting", async () => {
		const { root, h, reportRef } = await openReport();
		const offset = h.sent.length;
		root.querySelector<HTMLButtonElement>("[data-action=reevaluate]")!.click();
		await vi.waitFor(() => expect(h.sent.at(-1)?.action).toBe("evaluate"));
		const score = h.sent.at(-1);
		expect(score.ref).toEqual(reportRef);
		expect(score.configs).toBeUndefined();
		h.reply(score, { code: "IO_ERROR", message: "Lost acknowledgement" }, false);
		await vi.waitFor(() =>
			expect(root.querySelector<HTMLButtonElement>("[data-action=reevaluate]")?.disabled).toBe(false),
		);
		root.querySelector<HTMLButtonElement>("[data-action=reevaluate]")!.click();
		await vi.waitFor(() => expect(h.sent.filter((m) => m.action === "evaluate")).toHaveLength(2));
		expect(h.sent.at(-1).requestId).toBe(score.requestId);
		expect(
			h.sent
				.slice(offset)
				.filter((m) => ["createContract", "reviseContract", "createAttempt", "collect", "seal"].includes(m.action)),
		).toEqual([]);
	});
	it("loads every condition before revision and resumes partial saves without recreating the contract", async () => {
		const { root, h, contractRef, records } = await openReport();
		root.querySelector<HTMLButtonElement>("[data-action=revise]")!.click();
		await vi.waitFor(() => expect(root.querySelector("[name=conditions-20-statement]")).not.toBeNull());
		expect(h.sent.some((m) => m.action === "get" && m.ref.id === "contract" && m.offset === 20)).toBe(true);
		expect(root.querySelector<HTMLTextAreaElement>("[name=conditions-0-statement]")!.readOnly).toBe(true);
		root.querySelector<HTMLTextAreaElement>("[name=objective]")!.value = "<img src=x> Revised objective";
		root.querySelector<HTMLTextAreaElement>("[name=conditions-1-statement]")!.value = "Revised manual requirement";
		root.querySelector<HTMLInputElement>("[name=conditions-20-required]")!.checked = true;
		root.querySelector<HTMLTextAreaElement>("[name=additionalConditions]")!.value = "Human confirms meaning";
		const submit = () =>
			root
				.querySelector("form[data-form=revision]")!
				.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		submit();
		await vi.waitFor(() => expect(h.sent.at(-1)?.action).toBe("reviseContract"));
		const revision = h.sent.at(-1);
		expect(revision.previousRef).toEqual(contractRef);
		expect(revision.data.conditions).toHaveLength(22);
		expect(revision.data.conditions[20]).toMatchObject({ id: "c-20", required: true, sourceType: "user" });
		expect(revision.data.conditions[1].statement).toBe("Revised manual requirement");
		expect(revision.data.conditions[0]).toEqual(records.contract.data.conditions[0]);
		expect(revision.data.constraints).toEqual(records.contract.data.constraints);
		expect(revision.data.environmentRefs).toEqual(records.contract.data.environmentRefs);
		expect(revision.data.scope).toEqual(records.contract.data.scope);
		h.reply(revision, { ...contractRef, revision: 2 });
		await vi.waitFor(() => expect(h.sent.at(-1)?.action).toBe("createAttempt"));
		h.reply(h.sent.at(-1), { kind: "attempts", id: "new-attempt", revision: 1 });
		await vi.waitFor(() => expect(h.sent.at(-1)?.action).toBe("collect"));
		const collect = h.sent.at(-1);
		h.reply(collect, { code: "IO_ERROR", message: "Retry collection" }, false);
		await vi.waitFor(() => expect(root.querySelector("[role=alert]")?.textContent).toContain("IO_ERROR"));
		expect(root.querySelector<HTMLTextAreaElement>("[name=objective]")!.value).toBe("<img src=x> Revised objective");
		expect(root.querySelector("img")).toBeNull();
		submit();
		await vi.waitFor(() => expect(h.sent.filter((m) => m.action === "collect")).toHaveLength(2));
		expect(h.sent.at(-1).requestId).toBe(collect.requestId);
		expect(h.sent.filter((m) => m.action === "reviseContract")).toHaveLength(1);
		expect(h.sent.filter((m) => m.action === "createAttempt")).toHaveLength(1);
	});
});
