// Use the SDK pipeline so recording retains nested calls, hooks and cancellation.
import { resolvePlaywrightRuntime } from "./playwright-runtime.mjs";
import { validateRecordingSeed } from "./recording-preflight.mjs";
import { createMcpExtension } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { preparePrivateRecordingSession } from "./private-recording-session.mjs";
import { createPrivateRecordingConnection } from "./private-recording-connection.mjs";
import { createPrivateRecordingActions } from "./private-recording-actions.mjs";

export default async function (pi) {
	// Reuse the locked SDK's transport factory for every unrelated registered server.
	const sdkEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
	const { createDefaultTransport } = await import(new URL("./extensions/mcp/runtime.js", sdkEntry).href);
	let binding;
	const actions = createPrivateRecordingActions();
	const registerAnonymous = (ctx) => {
		const runtime = resolvePlaywrightRuntime(ctx.cwd);
		pi.registerMcpServer("ui-playwright-test", {
			command: process.execPath,
			args: [runtime.cli, "run-test-mcp-server", "--headless", "-c", runtime.config],
			cwd: ctx.cwd,
			exposure: "direct",
			timeout: 45,
		});
	};
	pi.on("session_start", async (_event, ctx) => {
		await binding?.prepared?.snapshot.revoke();
		binding = undefined;
		actions.clear();
		registerAnonymous(ctx);
	});
	pi.on("tool_call", async (event, ctx) => {
		if (
			event.toolName === "ui_discover_record" &&
			event.input?.request?.operation === "start" &&
			event.input.request.configuration?.private_recording &&
			event.input.request.configuration.backend !== "mcp__ui_playwright_test__"
		)
			return { block: true, reason: "私密录制须使用受管的 ui-playwright-test 连接" };
		const authorization = actions.onCall(event, binding);
		if (authorization?.block) return authorization;
		if (authorization?.privateCall) return;
		if (event.toolName !== "mcp__ui_playwright_test__generator_setup_page") return;
		try {
			await validateRecordingSeed(ctx.cwd, event.input);
		} catch (error) {
			return { block: true, reason: error.message };
		}
	});
	pi.on("tool_result", async (event, ctx) => {
		actions.onResult(event);
		if (event.toolName !== "ui_discover_record" || event.isError) return;
		const request = event.input?.request;
		if (!["start", "finish"].includes(request?.operation)) return;
		const text = event.content.find((block) => block.type === "text")?.text;
		if (!text) return;
		let result;
		try {
			result = JSON.parse(text);
		} catch {
			return;
		}
		if (result.status !== "completed") return;
		if (request.operation === "start" && request.configuration?.private_recording) {
			const current = { sessionRef: result.artifact_refs[0], prepared: undefined };
			binding = current;
			try {
				current.prepared = await preparePrivateRecordingSession({
					workspace: ctx.cwd,
					authority: join(ctx.sessionManager.getSessionDir(), "ui-recording-authority"),
					sessionRef: current.sessionRef,
				});
				if (binding !== current) throw new Error("stale session");
				const config = pi.getMcpServers().find((server) => server.name === "ui-playwright-test").config;
				pi.registerMcpServer("ui-playwright-test", {
					...config,
					description: `Private recording bootstrap ${current.sessionRef.sha256}`,
				});
				result.output = {
					private_preparation: current.prepared.receipt,
					recording: current.prepared.capture ? "private-capture-prepared" : "blocked-capture-not-connected",
				};
			} catch {
				await current.prepared?.snapshot.revoke();
				if (binding === current) pi.unregisterMcpServer("ui-playwright-test");
				result.status = "blocked";
				result.errors = [
					{
						category: "precondition",
						message: "私密会话准备失败；会话已保留，请保存 partial 记录",
						recoverable: false,
					},
				];
			}
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
		}
		if (
			request.operation === "finish" &&
			binding?.sessionRef.path === request.session_ref.path &&
			binding.sessionRef.sha256 === request.session_ref.sha256
		) {
			await binding.prepared?.snapshot.revoke();
			binding = undefined;
			actions.clear();
			registerAnonymous(ctx);
		}
	});
	pi.on("session_shutdown", async () => {
		const current = binding;
		binding = undefined;
		actions.clear();
		await current?.prepared?.snapshot.revoke();
	});
	return createMcpExtension({
		loadConfig: () => ({ servers: [], errors: [] }),
		createTransport: (entry, cwd, authProvider) => {
			if (entry.name !== "ui-playwright-test") return createDefaultTransport(entry, cwd, authProvider);
			if (binding) {
				if (
					!binding.prepared ||
					entry.config.description !== `Private recording bootstrap ${binding.sessionRef.sha256}`
				)
					throw new Error("私密会话连接准备未完成；禁止退回匿名连接");
				const current = binding;
				return createPrivateRecordingConnection(current.prepared, {
					currentCall: () => (binding === current ? actions.current(current) : undefined),
				});
			}
			if (entry.config.description?.startsWith("Private recording bootstrap ")) throw new Error("私密会话连接已失效");
			return createDefaultTransport(entry, cwd, authProvider);
		},
	})({ ...pi, registerTool: (definition) => pi.registerTool(actions.wrap(definition, () => binding)) });
}
