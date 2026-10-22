/**
 * 数据空间插件（data-space）协议面测试（零 token、自包含）。
 *
 * 覆盖：
 *   - 插件被宿主接受并激活（WS attach 触发扫描）；
 *   - GET /state 首次访问有内置示例（项目 / 模块 / 功能 / 用例 / 数据集）并已落盘；
 *   - 用例类型只支持接口 / UI 两类，快照下发 caseTypes；空类型补默认值，未知类型不清洗；
 *   - POST /save 带 baseRevision → revision+1，层级与用例内容可读回；
 *   - 悬空父引用被清洗：用例挂不存在的功能 → featureId 置空；模块挂不存在的系统 → 丢弃；
 *     用例引用不存在的数据集 → 从 datasetIds 里剔除；
 *   - 旧 baseRevision → 409 conflict 且回带最新快照（不做静默覆盖）；缺 baseRevision → 400；
 *   - client/ 下的视图文件可被浏览器 import（Content-Type: text/javascript）；
 *   - 重启服务后数据仍在（落 <dataDir>/data-space/store.json，不在插件目录）；
 *   - 0.1.0 的 groups + datasets 旧库启动时自动迁移成 systems + datasets（featureId 空），
 *     并留下 store.json.v1-<时间戳>.bak 备份；
 *   - POST /reset 需 confirm:true，确认后回到示例数据。
 *
 * 运行：node tests/data-space-plugin-test.mjs（单跑会先确保 dist 就绪）
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { distEntry, ensureBuild } from "./lib/ensure-build.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const PORT = 8921;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/plugins-api/data-space`;
const PLUGIN_SRC = join(repoRoot, "plugins", "data-space");
const CLIENT_FILES = [
	"entry.mjs",
	"state.mjs",
	"views.mjs",
	"style.mjs",
	"path-select.mjs",
	"modal-case.mjs",
	"modal-node.mjs",
	"modal-dataset.mjs",
	"brief.mjs",
	"modal-brief.mjs",
];

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
	const r = await fetch(`${API}/state`);
	return { status: r.status, body: await r.json().catch(() => null) };
};

const postJson = async (path, body) => {
	const r = await fetch(`${API}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return { status: r.status, body: await r.json().catch(() => null) };
};

const iso = () => new Date().toISOString();

async function stopServer(sock) {
	try {
		sock?.close();
	} catch {
		/* 已断开 */
	}
	proc?.kill();
	await new Promise((r) => setTimeout(r, 700));
}

async function bootServer(clientId) {
	proc = startServer();
	await waitHealthy();
	const sock = await connectWs(clientId);
	await new Promise((r) => setTimeout(r, 900));
	return sock;
}

