import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { openBudget } from "./model-request-budget.mjs";

const payload = () => ({
	model: "deepseek-flash",
	max_tokens: 128,
	messages: [{ role: "user", content: "write proof" }],
	tools: [{ function: { name: "write" } }],
});
test("six persisted reservations exhaust the cumulative eight-call allowance, including ambiguous failures", () => {
	const root = mkdtempSync("/tmp/pi-budget-");
	try {
		const path = join(root, "ledger.json");
		for (let i = 0; i < 6; i++) openBudget(path).reserve(payload());
		const budget = openBudget(path);
		assert.equal(budget.state.requests.length + budget.state.priorRequests, 8);
		assert.throws(() => budget.reserve(payload()), /exhausted/);
		assert(budget.state.requests.reduce((sum, r) => sum + r.reservedCny, budget.state.priorReservedCny) < 1);
	} finally {
		rmSync(root, { recursive: true });
	}
});
test("unapproved models, oversized context, output limits and other tools never consume or forward a request", () => {
	const root = mkdtempSync("/tmp/pi-budget-");
	try {
		const budget = openBudget(join(root, "ledger.json"));
		for (const override of [
			{ model: "deepseek-chat" },
			{ max_tokens: 129 },
			{ max_completion_tokens: 1024 },
			{ messages: [{ content: "x".repeat(32000) }] },
			{ messages: Array.from({ length: 25 }, () => ({ content: "x" })) },
			{ tools: [{ function: { name: "bash" } }] },
		])
			assert.throws(() => budget.reserve({ ...payload(), ...override }));
		assert.equal(budget.state.requests.length, 0);
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("T20 preserves all prior request counts and settles only completed usage", () => {
	const root = mkdtempSync("/tmp/pi-budget-");
	try {
		const path = join(root, "ledger.json");
		const first = openBudget(path);
		for (let i = 0; i < 6; i++) {
			const entry = first.reserve(payload());
			entry.status = "completed";
			entry.usage = { prompt_tokens: 1500, completion_tokens: 100 };
			first.save();
		}
		const next = openBudget(path, 14);
		for (let i = 0; i < 6; i++) next.reserve(payload());
		assert.equal(next.state.requests.length + next.state.priorRequests, 14);
		assert.throws(() => openBudget(path, 14).reserve(payload()), /request allowance exhausted/);
	} finally {
		rmSync(root, { recursive: true });
	}
});

test("uncertain calls retain their full cost reservation even with a larger request limit", () => {
	const root = mkdtempSync("/tmp/pi-budget-");
	try {
		const budget = openBudget(join(root, "ledger.json"), 14);
		for (let i = 0; i < 9; i++) budget.reserve(payload());
		assert.throws(() => budget.reserve(payload()), /one-yuan allowance exhausted/);
	} finally {
		rmSync(root, { recursive: true });
	}
});
