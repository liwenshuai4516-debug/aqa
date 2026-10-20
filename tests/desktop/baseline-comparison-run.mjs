// Same-machine original-host/current-package comparison. Original sources are read only.
import { _electron } from "playwright-core";
import { transform } from "esbuild";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import WebSocket from "ws";

const source = "/Users/liyingjun/Desktop/SW-QA/pi-web-ui-main/desktop";
const baseline = resolve("dist/desktop-baseline-comparison");
await fs.mkdir(baseline, { recursive: true });
const sourceHashes = {};
for (const name of await fs.readdir(source)) {
	if (!/\.(ts|cts)$/.test(name) || name.endsWith(".d.ts")) continue;
	const text = await fs.readFile(join(source, name), "utf8");
	sourceHashes[name] = createHash("sha256").update(text).digest("hex");
	const { code } = await transform(text, {
		loader: "ts",
		format: name.endsWith(".cts") ? "cjs" : "esm",
		target: "node24",
	});
	await fs.writeFile(join(baseline, name.replace(/\.cts$/, ".cjs").replace(/\.ts$/, ".js")), code);
}
const fixture = await fs.mkdtemp(join(tmpdir(), "pi-host-comparison-"));
await fs.mkdir(join(fixture, "中文 project"));
const workspace = await fs.realpath(join(fixture, "中文 project"));
await fs.writeFile(join(workspace, "sample.txt"), "中文 UTF-8 baseline fixture\n");
const result = {
	fixture,
	source,
	sourceHashes,
	samples: [],
	caveats: [
		"Fresh application data per sample; OS filesystem cache is not flushed, so these are fresh-profile startup samples, not guaranteed cold-disk measurements.",
		"Both use the same Electron 44.4.2 and Playwright launch instrumentation. Original host TS is transformed without bundling; both serve the same frozen business build, except approved D02/D03 which are inactive in this fixture.",
		"Memory sums RSS of the owned process tree after three idle seconds; shared memory can be counted more than once.",
	],
};
async function freePort() {
	const server = createServer().listen(0, "127.0.0.1");
	await once(server, "listening");
	const value = server.address().port;
	await new Promise((r) => server.close(r));
	return value;
}
async function wait(check, timeout = 10000) {
	const deadline = Date.now() + timeout;
	while (!(await check())) {
		assert(Date.now() < deadline, "comparison condition timeout");
		await new Promise((r) => setTimeout(r, 50));
	}
}
function memory(pid) {
	const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8" })
		.trim()
		.split("\n")
		.map((row) => row.trim().split(/\s+/).map(Number));
	const owned = new Set([pid]);
	for (let changed = true; changed;) {
		changed = false;
		for (const [child, parent] of rows)
			if (owned.has(parent) && !owned.has(child)) {
				owned.add(child);
				changed = true;
			}
	}
	return {
		rssMiB: rows.filter(([child]) => owned.has(child)).reduce((sum, row) => sum + row[2], 0) / 1024,
		processCount: owned.size,
	};
}
for (let iteration = 1; iteration <= 3; iteration++)
	for (const mode of iteration % 2 ? ["baseline", "current"] : ["current", "baseline"]) {
		const profile = join(fixture, `${mode}-${iteration}`);
		await fs.mkdir(join(profile, "agent"), { recursive: true });
		await fs.mkdir(join(profile, "data"));
		const sessions = join(profile, "agent/sessions");
		await fs.mkdir(sessions);
		const transcript = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "performance-sample",
				timestamp: "2026-10-01T00:00:00.000Z",
				cwd: workspace,
			}),
		];
		for (let i = 0; i < 200; i++) {
			const role = i % 2 ? "assistant" : "user";
			transcript.push(
				JSON.stringify({
					type: "message",
					id: `m${i}`,
					parentId: i ? `m${i - 1}` : null,
					timestamp: "2026-10-01T00:00:01.000Z",
					message: {
						role,
						content: [
							{
								type: "text",
								text:
									i === 0
										? "PERF_SAMPLE 相同长对话夹具"
										: `${role} ${i}\n\n` + "中文长文本与 Markdown **基线**。\n".repeat(role === "assistant" ? 30 : 1),
							},
						],
						timestamp: 1790812801000,
						...(role === "assistant"
							? {
									api: "openai-completions",
									provider: "fixture",
									model: "fixture",
									stopReason: "stop",
									usage: {
										input: 1,
										output: 1,
										cacheRead: 0,
										cacheWrite: 0,
										totalTokens: 2,
										cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
									},
								}
							: {}),
					},
				}),
			);
		}
		await fs.writeFile(
			join(sessions, "2026-10-01T00-00-00-000Z_performance-sample.jsonl"),
			transcript.join("\n") + "\n",
		);
		const port = await freePort();
		const env = {
			...process.env,
			PI_WEB_CWD: workspace,
			PI_WEB_PORT: String(port),
			PI_WEB_PLUGIN_CATALOG_URL: "off",
			PI_WEB_SDK: "bundled",
			PI_CODING_AGENT_DIR: join(profile, "agent"),
			PI_CODING_AGENT_SESSION_DIR: sessions,
			PI_WEB_DATA_DIR: join(profile, "data"),
			PI_DESKTOP_USER_DATA: profile,
		};
		delete env.ELECTRON_RUN_AS_NODE;
		delete env.PI_WEB_DESKTOP_URL;
		const harness = join(baseline, "harness.mjs");
		await fs.writeFile(
			harness,
			`import {app} from 'electron'; app.setPath('userData', ${JSON.stringify(profile)}); await import('./main.js');`,
		);
		const started = performance.now();
		let app, socket;
		try {
			app = await _electron.launch(
				mode === "baseline"
					? { args: [harness], env, timeout: 60000 }
					: {
							executablePath: resolve("release/mac-arm64/Pi Agent Desktop.app/Contents/MacOS/Pi Agent Desktop"),
							args: ["-r", resolve("node_modules/playwright-core/lib/server/electron/loader.js")],
							env,
							timeout: 60000,
						},
			);
			const page = await app.firstWindow({ timeout: 45000 });
			await page.waitForSelector(".app");
			await page.waitForSelector(".boot-wait", { state: "hidden" });
			const startupMs = performance.now() - started;
			await page.waitForLoadState("networkidle");
			await page.waitForTimeout(3000);
			const idle = memory(app.process().pid);
			const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
			await page.locator(".session-item", { hasText: "PERF_SAMPLE" }).click();
			await page.locator(".messages").getByText("assistant 199", { exact: false }).waitFor({ timeout: 15000 });
			await page.waitForTimeout(1000);
			const scroll = await page.evaluate(async () => {
				const intervals = [];
				let previous = performance.now();
				for (let step = 0; step < 60; step++) {
					// Session activation can replace the initial message container.
					const element = document.querySelector(".messages");
					if (!element || element.clientHeight === 0) throw new Error("Active message viewport missing");
					element.scrollTop =
						(element.scrollHeight - element.clientHeight) * (step < 30 ? 1 - step / 29 : (step - 30) / 29);
					await new Promise(requestAnimationFrame);
					const now = performance.now();
					intervals.push(now - previous);
					previous = now;
				}
				intervals.sort((a, b) => a - b);
				const element = document.querySelector(".messages");
				return {
					frames: intervals.length,
					medianFrameMs: intervals[30],
					p95FrameMs: intervals[57],
					scrollHeight: element.scrollHeight,
					viewportHeight: element.clientHeight,
				};
			});
			assert(
				scroll.scrollHeight > scroll.viewportHeight && scroll.viewportHeight > 0,
				"Long transcript is actually scrollable",
			);
			if (iteration === 1) {
				// Mask only the caret, live host metrics and timestamps.
				await page.addStyleTag({ content: "* { caret-color: transparent !important; }" });
				await page.locator(".inputbox textarea").fill("相同夹具 · UTF-8 输入草稿");
				await page.locator(".inputbox textarea").blur();
				await page.screenshot({
					path: `docs/desktop-delivery/evidence/compare-${mode}.png`,
					animations: "disabled",
					mask: [page.locator(".status-host-metrics,.project-time,.session-time")],
				});
				await fs.writeFile(
					`docs/desktop-delivery/evidence/compare-${mode}-layout.json`,
					JSON.stringify(
						await page.locator(".topbar,.inputbar,.inputbox,.left-panel,.right-panel").evaluateAll((elements) =>
							elements.map((e) => ({
								class: e.className,
								rect: e.getBoundingClientRect().toJSON(),
								font: getComputedStyle(e).font,
								color: getComputedStyle(e).color,
								background: getComputedStyle(e).backgroundColor,
							})),
						),
						null,
						2,
					),
				);
			}
			const origin = new URL(page.url()).origin;
			const cookies = await app.evaluate(
				async ({ BrowserWindow }, url) => BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({ url }),
				origin,
			);
			const token = cookies.find((cookie) => cookie.name === "pi_web_token")?.value;
			socket = new WebSocket(
				origin.replace("http:", "ws:") + "/ws",
				token ? { headers: { Authorization: `Bearer ${token}` } } : {},
			);
			let output = "";
			let ready = false;
			socket.on("message", (d) => {
				const message = JSON.parse(d);
				if (message.type === "ready") ready = true;
				if (message.type === "terminal_output" && message.terminalId === "comparison") output += message.data;
			});
			await once(socket, "open");
			const send = (message) => socket.send(JSON.stringify(message));
			send({ type: "hello", clientId: "comparison" });
			await wait(() => ready);
			send({ type: "terminal_create", terminalId: "comparison", cwd: workspace, cols: 80, rows: 24 });
			await wait(() => output.length > 0);
			output = "";
			const terminalStarted = performance.now();
			send({ type: "terminal_input", terminalId: "comparison", data: "printf 'COMPARISON_%s\\n' 'PTY_OK'\r" });
			await wait(() => output.includes("COMPARISON_PTY_OK"));
			const terminalResponseMs = performance.now() - terminalStarted;
			send({ type: "terminal_close", terminalId: "comparison" });
			result.samples.push({ mode, iteration, startupMs, terminalResponseMs, idle, size, scroll });
			console.log(JSON.stringify(result.samples.at(-1)));
		} catch (error) {
			result.error = error.stack;
			throw error;
		} finally {
			socket?.terminate();
			await app?.close().catch(() => {});
			await fs.writeFile("docs/desktop-delivery/evidence/baseline-comparison.json", JSON.stringify(result, null, 2));
		}
	}
