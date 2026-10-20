/**
 * 桌面壳启动纯逻辑（独立于 Electron 运行时，便于单测）：
 * - `/api/health` 就绪轮询与超时解析（`PI_WEB_HEALTH_TIMEOUT_MS`，issue #584）
 * - `PI_WEB_TOKEN` 透传到窗口首跳 URL（issue #584 comment）
 */

/** 默认 `/api/health` 就绪等待上限（60s，兼顾企业杀软实时扫描下的慢启动，issue #584）。 */
export const DEFAULT_HEALTH_TIMEOUT_MS = 60_000;

/** 最小允许的 `/api/health` 超时（1s），防止误配 `0` 或负数导致立判失败。 */
export const MIN_HEALTH_TIMEOUT_MS = 1_000;

/** 桌面默认固定端口（避开网页版 8787，使 Origin 稳定以持久化 localStorage）。 */
export const DEFAULT_DESKTOP_PORT = 8790;

/**
 * 解析 `/api/health` 启动等待超时（毫秒）：
 * - 优先读 `PI_WEB_HEALTH_TIMEOUT_MS`；
 * - 非法 / 未设 / `<= 0` 回落到 `DEFAULT_HEALTH_TIMEOUT_MS`（60_000ms）；
 * - 合法正数下限夹到 `MIN_HEALTH_TIMEOUT_MS`（1_000ms）。
 */
export function resolveHealthTimeoutMs(env: Record<string, string | undefined> = process.env): number {
	const raw = env.PI_WEB_HEALTH_TIMEOUT_MS?.trim();
	if (!raw) return DEFAULT_HEALTH_TIMEOUT_MS;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HEALTH_TIMEOUT_MS;
	return Math.max(MIN_HEALTH_TIMEOUT_MS, Math.floor(parsed));
}

/**
 * 构造 BrowserWindow 首跳加载 URL：
 * - 若环境变量设置了 `PI_WEB_TOKEN`，且目标 URL 尚未带 `?token=`，自动附加 `?token=<encoded>`；
 * - 服务端首跳校验通过后会种下 HttpOnly `pi_web_token` Cookie，前端 `readAndScrubAuthToken()`
 *   随后用 `history.replaceState` 抹掉地址栏里的 `?token=`（issue #584 comment）。
 */
export function buildDesktopLoadUrl(baseUrl: string, env: Record<string, string | undefined> = process.env): string {
	const token = env.PI_WEB_TOKEN?.trim();
	if (!token) return baseUrl;
	try {
		const u = new URL(baseUrl);
		if (!u.searchParams.has("token")) {
			u.searchParams.set("token", token);
		}
		return u.toString();
	} catch {
		return baseUrl;
	}
}

export interface WaitForHealthOptions {
	timeoutMs?: number;
	pollIntervalMs?: number;
	requestTimeoutMs?: number;
	/** 若子进程已提前退出或报错，返回对应 Error 可立即中止轮询，不必傻等超时。 */
	shouldAbort?: () => Error | null | undefined;
	/** 单测注入自定义 fetch。 */
	fetchFn?: (url: string, init?: RequestInit) => Promise<{ ok: boolean }>;
}

/**
 * `/api/health` 轮询：server 就绪后再建窗口，避免白屏。
 */
export async function waitForHealth(url: string, opts: number | WaitForHealthOptions = {}): Promise<void> {
	const options: WaitForHealthOptions = typeof opts === "number" ? { timeoutMs: opts } : opts;
	const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
	const pollIntervalMs = Math.max(10, options.pollIntervalMs ?? 200);
	const fetchImpl = options.fetchFn ?? fetch;
	const deadline = Date.now() + timeoutMs;
	const healthUrl = `${url.replace(/\/+$/, "")}/api/health`;

	for (;;) {
		const abortErr = options.shouldAbort?.();
		if (abortErr) throw abortErr;
		try {
			const res = await boundedRequest(
				(signal) => fetchImpl(healthUrl, { signal, redirect: "error" }),
				Math.min(options.requestTimeoutMs ?? 1_000, Math.max(1, deadline - Date.now())),
			);
			if (res.ok) return;
		} catch {
			/* 还没起来 */
		}
		const abortAfter = options.shouldAbort?.();
		if (abortAfter) throw abortAfter;
		if (Date.now() >= deadline) {
			throw new Error(`server 未在 ${timeoutMs}ms 内就绪：${url}`);
		}
		await new Promise((r) => setTimeout(r, Math.min(pollIntervalMs, Math.max(1, deadline - Date.now()))));
	}
}

/** The deadline also bounds mocks or transports that ignore AbortSignal. */
async function boundedRequest<T>(request: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			request(controller.signal),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					controller.abort();
					reject(new Error("服务请求超时"));
				}, timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}

/** Health is public. Prove the protected endpoint requires our fresh per-launch secret. */
export async function verifySidecarIdentity(url: string, token: string): Promise<void> {
	const endpoint = `${url}/api/themes`;
	const probe = (authorized: boolean) =>
		boundedRequest(async (signal) => {
			const response = await fetch(endpoint, {
				signal,
				redirect: "error",
				headers: authorized ? { Authorization: `Bearer ${token}` } : {},
			});
			const result = { status: response.status, cookie: response.headers.get("set-cookie") ?? "" };
			await response.body?.cancel();
			return result;
		}, 2_000);
	const anonymous = await probe(false);
	if (anonymous.status !== 401) throw new Error("服务身份校验失败：端口可能被其他服务占用。");
	const authenticated = await probe(true);
	if (authenticated.status !== 200 || !authenticated.cookie.includes(`pi_web_token=${encodeURIComponent(token)};`)) {
		throw new Error("服务身份校验失败：启动令牌未匹配。");
	}
}
