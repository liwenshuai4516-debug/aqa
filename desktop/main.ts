/**
 * pi-web-ui desktop shell (Electron, sidecar 模式).
 *
 * 设计：不碰 server/ 现有逻辑。主进程用 ELECTRON_RUN_AS_NODE 把
 * Electron 二进制当纯 Node 用，起一个 `dist/server/index.js` 子进程
 * （127.0.0.1 + 随机空闲口），等 /api/health 就绪后 BrowserWindow
 * 直接 load 该地址。前端继续走 appUrl("/ws") + location.host，
 * protocol.ts 零改动——和浏览器访问远端 server 是同一条路。
 *
 * 运行前先 `npm run build`（需要 dist/server + web/dist）。
 * 开发联调：PI_WEB_DESKTOP_URL=http://localhost:5173 可让窗口指到 vite
 * （仅开发模式生效，打包版忽略该 override —— 见 startServerSidecar）。
 */
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type IpcMainEvent } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { stopOwnedSidecar } from "./process-lifecycle.js";
import { createLogStream, installDesktopLogging } from "./logging.js";
import { DESKTOP_PREFERENCE_KEYS, sanitizePreferences } from "./preferences.js";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAllowedExternalUrl, prepareExternalUrl } from "./external-url.js";
import { validateWorkspace } from "./workspace.js";
import { setupPortableMode } from "./portable.js";
import {
	buildDesktopLoadUrl,
	DEFAULT_DESKTOP_PORT,
	resolveHealthTimeoutMs,
	verifySidecarIdentity,
	waitForHealth,
} from "./startup.js";

// 便携模式初始化：在 app ready 之前完成 Electron userData 重定向与便携环境变量装载
if (process.env.PI_DESKTOP_USER_DATA) app.setPath("userData", process.env.PI_DESKTOP_USER_DATA);
else app.setPath("userData", join(app.getPath("appData"), "Pi Agent Desktop"));
setupPortableMode(app);

async function selectWorkspace(): Promise<string | null> {
	if (process.env.PI_WEB_CWD) return validateWorkspace(process.env.PI_WEB_CWD);
	const preferencesPath = join(app.getPath("userData"), "startup.json");
	try {
		const saved = JSON.parse(readFileSync(preferencesPath, "utf8"));
		if (typeof saved.workspace === "string") return validateWorkspace(saved.workspace);
	} catch {
		// A deleted or inaccessible recent workspace opens the picker again.
	}
	for (;;) {
		const result = await dialog.showOpenDialog({
			title: "选择项目工作区 / Select project workspace",
			properties: ["openDirectory"],
		});
		if (result.canceled || !result.filePaths[0]) return null;
		try {
			const workspace = validateWorkspace(result.filePaths[0]);
			mkdirSync(app.getPath("userData"), { recursive: true });
			writeFileSync(preferencesPath, JSON.stringify({ workspace }), { mode: 0o600 });
			return workspace;
		} catch (error) {
			dialog.showErrorBox("工作区不可用 / Invalid workspace", (error as Error).message);
		}
	}
}
let workspace = "";
const launchSecrets: string[] = [];
const logPath = installDesktopLogging(join(app.getPath("userData"), "logs"), launchSecrets);
let accessToken = "";
let serviceUrl = "";
let shuttingDown = false;
let windowPromise: Promise<void> | null = null;
let recoveryPromise: Promise<void> | null = null;
const preferencesPath = join(app.getPath("userData"), "ui-preferences.json");
let preferences: Record<string, string> = {};
try {
	preferences = sanitizePreferences(JSON.parse(readFileSync(preferencesPath, "utf8")));
} catch {
	/* first launch */
}
function trustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
	if (
		!mainWin ||
		event.sender !== mainWin.webContents ||
		event.senderFrame !== mainWin.webContents.mainFrame ||
		!serviceUrl
	)
		return false;
	try {
		return new URL(event.senderFrame.url).origin === new URL(serviceUrl).origin;
	} catch {
		return false;
	}
}
async function captureWindowPreferences(): Promise<void> {
	const window = mainWin;
	if (!window || window.isDestroyed() || !serviceUrl) return;
	try {
		const currentUrl = window.webContents.getURL();
		if (!currentUrl || new URL(currentUrl).origin !== new URL(serviceUrl).origin) return;
		const keys = JSON.stringify(DESKTOP_PREFERENCE_KEYS);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const values = await Promise.race([
				window.webContents.executeJavaScript(
					`Object.fromEntries(${keys}.flatMap(key => { const value = localStorage.getItem(key); return value === null ? [] : [[key, value]]; }))`,
				),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => reject(new Error("preference capture timeout")), 1000);
				}),
			]);
			savePreferences(values);
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		console.warn("[desktop] 界面偏好保存失败", error);
	}
}

