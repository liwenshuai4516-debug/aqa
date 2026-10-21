// Local-first acceptance of the installed app's original goal/delegate protocol.
// --real reads the credential from stdin only. Responses are never synthesized
// in real mode. The persistent ledger counts every forwarded attempt.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import { launchNativeApp } from "./native-app.mjs";
import { openBudget } from "./model-request-budget.mjs";

const executablePath = resolve(process.argv[2]);
const real = process.argv.includes("--real");
const goalOnly = process.argv.includes("--goal-only");
const prefixArg = process.argv.indexOf("--evidence-prefix");
const evidencePrefix = prefixArg < 0 ? (goalOnly ? "T20" : "T19") : process.argv[prefixArg + 1];
assert(/^T\d+(?:-[a-z0-9]+)*$/.test(evidencePrefix), "Invalid evidence prefix");
const strictBytes = process.argv.includes("--strict-bytes");
assert(!strictBytes || goalOnly, "Strict byte retry covers goal only");
const prefix = `docs/desktop-delivery/evidence/${evidencePrefix}-${real ? "real" : "local"}`;
const evidencePath = `${prefix}.json`;
assert(!existsSync(evidencePath), "Preserve existing evidence before another run");
let credential = "";
if (real) {
	for await (const chunk of process.stdin) credential += chunk;
	credential = credential.trim();
	assert(credential, "Credential required on stdin");
}
if (goalOnly && real && !existsSync(`${prefix}-budget.json`))
	copyFileSync("docs/desktop-delivery/evidence/T20-real-budget.json", `${prefix}-budget.json`);
