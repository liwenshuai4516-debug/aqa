import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";

const executablePath = resolve(process.argv[2]);
const fixture = mkdtempSync(join(tmpdir(), "pi-notification-"));
const workspace = join(fixture, "workspace");
const userData = join(fixture, "desktop");
const agent = join(userData, "agent");
mkdirSync(workspace);
mkdirSync(agent, { recursive: true });
let response,
	calls = 0;
const provider = createServer(async (req, res) => {
	for await (const _ of req) {
		/* consume the local test request */
	}
	calls++;
	if (calls !== 1) {
		res.writeHead(429).end("One local request only");
		return;
	}
	response = res;
});
provider.listen(0, "127.0.0.1");
await once(provider, "listening");
writeFileSync(
	join(agent, "models.json"),
	JSON.stringify({
		providers: {
			fixture: {
				api: "openai-completions",
				baseUrl: `http://127.0.0.1:${provider.address().port}`,
				apiKey: "local-only",
				models: [
					{
						id: "notification-fixture",
						name: "Notification Fixture",
						input: ["text"],
						contextWindow: 32000,
						maxTokens: 128,
					},
				],
			},
		},
	}),
);
writeFileSync(join(agent, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "local-only" } }));
const reservation = createServer().listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PORT: String(port),
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of [
	"ELECTRON_RUN_AS_NODE",
	"PI_WEB_DATA_DIR",
	"PI_CODING_AGENT_DIR",
	"PI_WEB_DESKTOP_URL",
	"DEEPSEEK_API_KEY",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
])
	delete env[key];
