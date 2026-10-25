/** Read a selected SDK entry chain, never a global snapshot or arbitrary file path.
 * No subscriptions or business effects here. The host binds the client/session before calling.
 */
import { createHash } from "node:crypto";
import { nativeTestCompletion } from "../test-execution-notice.js";
import type {
	AgentEvaluationEvidencePage,
	AgentEvaluationEvidenceQuery,
	AgentEvaluationSourceItem,
} from "../protocol.js";

interface SourceEntry {
	id: string;
	parentId: string | null;
	type: string;
	timestamp: string;
	message?: unknown;
}
export interface EvaluationSource {
	clientVersion?: string;
	principalId: string;
	workspaceId: string;
	workspace: string;
	conversationId: string;
	sessionId: string;
	persisted: boolean;
	isStreaming: boolean;
	leafId: string | null;
	getEntry(id: string): SourceEntry | undefined;
	locateMessage?(id: string): string | undefined;
	children: Array<{ sessionId: string; conversationId: string; persisted: boolean }>;
}
export class EvidenceReadError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function check(ok: unknown, code: string, message: string): asserts ok {
	if (!ok) throw new EvidenceReadError(code, message);
}
const ID = /^[A-Za-z0-9_-]{1,128}$/;
function identifier(value: unknown): value is string {
	return typeof value === "string" && ID.test(value);
}
const ITEM_BYTES = 1024 ** 2,
	PAGE_BYTES = 8 * 1024 ** 2;

function redactText(text: string): string {
	return text
		.replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
		.replace(/\b(?:sk-|sk_|ghp_)[A-Za-z0-9_-]{12,}/g, "[REDACTED]");
}

/** Shared budget for the whole projected message, including structured tool arguments. */
function boundedCopy(value: unknown, budget: { bytes: number; nodes: number; redacted: boolean }, depth = 0): unknown {
	check(depth < 32 && ++budget.nodes <= 10000, "LIMIT_EXCEEDED", "Structured source exceeds parsing budget");
	budget.bytes += 16;
	if (typeof value === "string") {
		check(value.length <= ITEM_BYTES, "LIMIT_EXCEEDED", "Source string exceeds item budget");
		budget.bytes += Buffer.byteLength(value);
		const clean = redactText(value);
		budget.redacted ||= clean !== value;
		value = clean;
	} else if (value && typeof value === "object") {
		const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
		check(entries.length <= 10000, "LIMIT_EXCEEDED", "Source object exceeds item budget");
		const copied: Record<string, unknown> = {};
		for (const [k, v] of entries) {
			budget.bytes += Buffer.byteLength(k);
			check(budget.bytes <= ITEM_BYTES, "LIMIT_EXCEEDED", "Source exceeds item byte budget");
			const sensitive = /^(password|secret|token|api[-_]?key|authorization|cookie|credential)$/i.test(k);
			budget.redacted ||= sensitive;
			Object.defineProperty(copied, k, {
				value: sensitive ? "[REDACTED]" : boundedCopy(v, budget, depth + 1),
				enumerable: true,
			});
		}
		return Array.isArray(value) ? Object.values(copied) : copied;
	}
	check(budget.bytes <= ITEM_BYTES, "LIMIT_EXCEEDED", "Source exceeds item byte budget");
	return value;
}
export function redactEvaluationArtifactText(text: string): { text: string; redaction: string[] } {
	let clean = redactText(text);
	try {
		const value = JSON.parse(text),
			budget = { bytes: 0, nodes: 0, redacted: false };
		const projected = boundedCopy(value, budget);
		if (budget.redacted) clean = JSON.stringify(projected);
	} catch (error) {
		if (error instanceof EvidenceReadError) throw error;
	}
	return { text: clean, redaction: clean !== text ? ["credentials-v1"] : [] };
}

