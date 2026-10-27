// Keep raw protocol/files private; only verified, filtered responses cross into the SDK.
import { writeFile } from "node:fs/promises";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { StdioTransport } from "@earendil-works/pi-mcp";
import { readPrivateStorageEvents } from "./private-recording-storage-events.mjs";
import { resolvePlaywrightRuntime } from "./playwright-runtime.mjs";
import { guardPrivateRecordingTransport } from "./private-recording-transport.mjs";
import { validatePrivateRecordingSeed } from "./private-recording-preflight.mjs";

const blocked = () => new Error("私密录制采集或发布未通过核验；保留私有证据和 partial，不自动重放");
function ownedPath(root, relative, { file = false, privateMode = false, createParents = false } = {}) {
	if (
		realpathSync(root) !== root ||
		lstatSync(root).isSymbolicLink() ||
		!lstatSync(root).isDirectory() ||
		(privateMode && lstatSync(root).mode & 0o077) ||
		!relative ||
		isAbsolute(relative) ||
		relative.includes("\\") ||
		relative.split("/").some((p) => !p || [".", "..", ".pi", ".git", "node_modules"].includes(p))
	)
		throw blocked();
	const parts = relative.split("/");
	let path = root,
		missing = false;
	for (let i = 0; i < parts.length; i++) {
		path = join(path, parts[i]);
		if (!existsSync(path)) {
			// lstat sees dangling links too; they must not be treated as an absent target.
			try {
				lstatSync(path);
				throw blocked();
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			if (createParents && i < parts.length - 1) mkdirSync(path, { mode: 0o700 });
			else {
				missing = true;
				if (file) throw blocked();
				continue;
			}
		}
		if (missing) throw blocked();
		const info = lstatSync(path);
		if (
			info.isSymbolicLink() ||
			(i < parts.length - 1 ? !info.isDirectory() : file ? !info.isFile() : true) ||
			(privateMode && info.mode & 0o077)
		)
			throw blocked();
	}
	return path;
}
function publicTarget(root, path, createParents = false) {
	return ownedPath(root, path, { createParents });
}
function hideMedia(value) {
	if (!value || typeof value !== "object") return value;
	if (["image", "audio", "resource", "resource_link"].includes(value.type))
		return { type: "text", text: "[Private media/resource withheld; reduced evidence only]" };
	return Array.isArray(value)
		? value.map(hideMedia)
		: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hideMedia(item)]));
}

/** @param {Awaited<ReturnType<typeof import('./private-recording-session.mjs').preparePrivateRecordingSession>>} prepared
 * @param {{currentCall?:()=>any}} options */
