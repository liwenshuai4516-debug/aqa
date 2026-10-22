/** Chat-only projection. Raw messages remain available to trace, search and export. */
import type { UiMessage } from "./types";

export function presentChatMessages(messages: readonly UiMessage[], running: boolean): UiMessage[] {
	const output: UiMessage[] = [];
	let start = 0;
	const flush = (end: number, active: boolean) => {
		const segment = messages.slice(start, end);
		const assistants = segment.filter((m) => m.role === "assistant" && !m.customType);
		const final = assistants.at(-1);
		// Only a completed, successful answer can replace a process. Preserve failures,
		// interruptions, tool-only runs and custom/system cards verbatim.
		const compact =
			!active &&
			final?.stopReason === "stop" &&
			!final.errorMessage &&
			!final.content.some((b) => b.type === "toolCall") &&
			final.content.some((b) => b.type === "text" && typeof b.text === "string" && b.text.trim()) &&
			!segment.some((m) => m.isError || m.errorMessage || m.stopReason === "error" || m.stopReason === "aborted");
		if (!compact || !final) {
			output.push(...segment);
			return;
		}
		// Missing legacy/provider timing must not be silently presented as zero or
		// a complete total. Sum model requests only; tool durations are excluded.
		const timed = assistants.every(
			(m) => typeof m.durationMs === "number" && Number.isFinite(m.durationMs) && m.durationMs >= 0,
		);
		for (const m of segment) {
			if (m === final)
				output.push({
					...m,
					content: m.content.filter((b) => b.type !== "thinking"),
					durationMs: timed ? assistants.reduce((sum, a) => sum + a.durationMs!, 0) : undefined,
				});
			else if (m.role !== "assistant" || m.customType) output.push(m);
		}
	};
	for (let i = 0; i < messages.length; i++) {
		if (messages[i].role === "user") {
			flush(i, false);
			start = i;
		}
	}
	flush(messages.length, running);
	return output;
}
