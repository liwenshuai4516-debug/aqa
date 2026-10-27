/** Real filesystem denial/ENOSPC on an owned 64MiB volume, through the original Electron service. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { openSync, closeSync, writeSync, fsyncSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, statfs, unlink, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

export async function prepareStorageFaultVolume(output) {
	assert.equal(process.platform, "darwin");
	const mount = await mkdtemp("/private/tmp/ec04v-"),
		image = join(output, "fault-volume.dmg");

	const create = execFileSync("hdiutil", ["create", "-size", "64m", "-fs", "HFS+", "-volname", "EC04Fault", image], {
		encoding: "utf8",
	});
	const attach = execFileSync("hdiutil", ["attach", image, "-mountpoint", mount, "-nobrowse"], { encoding: "utf8" });
	await writeFile(join(output, "volume-setup.log"), create + attach);
	let mounted = true;
	const close = () => {
		if (!mounted) return;
		const detached = execFileSync("hdiutil", ["detach", mount], { encoding: "utf8" });
		mounted = false;
		process.removeListener("exit", close);
		return detached;
	};
	process.once("exit", close);
	return { mount, dataDir: join(mount, "data"), close };
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function verifyStorageFault({ page, output, dataDir, volume, original, until }) {
	const root = join(dataDir, "agent-evaluation"),
		contracts = join(root, "contracts");
	const originalFile = join(root, "evaluations", `${original.id}.${original.revision}.json`),
		originalBytes = await readFile(originalFile);
	const contract = JSON.parse(
		await readFile(
			join(contracts, `${original.data.contractRef.id}.${original.data.contractRef.revision}.json`),
			"utf8",
		),
	);
	async function rpc(request) {
		const offset = await page.evaluate(() => window.__evaluationFrames.length);
		await page.evaluate(
			(payload) =>
				window.__evaluationSocket.send(
					JSON.stringify({ type: "plugin_message", pluginId: "agent-evaluation", payload }),
				),
			request,
		);
		let reply;
		await until(async () => {
			reply = await page.evaluate(
				({ offset, id }) =>
					window.__evaluationFrames.slice(offset).find((f) => f.type === "plugin_data" && f.payload?.requestId === id)
						?.payload,
				{ offset, id: request.requestId },
			);
			return !!reply;
		});
		return reply;
	}
	// Reauthorize the original Pi source after the ordinary offline-import regression.
	await page.evaluate(() =>
		window.__evaluationSocket.send(JSON.stringify({ type: "switch_session", path: window.__storageSourcePath })),
	);
	let source;
	await until(async () => {
		const reply = await rpc({ action: "describe", requestId: crypto.randomUUID() });
		source = reply.result;
		return source?.sessionId === contract.data.scope.sessionId;
	});
	const bound = { conversationId: source.conversationId, sessionId: source.sessionId };
	async function openForm(label) {
		if (await page.locator('.aev [data-action="back"]').count())
			await page.locator('.aev [data-action="back"]').first().click();
		await page.locator('.aev [data-action="new"]:not([disabled])').click();
		await page.locator('.aev [name="objective"]').fill(label);
	}
	async function deniedForm(label, code = "IO_ERROR") {
		await openForm(label);
		await page.locator('.aev button[type="submit"]').click();
		await until(async () => (await page.locator('.aev [role="alert"]').innerText()).includes(code));
		assert.equal(await page.locator('.aev [name="objective"]').inputValue(), label);
		await page.screenshot({ path: join(output, `${label}.png`) });
	}
	const before = (await readdir(contracts)).sort();
	const deniedRequest = {
		action: "createContract",
		requestId: crypto.randomUUID(),
		...bound,
		data: { ...contract.data, objective: "Filesystem EACCES raw control" },
	};
	await chmod(contracts, 0o500);
	try {
		await assert.rejects(writeFile(join(contracts, "permission-probe"), "owned"), { code: "EACCES" });
		const denied = await rpc(deniedRequest);
		assert.equal(denied.ok, false);
		assert.equal(denied.error.code, "IO_ERROR");
		await deniedForm("filesystem-permission-denied");
		assert.deepEqual((await readdir(contracts)).sort(), before);
		assert.deepEqual(await readFile(originalFile), originalBytes);
	} finally {
		await chmod(contracts, 0o700);
	}
	const recovered = await rpc(deniedRequest);
	assert.equal(recovered.ok, true, JSON.stringify(recovered.error));
	assert.deepEqual(await rpc(deniedRequest), recovered);
	assert.equal((await readdir(contracts)).length, before.length + 1);

	const filler = join(volume.mount, "owned-reserve.bin"),
		fd = openSync(filler, "wx", 0o600),
		block = Buffer.alloc(65536, 0x65);
	let filledBytes = 0,
		fullError;
	try {
		for (const size of [block.length, 4096, 1]) {
			while (filledBytes < 64 * 1024 ** 2) {
				try {
					filledBytes += writeSync(fd, block, 0, size);
				} catch (error) {
					if (error.code !== "ENOSPC") throw error;
					fullError = error.code;
					break;
				}
			}
		}
		assert.equal(fullError, "ENOSPC", "Only the bounded test volume may be filled");
		try {
			fsyncSync(fd);
		} catch (error) {
			assert.equal(error.code, "ENOSPC");
		}
	} finally {
		closeSync(fd);
	}
	const fullStat = await statfs(volume.mount),
		preFull = (await readdir(contracts)).sort();
	assert.equal(fullStat.bavail, 0, "The owned volume must have no available blocks");
	const fullRequest = {
		...deniedRequest,
		requestId: crypto.randomUUID(),
		data: { ...contract.data, objective: "Physical bounded volume ENOSPC" },
	};
	let fullReply,
		retained = [];
	try {
		await assert.rejects(writeFile(join(volume.mount, "full-probe"), Buffer.alloc(65536)), { code: "ENOSPC" });
		fullReply = await rpc(fullRequest);
		assert.equal(fullReply.ok, false);
		assert.equal(fullReply.error.code, "IO_ERROR");
		assert.equal((await readdir(contracts)).filter((n) => n.endsWith(".json")).length, preFull.length);
		const partial = (await readdir(contracts)).filter((name) => !preFull.includes(name));
		await deniedForm("filesystem-disk-full", partial.length ? "STORE_CORRUPT" : "IO_ERROR");
		assert.deepEqual(await readFile(originalFile), originalBytes);
	} finally {
		await unlink(filler);
	}
	// Retain incomplete originals before explicitly removing only this run's uncommitted files.
	for (const name of await readdir(contracts))
		if (!preFull.includes(name)) {
			assert.match(name, /\.json\.tmp-[a-f0-9-]+$/);
			const path = join(contracts, name),
				bytes = await readFile(path),
				destination = join(output, `retained-${name}`);
			await copyFile(path, destination);
			assert.deepEqual(await readFile(destination), bytes);
			retained.push({ name, bytes: bytes.length, sha256: sha(bytes) });
			await unlink(path);
		}
	const epoch = await page.evaluate(() =>
		Math.max(...window.__evaluationFrames.filter((f) => f.type === "plugins").map((f) => f.epoch ?? 0)),
	);
	await page.evaluate(() => window.__evaluationSocket.send(JSON.stringify({ type: "plugins_reload" })));
	await until(() =>
		page.evaluate(
			(epoch) =>
				window.__evaluationFrames.some(
					(f) =>
						f.type === "plugins" &&
						f.epoch > epoch &&
						f.plugins.some(
							(p) =>
								p.id === "agent-evaluation" &&
								p.version === "0.4.34" &&
								p.agentTools?.some((t) => t.name === "agent_evaluation"),
						),
				),
			epoch,
		),
	);
	const fullRecovered = await rpc(fullRequest);
	assert.equal(fullRecovered.ok, true, JSON.stringify(fullRecovered.error));
	assert.deepEqual(await rpc(fullRequest), fullRecovered);
	assert.equal((await readdir(contracts)).filter((n) => n.endsWith(".json")).length, preFull.length + 1);
	assert.deepEqual(await readFile(originalFile), originalBytes);
	const read = await rpc({
		action: "get",
		requestId: crypto.randomUUID(),
		...bound,
		ref: { kind: original.kind, id: original.id, revision: original.revision },
	});
	assert.equal(read.ok, true);
	assert.equal(read.result.id, original.id);
	const result = {
		status: "PASS",
		actualErrnos: ["EACCES", fullError],
		filledBytes,
		fullStat: { bsize: fullStat.bsize, bavail: fullStat.bavail },
		permissionRequest: deniedRequest,
		permissionRetry: recovered.result,
		fullRequest,
		fullReply,
		fullRetry: fullRecovered.result,
		retained,
		formValuesRetained: true,
		originalReportUnchanged: true,
		explicitRecovery: true,
		actualModelCalls: 0,
		actualCliCalls: 0,
	};
	await writeFile(join(output, "storage-fault-result.json"), JSON.stringify(result, null, 2));
	return result;
}