function savePreferences(value: unknown): void {
	const next = sanitizePreferences(value);
	if (JSON.stringify(next) === JSON.stringify(preferences)) return;
	writeFileSync(`${preferencesPath}.tmp`, JSON.stringify(next), { mode: 0o600 });
	renameSync(`${preferencesPath}.tmp`, preferencesPath);
	preferences = next;
}

const here = dirname(fileURLToPath(import.meta.url));
/** 开发：dist/desktop → dist/server；打包后：asar 关闭，app 目录即根布局（dist/server + web/dist + themes）。 */
function resolveServerEntry(): string {
	if (app.isPackaged) {
		return join(app.getAppPath(), "dist", "server", "index.js");
	}
	return join(here, "..", "server", "index.js");
}

function resolveWebDir(): string {
	const root = app.isPackaged ? app.getAppPath() : join(here, "..", "..");
	const index = join(root, "web", "dist", "index.html");
	if (!existsSync(resolveServerEntry()) || !existsSync(index))
		throw new Error("安装资源缺失：找不到业务服务或界面文件，请重新安装。");
	return index;
}

/** 取一个系统分配的空闲 TCP 口（桌面模式不用固定 8787，避免和网页版冲突）。 */
function pickFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const s = createServer();
		s.once("error", reject);
		s.listen(0, "127.0.0.1", () => {
			const addr = s.address();
			s.close(() => {
				if (addr && typeof addr === "object") resolve(addr.port);
				else reject(new Error("pickFreePort: bad address"));
			});
		});
	});
}

/** 该端口现在能不能绑（能绑 = 空闲）。 */
function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const s = createServer();
		s.once("error", () => resolve(false));
		s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
	});
}

/**
 * 端口解析：
 * 1. 若显式指定 `PI_WEB_PORT`，优先使用该端口（若被占用则回落随机口）；
 * 2. 默认优先尝试固定端口 `DEFAULT_DESKTOP_PORT`（8790），这样窗口 Origin 保持恒定，Chromium 的 localStorage
 *    （主题选择、面板宽度、折叠状态等）在重启与多会话间能稳定持久化；
 * 3. 若该端口已被占用，安全退回系统分配的随机空闲口。
 */
async function resolvePort(): Promise<number> {
	const want = Number(process.env.PI_WEB_PORT ?? 0);
	if (want > 0) {
		if (await isPortFree(want)) return want;
		console.warn(`[desktop] PI_WEB_PORT=${want} 已被占用，改用随机空闲口（不影响在跑的那个 server）`);
		return pickFreePort();
	}
	if (await isPortFree(DEFAULT_DESKTOP_PORT)) {
		return DEFAULT_DESKTOP_PORT;
	}
	console.log(`[desktop] 默认端口 ${DEFAULT_DESKTOP_PORT} 已被占用，改用随机空闲口`);
	return pickFreePort();
}

let serverProc: ChildProcess | null = null;
let mainWin: BrowserWindow | null = null;
let serverHealthy = false;

/** 启动失败时清理子进程并以非零码退出（issue #584：避免退出码 0 掩盖启动失败）。 */
async function exitOnStartupFailure(code = 1): Promise<void> {
	shuttingDown = true;
	if (serverProc) await stopOwnedSidecar(serverProc);
	serverProc = null;
	app.exit(code);
}

async function showOrCreateWindow(): Promise<void> {
	if (shuttingDown || !serverHealthy || !serviceUrl) return;
	if (mainWin && !mainWin.isDestroyed()) {
		if (mainWin.isMinimized()) mainWin.restore();
		mainWin.show();
		mainWin.focus();
		return;
	}
	if (!windowPromise)
		windowPromise = createWindow(serviceUrl).finally(() => {
			windowPromise = null;
		});
	await windowPromise;
}

