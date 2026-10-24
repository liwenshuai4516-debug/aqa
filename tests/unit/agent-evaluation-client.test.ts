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
		send: (m: any) => sent.push(m),
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
describe("evaluation client lifecycle", () => {
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
});