const budget = openBudget(`${prefix}-budget.json`, goalOnly ? 14 : 8);
const fixture = mkdtempSync("/tmp/pi-goal-");
const workspace = join(fixture, "workspace");
const userData = join(fixture, "desktop");
const agent = join(userData, "agent");
mkdirSync(workspace);
mkdirSync(agent, { recursive: true });
const evidence = {
	fixture,
	executablePath,
	mode: real ? "real DeepSeek" : "scripted local provider",
	strictBytes,
	checks: [],
	requests: [],
	status: "FAIL",
};
let stage = "delegate";
let requestFailure = false;
const provider = createServer(async (req, res) => {
	let entry;
	try {
		let body = "";
		for await (const chunk of req) {
			body += chunk;
			assert(body.length < 100000, "Oversized incoming request");
		}
		const payload = JSON.parse(body);
		payload.max_tokens = 128;
		delete payload.max_completion_tokens;
		payload.thinking = { type: "disabled" };
		payload.stream_options = { include_usage: true };
		evidence.lastRequestShape = {
			bytes: Buffer.byteLength(JSON.stringify(payload)),
			messages: payload.messages.map((m) => ({ role: m.role, bytes: Buffer.byteLength(JSON.stringify(m)) })),
			tools: (payload.tools ?? []).map((t) => ({ name: t.function.name, bytes: Buffer.byteLength(JSON.stringify(t)) })),
		};
		entry = budget.reserve(payload);
		evidence.requests.push({
			ordinal: entry.ordinal,
			stage,
			tools: payload.tools.map((t) => t.function.name),
			inputBytes: entry.inputBytes,
		});
		if (real) {
			const upstream = await fetch("https://api.deepseek.com/chat/completions", {
				method: "POST",
				headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(60000),
			});
			entry.httpStatus = upstream.status;
			assert(upstream.ok, "Provider returned an unsuccessful status");
			res.writeHead(200, { "content-type": "text/event-stream" });
			let pending = "";
			const decoder = new TextDecoder();
			for await (const chunk of upstream.body) {
				res.write(chunk);
				pending += decoder.decode(chunk, { stream: true });
				const lines = pending.split("\n");
				pending = lines.pop();
				for (const line of lines) {
					if (!line.startsWith("data: {")) continue;
					const frame = JSON.parse(line.slice(6));
					if (frame.usage) entry.usage = frame.usage;
				}
			}
			entry.status = "completed";
			if (entry.usage) {
				assert(entry.usage.prompt_tokens <= 40000, "Input framing reserve exceeded");
				assert(entry.usage.completion_tokens <= 128, "Provider output reserve exceeded");
			} else throw new Error("Provider usage missing");
			res.end();
		} else {
			const messages = payload.messages;
			const lastUser = messages.findLastIndex((m) => m.role === "user");
			const review = JSON.stringify(messages[lastUser]).includes("[goal-review]");
			const afterTool = messages.slice(lastUser + 1).some((m) => m.role === "tool");
			let delta, finish;
			if (
				!afterTool &&
				!JSON.stringify(messages[lastUser]).includes("Goal achieved") &&
				!JSON.stringify(messages[lastUser]).includes("目标已达成")
			) {
				const name = review ? "read" : "write";
				const args = review
					? { path: "goal-proof.txt" }
					: { path: `${stage}-proof.txt`, content: `${stage.toUpperCase()}_OK` };
				delta = {
					tool_calls: [
						{
							index: 0,
							id: `call_${randomUUID()}`,
							type: "function",
							function: { name, arguments: JSON.stringify(args) },
						},
					],
				};
				finish = "tool_calls";
			} else {
				delta = {
					content: review
						? '{"verdict":"pass","feedback":"Read goal-proof.txt and verified GOAL_OK."}'
						: "Verified. Done.",
				};
				finish = "stop";
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			for (const [d, f] of [
				[delta, null],
				[{}, finish],
			])
				res.write(
					`data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta: d, finish_reason: f }] })}\n\n`,
				);
			res.end("data: [DONE]\n\n");
			entry.status = "local-completed";
		}
	} catch (error) {
		requestFailure = true;
		if (entry) entry.status = "failed-or-ambiguous";
		evidence.proxyError = error.name === "AssertionError" ? error.message : error.name;
		if (!res.headersSent) res.writeHead(400);
		res.end("Acceptance request stopped");
	} finally {
		budget.save();
	}
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
writeFileSync(
	join(agent, "models.json"),
	JSON.stringify({
		providers: {
			acceptance: {
				api: "openai-completions",
				baseUrl: `http://127.0.0.1:${provider.address().port}`,
				apiKey: "local-only",
				models: [
					{ id: "deepseek-flash", name: "Acceptance Flash", input: ["text"], contextWindow: 32000, maxTokens: 128 },
				],
			},
		},
	}),
);
writeFileSync(join(agent, "auth.json"), JSON.stringify({ acceptance: { type: "api_key", key: "local-only" } }));
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PI_WEB_TOOL_LAZY_LOADING: "0",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of [
	"ELECTRON_RUN_AS_NODE",
	"PI_WEB_DATA_DIR",
	"PI_CODING_AGENT_DIR",
	"PI_WEB_DESKTOP_URL",
	"PI_WEB_PORT",
	"DEEPSEEK_API_KEY",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
])
	delete env[key];
let application, ws, snapshot, settings, goalStatus;
const notices = [];
let seq = 0;
const send = (m) => ws.send(JSON.stringify({ ...m, seq: ++seq }));
const wait = async (predicate, label, timeout = 90000) => {
	const deadline = Date.now() + timeout;
	while (!predicate()) {
		assert(!requestFailure, "Provider forwarding stopped; see proxyError");
		assert(Date.now() < deadline, `Timeout: ${label}`);
		await sleep(100);
	}
};
const check = (label, value) => {
	assert(value, label);
	evidence.checks.push(label);
	console.log(label);
};
try {
	application = await launchNativeApp({ executablePath, packaged: true, env });
	const page = await application.firstWindow();
	await page.waitForSelector(".app");
	await application.context().addInitScript(() => {
		const Original = window.WebSocket;
		window.WebSocket = class extends Original {
			constructor(...args) {
				super(...args);
				if (String(args[0]).includes("/ws")) window.__acceptanceSocketUrl = String(args[0]);
			}
		};
	});
	await page.reload();
	await page.waitForFunction(() => window.__acceptanceSocketUrl);
	// The UI removes the launch token from the address bar. Reuse its actual
	// authenticated socket URL in memory only; never put that URL in evidence.
	ws = new WebSocket(await page.evaluate(() => window.__acceptanceSocketUrl));
	ws.on("message", (data) => {
		const m = JSON.parse(data);
		if (m.type === "snapshot") snapshot = m.state;
		if (m.type === "snapshot_delta" && snapshot?.rev === m.baseRev)
			snapshot = { ...snapshot, ...m.state, messages: [...(snapshot.messages ?? []), ...(m.appended ?? [])] };
		if (m.type === "settings_state") settings = m.settings;
		if (m.type === "goal_status") {
			goalStatus = m.status;
			evidence.goalStatus = goalStatus;
		}
		if (m.type === "notice") notices.push(m.text);
	});
	await once(ws, "open");
	send({ type: "hello", clientId: randomUUID() });
	await wait(() => snapshot && settings, "initial state");
	const { ALL_KNOWN_AGENT_TOOL_NAMES } = await import(
		pathToFileURL(resolve(executablePath, "../../Resources/app/dist/server/tool-manager.js"))
	);
	send({
		type: "set_settings",
		promptMode: "replace",
		customSystemPrompt:
			"Use read/write only in the given workspace. Write the exact requested content, then reply briefly. Review using read and report only the requested JSON. Never run commands or delegate tools.",
		disabledAgentTools: ALL_KNOWN_AGENT_TOOL_NAMES.filter((name) => !["read", "write"].includes(name)),
		toolLazyLoading: false,
		terminalToolsEnabled: false,
		parallelReminderEnabled: false,
	});
	await wait(() => settings?.promptMode === "replace" && settings?.toolLazyLoading === false, "test settings");
	send({ type: "set_model", modelId: "acceptance/deepseek-flash" });
	await sleep(1000);
	if (!goalOnly) {
		send({ type: "set_delegate_mode", enabled: true });
		await wait(() => snapshot.delegateMode === true, "delegate enabled");
		send({
			type: "prompt",
			text: "Use write now to create delegate-proof.txt containing exactly DELEGATE_OK. Then reply Done. Do not read or use other tools.",
		});
		await wait(() => snapshot.delegateConvId && existsSync(join(workspace, "delegate-proof.txt")), "delegate write");
		check(
			"Original Delegate Mode created an executor and wrote the requested file",
			readFileSync(join(workspace, "delegate-proof.txt"), "utf8") === "DELEGATE_OK",
		);
		evidence.delegateConvId = snapshot.delegateConvId;
		await wait(
			() => budget.state.requests.length >= 2 && budget.state.requests.at(-1).status.endsWith("completed"),
			"delegate response completed",
		);
		send({ type: "set_delegate_mode", enabled: false });
		await wait(() => !snapshot.delegateMode && !snapshot.delegateConvId, "delegate disabled");
	}
	stage = "goal";
	send({
		type: "set_goal",
		goal: strictBytes
			? 'Use write once to create goal-proof.txt. Set content to the JSON string "GOAL_OK": exactly seven ASCII bytes 47 4f 41 4c 5f 4f 4b (hex). No newline, whitespace, quotes or BOM. Then reply Done. The reviewer must use read to inspect the file and return the original required verdict JSON; do not assume the executor succeeded.'
			: goalOnly
				? "Use write once to create goal-proof.txt containing exactly GOAL_OK, then reply Done. This is the entire execution task; no additional verification steps are required from the executor."
				: "Use write to create goal-proof.txt containing exactly GOAL_OK. Do not read first. Reviewer: use read to verify that exact file content and return the required verdict JSON only.",
		maxRounds: 1,
		locked: true,
		execModel: "acceptance/deepseek-flash",
	});
	await wait(() => goalStatus?.roles?.executor?.convId, "goal executor");
	evidence.goalExecutor = goalStatus.roles.executor.convId;
	await wait(() => goalStatus?.verdict === "pass", "real goal review verdict");
	check(
		"Goal executor wrote exact requested content",
		readFileSync(join(workspace, "goal-proof.txt"), "utf8") === "GOAL_OK",
	);
	evidence.fileHex = readFileSync(join(workspace, "goal-proof.txt")).toString("hex");
	check(
		"Original goal orchestration accepted the reviewer verdict",
		goalStatus.verdict === "pass" && goalStatus.goal === null,
	);
	evidence.status = "PASS";
} catch (error) {
	evidence.error = !real || error.name === "AssertionError" ? error.message : error.name;
	process.exitCode = 1;
} finally {
	if (ws?.readyState === WebSocket.OPEN) {
		send({ type: "abort" });
		send({ type: "clear_goal" });
		ws.close();
	}
	await application?.close().catch(() => {});
	provider.closeAllConnections();
	await new Promise((r) => provider.close(r));
	credential = "";
	evidence.budget = budget.state;
	evidence.notices = notices;
	writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
	console.log(
		JSON.stringify({
			status: evidence.status,
			error: evidence.error,
			proxyError: evidence.proxyError,
			requests: evidence.requests.length,
			fixture,
		}),
	);
}
