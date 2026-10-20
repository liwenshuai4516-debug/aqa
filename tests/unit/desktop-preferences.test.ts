import { describe, expect, it } from "vitest";
import { sanitizePreferences } from "../../desktop/preferences.js";
describe("desktop preference ownership", () => {
	it("allows only bounded UI preferences and drops identity, auth, grants and session data", () => {
		expect(
			sanitizePreferences({
				"pi-web-ui:theme": "nord",
				"pi-web-ui:lang": "zh",
				token: "secret",
				clientId: "id",
				"pi-web-ui:plugin-path-grants": "danger",
				draft: "text",
				"pi-web-sounds": "x".repeat(17000),
			}),
		).toEqual({ "pi-web-ui:theme": "nord", "pi-web-ui:lang": "zh" });
		expect(sanitizePreferences(null)).toEqual({});
		expect(sanitizePreferences([])).toEqual({});
	});
});
