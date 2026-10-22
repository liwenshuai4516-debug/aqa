/** Isolated browser regression: real chat components, fixed messages, no model/backend. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { CHROME_PATH } from "./lib/chrome.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidence = new URL(`./scratch/chat-presentation/${Date.now()}/`, import.meta.url);
mkdirSync(evidence, { recursive: true });
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MessageList} from '/src/components/MessageList.tsx';
import {LanguageProvider} from '/src/i18n.tsx';
import {openExportImage,closeExportImage} from '/src/export-image-state.ts';
window.openFixtureExport=()=>openExportImage('a2');
window.closeFixtureExport=closeExportImage;
import '/src/styles.css';
const messages = [
{id:'u',role:'user',timestamp:1000,content:[{type:'text',text:'查询时间'}]},
{id:'a1',role:'assistant',timestamp:2000,durationMs:9005,stopReason:'toolUse',content:[{type:'thinking',thinking:'正在分析并查询时间'},{type:'text',text:'我查一下当前时间。'},{type:'toolCall',id:'call',name:'bash',argumentsText:'{"command":"date"}'}]},
{id:'t',role:'toolResult',toolCallId:'call',timestamp:11024,content:[{type:'text',text:'16:54'}]},
{id:'a2',role:'assistant',timestamp:11027,durationMs:5388,stopReason:'stop',content:[{type:'thinking',thinking:'整理最终答案'},{type:'text',text:'现在是 16:54。'}]}
];
const root=createRoot(document.getElementById('root'));
window.renderFixture=(mode)=>{
 const running=mode==='running';
 const source=mode==='failed' ? [...messages.slice(0,-1),{...messages.at(-1),stopReason:'error',errorMessage:'Fixture failure'}] : messages;
 root.render(React.createElement(LanguageProvider,null,React.createElement(MessageList,{state:{messages:running?source.slice(0,3):source,streamingMessage:null,isStreaming:running,queue:{steering:[],followUp:[]},sessionId:'fixture',conversationId:'fixture'},liveOutputs:new Map(),toolStatuses:new Map(),thinkingWrap:true,toolsWrap:true})));
};
window.renderFixture('running');
`;
const server = await createServer({
	configFile: new URL("../web/vite.config.ts", import.meta.url).pathname,
	server: { host: "127.0.0.1", port: 8996, strictPort: true, open: false },
	plugins: [
		{
			name: "chat-fixture",
			configureServer(s) {
				s.middlewares.use(async (req, res, next) => {
					if (req.url !== "/__chat-fixture") return next();
					res.setHeader("Content-Type", "text/html");
					res.end(
						await s.transformIndexHtml(
							"/__chat-fixture",
							'<!DOCTYPE html><html lang="zh"><body><div id="root"></div><script type="module" src="/__chat-fixture.tsx"></script></body></html>',
						),
					);
				});
			},
			resolveId(id) {
				if (id === "/__chat-fixture.tsx") return "\0chat-fixture.tsx";
			},
			load(id) {
				if (id === "\0chat-fixture.tsx") return entry;
			},
		},
	],
});
let browser;
let passed = false;
const checks = [];
const errors = [];
try {
	await server.listen();
	browser = await chromium.launch({ executablePath: CHROME_PATH || undefined, headless: true });
	const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto("http://127.0.0.1:8996/__chat-fixture");
	await page.getByText("我查一下当前时间。", { exact: true }).waitFor();
	assert.equal(await page.locator(".thinking-body").count(), 1);
	assert.equal(await page.locator(".toolcall").count(), 1);
	checks.push("running process visible");
	await page.screenshot({ path: fileURLToPath(new URL("running.png", evidence)) });
	await page.evaluate(() => window.renderFixture("done"));
	await page.getByText("现在是 16:54。", { exact: true }).waitFor();
	assert.equal(await page.locator(".thinking").count(), 0);
	assert.equal(await page.locator(".toolcall").count(), 0);
	assert.equal(await page.getByText("我查一下当前时间。", { exact: true }).count(), 0);
	assert.match(await page.locator(".model-timing").innerText(), /14\.4s/);
	checks.push("completed final only; model timing 14.4s excludes tool time");
	await page.screenshot({ path: fileURLToPath(new URL("completed.png", evidence)) });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: fileURLToPath(new URL("completed-mobile.png", evidence)) });
	assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
	checks.push("mobile no horizontal overflow");
	await page.keyboard.press(process.platform === "darwin" ? "Meta+f" : "Control+f");
	await page.locator(".thinking").first().waitFor();
	checks.push("search restores original process");
	await page.keyboard.press("Escape");
	await page.evaluate(() => window.openFixtureExport());
	await page.locator(".thinking").first().waitFor();
	checks.push("export restores original process");
	await page.evaluate(() => window.closeFixtureExport());
	await page.evaluate(() => window.renderFixture("failed"));
	await page.getByText("Fixture failure", { exact: true }).waitFor();
	assert.equal(await page.locator(".toolcall").count(), 1);
	checks.push("failure evidence retained");
	await page.reload();
	await page.getByText("我查一下当前时间。", { exact: true }).waitFor();
	await page.evaluate(() => window.renderFixture("done"));
	await page.getByText("现在是 16:54。", { exact: true }).waitFor();
	assert.match(await page.locator(".model-timing").innerText(), /14\.4s/);
	checks.push("history re-render retains timing");
	assert.deepEqual(errors, []);
	passed = true;
	console.log(JSON.stringify({ status: "PASS", checks, evidence: fileURLToPath(evidence), root }));
} finally {
	writeFileSync(
		new URL("result.json", evidence),
		JSON.stringify({ status: passed ? "PASS" : "FAIL", checks, errors }, null, 2),
	);
	await browser?.close();
	await server.close();
}