let application;
const checks = [];
try {
	application = await launchNativeApp({ executablePath, packaged: true, env });
	const page = await application.firstWindow();
	// Playwright enables focus emulation when attaching. Restore the real OS
	// presence signals before exercising the original notification suppression.
	const presenceSession = await page.context().newCDPSession(page);
	await presenceSession.send("Emulation.setFocusEmulationEnabled", { enabled: false });
	await page.waitForSelector(".app");
	await page.getByRole("button", { name: "Notification Fixture", exact: true }).waitFor({ timeout: 30000 });
	await page.evaluate(() => {
		// Observe the actual native-backed page Notification API, without granting
		// permission, replacing delivery, or changing its suppression policy.
		window.__notificationEvents = [];
		const originalShow = ServiceWorkerRegistration.prototype.showNotification;
		ServiceWorkerRegistration.prototype.showNotification = function (...args) {
			window.__notificationEvents.push({ event: "sw-requested", title: args[0] });
			return originalShow.apply(this, args).then(
				(value) => {
					window.__notificationEvents.push({ event: "sw-delivered", title: args[0] });
					return value;
				},
				(error) => {
					window.__notificationEvents.push({ event: "sw-error", title: args[0], error: String(error) });
					throw error;
				},
			);
		};
		const Original = window.Notification;
		window.Notification = class extends Original {
			constructor(...args) {
				super(...args);
				window.__notificationEvents.push({ event: "created", title: args[0] });
				for (const event of ["show", "error", "click", "close"])
					this.addEventListener(event, () => window.__notificationEvents.push({ event, title: args[0] }));
			}
		};
	});
	const soundTrigger = page.locator('button[data-tip="声音"], button[title="声音"]');
	if (!(await soundTrigger.isVisible())) await page.locator(".plugin-topbar-more > button").click();
	await soundTrigger.click();
	await page.locator(".notify-menu input[type=checkbox]").check();
	await page.waitForFunction(() => Notification.permission !== "default");
	const permission = await page.evaluate(() => Notification.permission);
	assert.equal(permission, "granted", "original UI obtains real notification permission");
	checks.push({
		status: "PASS",
		check: "original notification toggle obtains real Electron/browser notification permission",
		permission,
	});
	const sound = page.locator(".sound-menu").filter({ has: page.locator(".dd-header", { hasText: "声音提示" }) });
	await sound.locator(".sound-master input[type=checkbox]").check();
	await sound.locator("input[type=range]").fill("30");
	await sound.locator(".sound-row", { hasText: "回复开始" }).locator("input[type=checkbox]").check();
	const audioSession = await page.context().newCDPSession(page);
	const nodes = [];
	await audioSession.send("WebAudio.enable");
	audioSession.on("WebAudio.audioNodeCreated", (event) => nodes.push(event.node.nodeType));
	await sound.locator(".sound-row", { hasText: "回复开始" }).locator(".sound-preview").click();
	await page.waitForTimeout(300);
	assert(nodes.some((type) => type.includes("Oscillator")));
	checks.push({
		status: "PASS",
		check: "original sound preview synthesizes actual audio; system volume unchanged",
		nodes,
	});
	await page.keyboard.press("Escape");
	await page.locator(".inputbox textarea").fill("NOTIFICATION_ACCEPTANCE");
	await page.locator(".inputbox textarea").press("Enter");
	const deadline = Date.now() + 10000;
	while (!response && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
	assert(response, "local provider receives the original SDK prompt");
	await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
	const minimizedDeadline = Date.now() + 10000;
	while (
		!(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())) &&
		Date.now() < minimizedDeadline
	)
		await new Promise((r) => setTimeout(r, 100));
	assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()));
	await page.waitForFunction(() => !document.hasFocus(), undefined, { polling: 100, timeout: 10000 });
	checks.push({
		status: "PASS",
		check: "real window minimized and original page focus suppression released",
		presence: await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() })),
	});
	response.writeHead(200, { "content-type": "text/event-stream" });
	for (const [delta, finish] of [
		[{ content: "NOTIFICATION_ACCEPTANCE_OK" }, null],
		[{}, "stop"],
	])
		response.write(
			`data: ${JSON.stringify({ id: "notification-fixture", object: "chat.completion.chunk", model: "notification-fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
		);
	response.end("data: [DONE]\n\n");
	await page.getByText("NOTIFICATION_ACCEPTANCE_OK", { exact: true }).waitFor({ state: "attached", timeout: 30000 });
	let notification;
	const notificationDeadline = Date.now() + 10000;
	while (Date.now() < notificationDeadline) {
		notification = await page.evaluate(async () => {
			const reg = await navigator.serviceWorker?.getRegistration();
			const held = await Promise.race([
				reg?.getNotifications(),
				new Promise((r) => setTimeout(() => r(undefined), 1000)),
			]);
			return {
				events: window.__notificationEvents,
				held: held?.map((item) => ({ title: item.title, body: item.body })),
				visibility: document.visibilityState,
				enabled: JSON.parse(localStorage.getItem("pi-web-notify"))?.enabled,
			};
		});
		if (
			notification.events.some((item) => item.event === "show" || item.event === "sw-delivered") ||
			notification.held?.some((item) => item.title === "任务完成")
		)
			break;
		await new Promise((r) => setTimeout(r, 100));
	}
	checks.push({ status: "OBSERVED", check: "notification delivery events", notification });
	if (
		!notification.events.some((item) => item.event === "show" || item.event === "sw-delivered") &&
		!notification.held?.length
	) {
		await page.evaluate(() => {
			new Notification("桌面通知通道诊断", { body: "实际页面通知，用于定位系统通知兼容性" });
		});
		await page.waitForTimeout(2000);
		const events = await page.evaluate(() => window.__notificationEvents);
		checks.push({
			status: events.some((item) => item.event === "show" && item.title === "桌面通知通道诊断") ? "PASS" : "FAIL",
			check: "diagnostic only: actual page notification delivery, independent from original completion path",
			events,
		});
	}
	assert(
		notification.events.some((item) => item.event === "show" || item.event === "sw-delivered") ||
			notification.held?.some((item) => item.title === "任务完成"),
		"real notification show event or service-worker held notification",
	);
	checks.push({
		status: "PASS",
		check: "original background completion path delivers an actual notification to the platform API",
		notification,
	});
	console.log(
		"MANUAL_OBSERVATION_READY: actual notification and sound dispatched; waiting up to 60 seconds before cleanup",
	);
	await new Promise((r) => setTimeout(r, 60000));
} catch (error) {
	checks.push({ status: "FAIL", error: error.stack });
	process.exitCode = 1;
} finally {
	response?.end();
	if (application) await application.close().catch(() => application.process().kill("SIGTERM"));
	provider.closeAllConnections();
	await new Promise((r) => provider.close(r));
	writeFileSync(
		"docs/desktop-delivery/evidence/T15-notification.json",
		JSON.stringify(
			{
				fixture,
				executablePath,
				realModelRequests: 0,
				localRequests: calls,
				checks,
				humanObservation: "not recorded by automation; see separate user response evidence",
			},
			null,
			2,
		),
	);
	console.log(JSON.stringify(checks, null, 2));
}
