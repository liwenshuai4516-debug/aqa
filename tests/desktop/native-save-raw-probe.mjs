// Native API probe with raw CDP only: no Playwright browser/context configuration.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { once } from "node:events";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import assert from "node:assert/strict";
const executable = resolve(process.argv[2]),
	output = resolve(process.argv[3]);
assert(!existsSync(output));
const saveMode = process.argv.includes("--save");
const fixture = mkdtempSync("/tmp/pi-native-save-raw-");
const workspace = join(fixture, "中文 workspace");
mkdirSync(workspace);
const downloads = join(fixture, "中文 downloads");
mkdirSync(downloads);
const expectedPath = join(downloads, "报告.zip");
const expectedHex = "504b0506000000000000000000000000000000000000";
writeFileSync(join(workspace, "报告.zip"), Buffer.from(expectedHex, "hex"));
mkdirSync(join(fixture, "desktop/agent"), { recursive: true });
writeFileSync(join(fixture, "desktop/agent/auth.json"), "{}");
writeFileSync(join(fixture, "desktop/agent/models.json"), "{}");
const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: join(fixture, "desktop"),
	PI_WEB_CWD: workspace,
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of Object.keys(env))
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_|PI_PORTABLE)/.test(key) ||
		[
			"ELECTRON_RUN_AS_NODE",
			"NODE_OPTIONS",
			"PI_WEB_DATA_DIR",
			"PI_CODING_AGENT_DIR",
			"PI_CODING_AGENT_SESSION_DIR",
			"PI_WEB_DESKTOP_URL",
			"PI_WEB_PORT",
			"PORTABLE_EXECUTABLE_DIR",
		].includes(key)
	)
		delete env[key];
