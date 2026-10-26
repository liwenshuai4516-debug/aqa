// Product connection bootstrap only. Browser calls stay blocked until capture/writer publication is connected.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StdioTransport } from "@earendil-works/pi-mcp";
import { resolvePlaywrightRuntime } from "./playwright-runtime.mjs";
import { guardPrivateRecordingTransport } from "./private-recording-transport.mjs";

/** @param {Awaited<ReturnType<typeof import('./private-recording-session.mjs').preparePrivateRecordingSession>>} prepared */
export function createPrivateRecordingConnection(prepared) {
	const { snapshot, privacy } = prepared;
	const runtime = resolvePlaywrightRuntime(snapshot.workspace);
	if (runtime.fallback) throw new Error("私密录制连接缺少已冻结的 Playwright 配置");
	const wire = new StdioTransport({
		command: process.execPath,
		args: [runtime.cli, "run-test-mcp-server", "--headless", "-c", runtime.config],
		cwd: snapshot.workspace,
		env: snapshot.childEnv,
		stderr: "pipe",
	});
	let sequence = 0;
	const guarded = guardPrivateRecordingTransport({
		transport: wire,
		snapshot,
		receive: async (message) => {
			await snapshot.assertCurrent();
			await writeFile(join(privacy.directory, `handshake-${++sequence}.json`), JSON.stringify(message), {
				mode: 0o600,
				flag: "wx",
			});
			const output = await privacy.process(message);
			await snapshot.assertCurrent();
			return output;
		},
	});
	return {
		...guarded,
		send: async (message, options) => {
			if (
				!("method" in message) ||
				!["initialize", "notifications/initialized", "notifications/cancelled", "ping", "tools/list"].includes(
					message.method,
				)
			) {
				await snapshot.revoke();
				throw new Error("私密录制捕获与发布尚未接通，浏览器动作已阻塞；请保存 partial 记录");
			}
			return guarded.send(message, options);
		},
	};
}
