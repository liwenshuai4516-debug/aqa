import { Type as T } from "typebox";
import { digest } from "../schema.mjs";
export const text = T.String({ minLength: 1, maxLength: 1024 });
export const object = (fields) => T.Object(fields, { additionalProperties: false });
export const checks = (fields) =>
	object({ checks: T.Array(object({ conditionId: text, ...fields }), { maxItems: 100 }) });
export function define(id, configSchema, evaluate) {
	return {
		manifest: {
			id,
			version: "1",
			method: "deterministic",
			supportedTaskTypes: ["agent-task", "client-software"],
			requiredEvidence: [],
			configSchema,
			outputSchemaVersion: 1,
			timeoutMs: 2000,
			budget: { maxFindings: 200 },
			dependencies: [],
		},
		evaluate,
	};
}
export const key = (ref) => `${ref.kind}:${ref.id}:${ref.revision}`;
export const trustworthy = (item, view) =>
	item &&
	["harness-observed", "externally-verified", "instrumented"].includes(item.data.origin) &&
	item.data.availability !== "unavailable" &&
	!item.data.truncated &&
	!view.conflicting.includes(key(item.ref));
export function finding(conditionId, verdict, items, reason, missingEvidence = [], metrics = {}) {
	return {
		...(conditionId ? { conditionId } : {}),
		verdict,
		evidenceState: missingEvidence.length ? (items.length ? "partial" : "unavailable") : "sufficient",
		evidenceRefs: [...new Map(items.map((item) => [key(item.ref), item.ref])).values()],
		missingEvidence,
		reason,
		attributions: [],
		metrics,
	};
}
export function noChecks(id) {
	return [finding(null, "inconclusive", [], `${id}: no frozen checks selected`, ["condition-configuration-required"])];
}
export function jsonPointer(value, pointer) {
	if (pointer === "") return { found: true, value };
	if (typeof pointer !== "string" || !pointer.startsWith("/")) return { found: false };
	for (const part of pointer
		.slice(1)
		.split("/")
		.map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))) {
		if (!value || typeof value !== "object" || !Object.hasOwn(value, part)) return { found: false };
		value = value[part];
	}
	return { found: true, value };
}
export function callsIn(view) {
	const calls = new Map(),
		orphanResults = [],
		duplicates = [],
		ignored = [];
	for (const item of view.evidence) {
		if (item.data.producer !== "pi-evidence-v1") continue;
		if (!trustworthy(item, view)) {
			ignored.push(item);
			continue;
		}
		const message = item.value?.message;
		const prefix = `${item.data.attemptRef.id}:${item.data.sourceId}:`;
		if (message?.role === "assistant")
			for (const block of message.content ?? []) {
				if (block.type !== "toolCall" || typeof block.id !== "string") continue;
				const id = prefix + block.id;
				const row = {
					id,
					toolCallId: block.id,
					name: block.name,
					args: block.arguments,
					start: item,
					result: null,
					conflict: false,
				};
				if (calls.has(id)) {
					duplicates.push(id);
					if (digest([calls.get(id).name, calls.get(id).args ?? null]) !== digest([row.name, row.args ?? null]))
						calls.get(id).conflict = true;
				} else calls.set(id, row);
			}
		if (message?.role === "toolResult" && message.toolCallId)
			orphanResults.push({ id: prefix + message.toolCallId, item });
	}
	const unmatched = [];
	for (const { id, item } of orphanResults) {
		const call = calls.get(id);
		if (!call) {
			unmatched.push(item);
			continue;
		}
		if (call.result) {
			duplicates.push(id);
			if (digest(call.result.value?.message) !== digest(item.value?.message)) call.conflict = true;
		} else call.result = item;
	}
	return { calls: [...calls.values()], unmatched, duplicates, ignored };
}
export function callState(call) {
	if (call.conflict || !call.result) return "unknown";
	const message = call.result.value.message;
	if (message.cancelled === true) return "cancelled";
	if (message.denied === true) return "denied";
	if (message.isError === true) return "failed";
	return message.isError === false ? "succeeded" : "unknown";
}
