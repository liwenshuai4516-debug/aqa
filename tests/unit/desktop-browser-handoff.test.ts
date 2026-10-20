import { describe, expect, it } from "vitest";
import { prepareExternalUrl } from "../../desktop/external-url.js";
describe("D01 system browser authentication", () => {
	it("adds the current secret only to the owned service, preserving conversation hash", () => {
		const url = new URL(prepareExternalUrl("http://127.0.0.1:18940/#s=session", "http://127.0.0.1:18940", "secret")!);
		expect(url.searchParams.get("token")).toBe("secret");
		expect(url.hash).toBe("#s=session");
		expect(prepareExternalUrl("http://127.0.0.1:18941/", "http://127.0.0.1:18940", "secret")).toBe(
			"http://127.0.0.1:18941/",
		);
		expect(prepareExternalUrl("https://example.com/", "http://127.0.0.1:18940", "secret")).toBe("https://example.com/");
		expect(prepareExternalUrl("file:///etc/passwd", "http://127.0.0.1:18940", "secret")).toBeNull();
	});
});
