// Installed app: original download UI and media preview / HTTP Range behavior.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";
import { waitForStablePage } from "../lib/page-stability.mjs";

const executablePath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve existing evidence");
const fixture = mkdtempSync("/tmp/pi-file-media-");
const workspace = join(fixture, "中文 workspace");
const userData = join(fixture, "desktop");
const downloads = join(fixture, "中文 downloads");
mkdirSync(workspace);
mkdirSync(downloads);
mkdirSync(join(userData, "agent"), { recursive: true });
writeFileSync(join(userData, "agent/auth.json"), "{}");
writeFileSync(join(userData, "agent/models.json"), "{}");
const zip = Buffer.from("504b0506000000000000000000000000000000000000", "hex");
const text = Buffer.from("中文下载内容 · UTF-8\nSECOND_LINE\n");
writeFileSync(join(workspace, "报告.zip"), zip);
writeFileSync(join(workspace, "中文文本.txt"), text);
writeFileSync(join(workspace, "中文GBK.txt"), Buffer.from("d6d0cec4b2e2cad4", "hex"));
const wav = Buffer.alloc(44 + 16000);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(16000, 40);
writeFileSync(join(workspace, "静音样例.wav"), wav);
const result = { fixture, executablePath, status: "FAIL", checks: [], realModelRequests: 0, downloads: [] };
const check = (label, ok) => {
	assert(ok, label);
	result.checks.push(label);
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
async function until(predicate, timeout = 30000) {
	const deadline = Date.now() + timeout;
	while (!(await predicate())) {
		assert(Date.now() < deadline, "File/media condition timeout");
		await new Promise((r) => setTimeout(r, 100));
	}
}
const row = (name) =>
	page.locator(".panel-right .file-item.file").filter({ has: page.locator(".file-name-text", { hasText: name }) });
async function download(name, expected) {
	const savePath = join(downloads, name);
	await row(name).hover();
	await row(name).locator("button.file-attach.download").click();
	console.log("NATIVE_SAVE_REQUIRED: " + savePath);
	await until(() => existsSync(savePath) && readFileSync(savePath).equals(expected), 900000);
	check(`Original native save preserves Chinese filename: ${name}`, existsSync(savePath));
	const info = { name, branch: "unmodified showSaveFilePicker", manualSelection: true };
	const bytes = readFileSync(savePath);
	check(`Actual Electron download bytes match source: ${name}`, bytes.equals(expected));
	result.downloads.push({ ...info, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
try {
	app = await launchNativeApp({ executablePath, packaged: true, env });
	page = await app.firstWindow();
	await page.waitForSelector(".app");
	assert(await waitForStablePage(page));
	await row("报告.zip").waitFor();
	result.picker = await page.evaluate(() => ({
		nativeFilePicker: typeof window.showSaveFilePicker,
		secureContext: window.isSecureContext,
	}));
	check(
		"Installed Electron offers original native save branch",
		result.picker.nativeFilePicker === "function" && result.picker.secureContext,
	);
	const textDownload = await page.evaluate(async () => {
		const r = await fetch("/api/file?" + new URLSearchParams({ path: "中文文本.txt", download: "1" }));
		return {
			status: r.status,
			disposition: r.headers.get("content-disposition"),
			bytes: Array.from(new Uint8Array(await r.arrayBuffer())),
		};
	});
	check(
		"Text download endpoint preserves exact UTF-8 bytes",
		textDownload.status === 200 && Buffer.from(textDownload.bytes).equals(text),
	);
	check(
		"Download endpoint encodes Chinese filename as attachment",
		textDownload.disposition?.includes("attachment") &&
			textDownload.disposition.includes("filename*=UTF-8''" + encodeURIComponent("中文文本.txt")),
	);
	await row("中文GBK.txt").locator(".file-name").click();
	await until(async () => (await page.locator(".fp-code-text").innerText()).includes("中文测试"));
	check("Original text preview decodes GBK Chinese bytes", true);
	await page.locator(".fp-close").click();
	await row("静音样例.wav").locator(".file-name").click();
	const audio = page.locator(".fp-audio-element");
	await audio.waitFor();
	await until(() => audio.evaluate((el) => el.readyState >= 1 && Number.isFinite(el.duration)));
	const media = await audio.evaluate((el) => ({
		duration: el.duration,
		src: el.currentSrc,
		error: el.error?.code ?? null,
	}));
	check(
		"Original audio preview decodes real PCM WAV metadata",
		media.error === null && Math.abs(media.duration - 1) < 0.01,
	);
	const response = await page.evaluate(async (src) => {
		const r = await fetch(src, { headers: { Range: "bytes=44-75" } });
		return {
			status: r.status,
			range: r.headers.get("content-range"),
			accept: r.headers.get("accept-ranges"),
			bytes: Array.from(new Uint8Array(await r.arrayBuffer())),
		};
	}, media.src);
	result.range = response;
	check(
		"Installed media endpoint returns exact requested byte range",
		response.status === 206 &&
			response.range === `bytes 44-75/${wav.length}` &&
			Buffer.from(response.bytes).equals(wav.subarray(44, 76)),
	);
	const suffix = await page.evaluate(async (src) => {
		const r = await fetch(src, { headers: { Range: "bytes=-16" } });
		return {
			status: r.status,
			range: r.headers.get("content-range"),
			bytes: Array.from(new Uint8Array(await r.arrayBuffer())),
		};
	}, media.src);
	check(
		"Media endpoint supports exact suffix range",
		suffix.status === 206 &&
			suffix.range === `bytes ${wav.length - 16}-${wav.length - 1}/${wav.length}` &&
			Buffer.from(suffix.bytes).equals(wav.subarray(-16)),
	);
	const invalid = await page.evaluate(async (src) => {
		const r = await fetch(src, { headers: { Range: "bytes=999999-" } });
		await r.arrayBuffer();
		return { status: r.status, range: r.headers.get("content-range") };
	}, media.src);
	check(
		"Unsatisfiable media range reports 416 without full file",
		invalid.status === 416 && invalid.range === `bytes */${wav.length}`,
	);
	const unauthorizedUrl = new URL(media.src);
	unauthorizedUrl.searchParams.delete("token");
	const unauthorized = await fetch(unauthorizedUrl);
	await unauthorized.body?.cancel();
	check("Unauthenticated external media request is rejected", unauthorized.status === 401);
	result.media = { duration: media.duration, error: media.error };
	await audio.evaluate((el) => el.pause());
	await page.screenshot({ path: output.replace(/\.json$/, "-audio.png") });
	await page.locator(".fp-close").click();
	await download("报告.zip", zip);
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
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
