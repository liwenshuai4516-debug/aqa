import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";

const runtimeRoot = resolve(process.argv[2]);
const filesystem = join(runtimeRoot, "node_modules/@modelcontextprotocol/server-filesystem");
assert.equal(JSON.parse(readFileSync(join(filesystem, "package.json"))).version, "2.0.0");
const executablePath = resolve(
	process.argv[3] ?? "release/mac-arm64/Pi Agent Desktop.app/Contents/MacOS/Pi Agent Desktop",
);
const fixture = realpathSync(mkdtempSync(join(tmpdir(), "pi-mcp-filesystem-")));
const workspace = join(fixture, "中文 workspace");
const userData = join(fixture, "desktop");
const agent = join(userData, "agent");
const data = join(userData, "data");
for (const directory of [workspace, agent, data]) mkdirSync(directory, { recursive: true });
const readPath = join(workspace, "中文 文件.txt");
const mcpWritePath = join(workspace, "mcp-written.txt");
const approvalPath = join(workspace, "approval-written.txt");
const outsidePath = join(fixture, "outside.txt");
writeFileSync(readPath, "MCP_REAL_READ_中文");
writeFileSync(outsidePath, "OUTSIDE_MUST_NOT_BE_READ");
writeFileSync(
	join(agent, "mcp.json"),
	JSON.stringify({
		mcpServers: {
			filesystem: {
				command: executablePath,
				args: [join(filesystem, "dist/index.js"), workspace],
				env: { ELECTRON_RUN_AS_NODE: "1" },
			},
			missing: { command: "pi-mcp-deliberately-missing-command", args: [] },
		},
	}),
);
writeFileSync(
	join(data, "approval-rules.json"),
	JSON.stringify([
		{
			id: "custom.desktop-approval",
			enabled: true,
			tools: ["write"],
			field: "path",
			match: "contains",
			value: "approval-written.txt",
			action: "ask",
			label: "Desktop acceptance write",
			labelEn: "Desktop acceptance write",
		},
	]),
);
const operations = {
	MCP_READ: { name: "read_text_file", args: { path: readPath }, expected: /MCP_REAL_READ_中文/ },
	MCP_REENABLED: { name: "read_text_file", args: { path: readPath }, expected: /MCP_REAL_READ_中文/ },
	MCP_WRITE: {
		name: "write_file",
		args: { path: mcpWritePath, content: "MCP_REAL_WRITE_中文" },
		expected: /Successfully wrote/,
	},
	MCP_OUTSIDE: {
		name: "read_text_file",
		args: { path: outsidePath },
		expected: /Access denied|outside allowed|not allowed/i,
	},
	APPROVAL_DENY: {
		name: "write",
		args: { path: approvalPath, content: "SHOULD_NOT_EXIST" },
		expected: /denied|拒绝|blocked|阻止/i,
	},
	APPROVAL_ALLOW: {
		name: "write",
		args: { path: approvalPath, content: "APPROVAL_REAL_WRITE" },
		expected: /wrote|written|写入/i,
	},
};
const requests = [];
const checks = [];
let providerFailure;
const provider = createServer(async (req, res) => {
	try {
		let body = "";
		for await (const chunk of req) body += chunk;
		const payload = JSON.parse(body);
		assert(requests.length < 16, "bounded local provider requests");
		const messages = payload.messages;
		const userIndex = messages.findLastIndex((message) => message.role === "user");
		const userText = JSON.stringify(messages[userIndex]?.content);
		const operationId = Object.keys(operations).find((id) => userText.includes(id));
		const operation = operations[operationId];
		assert(operation, "known test operation");
		const toolResult = messages.slice(userIndex + 1).find((message) => message.role === "tool");
		requests.push({
			operation: operationId,
			phase: toolResult ? "result" : "call",
			availableTools: (payload.tools ?? []).map((tool) => tool.function.name),
			...(toolResult ? { toolResult: toolResult.content } : {}),
		});
		if (toolResult) assert.match(JSON.stringify(toolResult.content), operation.expected);
		else assert(requests.at(-1).availableTools.includes(operation.name), "tool registered: " + operation.name);
		res.writeHead(200, { "content-type": "text/event-stream" });
		const delta = toolResult
			? { content: `${operationId}_OK` }
			: {
					tool_calls: [
						{
							index: 0,
							id: "call_" + operationId,
							type: "function",
							function: { name: operation.name, arguments: JSON.stringify(operation.args) },
						},
					],
				};
		for (const [content, finish] of [
			[delta, null],
			[{}, toolResult ? "stop" : "tool_calls"],
		])
			res.write(
				`data: ${JSON.stringify({ id: operationId, object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta: content, finish_reason: finish }] })}\n\n`,
			);
		res.end("data: [DONE]\n\n");
	} catch (error) {
		providerFailure = error;
		res.writeHead(500).end("Local acceptance assertion failed");
	}
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
writeFileSync(
	join(agent, "models.json"),
	JSON.stringify({
		providers: {
			fixture: {
				api: "openai-completions",
				baseUrl: `http://127.0.0.1:${provider.address().port}`,
				apiKey: "local-only",
				models: [{ id: "mcp-fixture", name: "MCP Fixture", input: ["text"], contextWindow: 32000, maxTokens: 128 }],
			},
		},
	}),
);
writeFileSync(join(agent, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "local-only" } }));
const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
assert(port >= 8900);
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of [
	"ELECTRON_RUN_AS_NODE",
	"PI_WEB_DATA_DIR",
	"PI_CODING_AGENT_DIR",
	"PI_CODING_AGENT_SESSION_DIR",
	"PI_WEB_DESKTOP_URL",
	"DEEPSEEK_API_KEY",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
])
	delete env[key];