async function recoverSidecar(): Promise<void> {
	if (shuttingDown || recoveryPromise) return;
	recoveryPromise = (async () => {
		serverHealthy = false;
		const result = await dialog.showMessageBox({
			type: "error",
			title: "Pi Agent Desktop 服务已停止",
			message: "后台服务已停止，当前运行中的任务与终端已中断。",
			detail: `可重新连接已保存的会话；不会自动重放模型请求、工具或写操作。\n日志：${logPath}`,
			buttons: ["重新启动服务", "退出"],
			defaultId: 0,
			cancelId: 1,
		});
		if (result.response !== 0 || shuttingDown) {
			app.quit();
			return;
		}
		try {
			serviceUrl = await startServerSidecar();
			if (mainWin && !mainWin.isDestroyed())
				await loadWindowUrl(mainWin, buildDesktopLoadUrl(serviceUrl, { PI_WEB_TOKEN: accessToken }));
			else await showOrCreateWindow();
		} catch (error) {
			if (shuttingDown) return;
			dialog.showErrorBox("服务恢复失败", `${(error as Error).message}\n日志：${logPath}`);
			await exitOnStartupFailure(1);
		}
	})().finally(() => {
		recoveryPromise = null;
	});
	await recoveryPromise;
}

console.log("[desktop] main started, waiting for app ready…");

async function startServerSidecar(): Promise<string> {
	const override = process.env.PI_WEB_DESKTOP_URL;
	if (override) {
		// 仅开发模式允许 override（指向 vite(:5173) 联调，前提是另起 dev:server）。
		// 打包版一律忽略：这是唯一能让应用窗口指向任意 URL 的入口（appOrigin、
		// will-navigate 守卫都从返回值推导），打包后放行等于把窗口交给环境变量。
		if (!app.isPackaged) return override;
		console.warn("[desktop] 打包版忽略 PI_WEB_DESKTOP_URL（仅开发模式允许）");
	}
	const entry = resolveServerEntry();
	resolveWebDir();
	console.log(`[desktop] server entry: ${entry}`);
	const port = await resolvePort();
	accessToken = randomBytes(32).toString("hex");
	launchSecrets.push(accessToken);
	const dataDir = process.env.PI_WEB_DATA_DIR ?? join(app.getPath("userData"), "data");
	const cwd = workspace;
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(app.getPath("userData"), "agent");
	mkdirSync(agentDir, { recursive: true });
	// 确保工作区与数据目录在子进程启动前已实体创建，防止第一次打开找不到目录
	try {
		mkdirSync(dataDir, { recursive: true });
	} catch {
		/* ignore */
	}
	console.log(`[desktop] spawning server on 127.0.0.1:${port} (data: ${dataDir})`);
	// ELECTRON_RUN_AS_NODE=1：让 Electron 二进制退化成纯 Node 跑 server，
	// 无需额外捆一个 node，也不用改 server/index.ts。
	// Retain the original resolver hook, with PI_WEB_SDK=bundled fixed below.
	const sdkHook = join(dirname(entry), "resolve-global-sdk.js");
	serverProc = spawn(
		process.execPath,
		[
			...(existsSync(sdkHook) ? ["--import", pathToFileURL(sdkHook).href] : []),
			join(here, "sidecar.js"),
			"--host",
			"127.0.0.1",
			"--port",
			String(port),
		],
		{
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1",
				PI_WEB_HOST: "127.0.0.1",
				PI_WEB_PORT: String(port),
				PI_WEB_CWD: cwd,
				PI_WEB_DATA_DIR: dataDir,
				PI_CODING_AGENT_DIR: agentDir,
				PI_WEB_SDK: "bundled",
				PI_WEB_RESUME_INTERRUPTED: "0",
				PI_WEB_TOKEN: accessToken,
			},
			stdio: ["ignore", "pipe", "pipe", "ipc"],
			detached: process.platform !== "win32",
			windowsHide: true,
		},
	);
	serverProc.stdout?.pipe(createLogStream((line) => console.log(`[server] ${line}`)));
	serverProc.stderr?.pipe(createLogStream((line) => console.error(`[server] ${line}`)));
	let earlyExitError: Error | null = null;
	serverProc.on("error", (err) => {
		console.error(`[desktop] server spawn 失败：${err.message}`);
		earlyExitError = new Error(`server spawn 失败：${err.message}`);
		// waitForHealth observes this error and reports it through the startup dialog.
	});
	serverProc.on("exit", (code, signal) => {
		console.error(`[desktop] server 提前退出（code=${code} signal=${signal}），请看上方 server 日志`);
		earlyExitError = new Error(`server 提前退出（code=${code} signal=${signal}）`);
		if (serverHealthy && !shuttingDown) {
			serverProc = null;
			void recoverSidecar();
		}
	});
	const url = `http://127.0.0.1:${port}`;
	const timeoutMs = resolveHealthTimeoutMs(process.env);
	await waitForHealth(url, {
		timeoutMs,
		shouldAbort: () => earlyExitError ?? (shuttingDown ? new Error("应用正在退出。") : null),
	});
	await verifySidecarIdentity(url, accessToken);
	if (shuttingDown) throw new Error("应用正在退出。");
	if (earlyExitError || serverProc.exitCode !== null) throw earlyExitError ?? new Error("服务在就绪前退出。");
	serverHealthy = true;
	console.log(`[desktop] server 就绪：${url}`);
	return url;
}

