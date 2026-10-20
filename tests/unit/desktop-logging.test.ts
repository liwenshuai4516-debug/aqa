import { describe, expect, it } from "vitest";
import { createLogStream, redactLog } from "../../desktop/logging.js";
import { once } from "node:events";
describe("desktop logs", () => {
	it("redacts launch secrets, URL-encoded secrets, auth headers and keys", () => {
		const safe = redactLog(
			'token=secret-value Authorization: Bearer Cookie: value apiKey="key value" sk-abcdefghijklmnop encoded=s%20e%26t',
			["s e&t", "secret-value"],
		);
		for (const secret of ["secret-value", "s%20e%26t", "key value", "abcdefghijklmnop", "Cookie: value"])
			expect(safe).not.toContain(secret);
	});
	it("reassembles a secret split between stdout chunks before redacting", async () => {
		const lines: string[] = [];
		const stream = createLogStream((line) => lines.push(redactLog(line, ["split-secret"])));
		stream.write(Buffer.from("value=split-"));
		stream.end(Buffer.from("secret\n中文尾行"));
		await once(stream, "finish");
		expect(lines).toEqual(["value=[REDACTED]", "中文尾行"]);
	});
});
