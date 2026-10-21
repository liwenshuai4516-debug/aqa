import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import WebSocket from "ws";
import { once } from "node:events";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
const [mainEndpoint, pageEndpoint, savePath, output] = process.argv.slice(2);
assert(!existsSync(output));
const result = {
	status: "FAIL",
	instrumentation:
		"Original blob branch selected by prior diagnostic; reset CDP download behavior to default; actual Electron will-download destination",
	checks: [],
};
let browser,
	ws,
	id = 0;
try {
	const targets = await (await fetch(mainEndpoint + "/json/list")).json();
	ws = new WebSocket(targets[0].webSocketDebuggerUrl);
	await once(ws, "open");
	const evaluate = async (expression) => {
		const response = once(ws, "message");
		ws.send(JSON.stringify({ id: ++id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
		const [data] = await response;
		const value = JSON.parse(data);
		assert(!value.error && !value.result?.exceptionDetails);
		return value.result.result.value;
	};
	await evaluate(
		`(()=>{globalThis.__downloadProbe=null;process.getBuiltinModule('module').createRequire(process.cwd()+'/native-test.cjs')('electron').BrowserWindow.getAllWindows()[0].webContents.session.once('will-download',(_e,item)=>{globalThis.__downloadProbe={name:item.getFilename(),state:'started'};item.setSavePath(${JSON.stringify(savePath)});item.once('done',(_e,state)=>{globalThis.__downloadProbe={...globalThis.__downloadProbe,state,path:item.getSavePath()};});});return true;})()`,
	);
	browser = await chromium.connectOverCDP(pageEndpoint);
	const protocol = await browser.newBrowserCDPSession();
	await protocol.send("Browser.setDownloadBehavior", { behavior: "default" });
	const page = browser.contexts()[0].pages()[0];
	const row = page.locator(".file-item.file").filter({ has: page.locator(".file-name-text", { hasText: "报告.zip" }) });
	await row.hover();
	await row.locator("button.file-attach.download").click();
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const raw = await evaluate("JSON.stringify(globalThis.__downloadProbe)");
		result.download = JSON.parse(raw);
		if (result.download?.state === "completed") break;
		await new Promise((r) => setTimeout(r, 100));
	}
	assert.equal(result.download?.state, "completed");
	result.fileExists = existsSync(savePath);
	assert(result.fileExists);
	result.fileHex = readFileSync(savePath).toString("hex");
	assert.equal(result.fileHex, "504b0506000000000000000000000000000000000000");
	result.checks.push("Actual Electron download completed at explicit path with exact original ZIP bytes");
	result.status = "PASS";
} catch (error) {
	result.error = error.message;
	process.exitCode = 1;
} finally {
	ws?.close();
	await browser?.close().catch(() => {});
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
