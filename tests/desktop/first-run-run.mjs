import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const fixture = mkdtempSync(join(tmpdir(), "pi-first-run-"));
const workspace = join(fixture, "中文 workspace");
mkdirSync(workspace);
const executable = resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const checks = [];
async function port() {
	const server = createServer().listen(0, "127.0.0.1");
	await once(server, "listening");
	const value = server.address().port;
	await new Promise((r) => server.close(r));
	return value;
}
async function run(name, userData, answers, expectedWindow) {
	const hook = join(fixture, name + ".mjs");
	const callsPath = join(fixture, name + "-calls.json");
	writeFileSync(
		hook,
		`import {dialog} from 'electron'; import fs from 'node:fs'; const answers=${JSON.stringify(answers)}; const calls=[];
const record=()=>fs.writeFileSync(${JSON.stringify(callsPath)},JSON.stringify(calls)); record();
dialog.showOpenDialog=async(options)=>{calls.push({kind:'picker',options});record();if(!answers.length)throw Error('Unexpected picker');return answers.shift();};
dialog.showErrorBox=(title,message)=>{calls.push({kind:'error',title,message});record();}; await import(${JSON.stringify(pathToFileURL(resolve("dist/desktop/main.js")).href)});`,
	);
	const debugPort = await port();
	const env = {
		...process.env,
		PI_DESKTOP_USER_DATA: userData,
		PI_WEB_PORT: String(await port()),
		PI_WEB_PLUGIN_CATALOG_URL: "off",
		PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
	};
	for (const key of [
		"PI_WEB_CWD",
		"PI_WEB_DATA_DIR",
		"PI_CODING_AGENT_DIR",
		"PI_CODING_AGENT_SESSION_DIR",
		"PI_WEB_DESKTOP_URL",
		"ELECTRON_RUN_AS_NODE",
	])
		delete env[key];
	let browser;
	let logs = "";
	const child = spawn(executable, [hook, `--remote-debugging-port=${debugPort}`], {
		env,
		cwd: fixture,
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.on("data", (d) => {
		logs += d;
	});
	child.stderr.on("data", (d) => {
		logs += d;
	});
	const exited = once(child, "exit");
	try {
		const deadline = Date.now() + 45000;
		while (expectedWindow ? !logs.includes("[desktop] window loaded") : child.exitCode === null) {
			assert(Date.now() < deadline, "first-run timeout " + name);
			if (expectedWindow) assert.equal(child.exitCode, null, "app must stay alive");
			await new Promise((r) => setTimeout(r, 100));
		}
		if (expectedWindow) {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
			await browser.contexts()[0].pages()[0].waitForSelector(".app");
			const session = await browser.newBrowserCDPSession();
			void session.send("Browser.close").catch(() => {});
			let timer;
			try {
				await Promise.race([
					exited,
					new Promise((_, reject) => {
						timer = setTimeout(() => reject(new Error("quit timeout")), 15000);
					}),
				]);
			} finally {
				clearTimeout(timer);
			}
		} else {
			assert(!logs.includes("spawning server"), "cancel never spawns service");
			assert(!existsSync(join(userData, "startup.json")), "cancel does not save workspace");
		}
		assert.equal(child.exitCode, 0);
		return JSON.parse(readFileSync(callsPath, "utf8"));
	} finally {
		writeFileSync(join(fixture, name + "-process.log"), logs);
		await browser?.close().catch(() => {});
		if (child.exitCode === null) child.kill("SIGTERM");
	}
}
try {
	const cancelled = await run("cancel", join(fixture, "cancel-data"), [{ canceled: true, filePaths: [] }], false);
	assert.equal(cancelled.filter((c) => c.kind === "picker").length, 1);
	checks.push({
		id: "T03",
		status: "PASS",
		check: "no workspace override: native picker invoked; cancel exits with no service or saved workspace",
	});
	const data = join(fixture, "selected-data");
	const selected = await run(
		"select",
		data,
		[
			{ canceled: false, filePaths: [homedir()] },
			{ canceled: false, filePaths: [workspace] },
		],
		true,
	);
	assert.equal(selected.filter((c) => c.kind === "picker").length, 2);
	assert.equal(selected.filter((c) => c.kind === "error").length, 1);
	assert.equal(
		JSON.parse(readFileSync(join(data, "startup.json"))).workspace,
		workspace.replace(/^\/var\//, "/private/var/"),
	);
	checks.push({
		id: "T03",
		status: "PASS",
		check:
			"home directory rejected through error dialog; picker repeats, valid Chinese path saved and real window loads",
	});
	const restarted = await run("restart", data, [], true);
	assert.deepEqual(restarted, []);
	checks.push({
		id: "T03",
		status: "PASS",
		check: "restart without cwd override restores recent workspace and never invokes picker",
	});
} catch (error) {
	checks.push({ status: "FAIL", error: error.stack });
	process.exitCode = 1;
} finally {
	const result = {
		fixture,
		executable,
		instrumentation:
			"compiled production main loaded through a test harness; only dialog return values supplied, native chooser interaction not tested",
		checks,
	};
	writeFileSync("docs/desktop-delivery/evidence/first-run.json", JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
