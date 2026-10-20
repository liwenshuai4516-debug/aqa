import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Reserve before forwarding, including failed/ambiguous requests. Never refund
// a request count: restarting this runner must not create another paid allowance.
export function openBudget(path, cumulativeLimit = 8) {
	assert([8, 14].includes(cumulativeLimit), "Only explicitly approved request limits are allowed");
	const state = existsSync(path)
		? JSON.parse(readFileSync(path, "utf8"))
		: { priorRequests: 2, priorReservedCny: 0.1, requests: [] };
	assert.equal(state.priorRequests, 2);
	assert.equal(state.priorReservedCny, 0.1);
	return {
		state,
		reserve(payload) {
			assert.equal(payload.model, "deepseek-flash", "Only the approved priced model is allowed");
			assert(state.requests.length + state.priorRequests < cumulativeLimit, "Cumulative request allowance exhausted");
			assert.equal(payload.max_tokens, 128, "Output limit must be 128");
			assert(!payload.max_completion_tokens, "Conflicting output limit");
			assert(Buffer.byteLength(JSON.stringify(payload)) <= 32000, "Input byte allowance exceeded");
			assert(payload.messages.length <= 24, "Message framing allowance exceeded");
			assert(
				payload.tools.every((t) => ["read", "write"].includes(t.function.name)),
				"Unexpected tool",
			);
			// Settle completed requests at the conservative peak price (ignore
			// cache discounts). Ambiguous or failed attempts keep their reserve.
			const reserved = state.requests.reduce((sum, r) => {
				const u = r.usage;
				return (
					sum +
					(r.status === "completed" && Number.isFinite(u?.prompt_tokens) && Number.isFinite(u?.completion_tokens)
						? Math.max(0, (u.prompt_tokens * 2 + u.completion_tokens * 8) / 1e6)
						: r.reservedCny)
				);
			}, state.priorReservedCny);
			assert(reserved + 0.1 <= 1, "Cumulative one-yuan allowance exhausted");
			// 40,000 input tokens + 128 output tokens at peak 2/8 CNY per
			// million is 0.081024 CNY. Reserve 0.10 per request, including
			// framing margin; actual provider usage is retained for reconciliation.
			const entry = {
				ordinal: state.requests.length + 3,
				reservedCny: 0.1,
				inputBytes: Buffer.byteLength(JSON.stringify(payload)),
				status: "reserved",
			};
			state.requests.push(entry);
			writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
			return entry;
		},
		save() {
			writeFileSync(path, JSON.stringify(state, null, 2), { mode: 0o600 });
		},
	};
}
