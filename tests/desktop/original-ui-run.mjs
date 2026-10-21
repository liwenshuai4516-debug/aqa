import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CHROME_PATH } from "../lib/chrome.mjs";

const args = process.argv.slice(2);
const prefixIndex = args.indexOf("--evidence-prefix");
const evidencePrefix = prefixIndex >= 0 ? args.splice(prefixIndex, 2)[1] : "T18";
assert(/^[A-Za-z0-9-]+$/.test(evidencePrefix), "Evidence prefix must be a filename stem");
const scripts = args.length ? args : ["terminal-browser", "file-upload-browser", "image-paste-browser"];
const evidencePath = `docs/desktop-delivery/evidence/${evidencePrefix}-original-ui.json`;
assert(!existsSync(evidencePath), "Preserve previous UI evidence");
for (const script of scripts)
	assert(!existsSync(`docs/desktop-delivery/evidence/${evidencePrefix}-${script}.log`), "Preserve previous UI logs");
const fixture = mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "pi-ui-"));
let localRequests = 0;
const provider = createServer(async (req, res) => {
	for await (const _ of req) {
		/* consume only local test input */
	}
	localRequests++;
	res.writeHead(200, { "content-type": "text/event-stream" });
	for (const [delta, finish] of [
		[{ content: "LOCAL_UI_ACCEPTANCE_OK" }, null],
		[{}, "stop"],
	])
		res.write(
			`data: ${JSON.stringify({ id: "ui-fixture", object: "chat.completion.chunk", model: "ui-fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
		);
	res.end("data: [DONE]\n\n");
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
const checks = [];
try {
	for (const script of scripts) {
		const root = join(fixture, script);
		const agent = join(root, "agent");
		mkdirSync(agent, { recursive: true });
		writeFileSync(join(agent, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "local-only" } }));
		writeFileSync(
			join(agent, "models.json"),
			JSON.stringify({
				providers: {
					fixture: {
						api: "openai-completions",
						baseUrl: `http://127.0.0.1:${provider.address().port}`,
						apiKey: "local-only",
						models: [
							{ id: "ui-fixture", name: "UI Fixture", input: ["text", "image"], contextWindow: 32000, maxTokens: 128 },
						],
					},
				},
			}),
		);
		const env = {
			...process.env,
			CHROME_PATH,
			PI_CODING_AGENT_DIR: agent,
			PI_WEB_DATA_DIR: join(root, "data"),
			PI_WEB_PLUGIN_CATALOG_URL: "off",
			PI_WEB_TOKEN: "",
		};
		for (const key of Object.keys(env))
			if (
				/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
				/^(AWS_|GOOGLE_|GCLOUD_|AZURE_)/.test(key) ||
				["PI_WEB_DESKTOP_URL", "ELECTRON_RUN_AS_NODE"].includes(key)
			)
				delete env[key];
		const child = spawn(process.execPath, [resolve(`tests/${script}-test.mjs`)], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let logs = "";
		child.stdout.on("data", (data) => {
			logs += data;
		});
		child.stderr.on("data", (data) => {
			logs += data;
		});
		const [code, signal] = await once(child, "exit");
		writeFileSync(`docs/desktop-delivery/evidence/${evidencePrefix}-${script}.log`, logs);
		const skipped = logs.split("\n").filter((line) => /\bSKIP\b/.test(line));
		checks.push({ script, code, signal, status: code !== 0 ? "FAIL" : skipped.length ? "PARTIAL" : "PASS", skipped });
		console.log(JSON.stringify(checks.at(-1)));
		if (code !== 0) process.exitCode = 1;
	}
} finally {
	provider.closeAllConnections();
	await new Promise((resolveClose) => provider.close(resolveClose));
	writeFileSync(evidencePath, JSON.stringify({ fixture, realModelRequests: 0, localRequests, checks }, null, 2));
}
