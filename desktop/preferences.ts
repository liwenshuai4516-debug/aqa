/** Only UI preferences may cross origins; never tokens, grants, drafts or client identities. */
export const DESKTOP_PREFERENCE_KEYS = [
	"pi-web-ui:theme",
	"pi-web-ui:lang",
	"pi-web-ui:left-panel-width",
	"pi-web-ui:right-panel-width",
	"pi-web-ui:left-panel-collapsed",
	"pi-web-ui:right-panel-collapsed",
	"pi-web-sounds",
	"pi-web-notify",
	"pi-web-tts",
	"pi_zen_mode",
] as const;
export function sanitizePreferences(value: unknown): Record<string, string> {
	const output: Record<string, string> = {};
	if (!value || typeof value !== "object" || Array.isArray(value)) return output;
	for (const key of DESKTOP_PREFERENCE_KEYS) {
		const entry = (value as Record<string, unknown>)[key];
		if (typeof entry === "string" && entry.length <= 16_384) output[key] = entry;
	}
	return output;
}