async function loadWindowUrl(window: BrowserWindow, url: string): Promise<void> {
	const contents = window.webContents;
	await new Promise<void>((resolve, reject) => {
		const finish = (error?: Error) => {
			clearTimeout(timer);
			contents.removeListener("did-finish-load", loaded);
			contents.removeListener("did-fail-load", failed);
			if (error) reject(error);
			else resolve();
		};
		const loaded = () => {
			try {
				if (new URL(contents.getURL()).origin === new URL(url).origin) finish();
			} catch {
				/* Wait for the actual application navigation. */
			}
		};
		const failed = (_event: unknown, code: number, description: string, _url: string, isMainFrame: boolean) => {
			if (isMainFrame && code !== -3) finish(new Error(description));
		};
		const timer = setTimeout(() => finish(new Error("界面加载超时，请查看日志后重新启动应用。")), 30000);
		contents.on("did-finish-load", loaded);
		contents.on("did-fail-load", failed);
		void window.loadURL(url).catch((error: Error & { code?: string; errno?: number }) => {
			// The original frontend may reload on its first ready message. A superseded
			// navigation is successful only when the replacement actually finishes.
			if (error.code !== "ERR_ABORTED" && error.errno !== -3) finish(error);
		});
	});
}

async function createWindow(url: string): Promise<void> {
	mainWin = new BrowserWindow({
		width: 1280,
		height: 860,
		minWidth: 800,
		minHeight: 600,
		autoHideMenuBar: true,
		// 自定义沉浸式标题栏：隐藏系统通用标题栏，使用无边框沉浸式窗口
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
		trafficLightPosition: process.platform === "darwin" ? { x: 12, y: 15 } : undefined,
		webPreferences: {
			preload: join(here, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	const loadUrl = buildDesktopLoadUrl(url, { PI_WEB_TOKEN: accessToken });
	console.log(`[desktop] opening window: ${url}`);

	// 外链（更新日志/插件主页等）丢给系统浏览器，别在应用窗口里导航走。
	mainWin.webContents.setWindowOpenHandler(({ url: u }) => {
		if (!isAllowedExternalUrl(u)) {
			console.warn(`[desktop] 已拦截非 allowlist 外链（新窗口）：${u}`);
			return { action: "deny" };
		}
		const external = prepareExternalUrl(u, serviceUrl, accessToken);
		if (external) void shell.openExternal(external);
		return { action: "deny" };
	});
	// 同帧导航守卫（issue #154）：setWindowOpenHandler 只拦新窗口请求（window.open /
	// target="_blank"），而对话正文里的裸 href（现在 Markdown 已补 target，见
	// web/src/components/Markdown.tsx）与 JS 主动跳转（location.href/assign）走的是
	// 同帧导航 —— 默认会被允许，直接把应用窗口带走（无地址栏、无后退键，只能重启）。
	// 应用自身 origin（重载/前端路由）放行，其余一律转系统浏览器。
	mainWin.webContents.on("will-navigate", (e, target) => {
		let origin: string;
		try {
			origin = new URL(target).origin;
		} catch {
			e.preventDefault();
			return;
		}
		if (origin === new URL(serviceUrl || url).origin) return;
		e.preventDefault();
		if (!isAllowedExternalUrl(target)) {
			console.warn(`[desktop] 已拦截非 allowlist 外链（同帧导航）：${target}`);
			return;
		}
		console.log(`[desktop] will-navigate 拦截，已用系统浏览器打开：${target}`);
		const external = prepareExternalUrl(target, serviceUrl, accessToken);
		if (external) void shell.openExternal(external);
	});
	mainWin.on("enter-full-screen", () => {
		mainWin?.webContents.send("pi-desktop:full-screen-change", true);
	});
	mainWin.on("leave-full-screen", () => {
		mainWin?.webContents.send("pi-desktop:full-screen-change", false);
	});
	mainWin.on("maximize", () => {
		mainWin?.webContents.send("pi-desktop:window-maximized-change", true);
	});
	mainWin.on("unmaximize", () => {
		mainWin?.webContents.send("pi-desktop:window-maximized-change", false);
	});
	mainWin.webContents.on("will-redirect", (event, target) => {
		try {
			if (new URL(target).origin === new URL(serviceUrl || url).origin) return;
		} catch {
			/* deny malformed target */
		}
		event.preventDefault();
	});
	let closeAllowed = false;
	mainWin.on("close", (event) => {
		if (closeAllowed || shuttingDown) return;
		event.preventDefault();
		const window = mainWin;
		void captureWindowPreferences().finally(() => {
			closeAllowed = true;
			if (window && !window.isDestroyed()) window.close();
		});
	});
	mainWin.on("closed", () => {
		mainWin = null;
	});
	try {
		await loadWindowUrl(mainWin, loadUrl);
		console.log("[desktop] window loaded");
	} catch (err) {
		throw new Error(`界面加载失败：${(err as Error).message}`);
	}
}

// 单实例：第二个实例聚焦已有窗口（和网页版多标签页各走独立 clientId 不冲突）。
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
	app.quit();
} else {
	app.on("second-instance", () => {
		void showOrCreateWindow();
	});
}

// ⚠️ 绝对不要在 ESM 主进程顶层 `await app.whenReady()`（Electron 44 实测死锁）：
// Electron 要等入口模块求值完成才发 ready 事件，顶层 await ready = 互相死等——
// 进程挂在 "waiting for app ready…"，窗口永远不开（改成 .then 回调里 await 即可）。
void app.whenReady().then(async () => {
	if (!hasSingleInstanceLock) return;
	console.log("[desktop] app ready");
	try {
		wireWindowControls();
		const selected = await selectWorkspace();
		if (!selected) {
			app.quit();
			return;
		}
		workspace = selected;
		const url = await startServerSidecar();
		serviceUrl = url;
		await showOrCreateWindow();
		await wireAutoUpdater();
	} catch (err) {
		if (shuttingDown) return;
		console.error("✖ 桌面版启动失败：", err);
		dialog.showErrorBox("Pi Agent Desktop 启动失败", `无法启动应用。${(err as Error).message}\n日志：${logPath}`);
		await exitOnStartupFailure(1);
	}
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
	void showOrCreateWindow();
});
app.on("before-quit", (event) => {
	if (shuttingDown) return;
	event.preventDefault();
	shuttingDown = true;
	void (async () => {
		await captureWindowPreferences();
		if (serverProc) await stopOwnedSidecar(serverProc);
		serverProc = null;
		app.quit();
	})();
});

// -- 沉浸式标题栏与窗口控制（Windows / Linux 前端一体化控制三键） ----------
let windowControlsWired = false;
function wireWindowControls(): void {
	if (windowControlsWired) return;
	windowControlsWired = true;
	ipcMain.on("pi-desktop:preferences-load", (event) => {
		event.returnValue = trustedSender(event) ? { keys: DESKTOP_PREFERENCE_KEYS, values: preferences } : null;
	});
	ipcMain.on("pi-desktop:preferences-save", (event, values: unknown) => {
		try {
			if (trustedSender(event)) savePreferences(values);
		} catch (error) {
			console.warn("[desktop] 界面偏好保存失败", error);
		}
	});

	ipcMain.handle("pi-desktop:window-minimize", (event) => {
		if (!trustedSender(event)) return false;
		if (mainWin && !mainWin.isDestroyed()) {
			mainWin.minimize();
			return true;
		}
		return false;
	});

	ipcMain.handle("pi-desktop:window-toggle-maximize", (event) => {
		if (!trustedSender(event)) return false;
		if (mainWin && !mainWin.isDestroyed()) {
			if (mainWin.isMaximized()) {
				mainWin.unmaximize();
			} else {
				mainWin.maximize();
			}
			return true;
		}
		return false;
	});

	ipcMain.handle("pi-desktop:window-close", (event) => {
		if (!trustedSender(event)) return false;
		if (mainWin && !mainWin.isDestroyed()) {
			mainWin.close();
			return true;
		}
		return false;
	});

	ipcMain.handle("pi-desktop:window-is-maximized", (event) => {
		if (!trustedSender(event)) return false;
		if (mainWin && !mainWin.isDestroyed()) {
			return mainWin.isMaximized();
		}
		return false;
	});

	ipcMain.handle("pi-desktop:set-title-bar-overlay", (_event, opts: { color?: string; symbolColor?: string }) => {
		if (!trustedSender(_event) || !mainWin || process.platform === "darwin") return false;
		if (
			!opts ||
			typeof opts !== "object" ||
			Object.keys(opts).some((key) => !["color", "symbolColor"].includes(key)) ||
			Object.values(opts).some((value) => typeof value !== "string" || !/^#[0-9a-f]{6,8}$/i.test(value))
		)
			return false;
		try {
			if (typeof mainWin.setTitleBarOverlay === "function") {
				mainWin.setTitleBarOverlay(opts);
				return true;
			}
		} catch (err) {
			console.warn(`[desktop] setTitleBarOverlay 失败：${(err as Error).message}`);
		}
		return false;
	});
}

// -- 应用内自动更新（issue #180） ----------------------------------------------
//
// 以前更新面板走的永远是 npm 全局包（`npm i -g pi-web-ui@latest`），而打包后
// 的服务来自包内 `dist/server` —— npm 换的是别处，桌面用户只能手换 dmg。
// 现在主进程经 electron-updater 直连 GitHub releases 的 latest*.yml：
// check（只拉元数据）→ download（进度回传）→ quitAndInstall（重启即装好）。
// autoDownload=false：下载必须由用户在更新面板里点按钮触发，不搞 surprise 下载。
//
// 前端（web/，与浏览器同一份代码）经 preload 的 `window.piDesktop.updater`
// 调 invoke/订阅 event，全走 IPC，不与 server/protocol.ts 分叉。
//
// 未签名说明：Windows/Linux 未签名也能原地更新（SmartScreen 照常提示一次）；
// macOS 首次安装仍要右键→打开（Gatekeeper），之后 zip 通道照常更新。
/** 发往 renderer 的更新事件（preload 原样透出，见 web/src/desktop-updater.ts）。 */
interface DesktopUpdaterEvent {
	state: "checking" | "available" | "up-to-date" | "downloading" | "downloaded" | "error";
	version?: string | null;
	percent?: number;
	message?: string;
}

function pushUpdaterEvent(msg: DesktopUpdaterEvent): void {
	mainWin?.webContents.send("pi-desktop-updater:event", msg);
}

let updaterWired = false;

async function wireAutoUpdater(): Promise<void> {
	if (updaterWired) return;
	updaterWired = true;
	try {
		await configureAutoUpdater();
	} catch {
		// Configuration/import errors must not close an otherwise usable app.
		// Do not log the exception: malformed feed URLs can contain credentials.
		console.error("[desktop] 自动更新初始化失败（不影响使用）；请联系发布者检查更新渠道配置。");
		for (const operation of ["check", "download", "quit-install"]) {
			const channel = `pi-desktop-updater:${operation}`;
			ipcMain.removeHandler(channel);
			ipcMain.handle(channel, () => {
				throw new Error("自动更新不可用：发布渠道初始化失败；请联系发布者获取安装包。");
			});
		}
	}
}

async function configureAutoUpdater(): Promise<void> {
	// dev（`npm run desktop:dev`，isPackaged=false）也注册同一套 IPC：调用直接
	// 报“仅打包后可用”，前端据此显示下载页指引 —— 不让 invoke 挂起无 handler。
	if (!app.isPackaged || !existsSync(join(app.getAppPath(), "desktop-update.json"))) {
		const devOnly = () => {
			throw new Error("自动更新尚未配置本产品的发布渠道；请联系发布者获取安装包。");
		};
		ipcMain.handle("pi-desktop-updater:check", devOnly);
		ipcMain.handle("pi-desktop-updater:download", devOnly);
		ipcMain.handle("pi-desktop-updater:quit-install", devOnly);
		return;
	}
	// electron-updater 的 autoUpdater 是 `Object.defineProperty(exports, "autoUpdater", { get })`
	// 懒 getter 导出（见其 out/main.js），而 Node 的 CJS→ESM 具名导出探测只认 `exports.X = …`，
	// 于是打包版里 `const { autoUpdater } = await import("electron-updater")` 拿到的是 undefined，
	// 下一行赋值就抛 TypeError，整个 App 启动即退出（#220）。
	// 注意 out/main.d.ts 声明的是 `export declare const autoUpdater`，类型层面看不出这个坑。
	// 所以：回落到 default（= module.exports）再取一次；两者都没有就整体降级为“更新不可用”，
	// 绝不让更新接线拖垮启动。
	const updaterModule = (await import("electron-updater")) as typeof import("electron-updater") & {
		default?: { autoUpdater?: (typeof import("electron-updater"))["autoUpdater"] };
	};
	const autoUpdater = updaterModule.autoUpdater ?? updaterModule.default?.autoUpdater;
	if (!autoUpdater) {
		console.error("[desktop] electron-updater 未导出 autoUpdater，跳过自动更新接线");
		const unavailable = () => {
			throw new Error("自动更新不可用：electron-updater 未正确加载");
		};
		ipcMain.handle("pi-desktop-updater:check", unavailable);
		ipcMain.handle("pi-desktop-updater:download", unavailable);
		ipcMain.handle("pi-desktop-updater:quit-install", unavailable);
		return;
	}
	const updateConfig = JSON.parse(readFileSync(join(app.getAppPath(), "desktop-update.json"), "utf8"));
	const feed = new URL(updateConfig.url);
	if (
		feed.protocol !== "https:" ||
		feed.username ||
		feed.password ||
		(feed.hostname === "github.com" && feed.pathname.startsWith("/xing-shuyin/pi-web-ui"))
	)
		throw new Error("更新源必须是本产品的 HTTPS 发布地址。");
	autoUpdater.setFeedURL({ provider: "generic", url: feed.href });
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;
	autoUpdater.on("checking-for-update", () => pushUpdaterEvent({ state: "checking" }));
	autoUpdater.on("update-available", (info) =>
		pushUpdaterEvent({ state: "available", version: info?.version ?? null }),
	);
	autoUpdater.on("update-not-available", (info) =>
		pushUpdaterEvent({ state: "up-to-date", version: info?.version ?? null }),
	);
	autoUpdater.on("download-progress", (p) =>
		pushUpdaterEvent({ state: "downloading", percent: Math.round(p?.percent ?? 0) }),
	);
	autoUpdater.on("update-downloaded", (info) =>
		pushUpdaterEvent({ state: "downloaded", version: info?.version ?? null }),
	);
	autoUpdater.on("error", (err) =>
		pushUpdaterEvent({
			state: "error",
			message: err instanceof Error ? err.message : String(err),
		}),
	);
	ipcMain.handle("pi-desktop-updater:check", async (event) => {
		if (!trustedSender(event)) return false;
		await autoUpdater.checkForUpdates();
		return true;
	});
	ipcMain.handle("pi-desktop-updater:download", async (event) => {
		if (!trustedSender(event)) return false;
		await autoUpdater.downloadUpdate();
		return true;
	});
	ipcMain.handle("pi-desktop-updater:quit-install", async (event) => {
		if (!trustedSender(event)) return false;
		shuttingDown = true;
		if (serverProc) await stopOwnedSidecar(serverProc);
		serverProc = null;
		autoUpdater.quitAndInstall(false, true);
		return true;
	});
	// 开机静默查一次（只拉 yml 元数据，不下载）：面板打开时即有结论，
	// 离线/无 release 时只记日志，不挡窗口。
	try {
		await autoUpdater.checkForUpdates();
	} catch (err) {
		console.error(`[desktop] 开机更新检查失败（不影响使用）：${(err as Error).message}`);
	}
}