function messageBody(
	entry: SourceEntry,
	nativeExecution?: ReturnType<typeof nativeTestCompletion>,
): { body: unknown; omitted: boolean } {
	const message = entry.message as Record<string, unknown> | undefined;
	if (
		entry.type !== "message" ||
		!message ||
		typeof message !== "object" ||
		!["user", "assistant", "toolResult", "bashExecution"].includes(String(message.role))
	)
		return { body: { entryType: entry.type }, omitted: true };
	const body: Record<string, unknown> = {};
	for (const name of [
		"role",
		"timestamp",
		"toolCallId",
		"toolName",
		"isError",
		"stopReason",
		"usage",
		"model",
		"provider",
		"durationMs",
		"command",
		"output",
		"exitCode",
		"cancelled",
		"denied",
	])
		if (message[name] !== undefined) body[name] = message[name];
	if (nativeExecution) body.nativeExecution = nativeExecution;
	let omitted = false;
	if (typeof message.content === "string") body.content = message.content;
	else if (Array.isArray(message.content)) {
		check(message.content.length <= 10000, "LIMIT_EXCEEDED", "Source block count exceeds budget");
		body.content = message.content.flatMap((block: Record<string, unknown>): Record<string, unknown>[] => {
			if (!block || typeof block !== "object") {
				omitted = true;
				return [];
			}
			if (block.type === "text") return [{ type: "text", text: block.text }];
			if (block.type === "toolCall")
				return [
					{
						type: "toolCall",
						id: block.id ?? block.toolCallId,
						name: block.name,
						arguments: block.arguments ?? block.args,
					},
				];
			// Never copy hidden thinking, signatures, image bytes, or extension-private blocks.
			omitted = true;
			return [];
		});
	}
	return { body, omitted };
}
function sourceItem(
	entry: SourceEntry,
	sourceId: string,
	nativeExecution?: ReturnType<typeof nativeTestCompletion>,
): AgentEvaluationSourceItem {
	const base = {
		sourceEventId: entry.id,
		sourceLocator: `${sourceId}#${entry.id}`,
		parentEventId: entry.parentId,
		occurredAt: entry.timestamp,
		kind: entry.type,
		redaction: [] as string[],
	};
	try {
		const { body, omitted } = messageBody(entry, nativeExecution);
		const budget = { bytes: 0, nodes: 0, redacted: false };
		const content = JSON.stringify(
			boundedCopy(
				{ entryId: entry.id, parentEventId: entry.parentId, occurredAt: entry.timestamp, message: body },
				budget,
			),
		);
		check(Buffer.byteLength(content) <= ITEM_BYTES, "LIMIT_EXCEEDED", "Encoded source exceeds item budget");
		return {
			...base,
			sourceRevision: hash(content),
			content,
			availability: omitted || budget.redacted ? "partial" : "available",
			truncated: false,
			redaction: [...(omitted ? ["non-public-content-omitted"] : []), ...(budget.redacted ? ["credentials-v1"] : [])],
		};
	} catch (error) {
		if (!(error instanceof EvidenceReadError) || error.code !== "LIMIT_EXCEEDED") throw error;
		return {
			...base,
			sourceRevision: hash(JSON.stringify(base)),
			availability: "unavailable",
			truncated: true,
			redaction: ["item-budget-exceeded"],
		};
	}
}

