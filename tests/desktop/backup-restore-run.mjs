// Actual internal package, independent data, original SDK/protocol and filesystem.
// Verifies same-version reinstall and full-data restore, not signed auto-update.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import WebSocket from "ws";
import { launchNativeApp } from "./native-app.mjs";
import { waitForStablePage } from "../lib/page-stability.mjs";

const executablePath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve existing evidence");
const fixture = mkdtempSync("/tmp/pi-restore-");
const workspace = join(fixture, "中文 workspace");
const userData = join(fixture, "desktop");
const agent = join(userData, "agent");
mkdirSync(workspace);
mkdirSync(agent, { recursive: true });
// Seed an existing workspace choice; native picker interaction is a separate gate.
writeFileSync(join(userData, "startup.json"), JSON.stringify({ workspace }), { mode: 0o600 });
const projectProof = join(workspace, "用户文件.txt");
const projectBytes = Buffer.from("用户文件不可损坏\nPROJECT_PRESERVED\n");
writeFileSync(projectProof, projectBytes);
let requests = 0;
const provider = createServer(async (req, res) => {
	for await (const _ of req) {
		/* consume only local test input */
	}
	requests++;
	res.writeHead(200, { "content-type": "text/event-stream" });
	for (const [delta, finish] of [
		[{ content: "RESTORE_HISTORY_OK" }, null],
		[{}, "stop"],
	])
		res.write(
			`data: ${JSON.stringify({ id: "restore", object: "chat.completion.chunk", model: "restore", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
		);
	res.end("data: [DONE]\n\n");
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
writeFileSync(join(agent, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "local-only" } }));
writeFileSync(
	join(agent, "models.json"),
	JSON.stringify({
		providers: {
			fixture: {
				api: "openai-completions",
				apiKey: "local-only",
				baseUrl: `http://127.0.0.1:${provider.address().port}`,
				models: [{ id: "restore", name: "Restore Fixture", contextWindow: 32000, maxTokens: 128 }],
			},
		},
	}),
);
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of Object.keys(env))
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_)/.test(key) ||
		[
			"ELECTRON_RUN_AS_NODE",
			"NODE_OPTIONS",
			"PI_WEB_DATA_DIR",
			"PI_CODING_AGENT_DIR",
			"PI_CODING_AGENT_SESSION_DIR",
			"PI_WEB_DESKTOP_URL",
			"PI_WEB_PORT",
		].includes(key)
	)
		delete env[key];
