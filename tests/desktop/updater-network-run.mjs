// Real updater/preload against an isolated HTTPS feed; no install attempt.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:https";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { homedir } from "node:os";
import { launchNativeApp } from "./native-app.mjs";
import { waitForStablePage } from "../lib/page-stability.mjs";
const installed = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve evidence");
const fixture = mkdtempSync("/tmp/pi-updater-network-");
const bundle = join(fixture, "中文 updater installation/Pi Agent Desktop.app");
mkdirSync(join(fixture, "中文 updater installation"));
execFileSync("cp", ["-cR", installed, bundle]);
const root = join(bundle, "Contents/Resources/app");
const executablePath = join(bundle, "Contents/MacOS/Pi Agent Desktop");
const mainFile = join(root, "dist/desktop/main.js");
const originalMain = readFileSync(join(installed, "Contents/Resources/app/dist/desktop/main.js"));
assert(readFileSync(mainFile).equals(originalMain));
const workspace = join(fixture, "中文 workspace");
const userData = join(fixture, "desktop");
mkdirSync(workspace);
mkdirSync(join(userData, "agent"), { recursive: true });
writeFileSync(join(workspace, "用户文件.txt"), "UPDATE_MUST_KEEP_THIS\n");
writeFileSync(join(userData, "agent/auth.json"), "{}");
writeFileSync(join(userData, "agent/models.json"), "{}");
const certPath = join(fixture, "feed.crt"),
	keyPath = join(fixture, "feed.key");
execFileSync(
	"openssl",
	[
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		keyPath,
		"-out",
		certPath,
		"-days",
		"1",
		"-subj",
		"/CN=127.0.0.1",
		"-addext",
		"subjectAltName=IP:127.0.0.1",
	],
	{ stdio: "ignore" },
);
const cert = readFileSync(certPath);
const fingerprint = new X509Certificate(cert).fingerprint256;
const metadataPath = join(root, "package.json");
const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
metadata.main = "update-test-bootstrap.mjs";
writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
writeFileSync(
	join(root, "update-test-bootstrap.mjs"),
	`
import {app,session} from 'electron';
import {X509Certificate} from 'node:crypto';
globalThis.__testTLSDecisions=[];
app.on('ready',()=>session.fromPartition('electron-updater',{cache:false}).setCertificateVerifyProc((request,callback)=>{
 let matched=false;
 try {matched=request.hostname==='127.0.0.1' && new X509Certificate(request.certificate.data).fingerprint256===${JSON.stringify(fingerprint)};} catch{}
 globalThis.__testTLSDecisions.push({hostname:request.hostname,matched});callback(matched?0:-3);
}));
await import('./dist/desktop/main.js');
`,
);

const payload = Buffer.alloc(128 * 1024, 0x51);
const correctHash = createHash("sha512").update(payload).digest("base64");
let mode = "current";
const requests = [];
const feed = createServer({ key: readFileSync(keyPath), cert }, (req, res) => {
	const path = new URL(req.url, "https://127.0.0.1").pathname;
	requests.push({ mode, path, method: req.method });
	if (path.endsWith(".yml")) {
		if (mode === "unavailable") {
			res.writeHead(503).end("Test channel unavailable");
			return;
		}
		const version = mode === "current" ? "0.109.0" : "0.109.1";
		const hash = mode === "checksum" ? Buffer.alloc(64).toString("base64") : correctHash;
		res
			.writeHead(200, { "content-type": "text/yaml" })
			.end(
				`version: ${version}\nfiles:\n  - url: test-update-arm64.zip\n    sha512: ${hash}\n    size: ${payload.length}\npath: test-update-arm64.zip\nsha512: ${hash}\nreleaseDate: '2026-10-21T00:00:00.000Z'\n`,
			);
		return;
	}
	if (path.endsWith("test-update-arm64.zip")) {
		res.writeHead(200, { "content-type": "application/zip", "content-length": payload.length });
		if (mode === "interrupted") {
			res.write(payload.subarray(0, 4096));
			setTimeout(() => res.destroy(), 20);
		} else res.end(payload);
		return;
	}
	res.writeHead(404).end();
});
feed.listen(0, "127.0.0.1");
await once(feed, "listening");
const url = `https://127.0.0.1:${feed.address().port}/updates/`;
writeFileSync(join(root, "desktop-update.json"), JSON.stringify({ url }));
// The updater joins this field beneath ~/Library/Caches. Resolve only to this
// test's own cache; do not reuse a user's product updater cache.
writeFileSync(
	join(bundle, "Contents/Resources/app-update.yml"),
	`provider: generic\nurl: ${url}\nupdaterCacheDirName: ${relative(join(homedir(), "Library/Caches"), join(fixture, "updater-cache"))}\n`,
);
const result = {
	fixture,
	status: "FAIL",
	executablePath,
	instrumentation:
		"Clone adds an instrumentation bootstrap before the byte-identical original main to install exact-certificate trust before the first updater request; test feed/cache configuration only. Real original updater and preload. Ephemeral TLS trust matches loopback hostname AND generated certificate fingerprint. No update installation or signature bypass.",
	checks: [],
	requests,
	realModelRequests: 0,
};
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_CWD: workspace,
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of Object.keys(env))
	if (
		/(API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SESSION_TOKEN)$/.test(key) ||
		/^(AWS_|GOOGLE_|GCLOUD_|AZURE_|PI_PORTABLE)/.test(key) ||
		[
			"ELECTRON_RUN_AS_NODE",
			"NODE_OPTIONS",
			"PI_WEB_DATA_DIR",
			"PI_CODING_AGENT_DIR",
			"PI_CODING_AGENT_SESSION_DIR",
			"PI_WEB_DESKTOP_URL",
			"PI_WEB_PORT",
			"PORTABLE_EXECUTABLE_DIR",
		].includes(key)
	)
		delete env[key];
