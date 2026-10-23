/** Chat-only projection. Raw messages remain available to trace, search and export. */
import type { UiMessage } from "./types";
import { parseSkillBlock } from "./skill-block";

export function presentChatMessages(messages: readonly UiMessage[], running: boolean): UiMessage[] {
	const output: UiMessage[] = [];
	let start = 0;
	const flush = (end: number, active: boolean) => {
		const segment = messages.slice(start, end);
		const assistants = segment.filter((m) => m.role === "assistant" && !m.customType);
		const final = assistants.at(-1);
		// A final answer replaces the process even if intermediate requests failed.
		// Without an answer, keep interruptions and failures visible.
		const compact =
			!active &&
			final?.stopReason === "stop" &&
			!final.errorMessage &&
			!final.content.some((b) => b.type === "toolCall") &&
			final.content.some((b) => b.type === "text" && typeof b.text === "string" && b.text.trim());
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
			else if (m.role === "user") {
				const text = m.content
					.flatMap((b) => (b.type === "text" && "text" in b && typeof b.text === "string" ? [b.text] : []))
					.join("\n");
				const skill = parseSkillBlock(text);
				output.push(
					skill
						? {
								...m,
								content: [
									{ type: "text", text: `/skill:${skill.name}${skill.userMessage ? ` ${skill.userMessage}` : ""}` },
									...m.content.filter((b) => b.type !== "text"),
								],
							}
						: m,
				);
			} else if (m.role !== "toolResult" && (m.role !== "assistant" || m.customType)) output.push(m);
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