const result = { fixture, executablePath, status: "FAIL", checks: [], realModelRequests: 0 };
let app, ws;
const check = (label, value) => {
	assert(value, label);
	result.checks.push({ status: "PASS", check: label });
};
async function until(predicate) {
	const end = Date.now() + 30000;
	while (Date.now() < end) {
		if (await predicate()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("Restore condition timeout");
}
async function launch(executable) {
	app = await launchNativeApp({ executablePath: executable, packaged: true, env });
	const page = await app.firstWindow();
	await page.waitForSelector(".app");
	assert(await waitForStablePage(page));
	const origin = new URL(page.url()).origin;
	const cookies = await app.evaluate(
		async ({ BrowserWindow }, url) => BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({ url }),
		origin,
	);
	const token = cookies.find((c) => c.name === "pi_web_token")?.value;
	assert(token);
	ws = new WebSocket(origin.replace("http:", "ws:") + "/ws", { headers: { Authorization: `Bearer ${token}` } });
	const messages = [];
	ws.on("message", (data) => messages.push(JSON.parse(data)));
	await once(ws, "open");
	ws.send(JSON.stringify({ type: "hello", clientId: "backup-restore", locale: "en" }));
	await until(() => messages.some((m) => m.type === "ready"));
	return { page, messages };
}
async function quit() {
	ws?.close();
	ws = null;
	if (app) {
		await app.close();
		app = null;
	}
}
const send = (message) => ws.send(JSON.stringify(message));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function manifest(root) {
	const entries = {};
	function walk(dir) {
		for (const item of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, item.name);
			if (item.isDirectory()) walk(path);
			else if (item.isFile()) entries[relative(root, path)] = hash(readFileSync(path));
			else throw new Error("Unexpected special file in offline data snapshot");
		}
	}
	walk(root);
	return entries;
}
try {
	let run = await launch(executablePath);
	send({ type: "set_model", modelId: "fixture/restore" });
	await until(() => run.messages.some((m) => m.state?.model?.id === "restore"));
	send({ type: "prompt", text: "Reply RESTORE_HISTORY_OK only." });
	await until(() =>
		run.messages.some((m) => JSON.stringify(m.state?.messages ?? m.appended ?? []).includes("RESTORE_HISTORY_OK")),
	);
	send({ type: "get_state" });
	await until(() =>
		run.messages.some(
			(m) =>
				m.type === "snapshot" &&
				m.state?.isStreaming === false &&
				JSON.stringify(m.state?.messages).includes("RESTORE_HISTORY_OK"),
		),
	);
	await run.page.evaluate(() => {
		localStorage.setItem("pi-web-ui:theme", "nord");
		localStorage.setItem("pi-web-ui:lang", "en");
		localStorage.setItem("pi-web-ui:left-panel-width", "317");
	});
	await until(
		() =>
			existsSync(join(userData, "ui-preferences.json")) &&
			JSON.parse(readFileSync(join(userData, "ui-preferences.json"), "utf8"))["pi-web-ui:left-panel-width"] === "317",
	);
	await quit();
	check("Original SDK completed history and preferences persisted before offline backup", requests === 1);
	const before = manifest(userData);
	const backup = join(fixture, "离线 backup");
	execFileSync("cp", ["-cR", userData, backup]);
	check(
		"Full offline data backup hashes exactly match every source file",
		JSON.stringify(manifest(backup)) === JSON.stringify(before),
	);
	const sessionFiles = Object.keys(before).filter((p) => p.startsWith("agent/sessions/") && p.endsWith(".jsonl"));
	assert(sessionFiles.length);
	const history = sessionFiles.find((p) => readFileSync(join(userData, p), "utf8").includes("RESTORE_HISTORY_OK"));
	assert(history);
	renameSync(userData, join(fixture, "原数据保留"));
	execFileSync("cp", ["-cR", backup, userData]);
	check(
		"Restore to original userData path exactly matches the complete offline snapshot",
		JSON.stringify(manifest(userData)) === JSON.stringify(before),
	);
	const bundle = resolve(executablePath, "../../..");
	const replacement = join(fixture, "重新安装 Pi Agent Desktop.app");
	execFileSync("cp", ["-cR", bundle, replacement]);
	const replacementExe = join(replacement, "Contents/MacOS/Pi Agent Desktop");
	check(
		"Reinstalled application executable is byte-identical",
		hash(readFileSync(replacementExe)) === hash(readFileSync(executablePath)),
	);
	delete env.PI_WEB_CWD;
	run = await launch(replacementExe);
	check(
		"Saved workspace and allowlisted UI preferences restore without cwd override",
		JSON.parse(readFileSync(join(userData, "startup.json"), "utf8")).workspace === workspace &&
			(await run.page.evaluate(
				() =>
					localStorage.getItem("pi-web-ui:theme") === "nord" &&
					localStorage.getItem("pi-web-ui:lang") === "en" &&
					localStorage.getItem("pi-web-ui:left-panel-width") === "317",
			)),
	);
	send({ type: "switch_session", path: join(userData, history) });
	await until(() => run.messages.some((m) => JSON.stringify(m.state?.messages ?? []).includes("RESTORE_HISTORY_OK")));
	check("Restored original history opens through actual sidecar and SDK", true);
	await new Promise((r) => setTimeout(r, 3000));
	check(
		"Reinstall and restore issue no extra model request or project modification",
		requests === 1 && readFileSync(projectProof).equals(projectBytes),
	);
	check(
		"Session and local-only provider configuration retain exact saved bytes",
		sessionFiles.every((p) => hash(readFileSync(join(userData, p))) === before[p]) &&
			["agent/auth.json", "agent/models.json"].every((p) => hash(readFileSync(join(userData, p))) === before[p]),
	);
	result.snapshot = before;
	result.history = history;
	result.reinstalledExecutable = replacementExe;
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	await quit().catch((error) => {
		result.cleanupError = error.message;
		process.exitCode = 1;
	});
	provider.closeAllConnections();
	await new Promise((r) => provider.close(r));
	result.localRequests = requests;
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(
		JSON.stringify({
			status: result.status,
			checks: result.checks.length,
			error: result.error,
			cleanupError: result.cleanupError,
			localRequests: requests,
		}),
	);
}