const child = spawn(executable, ["--inspect=0", `--remote-debugging-port=${port}`], {
	env,
	stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
for (const s of [child.stdout, child.stderr]) s.on("data", (d) => (logs += d));
const result = {
	fixture,
	executable,
	status: "FAIL",
	instrumentation: "Raw CDP only; original API; no download or chooser behavior override",
	realModelRequests: 0,
};
let pageSocket, mainSocket;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sequence = 0;
async function command(socket, method, params) {
	const id = ++sequence;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			socket.off("message", listener);
			reject(new Error("CDP command timeout"));
		}, 10000);
		function listener(data) {
			const m = JSON.parse(data);
			if (m.id !== id) return;
			clearTimeout(timer);
			socket.off("message", listener);
			if (m.error || m.result?.exceptionDetails) reject(new Error("CDP evaluation failed"));
			else resolve(m.result);
		}
		socket.on("message", listener);
		socket.send(JSON.stringify({ id, method, params }));
	});
}
try {
	const deadline = Date.now() + 60000;
	while (!logs.includes("[desktop] window loaded")) {
		assert(child.exitCode === null && Date.now() < deadline);
		await sleep(100);
	}
	const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	const target = targets.find((t) => t.type === "page");
	assert(target);
	pageSocket = new WebSocket(target.webSocketDebuggerUrl);
	await once(pageSocket, "open");
	const mainUrl = logs.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/)?.[1];
	assert(mainUrl);
	mainSocket = new WebSocket(mainUrl);
	await once(mainSocket, "open");
	await command(mainSocket, "Runtime.evaluate", {
		expression:
			"(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/probe.cjs')('electron');e.app.focus({steal:true});e.BrowserWindow.getAllWindows()[0].show();e.BrowserWindow.getAllWindows()[0].focus();return true;})()",
		returnByValue: true,
	});
	if (saveMode) {
		const readyDeadline = Date.now() + 30000;
		while (true) {
			const r = await command(pageSocket, "Runtime.evaluate", {
				expression: "[...document.querySelectorAll('.file-item.file')].some(e=>e.textContent.includes('报告.zip'))",
				returnByValue: true,
			});
			if (r.result.value) break;
			assert(Date.now() < readyDeadline);
			await sleep(100);
		}
		await command(pageSocket, "Runtime.evaluate", {
			expression:
				"(()=>{const original=window.showSaveFilePicker;window.__rawSave={state:'not-called'};window.showSaveFilePicker=async function(...args){window.__rawSave={state:'pending',startedAt:Date.now(),suggestedName:args[0]?.suggestedName};try{const h=await Reflect.apply(original,this,args);window.__rawSaveHandle=h;window.__rawSave={...window.__rawSave,state:'selected',name:h.name};return h;}catch(e){window.__rawSave={...window.__rawSave,state:'rejected',errorName:e.name,errorMessage:e.message};throw e;}};[...document.querySelectorAll('.file-item.file')].find(e=>e.textContent.includes('报告.zip')).querySelector('button.file-attach.download').click();return true;})()",
			userGesture: true,
			returnByValue: true,
		});
		await sleep(2000);
		const initial = await command(pageSocket, "Runtime.evaluate", {
			expression: "JSON.stringify(window.__rawSave)",
			returnByValue: true,
		});
		result.initialOutcome = JSON.parse(initial.result.value);
		assert.equal(result.initialOutcome.state, "pending", "Native picker did not remain open");
		console.log("NATIVE_SAVE_REQUIRED: " + expectedPath);
		const deadline = Date.now() + 900000;
		while (Date.now() < deadline) {
			const r = await command(pageSocket, "Runtime.evaluate", {
				expression:
					"(async()=>{const t={...window.__rawSave};if(window.__rawSaveHandle){const f=await window.__rawSaveHandle.getFile();t.fileBytes=Array.from(new Uint8Array(await f.arrayBuffer()));}return JSON.stringify(t);})()",
				awaitPromise: true,
				returnByValue: true,
			});
			result.outcome = JSON.parse(r.result.value);
			assert.notEqual(result.outcome.state, "rejected", "Original native picker rejected");
			if (result.outcome.fileBytes && Buffer.from(result.outcome.fileBytes).toString("hex") === expectedHex) break;
			await sleep(250);
		}
		assert.equal(Buffer.from(result.outcome.fileBytes ?? []).toString("hex"), expectedHex);
		assert.equal(result.outcome.suggestedName, "报告.zip");
		assert.equal(result.outcome.name, "报告.zip");
		result.expectedPath = expectedPath;
		result.expectedPathExists = existsSync(expectedPath);
		if (result.expectedPathExists) assert.equal(readFileSync(expectedPath).toString("hex"), expectedHex);
		result.status = "PASS";
	} else {
		await command(pageSocket, "Runtime.evaluate", {
			expression:
				"(()=>{window.__rawSave={state:'pending',startedAt:Date.now()};window.showSaveFilePicker({suggestedName:'原生保存诊断.zip'}).then(h=>window.__rawSave={...window.__rawSave,state:'selected',name:h.name,endedAt:Date.now()},e=>window.__rawSave={...window.__rawSave,state:'rejected',errorName:e.name,errorMessage:e.message,endedAt:Date.now()});return true;})()",
			userGesture: true,
			returnByValue: true,
		});
		await sleep(2000);
		const response = await command(pageSocket, "Runtime.evaluate", {
			expression: "JSON.stringify(window.__rawSave)",
			returnByValue: true,
		});
		result.initialOutcome = JSON.parse(response.result.value);
		result.status = "OBSERVED";
	}
} catch (error) {
	result.error = error.message;
	process.exitCode = 1;
} finally {
	if (mainSocket?.readyState === WebSocket.OPEN) {
		void command(mainSocket, "Runtime.evaluate", {
			expression: "process.getBuiltinModule('module').createRequire(process.cwd()+'/probe.cjs')('electron').app.quit()",
		}).catch(() => {});
		await sleep(100);
		mainSocket.close();
	}
	pageSocket?.close();
	const deadline = Date.now() + 15000;
	while (child.exitCode === null && Date.now() < deadline) await sleep(100);
	if (child.exitCode === null) {
		child.kill("SIGTERM");
		result.cleanup = "owned app exceeded quit wait";
	} else result.cleanupExit = child.exitCode;
	result.probeStoppedByClosingOwnedApp = true;
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
