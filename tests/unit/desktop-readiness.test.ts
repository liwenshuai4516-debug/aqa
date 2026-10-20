import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { verifySidecarIdentity, waitForHealth } from "../../desktop/startup.js";

describe("desktop bounded readiness and identity", () => {
	it("bounds a fetch implementation that never resolves", async () => {
		const start = Date.now();
		await expect(
			waitForHealth("http://127.0.0.1:19999", {
				timeoutMs: 60,
				requestTimeoutMs: 15,
				pollIntervalMs: 10,
				fetchFn: () => new Promise(() => {}),
			}),
		).rejects.toThrow("未在");
		expect(Date.now() - start).toBeLessThan(500);
	});
	it("rejects an unrelated healthy server and accepts only a token-protected server", async () => {
		let enforce = false;
		const server = createServer((req, res) => {
			if (enforce && req.headers.authorization !== "Bearer test-secret") {
				res.writeHead(401).end();
				return;
			}
			res.setHeader("Set-Cookie", "pi_web_token=test-secret; HttpOnly; Path=/");
			res.setHeader("Content-Type", "application/json");
			res.end("{}");
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address() as { port: number };
		try {
			await expect(verifySidecarIdentity(`http://127.0.0.1:${address.port}`, "test-secret")).rejects.toThrow("身份");
			enforce = true;
			await expect(verifySidecarIdentity(`http://127.0.0.1:${address.port}`, "test-secret")).resolves.toBeUndefined();
			await expect(verifySidecarIdentity(`http://127.0.0.1:${address.port}`, "wrong-secret")).rejects.toThrow("身份");
		} finally {
			server.closeAllConnections();
			server.close();
		}
	});
});
