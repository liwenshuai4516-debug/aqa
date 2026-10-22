/**
 * 数据空间插件（data-space）协议面测试（零 token、自包含）。
 *
 * 覆盖：
 *   - 插件被宿主接受并激活（WS attach 触发扫描）；
 *   - GET /plugins-api/data-space/state 首次访问有内置示例（3 分组 / 4 数据集）并已落盘；
 *   - POST /save 带 baseRevision → revision+1，写入内容可读回；
 *   - 旧 baseRevision → 409 conflict 且回带最新快照（不做静默覆盖）；
 *   - client/ 下的视图文件可被浏览器 import（Content-Type: text/javascript）；
 *   - 重启服务后数据仍在（落 <dataDir>/data-space/store.json，不在插件目录）。
 *
 * 运行：node tests/data-space-plugin-test.mjs（单跑会先确保 dist 就绪）
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { distEntry, ensureBuild } from "./lib/ensure-build.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const PORT = 8921;
const BASE = `http://127.0.0.1:${PORT}`;
const PLUGIN_SRC = join(repoRoot, "plugins", "data-space");

ensureBuild(repoRoot, "data-space-plugin-test");

const dataDir = mkdtempSync(join(tmpdir(), "pi-web-data-space-"));
mkdirSync(join(dataDir, "plugins"), { recursive: true });
cpSync(PLUGIN_SRC, join(dataDir, "plugins", "data-space"), { recursive: true });
const storeFile = join(dataDir, "data-space", "store.json");

let proc = null;
let failures = 0;

function check(ok, msg, extra) {
	if (ok) console.log(`✓ ${msg}`);
	else {
		failures += 1;
		console.error(`✗ ${msg}${extra === undefined ? "" : ` → ${JSON.stringify(extra)}`}`);
	}
}

function startServer() {
	const p = spawn(process.execPath, [distEntry(repoRoot)], {
		env: { ...process.env, PI_WEB_PORT: String(PORT), PI_WEB_DATA_DIR: dataDir, PI_WEB_CWD: repoRoot },
		stdio: ["ignore", "pipe", "pipe"],
	});
	p.stderr.on("data", (d) => {
		const s = String(d);
		if (/data-space|plugin:.*(error|failed)/i.test(s)) process.stderr.write(`[server] ${s}`);
	});
	return p;
}

async function waitHealthy(timeoutMs = 25_000) {
	const t0 = Date.now();
	for (;;) {
		try {
			if ((await fetch(`${BASE}/api/health`)).ok) return;
		} catch {
			/* 还没起来 */
		}
		if (Date.now() - t0 > timeoutMs) throw new Error("server not ready");
		await new Promise((r) => setTimeout(r, 250));
	}
}

