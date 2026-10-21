import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchNativeApp } from "./native-app.mjs";

const resuming = process.argv[3] === "--resume";
const cancelOnly = process.argv.includes("--cancel");
const outputFlag = process.argv.indexOf("--output");
const output =
	outputFlag < 0
		? `docs/desktop-delivery/evidence/T17-native-picker${resuming ? "-restore" : ""}.json`
		: resolve(process.argv[outputFlag + 1]);
assert(!existsSync(output), "Preserve prior evidence; choose a new output path");
const fixture = resuming
	? realpathSync(process.argv[4])
	: realpathSync(mkdtempSync(join(tmpdir(), "pi-native-picker-")));
const workspace = resuming ? realpathSync(process.argv[5]) : join(fixture, "中文 workspace");
if (!resuming) mkdirSync(workspace);
const userData = join(fixture, "desktop");
const env = {
	...process.env,
	PI_DESKTOP_USER_DATA: userData,
	PI_WEB_PLUGIN_CATALOG_URL: "off",
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
};
for (const key of [
	"ELECTRON_RUN_AS_NODE",
	"PI_WEB_CWD",
	"PI_WEB_DATA_DIR",
	"PI_CODING_AGENT_DIR",
	"PI_WEB_DESKTOP_URL",
	"DEEPSEEK_API_KEY",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
])
	delete env[key];
const executablePath = resolve(process.argv[2]);
const checks = [];
let app, cancelChild;
let cancelLogs = "";
try {
	if (cancelOnly) {
		cancelChild = spawn(executablePath, [], { env, stdio: ["ignore", "pipe", "pipe"] });
		for (const stream of [cancelChild.stdout, cancelChild.stderr])
			stream.on("data", (d) => {
				cancelLogs += d;
			});
		const deadline = Date.now() + 900000;
		console.log("NATIVE_CANCEL_REQUIRED: owned process " + cancelChild.pid);
		while (cancelChild.exitCode === null && cancelChild.signalCode === null && Date.now() < deadline)
			await new Promise((r) => setTimeout(r, 250));
		assert.equal(cancelChild.signalCode, null, "Native cancellation must not terminate by signal");
		assert.equal(cancelChild.exitCode, 0, "Native cancellation exits normally within bounded wait");
		assert(!cancelLogs.includes("spawning server"), "Native cancellation must not start sidecar");
		assert(!existsSync(join(userData, "startup.json")), "Native cancellation must not persist workspace");
		checks.push({
			status: "PASS",
			check: "native first-run cancellation exits normally without sidecar or persisted workspace",
			pid: cancelChild.pid,
			exitCode: cancelChild.exitCode,
		});
	} else {
		if (!resuming) console.log("NATIVE_PICKER_REQUIRED: " + workspace);
		app = await launchNativeApp({ executablePath, packaged: true, env });
		await (await app.firstWindow()).waitForSelector(".app");
		const saved = JSON.parse(readFileSync(join(userData, "startup.json"), "utf8"));
		assert.equal(saved.workspace, workspace);
		checks.push({
			status: "PASS",
			check: resuming
				? "previous manually selected directory reopens in the installed application"
				: "unmodified native picker selection saves the real Chinese/space directory and loads the installed application",
			workspace: saved.workspace,
		});
		await app.close();
		app = undefined;
		app = await launchNativeApp({ executablePath, packaged: true, env });
		await (await app.firstWindow()).waitForSelector(".app");
		assert.equal(JSON.parse(readFileSync(join(userData, "startup.json"), "utf8")).workspace, workspace);
		checks.push({
			status: "PASS",
			check: "actual second launch restores the selected workspace without another picker interaction",
		});
	}
} catch (error) {
	checks.push({ status: "FAIL", error: error.stack });
	process.exitCode = 1;
} finally {
	await app?.close();
	if (cancelChild && cancelChild.exitCode === null && cancelChild.signalCode === null) {
		cancelChild.kill("SIGTERM");
		await new Promise((r) => cancelChild.once("exit", r));
	}
	if (cancelOnly) writeFileSync(output.replace(/\.json$/, "-process.log"), cancelLogs);
	const result = {
		fixture,
		executablePath,
		realModelRequests: 0,
		instrumentation: cancelOnly
			? "Original installed executable; unmodified native directory chooser; human cancellation; process exit, sidecar log and startup-file checks"
			: resuming
				? "follow-up restoration of the actual selection from the prior native chooser; does not establish Chinese path selection"
				: "native chooser is not replaced; requires human selection, then validates actual saved path and restarts",
		checks,
	};
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