try {
	let sock = await bootServer("data-space-test");

	// -- 首次访问：内置示例（三层结构）+ 已落盘 ------------------------------
	let { status, body: st } = await getState();
	check(status === 200 && st?.ok === true, "GET /state 返回 200 + ok", { status, ok: st?.ok });
	check((st?.systems?.length ?? 0) >= 5, "示例含 5 个以上项目", st?.systems?.length);
	check((st?.modules?.length ?? 0) >= 7, "示例含 7 个以上模块", st?.modules?.length);
	check((st?.features?.length ?? 0) >= 14, "示例含 14 个以上功能", st?.features?.length);
	check((st?.cases?.length ?? 0) >= 18, "示例含 18 条以上用例", st?.cases?.length);
	check((st?.datasets?.length ?? 0) >= 5, "示例含 5 份以上数据集", st?.datasets?.length);
	check(
		JSON.stringify(st?.caseTypes) === JSON.stringify(["接口", "UI"]),
		"快照下发用例类型清单（接口 / UI）",
		st?.caseTypes,
	);
	check(
		(st?.cases ?? []).every((c) => ["接口", "UI"].includes(c.type)),
		"示例用例类型都在接口 / UI 两类内",
		[...new Set((st?.cases ?? []).map((c) => c.type))],
	);
	check(
		(st?.systems ?? []).some((s) => s.id === "sys-cts") && (st?.systems ?? []).some((s) => s.id === "sys-bms"),
		"示例新增客服热线 / 收费管理两个项目（用于演示列表与搜索）",
	);
	check(
		(st?.features ?? []).every((f) => (st.modules ?? []).some((m) => m.id === f.moduleId)),
		"每个功能都挂在已存在的模块下",
	);
	check(
		(st?.features ?? []).some((f) => !(st.cases ?? []).some((c) => c.featureId === f.id)),
		"示例里保留了覆盖缺口（存在没有用例的功能）",
	);
	check(existsSync(storeFile), "首次访问已把数据落盘到 <dataDir>/data-space/store.json", storeFile);
	check(typeof st?.dir === "string" && st?.file === storeFile, "快照回带数据文件路径", st?.file);
	check(st?.limits?.cases >= 1000, "快照回带容量上限", st?.limits?.cases);
	check(
		Array.isArray(st?.systems) && JSON.parse(readFileSync(storeFile, "utf8")).version === 2,
		"落盘文件为 version 2",
	);

	// -- 视图文件可被浏览器 import -------------------------------------------
	for (const name of CLIENT_FILES) {
		const r = await fetch(`${BASE}/plugins/data-space/client/${name}`);
		check(
			r.status === 200 && /javascript/.test(r.headers.get("content-type") ?? ""),
			`client/${name} 以 text/javascript 下发`,
			{ status: r.status, ct: r.headers.get("content-type") },
		);
	}

	// -- 保存：新增系统 / 模块 / 功能 / 用例 / 数据集 -------------------------
	const baseRevision = st.revision;
	const systemId = "probe-system";
	const moduleId = "probe-module";
	const featureId = "probe-feature";
	const stamp = iso();
	const nextSystems = [
		...st.systems,
		{ id: systemId, name: "探针系统", code: "tst", color: "teal", note: "", createdAt: stamp },
	];
	const nextModules = [
		...st.modules,
		{ id: moduleId, systemId, name: "探针模块", note: "", createdAt: stamp },
		// 父系统不存在 → 应被丢弃
		{ id: "ghost-module", systemId: "ghost-system", name: "悬空模块", note: "", createdAt: stamp },
	];
	const nextFeatures = [
		...st.features,
		{ id: featureId, moduleId, name: "探针功能", note: "", createdAt: stamp },
		// 父模块不存在 → 应被丢弃
		{ id: "ghost-feature", moduleId: "ghost-module", name: "悬空功能", note: "", createdAt: stamp },
	];
	const nextDatasets = [
		...st.datasets,
		{
			id: "probe-dataset",
			featureId,
			name: "探针数据集",
			env: "测试环境",
			tags: ["冒烟"],
			note: "测试用例创建",
			records: [{ id: "probe-record", key: "account", value: "probe_user", remark: "" }],
			createdAt: stamp,
			updatedAt: stamp,
		},
	];
	const nextCases = [
		...st.cases,
		{
			id: "probe-case",
			featureId,
			code: "TST-001",
			title: "探针用例-可保存",
			priority: "P0",
			type: "UI",
			status: "待评审",
			owner: "测试",
			tags: ["冒烟", "探针"],
			preconditions: "已登录",
			steps: [
				{ id: "s1", action: "打开列表", expect: "列表加载完成" },
				{ id: "s2", action: "点击新建", expect: "弹出表单" },
			],
			datasetIds: ["probe-dataset", "ghost-dataset"],
			note: "",
			createdAt: stamp,
			updatedAt: stamp,
		},
		{
			id: "ghost-case",
			featureId: "ghost-feature",
			code: "",
			title: "悬空用例",
			priority: "P9",
			type: "不存在",
			status: "不存在",
			owner: "",
			tags: [],
			preconditions: "",
			steps: [],
			datasetIds: [],
			note: "",
			createdAt: stamp,
			updatedAt: stamp,
		},
		{
			id: "blank-type-case",
			featureId,
			code: "TST-002",
			title: "空类型用例",
			priority: "P2",
			type: "   ",
			status: "草稿",
			owner: "",
			tags: [],
			preconditions: "",
			steps: [],
			datasetIds: [],
			note: "",
			createdAt: stamp,
			updatedAt: stamp,
		},
	];
	let saved = await postJson("/save", {
		baseRevision,
		systems: nextSystems,
		modules: nextModules,
		features: nextFeatures,
		cases: nextCases,
		datasets: nextDatasets,
	});
	check(saved.status === 200 && saved.body?.ok === true, "POST /save 保存成功", { status: saved.status });
	check(saved.body?.revision === baseRevision + 1, "revision 递增 1", { from: baseRevision, to: saved.body?.revision });

	const after = saved.body ?? {};
	const probeCase = (after.cases ?? []).find((c) => c.id === "probe-case");
	check(Boolean(probeCase) && probeCase.featureId === featureId, "新建用例挂在探针功能下", probeCase?.featureId);
	check(
		probeCase?.steps?.length === 2 && probeCase.steps[0].expect === "列表加载完成",
		"步骤与预期读回一致",
		probeCase?.steps?.length,
	);
	check(
		probeCase?.priority === "P0" && probeCase?.status === "待评审" && probeCase?.type === "UI",
		"优先级 / 状态 / 类型读回一致",
		{
			priority: probeCase?.priority,
			status: probeCase?.status,
			type: probeCase?.type,
		},
	);
	check(
		JSON.stringify(probeCase?.datasetIds) === JSON.stringify(["probe-dataset"]),
		"引用不存在的数据集被剔除",
		probeCase?.datasetIds,
	);
	check(
		(after.systems ?? []).find((s) => s.id === systemId)?.code === "TST",
		"系统编号前缀大写归一",
		(after.systems ?? []).find((s) => s.id === systemId)?.code,
	);
	check(!(after.modules ?? []).some((m) => m.id === "ghost-module"), "父系统不存在的模块被丢弃");
	check(!(after.features ?? []).some((f) => f.id === "ghost-feature"), "父模块不存在的功能被丢弃");
	const ghostCase = (after.cases ?? []).find((c) => c.id === "ghost-case");
	check(ghostCase?.featureId === "", "用例挂不存在功能时 featureId 置空（变未归类）", ghostCase?.featureId);
	check(ghostCase?.priority === "P2", "非法优先级回落到默认值 P2", ghostCase?.priority);
	check(ghostCase?.type === "不存在", "未知用例类型保留原值（开放词表，不清洗）", ghostCase?.type);
	const blankType = (after.cases ?? []).find((c) => c.id === "blank-type-case");
	check(blankType?.type === "接口", "空用例类型补默认值「接口」", blankType?.type);
	check(
		(after.datasets ?? []).find((d) => d.id === "probe-dataset")?.records?.[0]?.value === "probe_user",
		"数据集记录读回一致",
	);

	// -- 旧 revision：409 + 最新快照（不静默覆盖） ---------------------------
	let r = await postJson("/save", {
		baseRevision,
		systems: nextSystems,
		modules: [],
		features: [],
		cases: [],
		datasets: [],
	});
	check(r.status === 409 && r.body?.code === "conflict", "旧 baseRevision 返回 409 conflict", {
		status: r.status,
		code: r.body?.code,
	});
	check(r.body?.store?.revision === baseRevision + 1, "冲突响应回带最新快照", r.body?.store?.revision);

	// -- 缺 baseRevision：400 -------------------------------------------------
	r = await postJson("/save", { systems: nextSystems });
	check(r.status === 400, "缺 baseRevision 返回 400", r.status);

	// -- 落盘内容与内存一致 ---------------------------------------------------
	const onDisk = JSON.parse(readFileSync(storeFile, "utf8"));
	check(onDisk?.version === 2 && onDisk.revision === baseRevision + 1, "store.json 版本与 revision 与内存一致", {
		version: onDisk?.version,
		revision: onDisk?.revision,
	});
	check(
		onDisk?.cases?.some((c) => c.id === "probe-case"),
		"store.json 含新增用例",
	);
	check(
		onDisk?.systems?.some((s) => s.id === "probe-system"),
		"store.json 含新增系统",
	);

	// -- 重启后仍在（数据活在外面的数据目录） --------------------------------
	await stopServer(sock);
	sock = await bootServer("data-space-test-2");
	({ status, body: st } = await getState());
	check(status === 200 && st?.cases?.some((c) => c.id === "probe-case"), "重启服务后数据仍在", {
		status,
		count: st?.cases?.length,
	});
	check(st?.revision === baseRevision + 1, "revision 随落盘保留", st?.revision);
	check(
		st?.systems?.some((s) => s.id === "probe-system"),
		"重启后系统层级仍在",
	);

	// -- 0.1.0 旧库迁移：groups → systems，数据集归属清空 ---------------------
	await stopServer(sock);
	writeFileSync(
		storeFile,
		JSON.stringify(
			{
				version: 1,
				revision: 7,
				updatedAt: "2026-10-01T02:00:00.000Z",
				groups: [
					{ id: "g-legacy", name: "存量分组", color: "green", note: "旧库", createdAt: "2026-09-01T00:00:00.000Z" },
					{
						id: "g-legacy-2",
						name: "另一个分组",
						color: "not-a-color",
						note: "",
						createdAt: "2026-09-02T00:00:00.000Z",
					},
				],
				datasets: [
					{
						id: "d-legacy",
						name: "旧数据集",
						groupId: "g-legacy",
						env: "测试环境",
						tags: ["历史"],
						note: "",
						records: [{ id: "r-legacy", key: "phone", value: "13800000000", remark: "" }],
						createdAt: "2026-09-01T00:00:00.000Z",
						updatedAt: "2026-09-01T00:00:00.000Z",
					},
				],
			},
			null,
			"\t",
		),
		"utf8",
	);
	sock = await bootServer("data-space-test-3");
	({ status, body: st } = await getState());
	const legacySystem = (st?.systems ?? []).find((s) => s.id === "g-legacy");
	check(status === 200 && Boolean(legacySystem), "旧分组迁移为系统", legacySystem);
	check(legacySystem?.name === "存量分组" && legacySystem?.color === "green", "迁移保留分组名称与颜色", legacySystem);
	check((st?.systems ?? []).find((s) => s.id === "g-legacy-2")?.color === "blue", "非法颜色回落到默认值");
	check(
		(st?.datasets ?? []).find((d) => d.id === "d-legacy")?.featureId === "",
		"旧数据集归属清空为未归类",
		(st?.datasets ?? []).find((d) => d.id === "d-legacy")?.featureId,
	);
	check(
		(st?.datasets ?? []).find((d) => d.id === "d-legacy")?.records?.[0]?.value === "13800000000",
		"旧数据集记录完整保留",
	);
	check(st?.migratedFrom === 1, "快照标明从 v1 迁移", st?.migratedFrom);
	check((st?.modules?.length ?? -1) === 0 && (st?.cases?.length ?? -1) === 0, "迁移后模块与用例为空", {
		modules: st?.modules?.length,
		cases: st?.cases?.length,
	});
	const backups = readdirSync(join(dataDir, "data-space")).filter((n) => /^store\.json\.v1-\d+\.bak$/.test(n));
	check(backups.length === 1, "迁移前留下 v1 备份文件", backups);
	const migratedOnDisk = JSON.parse(readFileSync(storeFile, "utf8"));
	check(migratedOnDisk?.version === 2 && migratedOnDisk?.systems?.length === 2, "迁移结果已立即落盘", {
		version: migratedOnDisk?.version,
		systems: migratedOnDisk?.systems?.length,
	});

	// -- reset 需确认，确认后回到示例 ----------------------------------------
	r = await postJson("/reset", {});
	check(r.status === 400, "reset 缺 confirm 返回 400", r.status);
	r = await postJson("/reset", { confirm: true });
	const reset = r.body ?? {};
	check(
		r.status === 200 && (reset.systems?.length ?? 0) >= 5 && !(reset.datasets ?? []).some((d) => d.id === "d-legacy"),
		"reset 恢复示例数据且移除旧库数据",
		{ status: r.status, systems: reset.systems?.length, datasets: reset.datasets?.length },
	);
	check((reset.migratedFrom ?? 0) === 0, "reset 后不再显示迁移提示", reset.migratedFrom);
	sock.close();
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
