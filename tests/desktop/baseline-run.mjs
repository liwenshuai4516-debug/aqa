import { _electron } from "playwright-core";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const fixture = mkdtempSync(join(tmpdir(), "pi-desktop-baseline-"));
for (const name of ["workspace", "data", "agent", "electron"]) mkdirSync(join(fixture, name));
const harness = resolve("dist/desktop/baseline-harness.mjs");
writeFileSync(
	harness,
	`import { app } from 'electron'; app.setPath('userData', ${JSON.stringify(join(fixture, "electron"))}); await import('./main.js');`,
);
const env = {
	...process.env,
	PI_WEB_CWD: join(fixture, "workspace"),
	PI_WEB_DATA_DIR: join(fixture, "data"),
	PI_CODING_AGENT_DIR: join(fixture, "agent"),
	PI_WEB_SDK: "bundled",
	PI_WEB_PORT: "18900",
	PI_WEB_PLUGIN_CATALOG_URL: "off",
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
	executablePath: resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
	args: [harness],
	env,
	timeout: 60000,
});
try {
	const page = await app.firstWindow({ timeout: 60000 });
	await page.waitForSelector(".app", { timeout: 60000 });
	await page.screenshot({ path: "docs/desktop-delivery/evidence/baseline-electron.png" });
	const health = await (await fetch(new URL("/api/health", page.url()))).json();
	const bridge = await page.evaluate(() => ({
		desktop: window.piDesktop?.isDesktop,
		platform: window.piDesktop?.platform,
		node: typeof window.require,
	}));
	writeFileSync(
		"docs/desktop-delivery/evidence/baseline-electron.json",
		JSON.stringify(
			{ fixture, url: page.url(), health, bridge, versions: await app.evaluate(() => process.versions) },
			null,
			2,
		),
	);
	console.log(JSON.stringify({ status: "PASS", fixture, bridge, health }));
} finally {
	await app.close();
}
