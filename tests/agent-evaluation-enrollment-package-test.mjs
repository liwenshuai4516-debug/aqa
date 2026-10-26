/** Runs shipped enrollment scripts and one pinned guest from an actual internal macOS .app. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { launchNativeApp } from "./desktop/native-app.mjs";
const repo = fileURLToPath(new URL("..", import.meta.url));
const appPath = fs.realpathSync(process.argv[2]),
	helper = fs.realpathSync(process.argv[3]),
	boot = fs.realpathSync(process.argv[4]);
const resources = path.join(appPath, "Contents/Resources/app"),
	exe = path.join(appPath, "Contents/MacOS/Pi Agent Desktop");
const output = fs.realpathSync(fs.mkdtempSync("/private/tmp/ae-enroll-package-"));
console.log(output);
const userData = path.join(output, "desktop"),
	dataDir = path.join(userData, "data"),
	agentDir = path.join(userData, "agent"),
	workspace = path.join(output, "workspace"),
	home = path.join(output, "home");
for (const dir of [dataDir, agentDir, workspace, home]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(agentDir, "auth.json"), "{}");
fs.writeFileSync(path.join(agentDir, "models.json"), '{"providers":{}}');
const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, TMPDIR: os.tmpdir(), LANG: "en_US.UTF-8" };
const result = { status: "RUNNING", output, appPath, actualAgentCliCalls: 0, actualModelCalls: 0, checks: [] };
let app;
function command(args, name, extraEnv = {}) {
	const child = spawnSync(exe, args, {
		cwd: output,
		env: { ...env, ELECTRON_RUN_AS_NODE: "1", ...extraEnv },
		encoding: "utf8",
		timeout: 60000,
		maxBuffer: 1024 ** 2,
	});
	fs.writeFileSync(path.join(output, name), (child.stdout ?? "") + (child.stderr ?? ""));
	assert.equal(child.status, 0, child.error?.message || child.stderr);
	return child.stdout;
}
async function runGuest() {
	const fs = await import("node:fs"),
		path = await import("node:path"),
		url = await import("node:url"),
		crypto = await import("node:crypto"),
		assert = (await import("node:assert/strict")).default;
	const root = process.argv[1],
		dataDir = process.argv[2];
	const { readOfflineEnrollment } = await import(
		url.pathToFileURL(path.join(root, "dist/server/external-evaluation-enrollment.js")).href
	);
	const { ExternalEvaluationRuntime } = await import(
		url.pathToFileURL(path.join(root, "dist/server/external-evaluation-runtime.js")).href
	);
	const enrolled = readOfflineEnrollment(dataDir),
		id = crypto.randomUUID(),
		runtime = new ExternalEvaluationRuntime(enrolled.runtimeRoot, "a".repeat(64));
	const input = Buffer.from('{"offline":true,"text":"中文🙂"}\n');
	runtime.prepare(id, enrolled.backend, 15000, 100, {
		...enrolled.guest,
		argv: ["binary"],
		stdinBase64: input.toString("base64"),
	});
	let finished = false;
	try {
		await runtime.start(id);
		const end = Date.now() + 25000;
		while (Date.now() < end) {
			const s = await runtime.status(id);
			if (s.stopConfirmed && s.state === "ended") {
				assert.equal(s.guest.reportedExit, 0);
				assert.deepEqual(fs.readFileSync(path.join(enrolled.runtimeRoot, id, "guest-stdout.raw")), input);
				await runtime.cleanup(id);
				finished = true;
				console.log(
					JSON.stringify({
						status: "PASS",
						attemptId: id,
						source: root,
						runtimeRoot: enrolled.runtimeRoot,
						stopConfirmed: true,
						goal: "undetermined; no independent verifier",
						stdoutSha256: crypto.createHash("sha256").update(input).digest("hex"),
					}),
				);
				return;
			}
			await new Promise((done) => setTimeout(done, 40));
		}
		throw new Error("Packaged guest did not confirm terminal state");
	} finally {
		if (!finished) await runtime.cancel(id);
	}
}
try {
	const shipped = [
		"scripts/enable-agent-evaluation.mjs",
		"scripts/enroll-agent-evaluation-runtime.mjs",
		"dist/server/external-evaluation-enrollment.js",
		"plugins/agent-evaluation/runtime/guest-cli.sh",
		"plugins/agent-evaluation/runtime/guest-cli-runner.sh",
		"plugins/agent-evaluation/runtime/vm-supervisor.swift",
	];
	result.shippedFiles = {};
	for (const name of shipped) {
		const bytes = fs.readFileSync(path.join(resources, name));
		assert.deepEqual(bytes, fs.readFileSync(path.join(repo, name)));
		result.shippedFiles[name] = createHash("sha256").update(bytes).digest("hex");
	}
	command(
		[path.join(resources, "scripts/enable-agent-evaluation.mjs"), "--agent-dir", agentDir, "--data-dir", dataDir],
		"enable.log",
	);
	const args = [
		path.join(resources, "scripts/enroll-agent-evaluation-runtime.mjs"),
		"--data-dir",
		dataDir,
		"--helper",
		helper,
		"--kernel",
		path.join(boot, "boot/Image"),
		"--initrd",
		path.join(boot, "boot/initramfs-virt"),
	];
	const first = JSON.parse(command(args, "enroll-first.log")),
		second = JSON.parse(command(args, "enroll-second.log"));
	assert.deepEqual(first, second);
	assert.equal(
		fs.realpathSync(path.join(dataDir, "plugins/agent-evaluation")),
		path.join(resources, "plugins/agent-evaluation"),
	);
	result.enrollment = first;
	result.guest = JSON.parse(
		command(["--input-type=module", "-e", `(${runGuest.toString()})()`, resources, dataDir], "guest.log"),
	);
	assert.equal(result.guest.status, "PASS");
	result.checks.push(
		"Actual shipped scripts, plugin assets and host module match source; packaged Electron Node enrollment repeats identically and runs a bounded pinned guest from installed copies",
	);
	const manifestPath = path.join(dataDir, "agent-evaluation-runtime/installation/enrollment.json");
	const manifestBytes = fs.readFileSync(manifestPath);
	const reservation = createServer().listen(0, "127.0.0.1");
	await once(reservation, "listening");
	const port = reservation.address().port;
	assert.ok(port >= 8900);
	await new Promise((done) => reservation.close(done));
	const launchOptions = {
		executablePath: exe,
		packaged: true,
		env: {
			...env,
			PI_DESKTOP_USER_DATA: userData,
			PI_WEB_CWD: workspace,
			PI_WEB_PORT: String(port),
			PI_WEB_PLUGIN_CATALOG_URL: "off",
			PI_WEB_SDK: "bundled",
		},
	};
	app = await launchNativeApp(launchOptions);
	const page = await app.firstWindow();
	await page.waitForSelector(".app");
	result.native = await app.evaluate(({ app }) => ({
		packaged: app.isPackaged,
		appPath: app.getAppPath(),
		userData: app.getPath("userData"),
	}));
	assert.equal(result.native.packaged, true);
	assert.equal(result.native.appPath, resources);
	assert.equal(result.native.userData, userData);
	await page.getByText("Agent evaluation", { exact: true }).first().click();
	await page.locator(".aev main").filter({ hasText: /pi:/ }).waitFor();
	await page.locator(".aev .status:empty").waitFor();
	assert.equal(await page.locator(".aev [role=alert]").innerText(), "");
	await page.screenshot({ path: path.join(output, "packaged-window.png") });
	result.checks.push(
		"Actual internal packaged Electron launches from its shipped app path with isolated HOME/userData and renders the application; no model or product external-execution UI invoked",
	);
	await app.close();
	fs.writeFileSync(path.join(output, "app.log"), app.getLogs());
	assert.ok(!app.getLogs().includes("[control] socket error"), "Packaged control socket starts at a bounded path");
	assert.ok(app.getLogs().includes("[plugin:agent-evaluation] activated (v0.4.34)"));
	app = undefined;
	app = await launchNativeApp(launchOptions);
	const reopened = await app.firstWindow();
	await reopened.waitForSelector(".app");
	await reopened.getByText("Agent evaluation", { exact: true }).first().click();
	await reopened.locator(".aev main").filter({ hasText: /pi:/ }).waitFor();
	await reopened.locator(".aev .status:empty").waitFor();
	assert.equal(await reopened.locator(".aev [role=alert]").innerText(), "");
	assert.deepEqual(fs.readFileSync(manifestPath), manifestBytes);
	await reopened.screenshot({ path: path.join(output, "packaged-reopened.png") });
	await app.close();
	fs.writeFileSync(path.join(output, "app-reopened.log"), app.getLogs());
	assert.ok(!app.getLogs().includes("[control] socket error"));
	app = undefined;
	result.checks.push(
		"Shipped evaluation page opens before and after native restart; immutable enrollment manifest remains byte-identical and the control socket has no startup error",
	);
	result.status = "PASS";
} catch (error) {
	result.status = "FAIL";
	result.error = String(error.stack ?? error);
	if (error.nativeLogs !== undefined) fs.writeFileSync(path.join(output, "app.log"), error.nativeLogs);
	if (error.nativeExit) result.nativeExit = error.nativeExit;
	throw error;
} finally {
	if (app) {
		try {
			await app.close();
		} finally {
			fs.writeFileSync(path.join(output, "app.log"), app.getLogs());
		}
	}
	fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
	console.log(JSON.stringify({ status: result.status, output, error: result.error }));
}