let application;
const mcpPids = new Set();
function filesystemPids() {
	const rows = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" }).split("\n");
	return rows
		.filter((row) => row.includes(join(filesystem, "dist/index.js")) && row.includes(workspace))
		.map((row) => Number(row.trim().split(/\s+/)[0]));
}
async function until(predicate, timeout = 10000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("MCP condition timeout");
}
try {
	application = await launchNativeApp({ executablePath, packaged: true, env });
	const page = await application.firstWindow();
	await page.waitForSelector(".app");
	await page.waitForLoadState("networkidle");
	await page.getByRole("button", { name: "MCP Fixture", exact: true }).waitFor({ timeout: 30000 });
	await until(() => filesystemPids().length === 1);
	await page.getByRole("button", { name: "设置", exact: true }).click();
	await page.locator(".settings-tab", { hasText: "MCP" }).click();
	await page
		.locator(".mcp-server-card")
		.filter({ has: page.locator(".mcp-server-name", { hasText: /^filesystem$/ }) })
		.locator(".status-running")
		.waitFor();
	await page.keyboard.press("Escape");
	const prompt = async (id, approval) => {
		await page.locator(".inputbox textarea").fill(id);
		await page.locator(".inputbox textarea").press("Enter");
		if (approval) {
			const modal = page.locator(".approval-modal");
			await modal.waitFor();
			assert(!existsSync(approvalPath), "no write before approval");
			await modal
				.getByRole("button")
				.filter({ hasText: approval === "deny" ? /^拒绝$/ : /^批准执行$/ })
				.click();
		}
		await page.getByText(id + "_OK", { exact: true }).waitFor({ timeout: 30000 });
		if (providerFailure) throw providerFailure;
		assert.equal(requests.filter((request) => request.operation === id).length, 2);
	};
	await prompt("MCP_READ");
	checks.push({
		id: "A09/A05",
		status: "PASS",
		check:
			"packaged UI → real bundled SDK → original MCP bridge → official filesystem 2.0.0 stdio server reads Chinese filename and contents; scripted local provider only",
	});
	await prompt("MCP_WRITE");
	assert.equal(readFileSync(mcpWritePath, "utf8"), "MCP_REAL_WRITE_中文");
	checks.push({
		id: "A09/A05",
		status: "PASS",
		check: "official MCP write_file writes actual workspace file; result returns through SDK and UI",
	});
	await prompt("MCP_OUTSIDE");
	assert.equal(readFileSync(outsidePath, "utf8"), "OUTSIDE_MUST_NOT_BE_READ");
	checks.push({
		id: "A09",
		status: "PASS",
		check: "official MCP filesystem server refuses read outside its configured allowed root",
	});
	await prompt("APPROVAL_DENY", "deny");
	assert(!existsSync(approvalPath));
	await prompt("APPROVAL_ALLOW", "approve");
	assert.equal(readFileSync(approvalPath, "utf8"), "APPROVAL_REAL_WRITE");
	checks.push({
		id: "A04",
		status: "PASS",
		check:
			"original built-in write custom approval rule: UI denies with no disk write, then UI approves and actual file is written; no write occurs before either decision",
	});
	await page.getByRole("button", { name: "设置", exact: true }).click();
	await page.locator(".settings-tab", { hasText: "MCP" }).click();
	const card = page
		.locator(".mcp-server-card")
		.filter({ has: page.locator(".mcp-server-name", { hasText: /^filesystem$/ }) });
	await card.locator(".status-running").waitFor();
	const missing = page
		.locator(".mcp-server-card")
		.filter({ has: page.locator(".mcp-server-name", { hasText: /^missing$/ }) });
	await missing.locator(".status-error").waitFor();
	filesystemPids().forEach((pid) => mcpPids.add(pid));
	assert.equal(mcpPids.size, 1);
	await card.getByRole("switch").click();
	await card.locator(".status-stopped").waitFor();
	await until(() => filesystemPids().length === 0);
	assert.equal(JSON.parse(readFileSync(join(agent, "mcp.json"))).mcpServers.filesystem.enabled, false);
	await card.getByRole("switch").click();
	await card.locator(".status-running").waitFor();
	filesystemPids().forEach((pid) => mcpPids.add(pid));
	assert.equal(mcpPids.size, 2);
	checks.push({
		id: "A09",
		status: "PASS",
		check:
			"original MCP settings UI shows real tools and missing-command error independently; disable stops official process and persists config; enable starts a new process",
	});
	await page.screenshot({ path: "docs/desktop-delivery/evidence/T14-mcp-settings.png" });
	await page.keyboard.press("Escape");
	await prompt("MCP_REENABLED");
	checks.push({
		id: "A09",
		status: "PASS",
		check: "after disabling and enabling MCP, the same chat calls the new official process successfully without reload",
	});
	await application.close();
	application = null;
	await until(() => filesystemPids().length === 0);
	checks.push({
		id: "T05/A09",
		status: "PASS",
		check: "normal desktop quit cleans up the external MCP server process",
	});
} catch (error) {
	checks.push({ status: "FAIL", error: (providerFailure ?? error).stack });
	process.exitCode = 1;
} finally {
	if (application) await application.close().catch(() => application.process().kill("SIGTERM"));
	provider.closeAllConnections();
	await new Promise((r) => provider.close(r));
	const result = {
		fixture,
		executablePath,
		dependency: { name: "@modelcontextprotocol/server-filesystem", version: "2.0.0", runtimeRoot },
		model: "bounded local scripted SSE provider; no real model or provider requests",
		checks,
		requests,
		mcpPids: [...mcpPids],
	};
	writeFileSync("docs/desktop-delivery/evidence/T14-mcp-filesystem.json", JSON.stringify(result, null, 2));
	console.log(JSON.stringify(checks, null, 2));
}
