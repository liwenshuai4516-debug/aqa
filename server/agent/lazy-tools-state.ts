import { LAZY_CORE_TOOL_NAMES, LOAD_TOOLS_TOOL_NAME } from "../tool-manager.js";

/** Restore actual tool use/load receipts, never the SDK's default-active registry. */
export function restoreLazyToolNames(messages: readonly unknown[]): Set<string> {
	const names = new Set<string>();
	for (const value of messages) {
		if (!value || typeof value !== "object") continue;
		const message = value as { role?: string; toolName?: string; isError?: boolean; details?: { loaded?: unknown } };
		if (message.role !== "toolResult") continue;
		if (message.toolName === LOAD_TOOLS_TOOL_NAME) {
			if (message.isError || !Array.isArray(message.details?.loaded)) continue;
			for (const tool of message.details.loaded) {
				if (typeof tool === "string") names.add(tool);
				else if (tool && typeof tool === "object" && typeof tool.name === "string") names.add(tool.name);
			}
		} else if (typeof message.toolName === "string") names.add(message.toolName);
	}
	for (const core of [...LAZY_CORE_TOOL_NAMES, LOAD_TOOLS_TOOL_NAME]) names.delete(core);
	return names;
}
