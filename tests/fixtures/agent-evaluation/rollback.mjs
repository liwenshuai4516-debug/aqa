/** Native plugin rollback and full isolated userData restore. Never modifies the checkout or personal installation. */
import assert from "node:assert/strict";
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, symlink, unlink, writeFile } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import electron from "electron";
import { launchNativeApp } from "../../desktop/native-app.mjs";
import { reopenOfflineImport } from "./offline-import.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (root, args) => execFileSync("git", ["-C", root, ...args], { maxBuffer: 8 * 1024 ** 2 });
const copy = (source, destination) =>
	cp(source, destination, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
export async function installRollbackFixture(repo, dataDir, agentDir) {
	const plugin = join(dataDir, "plugins/agent-evaluation");
	assert.ok((await lstat(plugin)).isSymbolicLink());
	await unlink(plugin);
	await copy(join(repo, "plugins/agent-evaluation"), plugin);
	await symlink(join(repo, "node_modules"), join(dataDir, "node_modules"), "dir");
	const settingsPath = join(agentDir, "settings.json"),
		settings = JSON.parse(await readFile(settingsPath, "utf8"));
	const source = join(repo, "plugins/agent-evaluation/skills/agent-evaluation"),
		installed = join(plugin, "skills/agent-evaluation");
	assert.equal(settings.skills.filter((entry) => entry === source).length, 1);
	settings.skills = settings.skills.map((entry) => (entry === source ? installed : entry));
	await writeFile(settingsPath, JSON.stringify(settings, null, "\t") + "\n", { mode: 0o600 });
}
async function manifest(root) {
	const rows = [];
	async function scan(directory) {
		for (const name of (await readdir(directory)).sort()) {
			const file = join(directory, name),
				stat = await lstat(file),
				path = relative(root, file);
			if (stat.isSymbolicLink()) rows.push({ path, type: "symlink", target: await readlink(file) });
			else if (stat.isDirectory()) {
				rows.push({ path, type: "directory", mode: stat.mode & 0o777 });
				await scan(file);
			} else {
				assert.ok(stat.isFile(), `Unexpected special file in stopped fixture: ${path}`);
				const bytes = await readFile(file);
				rows.push({ path, type: "file", bytes: bytes.length, mode: stat.mode & 0o777, sha256: sha(bytes) });
			}
		}
	}
	await scan(root);
	return rows;
}
export async function verifyRollback({
	app: originalApp,
	page: originalPage,
	repo,
	output,
	userData,
	dataDir,
	env,
	sessionPath,
	original,
	offline,
	until,
}) {
	let app = originalApp,
		page = originalPage;
	const result = {
		status: "running",
		scope:
			"macOS arm64 actual Electron, plugin-only 0.4.24 -> 0.4.19 revert; explicit unsupported 0.4.18 and complete same-path userData restore",
		phases: [],
		actualModelCalls: 0,
		actualCliCalls: 0,
	};
	const directory = join(output, "rollback");
	await mkdir(directory);
	const store = join(dataDir, "agent-evaluation"),
		baselineStore = await manifest(store),
		identity = await readFile(join(userData, "client-identity")),
		sessionBytes = await readFile(sessionPath);
	assert.equal(identity.toString().trim(), original.domain.principalId);
	const phase = async (name) => {
		result.phase = name;
		await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2));
		console.log(`rollback: ${name}`);
	};
	const stop = async (name) => {
		if (!app) return;
		await writeFile(join(directory, `${name}-app.log`), app.getLogs());
		const process = app.process();
		await app.close();
		assert.ok(
			process.exitCode !== null || process.signalCode !== null,
			"Native process must be terminal before backing up or replacing files",
		);
		app = undefined;
		// A clean service stop releases the evaluation writer. Do not touch a live lock.
		await assert.rejects(lstat(join(store, "writer.lock")), { code: "ENOENT" });
	};
	async function sourceVersion(source, commit) {
		const files = git(repo, ["ls-tree", "-r", "--name-only", commit, "plugins/agent-evaluation"])
			.toString()
			.trim()
			.split("\n");
		for (const file of files) {
			const path = join(source, file);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, git(repo, ["show", `${commit}:${file}`]));
		}
		return join(source, "plugins/agent-evaluation");
	}
	async function launch(version) {
		app = await launchNativeApp({
			executablePath: electron,
			packaged: false,
			env,
			mainPath: join(repo, "dist/desktop/main.js"),
		});
		page = await app.firstWindow();
		await page.waitForSelector(".app");
		await page.addInitScript(() => {
			const Native = window.WebSocket;
			window.__evaluationFrames = [];
			window.WebSocket = class extends Native {
				constructor(...args) {
					super(...args);
					if (String(args[0]).includes("/ws")) {
						window.__evaluationSocket = this;
						this.addEventListener("message", (e) => {
							try {
								window.__evaluationFrames.push(JSON.parse(e.data));
							} catch {}
						});
					}
				}
			};
		});
		await page.reload();
		await page.waitForSelector(".app");
		await until(() =>
			page.evaluate(
				(version) =>
					window.__evaluationFrames.some(
						(f) =>
							f.type === "plugins" &&
							f.plugins.some((p) => p.id === "agent-evaluation" && p.version === version && p.active),
					),
				version,
			),
		);
		const offset = await page.evaluate(() => window.__evaluationFrames.length);
		await page.evaluate(
			(path) => window.__evaluationSocket.send(JSON.stringify({ type: "switch_session", path })),
			sessionPath,
		);
		await until(() =>
			page.evaluate(
				({ offset, path }) =>
					window.__evaluationFrames
						.slice(offset)
						.some((f) => f.type === "transition_progress" && f.phase === "done" && f.target === path),
				{ offset, path: sessionPath },
			),
		);
		await until(() => page.locator(".msg").filter({ hasText: "synthetic offline fixture" }).count());
		await page.getByText("Agent evaluation", { exact: true }).first().click();
		await page.locator(".aev").waitFor();
		await page.locator('.aev [data-action="refresh"]:not([disabled])').click();
		assert.deepEqual(await readFile(join(userData, "client-identity")), identity);
		return page;
	}
	async function openOriginal() {
		await page.locator(`.aev [data-action="open"][data-id="${original.id}"]:not([disabled])`).click();
		const artifact = page.locator(".aev article").filter({ has: page.locator("h3", { hasText: "F01" }) });
		await artifact.locator("summary", { hasText: "Human reviews" }).click();
		assert.match(await artifact.innerText(), /Original verdict: Pass/);
		assert.match(await artifact.innerText(), /Manual semantic review is still needed/);
		await artifact.locator('[data-action="evidence"]').first().click();
		await page.locator('.aev [data-action="evidence-artifact"]').click();
		await until(async () => (await page.locator(".aev [data-evidence-panel] pre").innerText()) === '{"ok":true}');
		assert.equal(await page.locator(".aev [role=alert]").innerText(), "");
	}
	const unchanged = async () => {
		assert.deepEqual(await manifest(store), baselineStore);
		assert.deepEqual(await readFile(join(userData, "client-identity")), identity);
		assert.deepEqual(await readFile(sessionPath), sessionBytes);
	};
	try {
		await phase("stop and back up full userData");
		await stop("current");
		// Refresh only after the controlled clean stop; locks are not part of durable evidence.
		baselineStore.splice(0, baselineStore.length, ...(await manifest(store)));
		const before = await manifest(userData),
			backup = join(directory, "full-userData-backup");
		await copy(userData, backup);
		assert.deepEqual(await manifest(backup), before);
		await writeFile(join(directory, "backup-manifest.json"), JSON.stringify(before, null, 2));
		result.backup = {
			path: backup,
			entries: before.length,
			manifestSha256: sha(JSON.stringify(before)),
			exactCopy: true,
			scope:
				"Entire stopped isolated userData, including installed plugin, SDK settings/history, native identity and Chromium state; dependency symlink preserved, not traversed",
		};
		const code = join(directory, "revert-code");
		git(repo, ["clone", "--shared", "--no-checkout", repo, code]);
		git(code, ["sparse-checkout", "set", "plugins/agent-evaluation"]);
		git(code, ["checkout", "--detach", "3fe28c5fc7268ce6c15bdf1c70dd286f644be5d4"]);
		git(code, ["revert", "--no-commit", "3fe28c5fc7268ce6c15bdf1c70dd286f644be5d4"]);
		const hostChanges = git(repo, [
			"diff",
			"--name-only",
			"e575285",
			"3fe28c5",
			"--",
			"server",
			"desktop",
			"web",
		]).toString();
		assert.equal(hostChanges, "", "Plugin-only rollback requires an unchanged host boundary");
		assert.equal(
			JSON.parse(await readFile(join(code, "plugins/agent-evaluation/manifest.json"), "utf8")).version,
			"0.4.19",
		);
		const expected19 = await sourceVersion(join(directory, "expected-0419"), "e575285");
		assert.deepEqual(await manifest(join(code, "plugins/agent-evaluation")), await manifest(expected19));
		result.revert = {
			command: ["git", "revert", "--no-commit", "3fe28c5fc7268ce6c15bdf1c70dd286f644be5d4"],
			isolatedClone: code,
			expectedSource: "e575285",
			exactPluginTree: true,
			hostSourceUnchanged: true,
		};
		const catalog = JSON.parse(await readFile(join(repo, "plugins/catalog.json"), "utf8"));
		assert.equal(
			catalog.some((p) => p.id === "agent-evaluation"),
			false,
			"Do not allow automatic builtin upgrade to conceal a rollback",
		);
		async function replacePlugin(source, name) {
			await rename(join(dataDir, "plugins/agent-evaluation"), join(directory, name));
			await copy(source, join(dataDir, "plugins/agent-evaluation"));
			assert.deepEqual(await manifest(join(dataDir, "plugins/agent-evaluation")), await manifest(source));
		}
		await phase("compatible revert to 0.4.19");
		await replacePlugin(join(code, "plugins/agent-evaluation"), "retained-plugin-0423");
		await launch("0.4.19");
		await openOriginal();
		await page.screenshot({ path: join(directory, "compatible-rollback.png") });
		await stop("compatible");
		await unchanged();
		result.phases.push({
			version: "0.4.19",
			status: "PASS",
			scope:
				"Original Pi report, separate human review and sealed file readable; offline records/private package retained exactly for re-upgrade; old version has no upload/original UI",
		});
		// Restore the complete original userData to the same path, retaining each retired tree.
		async function restore(name) {
			await rename(userData, join(directory, `retained-userData-${name}`));
			await copy(backup, userData);
			assert.deepEqual(await manifest(userData), before);
			await unchanged();
		}
		await phase("complete backup restore and current-version reopen");
		await restore("compatible");
		await launch("0.4.24");
		await openOriginal();
		await reopenOfflineImport({ page, until, fixture: offline });
		await page.screenshot({ path: join(directory, "restored-private-original.png") });
		await stop("restored");
		await unchanged();
		result.phases.push({
			version: "0.4.24",
			status: "PASS",
			scope:
				"Exact complete userData restore before launch; Pi report/review/sealed file and human-confirmed offline original reopen without new evidence/attempt/snapshot/report/review",
		});
		await phase("unsupported older format preserves data and refuses");
		const old18 = await sourceVersion(join(directory, "unsupported-0418"), "12e0128");
		await replacePlugin(old18, "retained-plugin-restored-0423");
		await launch("0.4.18");
		await openOriginal();
		await page.locator('.aev [data-action="back"]').click();
		await page.locator('.aev [data-action="new"]:not([disabled])').click();
		await page.locator('.aev [name="objective"]').fill("Unsupported format must block a new diagnosis");
		await page.locator('.aev [name="paths"]').fill("result.json");
		await page.locator('.aev button[type="submit"]').click();
		await until(async () => (await page.locator(".aev [role=alert]").innerText()).includes("STORE_CORRUPT"));
		const rejection = await page.locator(".aev [role=alert]").innerText();
		assert.match(rejection, /STORE_CORRUPT/);
		assert.equal(await page.locator(".aev article h3").count(), 0);
		await page.screenshot({ path: join(directory, "unsupported-format.png") });
		await stop("unsupported");
		await unchanged();
		result.phases.push({
			version: "0.4.18",
			status: "EXPECTED_REJECTION",
			rejection,
			scope:
				"Supported Pi history remains readable; unknown offline records block a new diagnosis with STORE_CORRUPT, no rewrite/delete/replay",
		});
		await phase("restore after unsupported downgrade");
		await restore("unsupported");
		await launch("0.4.24");
		await openOriginal();
		await reopenOfflineImport({ page, until, fixture: offline });
		// Close before final immutable-tree verification; return a fresh current process for the caller's remaining checks.
		await stop("final-restored");
		await unchanged();
		result.phases.push({
			version: "0.4.24",
			status: "PASS",
			scope:
				"Second full restore returns original identity, Pi report/review/sealed file and original offline bytes; all durable evaluation and seeded SDK files unchanged",
		});
		await launch("0.4.24");
		await openOriginal();
		result.status = "PASS";
		result.immutableStoreManifest = baselineStore;
		result.identitySha256 = sha(identity);
		result.seededSessionSha256 = sha(sessionBytes);
		await phase("complete");
		return { app, page, result };
	} catch (error) {
		result.status = "FAIL";
		result.error = error.stack;
		await page?.screenshot({ path: join(directory, "failure.png") }).catch(() => {});
		if (page)
			await writeFile(
				join(directory, "failure-frames.json"),
				JSON.stringify(await page.evaluate(() => window.__evaluationFrames ?? []).catch(() => [])),
			);
		if (app) {
			await writeFile(join(directory, "failure-app.log"), app.getLogs());
			await app.close();
			app = undefined;
		}
		throw error;
	} finally {
		await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2));
	}
}