export function readEvaluationEvidence(
	source: EvaluationSource,
	query: AgentEvaluationEvidenceQuery,
): AgentEvaluationEvidencePage {
	check(
		source && identifier(source.principalId) && identifier(source.sessionId),
		"PERMISSION_DENIED",
		"Source identity is unavailable",
	);
	check(
		query && ["describe", "collect", "locate"].includes(query.mode) && query.conversationId === source.conversationId,
		"PERMISSION_DENIED",
		"Conversation is outside the authorized scope",
	);
	const limit = query.limit ?? (query.mode === "describe" ? 100 : 1000);
	check(Number.isInteger(limit) && limit >= 1 && limit <= 1000, "INVALID_INPUT", "Invalid evidence page size");
	check(
		query.childSessionIds === undefined ||
			(Array.isArray(query.childSessionIds) &&
				query.childSessionIds.length <= 100 &&
				query.childSessionIds.every(identifier)),
		"INVALID_INPUT",
		"Invalid child selection",
	);
	if (query.mode === "collect")
		check(
			query.sessionId === source.sessionId && identifier(query.startMessageId) && identifier(query.endMessageId),
			"PERMISSION_DENIED",
			"Exact session and entry boundaries are required",
		);
	const gaps: string[] = [];
	if (!source.persisted) gaps.push("source-is-ephemeral; restart recovery is unavailable");
	if (source.isStreaming) gaps.push("source-run-is-active; selected evidence is provisional");
	for (const child of query.childSessionIds ?? [])
		if (!source.children.some((c) => c.sessionId === child)) gaps.push(`missing-selected-child:${child}`);
	const page: AgentEvaluationEvidencePage = {
		schemaVersion: 1,
		...(source.clientVersion ? { clientVersion: source.clientVersion } : {}),
		principalId: source.principalId,
		workspaceId: source.workspaceId,
		workspace: source.workspace,
		conversationId: source.conversationId,
		sessionId: source.sessionId,
		sourceId: `pi:${source.sessionId}`,
		persistedSource: source.persisted,
		observedAt: new Date().toISOString(),
		isStreaming: source.isStreaming,
		items: [],
		choices: [],
		children: source.children,
		gaps,
		coverage: "unknown",
		nextCursor: null,
		rangeStart: null,
		rangeEnd: null,
	};
	if (query.mode === "locate") {
		check(
			query.sessionId === source.sessionId && identifier(query.locateEventId),
			"PERMISSION_DENIED",
			"Exact source session and event are required",
		);
		const messageId = source.locateMessage?.(query.locateEventId);
		check(
			messageId,
			"EVIDENCE_GAP",
			"The source event is not uniquely visible in this conversation; retain the sealed evidence or open the original branch/history",
		);
		page.messageId = messageId;
		return page;
	}
	const started = performance.now(),
		seen = new Set<string>(),
		chain: SourceEntry[] = [];
	let current = query.mode === "collect" ? query.endMessageId! : source.leafId;
	let reachedStart = false;
	// Validate the entire bounded selection before emitting any body; an invalid start must not broaden it.
	while (current) {
		check(
			performance.now() - started <= 2000 && seen.size < 1000,
			"LIMIT_EXCEEDED",
			"Selection exceeds read budget; select a smaller range",
		);
		check(!seen.has(current), "EVIDENCE_GAP", "Source entry chain is cyclic");
		seen.add(current);
		const entry = source.getEntry(current);
		if (!entry) {
			gaps.push(`missing-source-entry:${current}`);
			break;
		}
		check(
			entry.id === current && typeof entry.timestamp === "string",
			"EVIDENCE_GAP",
			"Source entry identity is invalid",
		);
		chain.push(entry);
		if (query.mode === "collect" && current === query.startMessageId) {
			reachedStart = true;
			break;
		}
		current = entry.parentId;
		if (query.mode === "describe" && chain.length >= limit) {
			if (current) gaps.push("description-window-limited; earlier entries are not included");
			break;
		}
	}
	if (query.mode === "collect" && !reachedStart) {
		page.gaps.push("selected-start-not-reached");
		page.coverage = "partial";
		return page;
	}
	chain.reverse();
	page.rangeStart = chain[0]?.id ?? null;
	page.rangeEnd = chain.at(-1)?.id ?? null;
	let offset = 0;
	if (query.cursor) {
		const index = chain.findIndex((e) => e.id === query.cursor);
		check(index >= 0, "EVIDENCE_GAP", "Cursor is not in the selected range");
		offset = index + 1;
	}
	const nativeCalls = new Map<string, { name: string; arguments: unknown }>();
	if (query.mode === "collect")
		for (const entry of chain) {
			check(performance.now() - started <= 2000, "LIMIT_EXCEEDED", "Source linking time exceeded");
			const message = entry.message as { role?: string; content?: unknown } | undefined;
			if (message?.role === "assistant" && Array.isArray(message.content) && message.content.length <= 10000)
				for (const block of message.content)
					if (block?.type === "toolCall" && ["api_test_execute", "ui_test_run"].includes(block.name)) {
						check(nativeCalls.size < 1000, "LIMIT_EXCEEDED", "Native linking budget exceeded");
						nativeCalls.set(block.id, { name: block.name, arguments: block.arguments });
					}
		}
	let bytes = 0;
	for (const entry of chain.slice(offset)) {
		if (page.items.length >= limit) break;
		check(performance.now() - started <= 2000, "LIMIT_EXCEEDED", "Evidence parsing time exceeded");
		if (query.mode === "describe") {
			const message = entry.message as { role?: string; content?: unknown } | undefined;
			if (entry.type === "message") {
				const text =
					typeof message?.content === "string"
						? message.content
						: Array.isArray(message?.content)
							? message.content.find((b) => b?.type === "text")?.text
							: "";
				page.choices.push({
					id: entry.id,
					role: String(message?.role ?? "unknown"),
					preview: typeof text === "string" ? redactText(text.slice(0, 160)) : "",
				});
			}
			continue;
		}
		const message = entry.message as { role?: string; toolCallId?: string; isError?: boolean } | undefined;
		const call = message?.role === "toolResult" && message.toolCallId ? nativeCalls.get(message.toolCallId) : undefined;
		const completion = call
			? nativeTestCompletion(call.name, call.arguments, entry.message, message?.isError !== false)
			: undefined;
		const item = sourceItem(entry, page.sourceId, completion);
		bytes += Buffer.byteLength(item.content ?? "");
		if (bytes > PAGE_BYTES) break;
		page.items.push(item);
		if (item.truncated) gaps.push(`oversized-source-entry:${entry.id}`);
		else if (item.availability === "partial") gaps.push(`projected-source-entry:${entry.id}`);
	}
	if (query.mode === "collect") {
		const last = page.items.at(-1)?.sourceEventId;
		page.nextCursor = last && last !== page.rangeEnd ? last : null;
		if (offset < chain.length && !last) gaps.push("page-budget-exhausted");
	}
	page.coverage = gaps.length || page.nextCursor ? "partial" : "complete";
	return page;
}