/** WS attach 才会触发插件扫描/激活（路由随之挂载）。 */
async function connectWs(clientId) {
	return new Promise((resolve, reject) => {
		const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
		const timer = setTimeout(() => reject(new Error("ws connect timeout")), 15_000);
		sock.on("open", () => sock.send(JSON.stringify({ type: "hello", clientId })));
		sock.on("message", (raw) => {
			let msg = null;
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return;
			}
			if (msg?.type === "ready" || msg?.type === "snapshot") {
				clearTimeout(timer);
				resolve(sock);
			}
		});
		sock.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

const getState = async () => {
	const r = await fetch(`${BASE}/plugins-api/data-space/state`);
	return { status: r.status, body: await r.json().catch(() => null) };
};

try {
	proc = startServer();
	await waitHealthy();
	const sock = await connectWs("data-space-test");
	await new Promise((r) => setTimeout(r, 900));

	// -- 首次访问：内置示例 + 已落盘 ------------------------------------------
	let { status, body: st } = await getState();
	check(status === 200 && st?.ok === true, "GET /state 返回 200 + ok", { status, ok: st?.ok });
	check((st?.groups?.length ?? 0) >= 3, "内置示例含分组", st?.groups?.length);
	check((st?.datasets?.length ?? 0) >= 4, "内置示例含数据集", st?.datasets?.length);
	check(existsSync(storeFile), "首次访问已把数据落盘到 <dataDir>/data-space/store.json", storeFile);
	check(typeof st?.dir === "string" && st?.file === storeFile, "快照回带数据文件路径", st?.file);

	// -- 视图 bundle 可被浏览器 import ---------------------------------------
	const bundle = await fetch(`${BASE}/plugins/data-space/client/entry.mjs`);
	check(
		bundle.status === 200 && /javascript/.test(bundle.headers.get("content-type") ?? ""),
		"client/entry.mjs 以 text/javascript 下发",
		{ status: bundle.status, ct: bundle.headers.get("content-type") },
	);
	const styleMod = await fetch(`${BASE}/plugins/data-space/client/style.mjs`);
	check(styleMod.status === 200, "client/style.mjs 可被相对 import", styleMod.status);

	// -- 保存：revision 递增，内容可读回 -------------------------------------
	const baseRevision = st.revision;
	const groups = st.groups;
	const datasets = [
		...st.datasets,
		{
			id: "probe-dataset",
			name: "探针数据集",
			groupId: st.groups[0]?.id ?? "",
			env: "测试环境",
			tags: ["冒烟"],
			note: "测试用例创建",
			records: [{ id: "probe-record", key: "account", value: "probe_user", remark: "" }],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		},
	];
	let r = await fetch(`${BASE}/plugins-api/data-space/save`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ baseRevision, groups, datasets }),
	});
	let saved = await r.json().catch(() => null);
	check(r.status === 200 && saved?.ok === true, "POST /save 保存成功", { status: r.status });
	check(saved?.revision === baseRevision + 1, "revision 递增 1", { from: baseRevision, to: saved?.revision });
	check(
		saved?.datasets?.some((d) => d.id === "probe-dataset" && d.records?.[0]?.value === "probe_user"),
		"新增数据集与记录读回一致",
	);

	// -- 旧 revision：409 + 最新快照（不静默覆盖） ----------------------------
	r = await fetch(`${BASE}/plugins-api/data-space/save`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ baseRevision, groups, datasets }),
	});
	const conflict = await r.json().catch(() => null);
	check(r.status === 409 && conflict?.code === "conflict", "旧 baseRevision 返回 409 conflict", {
		status: r.status,
		code: conflict?.code,
	});
	check(conflict?.store?.revision === baseRevision + 1, "冲突响应回带最新快照", conflict?.store?.revision);

	// -- 缺 baseRevision：400 -------------------------------------------------
	r = await fetch(`${BASE}/plugins-api/data-space/save`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ groups, datasets }),
	});
	check(r.status === 400, "缺 baseRevision 返回 400", r.status);

	// -- 落盘内容与内存一致 ---------------------------------------------------
	const onDisk = JSON.parse(readFileSync(storeFile, "utf8"));
	check(
		onDisk?.datasets?.some((d) => d.id === "probe-dataset") && onDisk.revision === baseRevision + 1,
		"store.json 内容与内存快照一致",
		{ revision: onDisk?.revision },
	);

	// -- 重启后仍在（数据活在外面的数据目录） --------------------------------
	sock.close();
	proc.kill();
	await new Promise((r2) => setTimeout(r2, 600));
	proc = startServer();
	await waitHealthy();
	const sock2 = await connectWs("data-space-test-2");
	await new Promise((r2) => setTimeout(r2, 900));
	({ status, body: st } = await getState());
	check(status === 200 && st?.datasets?.some((d) => d.id === "probe-dataset"), "重启服务后数据仍在", {
		status,
		count: st?.datasets?.length,
	});
	check(st?.revision === baseRevision + 1, "revision 随落盘保留", st?.revision);

	// -- reset 需确认，确认后回到示例 ----------------------------------------
	r = await fetch(`${BASE}/plugins-api/data-space/reset`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({}),
	});
	check(r.status === 400, "reset 缺 confirm 返回 400", r.status);
	r = await fetch(`${BASE}/plugins-api/data-space/reset`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ confirm: true }),
	});
	const reset = await r.json().catch(() => null);
	check(
		r.status === 200 && !reset?.datasets?.some((d) => d.id === "probe-dataset") && reset?.datasets?.length >= 4,
		"reset 恢复示例数据且移除探针数据",
		{ status: r.status, count: reset?.datasets?.length },
	);
	sock2.close();
} catch (err) {
	failures += 1;
	console.error(`✗ 用例执行异常：${err instanceof Error ? err.message : String(err)}`);
} finally {
	try {
		proc?.kill();
	} catch {
		/* 已退出 */
	}
	rmSync(dataDir, { recursive: true, force: true });
	if (failures) {
		console.error(`\n${failures} 项断言失败`);
		process.exitCode = 1;
	} else {
		console.log("\n数据空间插件协议面测试全部通过");
	}
}
