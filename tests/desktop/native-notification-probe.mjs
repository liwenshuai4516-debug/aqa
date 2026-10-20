import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";

const fixture = mkdtempSync(join(tmpdir(), "pi-native-notification-"));
const workspace = join(fixture, "workspace");
mkdirSync(workspace);
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: join(fixture, "desktop"),
	PI_WEB_CWD: workspace,
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
let app;
const result = {
	fixture,
	scope: "diagnostic only; native API does not establish original UI completion delivery",
	realModelRequests: 0,
};
try {
	app = await launchNativeApp({ executablePath: resolve(process.argv[2]), packaged: true, env });
	result.native = await app.evaluate(
		({ Notification }) =>
			new Promise((resolveResult) => {
				const events = [];
				const supported = Notification.isSupported();
				const n = new Notification({ title: "桌面原生通知诊断", body: "验证 macOS 通知通道，不调用模型" });
				globalThis.__nativeNotificationProbe = n;
				for (const event of ["show", "failed", "close", "click"])
					n.on(event, (...args) => events.push({ event, detail: String(args[1] ?? "") }));
				n.show();
				setTimeout(() => resolveResult({ supported, events }), 5000);
			}),
	);
	console.log(JSON.stringify(result, null, 2));
} catch (error) {
	result.error = error.stack;
	process.exitCode = 1;
} finally {
	await app?.close();
	writeFileSync("docs/desktop-delivery/evidence/T15-native-notification.json", JSON.stringify(result, null, 2));
}
