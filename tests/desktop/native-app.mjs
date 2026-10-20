// Attach automation only after the real app has loaded, without Playwright's
// Electron loader, ready-event interception or Chromium feature overrides.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { resolve } from "node:path";
import WebSocket from "ws";

export async function launchNativeApp({ executablePath, packaged, env }) {
	const reservation = createServer().listen(0, "127.0.0.1");
	await once(reservation, "listening");
	const port = reservation.address().port;
	await new Promise((r) => reservation.close(r));
	const child = spawn(
		executablePath,
		["--inspect=0", `--remote-debugging-port=${port}`, ...(packaged ? [] : [resolve("dist/desktop/main.js")])],
		{ env, stdio: ["ignore", "pipe", "pipe"] },
	);
	let logs = "";
	child.stderr.on("data", (d) => {
		logs += d;
	});
	child.stdout.on("data", (d) => {
		logs += d;
	});
	const deadline = Date.now() + 60000;
	let browser, inspector;
	try {
		while (!logs.includes("[desktop] window loaded")) {
			if (child.exitCode !== null || Date.now() > deadline)
				throw new Error("Native app failed to load before automation attached");
			await new Promise((r) => setTimeout(r, 100));
		}
		const endpoint = logs.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/)?.[1];
		if (!endpoint) throw new Error("Main-process inspector endpoint missing");
		inspector = new WebSocket(endpoint);
		await once(inspector, "open");
		let sequence = 0;
		const pending = new Map();
		inspector.on("message", (d) => {
			const message = JSON.parse(d);
			const entry = pending.get(message.id);
			if (!entry) return;
			pending.delete(message.id);
			clearTimeout(entry.timer);
			if (message.error || message.result?.exceptionDetails)
				entry.reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
			else entry.resolve(message.result.result?.value);
		});
		const evaluate = (fn, arg) =>
			new Promise((resolveValue, reject) => {
				const id = ++sequence;
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error("Native inspector evaluation timeout"));
				}, 10000);
				pending.set(id, { resolve: resolveValue, reject, timer });
				const expression = `(${fn.toString()})(process.getBuiltinModule('module').createRequire(process.cwd() + '/native-test.cjs')('electron'), ${JSON.stringify(arg) ?? "undefined"})`;
				inspector.send(
					JSON.stringify({
						id,
						method: "Runtime.evaluate",
						params: { expression, awaitPromise: true, returnByValue: true },
					}),
				);
			});
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		const context = browser.contexts()[0];
		return {
			evaluate,
			process: () => child,
			context: () => context,
			firstWindow: async () => context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 30000 })),
			waitForEvent: (event) => {
				if (event !== "window") throw new Error("Unsupported native test event");
				return context.waitForEvent("page", { timeout: 30000 });
			},
			close: async () => {
				if (child.exitCode === null) {
					const exited = once(child, "exit");
					void evaluate(({ app }) => app.quit()).catch(() => {});
					// Node inspector otherwise waits for the debugger to detach on exit.
					inspector.close();
					let timer;
					try {
						await Promise.race([
							exited,
							new Promise((_, reject) => {
								timer = setTimeout(() => reject(new Error("Native app quit timeout")), 15000);
							}),
						]);
					} finally {
						clearTimeout(timer);
					}
				}
				await browser.close().catch(() => {});
			},
		};
	} catch (error) {
		inspector?.close();
		await browser?.close().catch(() => {});
		if (child.exitCode === null) child.kill("SIGTERM");
		throw error;
	}
}