let app, page;
const check = (name, ok) => {
	assert(ok, name);
	result.checks.push(name);
};
async function launch() {
	app = await launchNativeApp({ executablePath, packaged: true, env });
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	assert(await waitForStablePage(page));

	await page.evaluate(() => {
		window.__updaterEvents = [];
		window.piDesktop.updater.onEvent((e) => window.__updaterEvents.push(e));
	});
}
async function invoke(operation) {
	return page.evaluate(async (op) => {
		try {
			return { ok: await window.piDesktop.updater[op]() };
		} catch (error) {
			return { error: error.message };
		}
	}, operation);
}
async function events() {
	return page.evaluate(() => window.__updaterEvents);
}
async function assertHealthy() {
	assert.equal(await page.evaluate(async () => (await fetch("/api/health")).status), 200);
	assert.equal(app.process().exitCode, null);
}
try {
	await launch();
	const current = await invoke("check");
	result.current = current;
	assert(!current.error);
	check(
		"Actual HTTPS feed reports installed version up to date",
		(await events()).some((e) => e.state === "up-to-date"),
	);
	check("Metadata checks do not automatically download update", !requests.some((r) => r.path.endsWith(".zip")));
	await page.evaluate(() => localStorage.setItem("pi-web-ui:theme", "nord"));
	mode = "interrupted";
	await page.evaluate(() => (window.__updaterEvents = []));
	const available = await invoke("check");
	assert(!available.error);
	check(
		"Higher version is announced through original preload events",
		(await events()).some((e) => e.state === "available" && e.version === "0.109.1"),
	);
	check("Available update remains undownloaded until explicit action", !requests.some((r) => r.path.endsWith(".zip")));
	const interrupted = await invoke("download");
	result.interrupted = interrupted;
	check(
		"Interrupted HTTPS download rejects through original bridge",
		!!interrupted.error && (await events()).some((e) => e.state === "error"),
	);
	await assertHealthy();
	check("Business service remains usable after interrupted update", true);
	mode = "checksum";
	await page.evaluate(() => (window.__updaterEvents = []));
	const recheck = await invoke("check");
	assert(!recheck.error);
	const checksum = await invoke("download");
	result.checksum = checksum;
	check("Complete download with wrong SHA512 is rejected", /sha512|checksum/i.test(checksum.error ?? ""));
	check("Invalid update never emits downloaded state", !(await events()).some((e) => e.state === "downloaded"));
	await assertHealthy();
	mode = "unavailable";
	await page.evaluate(() => (window.__updaterEvents = []));
	const unavailable = await invoke("check");
	result.unavailable = unavailable;
	check(
		"Unavailable HTTPS channel reports an error without exiting",
		!!unavailable.error && (await events()).some((e) => e.state === "error"),
	);
	await assertHealthy();
	check(
		"Project bytes and independent agent configuration remain unchanged",
		readFileSync(join(workspace, "用户文件.txt"), "utf8") === "UPDATE_MUST_KEEP_THIS\n" &&
			readFileSync(join(userData, "agent/auth.json"), "utf8") === "{}" &&
			readFileSync(join(userData, "agent/models.json"), "utf8") === "{}",
	);
	result.events = await events();
	result.tlsDecisions = await app.evaluate(() => globalThis.__testTLSDecisions);
	result.actualUpdaterCache = await app.evaluate(
		({ app }) =>
			process.getBuiltinModule("module").createRequire(app.getAppPath() + "/package.json")("electron-updater")
				.autoUpdater.downloadedUpdateHelper.cacheDir,
	);
	assert.equal(resolve(result.actualUpdaterCache), resolve(join(fixture, "updater-cache")));

	await app.close();
	app = null;
	mode = "current";
	await launch();
	await assertHealthy();
	check(
		"Same installed version starts after all update failures",
		(await page.evaluate(() => localStorage.getItem("pi-web-ui:theme"))) === "nord",
	);
	check(
		"Original desktop main remains byte-identical after update failures",
		readFileSync(mainFile).equals(originalMain),
	);
	check(
		"Project content survives full application restart",
		readFileSync(join(workspace, "用户文件.txt"), "utf8") === "UPDATE_MUST_KEEP_THIS\n",
	);
	check("Explicit updater cache stays in the independent fixture", existsSync(join(fixture, "updater-cache")));
	await page.screenshot({ path: output.replace(/\.json$/, "-restored.png") });
	result.status = "PASS";
} catch (error) {
	result.error = error.stack;
	await page?.screenshot({ path: output.replace(/\.json$/, "-failure.png") }).catch(() => {});
	process.exitCode = 1;
} finally {
	await app?.close().catch((error) => {
		result.cleanupError = error.message;
		process.exitCode = 1;
	});
	feed.closeAllConnections();
	await new Promise((r) => feed.close(r));
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