export function createPrivateRecordingConnection(prepared, { currentCall = () => undefined } = {}) {
	const { snapshot, privacy, capture, captureContext } = prepared;
	const runtime = resolvePlaywrightRuntime(snapshot.workspace);
	if (runtime.fallback) throw new Error("私密录制连接缺少已冻结的 Playwright 配置");
	const wire = new StdioTransport({
		command: process.execPath,
		args: [runtime.cli, "run-test-mcp-server", "--headless", "-c", runtime.config],
		cwd: snapshot.workspace,
		env: snapshot.childEnv,
		stderr: "pipe",
	});
	let sequence = 0,
		ordinal = 0,
		actions = 0,
		calls = 0,
		cleanupRequested = false;
	const requests = new Map(),
		roots = new Set();
	const guarded = guardPrivateRecordingTransport({
		transport: wire,
		snapshot,
		receive: async (message, publish) => {
			const request = "id" in message && !("method" in message) ? requests.get(message.id) : undefined;
			if (request) requests.delete(message.id);
			const close = request?.tool === "mcp__ui_playwright_test__browser_close";
			if (!close) await snapshot.assertCurrent();
			const raw = ownedPath(privacy.directory, `handshake-${++sequence}.json`);
			await writeFile(raw, JSON.stringify(message), { mode: 0o600, flag: "wx" });
			if ("method" in message) {
				if (message.method === "roots/list" && "id" in message) {
					roots.add(message.id);
					return { jsonrpc: "2.0", id: message.id, method: "roots/list", params: {} };
				}
				if (capture && "id" in message) throw blocked();
				if (capture)
					return {
						jsonrpc: "2.0",
						method: "notifications/message",
						params: { level: "info", data: "Private recording notification withheld" },
					};
			}
			if (close)
				return {
					jsonrpc: "2.0",
					id: message.id,
					result: {
						isError: !!message.error || !message.result || !!message.result.isError,
						content: [
							{
								type: "text",
								text:
									message.result && !message.error && !message.result.isError
										? "Owned browser cleanup confirmed"
										: "Owned browser cleanup not confirmed; inspect private evidence",
							},
						],
					},
				};
			if (request) {
				if (!message.result || message.result.isError || message.error) throw blocked();
				if (request.ordinal) {
					const base = `output/recording/capture-${request.ordinal}/`;
					const marker = JSON.parse(
						readFileSync(
							ownedPath(privacy.directory, base + "complete.json", { file: true, privateMode: true }),
							"utf8",
						),
					);
					if (marker.version !== 1 || marker.ordinal !== request.ordinal || Object.keys(marker).length !== 2)
						throw blocked();
					const events = readPrivateStorageEvents(
						ownedPath(privacy.directory, "output/recording/storage-events.ndjson", { file: true, privateMode: true }),
						new URL(captureContext.environment.base_url).origin,
					);
					privacy.observeStorageState(events.stateForFilter);
					privacy.observeStorageState(
						JSON.parse(
							readFileSync(
								ownedPath(privacy.directory, base + "storage.json", { file: true, privateMode: true }),
								"utf8",
							),
						),
					);
					ownedPath(privacy.directory, base + "trace.zip", { file: true, privateMode: true });
					await privacy.process(message);
					return {
						jsonrpc: "2.0",
						id: message.id,
						result: {
							content: [
								{ type: "text", text: `Owned private capture ${request.ordinal} verified; raw evidence withheld` },
							],
						},
					};
				}
				const collected = await request.capture(++ordinal);
				if (collected.isError) throw blocked();
			}
			const output = hideMedia(await privacy.process(message));
			if (request?.tool === "mcp__ui_playwright_test__generator_write_test") {
				const code = request.input.code;
				if (privacy.text(code) !== code) throw blocked();
				// No await between the final lifecycle check and the exclusive, byte-identical copy.
				await publish(() => {
					const bytes = readFileSync(ownedPath(snapshot.workspace, capture.outputFile, { file: true }));
					if (!bytes.equals(Buffer.from(code)) || privacy.text(bytes.toString()) !== code) throw blocked();
					writeFileSync(publicTarget(captureContext.workspace, capture.outputFile, true), bytes, {
						mode: 0o600,
						flag: "wx",
					});
				});
			}
			return output;
		},
	});
	return {
		...guarded,
		send: async (message, options) => {
			try {
				if (!("method" in message) && "id" in message && roots.delete(message.id))
					return guarded.send(
						{
							jsonrpc: "2.0",
							id: message.id,
							result: { roots: [{ uri: pathToFileURL(snapshot.workspace).href, name: "private-recording" }] },
						},
						options,
					);
				if (
					"method" in message &&
					["initialize", "notifications/initialized", "notifications/cancelled", "ping", "tools/list"].includes(
						message.method,
					)
				)
					return guarded.send(message, options);
				const call = currentCall();
				if (
					!capture ||
					!captureContext ||
					message.method !== "tools/call" ||
					!call ||
					call.dispatched ||
					call.tool !== "mcp__ui_playwright_test__" + message.params?.name ||
					!isDeepStrictEqual(call.input, message.params.arguments)
				)
					throw new Error("私密录制捕获与发布尚未接通或调用未授权，浏览器动作已阻塞；请保存 partial 记录");
				const close = message.params.name === "browser_close";
				if (cleanupRequested || calls + 1 > capture.maxToolCalls) throw blocked();
				if (!close) {
					await snapshot.assertCurrent();
					if (call.ordinal) {
						if (call.ordinal !== ordinal || call.ordinal > capture.maxSteps) throw blocked();
					} else {
						if (actions >= capture.maxSteps || calls + 3 > capture.maxToolCalls) throw blocked();
						if (message.params.name === "generator_setup_page")
							await validatePrivateRecordingSeed({ capture, captureContext, snapshot });
						if (message.params.name === "generator_write_test") {
							if (
								call.input.fileName !== capture.outputFile ||
								typeof call.input.code !== "string" ||
								privacy.text(call.input.code) !== call.input.code
							)
								throw blocked();
							publicTarget(captureContext.workspace, capture.outputFile);
							publicTarget(snapshot.workspace, capture.outputFile);
						}
						actions++;
					}
				} else cleanupRequested = true;
				call.dispatched = true;
				calls++;
				requests.set(message.id, call);
				return await guarded.send(message, options);
			} catch (error) {
				await snapshot.revoke();
				throw error;
			}
		},
	};
}
