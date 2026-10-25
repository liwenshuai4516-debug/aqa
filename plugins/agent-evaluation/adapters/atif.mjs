/** Bounded, data-only ATIF conversion. References are declarations, never file/network requests.
 * Raw bytes and target-reported provenance must be retained by the eventual import transaction.
 */
import { createHash } from "node:crypto";
import { Check } from "typebox/value";
import schema from "./atif/schema.json" with { type: "json" };
import { EvaluationError } from "../schema.mjs";
export const ATIF_VERSION = "ATIF-v1.8";
export const ATIF_CONVERTER_VERSION = "1";
export const ATIF_LIMITS = Object.freeze({ bytes: 512 * 1024, depth: 32, nodes: 25000, steps: 500, trajectories: 20 });
const requireInput = (ok, code, message) => {
	if (!ok) throw new EvaluationError(code, message, "import");
};
const invalid = (ok) => requireInput(ok, "INVALID_INPUT", "Invalid ATIF structure or cross-field relationship");
const bounded = (ok) => requireInput(ok, "LIMIT_EXCEEDED", "ATIF parsing budget exceeded");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Check depth and duplicate property names before native parsing. Syntax is checked by JSON.parse.
function scan(text) {
	const stack = [];
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') {
			const start = i;
			for (i++; i < text.length; i++) {
				if (text[i] === "\\") i++;
				else if (text[i] === '"') break;
			}
			const top = stack.at(-1);
			if (top?.keys && top.key) {
				const key = JSON.parse(text.slice(start, i + 1));
				invalid(!top.keys.has(key));
				top.keys.add(key);
				top.key = false;
			}
		} else if (c === "{" || c === "[") {
			stack.push(c === "{" ? { keys: new Set(), key: true } : {});
			bounded(stack.length <= ATIF_LIMITS.depth);
		} else if (c === "}" || c === "]") stack.pop();
		else if (c === "," && stack.at(-1)?.keys) stack.at(-1).key = true;
	}
}
function walk(value) {
	let nodes = 0;
	const pending = [value];
	while (pending.length) {
		const item = pending.pop();
		bounded(++nodes <= ATIF_LIMITS.nodes);
		if (typeof item === "number")
			invalid(Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item)));
		if (item && typeof item === "object")
			for (const child of Object.values(item)) {
				bounded(pending.length + nodes < ATIF_LIMITS.nodes);
				pending.push(child);
			}
	}
}
function timestamp(value) {
	if (value == null) return;
	// Explicit ISO calendar-date profile; timezone offsets and fractional seconds are retained.
	const match =
		/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))?)?$/.exec(value);
	invalid(match && Number.isFinite(Date.parse(value)));
	const year = Number(match[1]),
		month = Number(match[2]),
		day = Number(match[3]);
	invalid(
		match[4] == null ||
			(Number(match[4]) < 24 &&
				Number(match[5]) < 60 &&
				Number(match[6] ?? 0) < 60 &&
				Number(match[7] ?? 0) < 24 &&
				Number(match[8] ?? 0) < 60),
	);
	const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	invalid(
		year >= 1 &&
			month >= 1 &&
			month <= 12 &&
			day >= 1 &&
			day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1],
	);
}
export function parseAtif(input) {
	requireInput(
		typeof input === "string" || input instanceof Uint8Array,
		"INVALID_INPUT",
		"ATIF requires UTF-8 JSON bytes",
	);
	bounded((typeof input === "string" ? Buffer.byteLength(input) : input.byteLength) <= ATIF_LIMITS.bytes);
	const bytes = Buffer.from(input);
	let text, document;
	try {
		text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		invalid(typeof input !== "string" || input === text);
		scan(text);
		document = JSON.parse(text);
	} catch (error) {
		if (error instanceof EvaluationError) throw error;
		throw new EvaluationError("INVALID_INPUT", "ATIF requires complete, uncompressed UTF-8 JSON", "import");
	}
	walk(document);
	const trajectories = [],
		events = [],
		losses = [];
	const loss = (pointer, reason) => losses.push({ pointer, reason });
	function convert(doc, pointer, parentPointer) {
		requireInput(
			doc?.schema_version === ATIF_VERSION,
			"SCHEMA_UNSUPPORTED",
			"An explicit ATIF-v1.8 version is required for every trajectory",
		);
		bounded(trajectories.length < ATIF_LIMITS.trajectories);
		const children = doc.subagent_trajectories ?? [],
			childIds = new Set();
		for (const child of children) {
			invalid(child.trajectory_id != null && !childIds.has(child.trajectory_id));
			childIds.add(child.trajectory_id);
		}
		trajectories.push({
			pointer,
			parentPointer,
			sessionId: doc.session_id ?? null,
			trajectoryId: doc.trajectory_id ?? null,
			agent: doc.agent,
		});
		if (doc.continued_trajectory_ref != null)
			loss(`${pointer}/continued_trajectory_ref`, "external-reference-not-resolved");
		for (const [i, step] of doc.steps.entries()) {
			const location = `${pointer}/steps/${i}`;
			bounded(events.length < ATIF_LIMITS.steps);
			invalid(step.step_id === i + 1);
			timestamp(step.timestamp);
			if (step.source !== "agent")
				invalid(
					["model_name", "reasoning_effort", "reasoning_content", "tool_calls", "metrics"].every(
						(k) => step[k] == null,
					),
				);
			if (step.source === "agent" && step.llm_call_count === 0)
				invalid(step.metrics == null && step.reasoning_content == null);
			const calls = new Set();
			for (const call of step.tool_calls ?? []) {
				invalid(!calls.has(call.tool_call_id));
				calls.add(call.tool_call_id);
			}
			const media = (content, path) => {
				if (!Array.isArray(content)) return;
				for (const [j, part] of content.entries()) {
					if (part.type === "text") invalid(part.text != null && part.source == null);
					else {
						invalid(part.source != null && part.text == null && part.source.media_type.startsWith(`${part.type}/`));
						loss(`${path}/${j}/source/path`, "media-reference-not-resolved");
					}
				}
			};
			media(step.message, `${location}/message`);
			for (const [j, result] of (step.observation?.results ?? []).entries()) {
				invalid(result.source_call_id == null || calls.has(result.source_call_id));
				const path = `${location}/observation/results/${j}`;
				media(result.content, `${path}/content`);
				for (const [k, reference] of (result.subagent_trajectory_ref ?? []).entries()) {
					invalid(reference.trajectory_id != null || reference.trajectory_path != null);
					if (reference.trajectory_path != null)
						loss(`${path}/subagent_trajectory_ref/${k}`, "external-reference-not-resolved");
					else if (!childIds.has(reference.trajectory_id))
						loss(`${path}/subagent_trajectory_ref/${k}`, "embedded-reference-missing");
				}
			}
			events.push({
				pointer: location,
				trajectoryPointer: pointer,
				stepId: step.step_id,
				origin: "target-reported",
				producer: "atif-import-v1",
				copiedContext: step.is_copied_context === true,
				value: step,
			});
		}
		for (const [i, child] of children.entries()) convert(child, `${pointer}/subagent_trajectories/${i}`, pointer);
	}
	// Validate structure before accessing collections, then enforce model-level invariants above.
	requireInput(
		document?.schema_version === ATIF_VERSION,
		"SCHEMA_UNSUPPORTED",
		"An explicit ATIF-v1.8 version is required",
	);
	invalid(Check(schema, document));
	convert(document, "", null);
	const pending = [[document, ""]];
	while (pending.length) {
		const [item, pointer] = pending.pop();
		if (!item || typeof item !== "object") continue;
		for (const [key, value] of Object.entries(item)) {
			const path = `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
			if (value == null) continue;
			if (["extra", "reasoning_content", "metrics", "final_metrics", "tool_definitions", "notes"].includes(key))
				loss(path, "retained-in-source-not-independently-verified");
			else if (typeof value === "object") pending.push([value, path]);
		}
	}
	return {
		format: ATIF_VERSION,
		converterVersion: ATIF_CONVERTER_VERSION,
		rawSha256: hash(bytes),
		rawBytes: bytes.length,
		rawText: text,
		trajectories,
		events,
		losses,
	};
}
