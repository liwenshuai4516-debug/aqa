/**
 * data-space 服务端入口 —— 测试资产（系统 / 模块 / 功能 / 用例 / 数据集）的唯一事实源。
 *
 * 分工：
 *   - 数据落 `<dataDir>/data-space/store.json`（原子写：临时文件 + rename）。**不放插件目录**：
 *     内置插件升级会整目录覆盖、卸载会删目录，用户数据必须活在外面。默认 `<dataDir>` = ~/.pi-web。
 *   - 全局一份，不按项目 cwd、不按会话隔离：切项目 / 换会话读到的是同一批数据。
 *   - 层级用扁平父引用（systemId / moduleId / featureId）：搜索、移动、导入导出都简单。
 *   - 浏览器只走 HTTP：`GET /state` 取快照、`POST /save` 整份保存（带 revision 乐观并发）、
 *     `POST /reset` 回到示例数据。冲突时回 409 + 服务端最新快照，由页面决定重载。
 *   - 0.1.0 的旧库（groups + datasets）在读取时自动迁移：分组 → 系统（code 留空），
 *     数据集归属清空为「未归类」，原数据一条不丢；旧文件先备份为 store.json.v1-<时间戳>.bak。
 *   - 执行结果（v3 回写）单独落 `<dataDir>/data-space/runs.json`：它是流水不是内容，
 *     和 store 混在一起会让「页面整份保存」与「AI 回写」互相抢 revision。
 *   - AI 工具只做两件事：按项目/模块/功能/编号查用例（省上下文）与回写执行结果；
 *     工具结果里只带数据集名称，不带取值。写盘后 broadcast 让打开着的页面自动刷新。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASE_TYPES, MAX, migrateLegacy, normalizeStore, now, str } from "./model.mjs";
import { MAX_RUNS, VERDICTS, normalizeRuns } from "./runs.mjs";
import { seedStore } from "./seed.mjs";
import { createDataSpaceTools } from "./tools.mjs";

export default {
	activate(host) {
		const dir = join(host.dataDir, "data-space");
		const file = join(dir, "store.json");
		const runsFile = join(dir, "runs.json");

		const loaded = load();
		let store = loaded.store;
		let runs = loadRuns();
		// 迁移结果立刻落盘，避免下次启动重复迁移（旧格式备份已在 load 里留好）。
		if (loaded.migrated) persist();

		function load() {
			let parsed = null;
			try {
				parsed = JSON.parse(readFileSync(file, "utf8"));
			} catch (err) {
				if (existsSync(file)) {
					// 读得出来但坏了（手改坏 / 半截写）：先挪走再当空库起，绝不静默覆盖用户数据。
					const quarantine = `${file}.corrupt-${Date.now()}`;
					try {
						renameSync(file, quarantine);
						host.log("error", `数据空间库解析失败，原文件已隔离为 ${quarantine}`, String(err));
					} catch {
						host.log("error", "数据空间库解析失败且隔离失败，本次不写盘以免覆盖");
					}
				}
				return { store: seedStore(), migrated: false };
			}

			const isV2 = parsed && typeof parsed === "object" && Array.isArray(parsed.systems);
			let migrated = null;
			if (!isV2) {
				migrated = migrateLegacy(parsed);
				// 迁移前留一份旧格式备份，用户随时能翻回去。
				try {
					copyFileSync(file, `${file}.v1-${Date.now()}.bak`);
				} catch (err) {
					host.log("warn", "迁移备份旧数据文件失败，继续迁移", String(err));
				}
			}
			const normalized = normalizeStore(migrated ?? parsed, null);
			if (migrated) host.log("info", "数据空间：旧版分组数据已迁移为「系统」层级");
			return {
				store: {
					version: 2,
					revision: Number.isFinite(parsed?.revision) ? parsed.revision : 1,
					updatedAt: str(parsed?.updatedAt, 40) || now(),
					...normalized,
				},
				migrated: Boolean(migrated),
			};
		}

		function persist() {
			try {
				mkdirSync(dir, { recursive: true });
				const tmp = `${file}.tmp.${process.pid}`;
				writeFileSync(tmp, JSON.stringify(store, null, "\t"), "utf8");
				renameSync(tmp, file);
			} catch (err) {
				host.log("error", "写入数据空间库失败：", err instanceof Error ? err.message : String(err));
			}
		}

		/** 执行结果：单独文件；坏了不静默覆盖（隔离后在空表上继续）。 */
		function loadRuns() {
			let parsed = null;
			try {
				parsed = JSON.parse(readFileSync(runsFile, "utf8"));
			} catch (err) {
				if (existsSync(runsFile)) {
					const quarantine = `${runsFile}.corrupt-${Date.now()}`;
					try {
						renameSync(runsFile, quarantine);
						host.log("error", `执行结果文件解析失败，已隔离为 ${quarantine}`, String(err));
					} catch {
						host.log("error", "执行结果文件解析失败且隔离失败，本次不写盘以免覆盖");
					}
				}
				return { version: 1, revision: 1, runs: [] };
			}
			return normalizeRuns(parsed, store.cases);
		}

		function persistRuns() {
			try {
				mkdirSync(dir, { recursive: true });
				const tmp = `${runsFile}.tmp.${process.pid}`;
				writeFileSync(tmp, JSON.stringify(runs, null, "\t"), "utf8");
				renameSync(tmp, runsFile);
			} catch (err) {
				host.log("error", "写入执行结果失败：", err instanceof Error ? err.message : String(err));
			}
		}

		/**
		 * 记一批执行结果。entries: [{case(caseId/编号), verdict, note}]。
		 * 编号 / id 都能定位；找不到的进 unknown，不静默丢。
		 */
		function recordResults(entries, source) {
			const byId = new Map(store.cases.map((c) => [c.id, c]));
			const byCode = new Map(store.cases.filter((c) => c.code).map((c) => [String(c.code).toUpperCase(), c]));
			const recorded = [];
			const unknown = [];
			const at = now();
			for (const entry of entries ?? []) {
				const key = str(entry?.case, 64);
				const verdict = str(entry?.verdict, 12);
				if (!key || !VERDICTS.includes(verdict)) continue;
				const c = byId.get(key) ?? byCode.get(key.toUpperCase());
				if (!c) {
					unknown.push(key);
					continue;
				}
				const run = {
					id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
					caseId: c.id,
					code: c.code,
					verdict,
					note: str(entry?.note, 300),
					at,
					source: source === "manual" ? "manual" : "ai",
					caseUpdatedAt: c.updatedAt,
				};
				runs.runs.push(run);
				recorded.push(run);
			}
			if (recorded.length) {
				runs.runs = runs.runs.slice(-MAX_RUNS);
				runs.revision += 1;
				persistRuns();
				// 页面开着就让表格自己刷新（不关闭的窗口也能看到结果）
				try {
					host.broadcast({ kind: "runs", revision: runs.revision });
				} catch {
					/* 没有客户端在线 */
				}
			}
			return { ok: true, recorded, unknown, runsRevision: runs.revision };
		}

		function snapshot() {
			return {
				ok: true,
				runs: runs.runs,
				runsRevision: runs.revision,
				verdicts: VERDICTS,
				revision: store.revision,
				updatedAt: store.updatedAt,
				migratedFrom: store.migratedFrom,
				systems: store.systems,
				modules: store.modules,
				features: store.features,
				cases: store.cases,
				datasets: store.datasets,
				caseTypes: CASE_TYPES,
				dir,
				file,
				limits: MAX,
			};
		}

		const offs = [];
		const route = (method, path, handler) => {
			offs.push(
				host.route(method, path, (req, res) => {
					try {
						handler(req, res);
					} catch (err) {
						host.log("error", `数据空间 http ${method} ${path} 失败：`, String(err));
						if (!res.headersSent) res.status(500).json({ ok: false, error: "服务端处理失败" });
					}
				}),
			);
		};

		route("GET", "/state", (_req, res) => res.json(snapshot()));

		route("POST", "/save", (req, res) => {
			const body = req.body && typeof req.body === "object" ? req.body : {};
			const baseRevision = Number(body.baseRevision);
			if (!Number.isFinite(baseRevision)) {
				res.status(400).json({ ok: false, error: "缺少 baseRevision" });
				return;
			}
			if (baseRevision !== store.revision) {
				res.status(409).json({
					ok: false,
					code: "conflict",
					error: "数据已被其他窗口更新",
					store: snapshot(),
				});
				return;
			}
			const normalized = normalizeStore(body, store);
			store = {
				version: 2,
				revision: store.revision + 1,
				updatedAt: now(),
				...normalized,
			};
			persist();
			res.json(snapshot());
		});

		// 页面里手工登记执行结果（与 AI 回写同一条记录链，只是 source=manual）
		route("POST", "/runs", (req, res) => {
			const body = req.body && typeof req.body === "object" ? req.body : {};
			const entries = Array.isArray(body.results)
				? body.results
				: [{ case: body.caseId || body.code, verdict: body.verdict, note: body.note }];
			const out = recordResults(entries, "manual");
			if (!out.recorded.length) {
				res.status(400).json({ ok: false, error: "没有可记录的结果：确认用例存在且结果合法", unknown: out.unknown });
				return;
			}
			res.json({
				ok: true,
				recorded: out.recorded,
				unknown: out.unknown,
				runs: runs.runs,
				runsRevision: out.runsRevision,
			});
		});

		route("POST", "/reset", (req, res) => {
			const body = req.body && typeof req.body === "object" ? req.body : {};
			if (body.confirm !== true) {
				res.status(400).json({ ok: false, error: "需要 confirm:true 才能重置" });
				return;
			}
			store = { ...seedStore(), revision: store.revision + 1 };
			persist();
			res.json(snapshot());
		});

		// AI 工具（v2 查询 / v3 回写）：用当前内存快照作答，页面刚保存的数据也看得到。
		const toolOffs = [];
		try {
			if (typeof host.registerAgentTool === "function") {
				const tools = createDataSpaceTools({
					store: () => store,
					runs: () => runs,
					record: (entries, source) => recordResults(entries, source),
				});
				for (const tool of tools) toolOffs.push(host.registerAgentTool(tool));
			}
		} catch (err) {
			host.log(
				"warn",
				"数据空间 AI 工具注册失败（页面功能不受影响）",
				err instanceof Error ? err.message : String(err),
			);
		}

		// 首次访问前把种子落盘：用户直接改文件也有东西可改；文件已存在则不碰。
		if (!existsSync(file)) persist();

		return () => {
			for (const off of [...toolOffs, ...offs]) {
				try {
					off?.();
				} catch {
					/* 已注销 */
				}
			}
		};
	},
};
