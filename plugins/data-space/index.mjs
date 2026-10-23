/**
 * data-space 服务端入口 —— 测试资产（项目 / 模块 / 功能 / 用例 / 环境）的唯一事实源。
 *
 * 分工：
 *   - 数据落 `<dataDir>/data-space/store.json`（原子写：临时文件 + rename）。**不放插件目录**：
 *     内置插件升级会整目录覆盖、卸载会删目录，用户数据必须活在外面。默认 `<dataDir>` = ~/.pi-web。
 *   - 全局一份，不按项目 cwd、不按会话隔离：切项目 / 换会话读到的是同一批数据。
 *   - 层级用扁平父引用（systemId / moduleId / featureId）：搜索、移动、导入导出都简单。
 *   - 浏览器只走 HTTP：`GET /state` 取快照、`POST /save` 整份保存（带 revision 乐观并发）、
 *     `POST /reset` 回到示例数据。冲突时回 409 + 服务端最新快照，由页面决定重载。
 *   - 0.8.0 移除数据集，改为「项目环境」：旧库里的 datasets / case.datasetIds 在读取时
 *     先备份原文件（store.json.v2-<时间戳>.bak）再丢弃，清理结果记在 store.purged 里给设置页展示；
 *     备份只做一次，重复启动不会生成新备份。
 *   - 0.1.0 的旧库（groups + datasets）在读取时自动迁移：分组 → 项目（code 留空），
 *     旧文件先备份为 store.json.v1-<时间戳>.bak。
 *   - 执行结果（v3 回写）单独落 `<dataDir>/data-space/runs.json`：它是流水不是内容，
 *     和 store 混在一起会让「页面整份保存」与「AI 回写」互相抢 revision。
 *   - 0.10.0 给环境加「参数」：账号 / 租户 / 数据库这类键值对，secret 标记敏感值；
 *     列表、CSV 与 AI 工具里敏感值一律占位，明文只留在本地 store.json。
 *   - AI 工具做三件事：查用例、查环境参数、回写执行结果；工具结果里敏感参数只给 ***。
 *     写盘后 broadcast 让页面自动刷新。
 */
import { copyFileSync, existsSync, readFileSync, realpathSync, renameSync } from "node:fs";
import { atomicJson } from "./durable.mjs";
import { basename, join } from "node:path";
import { buildDemoRuns } from "./demo-runs.mjs";
import { CASE_TYPES, MAX, migrateLegacy, normalizeStore, now, str } from "./model.mjs";
import { VERDICTS, normalizeRuns } from "./runs.mjs";
import { seedStore } from "./seed.mjs";
import { createAutomation } from "./automation.mjs";
import { createDataSpaceTools } from "./tools.mjs";

/** 默认任务名里的短时间戳（本地时区 MM-DD HH:mm）。 */
const shortStamp = (iso) => {
	const d = new Date(iso);
	const p = (n) => String(n).padStart(2, "0");
	return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default {
	activate(host) {
		const dir = join(host.dataDir, "data-space");
		const file = join(dir, "store.json");
		const runsFile = join(dir, "runs.json");

		const loaded = load();
		let store = loaded.store;
		let runs = loadRuns();
		// 迁移 / 清理结果立即落盘：下次启动不必重复判断，备份也只留一份。
		if (loaded.changed) persist();

		/** 结构变更前留一份原文件；返回备份文件名（失败停止迁移）。 */
		function backup(tag) {
			const name = `${basename(file)}.${tag}-${Date.now()}.bak`;
			try {
				copyFileSync(file, join(dir, name));
				return name;
			} catch (err) {
				host.log("error", "备份旧数据文件失败，停止迁移", String(err));
				throw err;
			}
		}

		function load() {
			let parsed = null;
			try {
				parsed = JSON.parse(readFileSync(file, "utf8"));
			} catch (err) {
				if (!(err instanceof SyntaxError) && err.code !== "ENOENT") throw err;
				if (existsSync(file)) {
					// 读得出来但坏了（手改坏 / 半截写）：先挪走再当空库起，绝不静默覆盖用户数据。
					const quarantine = `${file}.corrupt-${Date.now()}`;
					try {
						renameSync(file, quarantine);
						host.log("error", `数据空间库解析失败，原文件已隔离为 ${quarantine}`, String(err));
					} catch {
						throw new Error("数据空间库解析失败且无法隔离，拒绝覆盖原文件");
					}
				}
				return { store: seedStore(), changed: false };
			}

			const o = parsed && typeof parsed === "object" ? parsed : {};
			if (Number(o.version) > 3) throw new Error("数据版本高于当前支持版本，拒绝降级覆盖");
			const isCurrent = Array.isArray(o.systems);
			const oldDatasets = Array.isArray(o.datasets) ? o.datasets.length : 0;
			const linkedCases = Array.isArray(o.cases)
				? o.cases.filter((c) => Array.isArray(c?.datasetIds) && c.datasetIds.length).length
				: 0;

			let source = parsed;
			let backupName = "";
			if (!isCurrent) {
				// 迁移前留一份旧格式备份，用户随时能翻回去。
				source = migrateLegacy(parsed);
				backupName = backup("v1");
			}

			// 数据集已从模型中移除：只数个数、留备份，不再往新结构里搬。
			const purged =
				oldDatasets || linkedCases
					? {
							datasets: oldDatasets,
							cases: linkedCases,
							backup: backupName || backup(isCurrent ? "v2" : "v1"),
							at: now(),
						}
					: o.purged && typeof o.purged === "object"
						? o.purged
						: null;

			const normalized = normalizeStore(source, null);
			if (!isCurrent) host.log("info", "数据空间：旧版分组数据已迁移为「项目」层级");
			if (oldDatasets || linkedCases) {
				host.log(
					"info",
					`数据空间：已按 0.8.0 结构移除 ${oldDatasets} 份数据集（${linkedCases} 条用例的引用一并清掉），原文件备份为 ${purged.backup || "（备份失败）"}`,
				);
			}
			return {
				store: {
					version: 3,
					revision: Number.isFinite(o.revision) ? o.revision : 1,
					updatedAt: str(o.updatedAt, 40) || now(),
					...normalized,
					...(purged ? { purged } : {}),
				},
				changed: Boolean(!isCurrent || oldDatasets || linkedCases),
			};
		}

		function persist(next = store) {
			atomicJson(file, next);
		}
		function commitStore(next) {
			persist(next);
			store = next;
			host.broadcast({ kind: "store", revision: store.revision });
		}

		/** 执行结果：单独文件；坏了不静默覆盖（隔离后在空表上继续）。 */
		function loadRuns() {
			let parsed = null;
			try {
				parsed = JSON.parse(readFileSync(runsFile, "utf8"));
			} catch (err) {
				if (!(err instanceof SyntaxError) && err.code !== "ENOENT") throw err;
				if (existsSync(runsFile)) {
					const quarantine = `${runsFile}.corrupt-${Date.now()}`;
					try {
						renameSync(runsFile, quarantine);
						host.log("error", `执行结果文件解析失败，已隔离为 ${quarantine}`, String(err));
					} catch {
						throw new Error("执行结果文件解析失败且无法隔离，拒绝覆盖原文件");
					}
				}
				return { version: 1, revision: 1, runs: [] };
			}
			if (Number(parsed?.version) > 1) throw new Error("执行记录版本高于当前支持版本");
			return normalizeRuns(parsed, store.cases);
		}

		function persistRuns(next = runs) {
			atomicJson(runsFile, next);
		}
		function commitRuns(next) {
			persistRuns(next);
			runs = next;
			broadcastRuns();
		}

		/** 结果变了就让打开着的页面自己刷新（不关闭的窗口也能看到）。 */
		function broadcastRuns() {
			try {
				host.broadcast({ kind: "runs", revision: runs.revision });
			} catch {
				/* 没有客户端在线 */
			}
		}

		/**
		 * 结果上的环境：页面 / 工具传环境 id 或名称都认（大小写不敏感）。
		 * 无法匹配或不属于当前项目时拒绝登记。
		 */
		function resolveEnv(value, c) {
			const key = str(value, 64);
			if (!key) return { env: "", envId: "" };
			const lower = key.toLowerCase();
			const feature = store.features.find((f) => f.id === c.featureId);
			const systemId = store.modules.find((m) => m.id === feature?.moduleId)?.systemId;
			const scoped = store.envs.filter((e) => e.systemId === systemId);
			const names = scoped.filter((e) => e.name.toLowerCase() === lower);
			const hit = scoped.find((e) => e.id === key) ?? (names.length === 1 ? names[0] : null);
			if (!hit) throw new Error("环境不存在或不属于用例项目，请使用明确的环境 id");
			return hit ? { env: hit.name, envId: hit.id } : { env: str(key, 60), envId: "" };
		}

		/**
		 * 记一批执行结果。entries: [{case(caseId/编号), verdict, note, env}]。
		 * 编号 / id 都能定位；找不到的进 unknown，不静默丢。
		 *
		 * meta.taskName / meta.taskId：一次回写多条时自动归为一个「测试任务」（结果页按任务看整批结论）；
		 * meta.env：这批结果跑在哪个环境（每条 entry 里写了 env 则以单条为准）。
		 * 单条回写不造任务，避免把流水拆成一堆只有一条的任务。
		 */
		function recordResults(entries, source, meta = {}) {
			const byId = new Map(store.cases.map((c) => [c.id, c]));
			const byCode = new Map(store.cases.filter((c) => c.code).map((c) => [String(c.code).toUpperCase(), c]));
			const at = now();
			const resolved = [];
			const unknown = [];
			for (const entry of entries ?? []) {
				const key = str(entry?.case, 64);
				const verdict = str(entry?.verdict, 12);
				if (!key || !VERDICTS.includes(verdict)) continue;
				const matches = store.cases.filter((c) => c.code?.toUpperCase() === key.toUpperCase());
				const c = byId.get(key) ?? (matches.length === 1 ? byCode.get(key.toUpperCase()) : null);
				if (!c) {
					unknown.push(key);
					continue;
				}
				resolved.push({ c, verdict, note: str(entry?.note, 300), env: str(entry?.env, 64) });
			}

			const wantTask =
				str(meta.taskId, 64) ||
				(resolved.length > 1 ? `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` : "");
			const taskId = resolved.length ? wantTask : "";
			const taskName = taskId ? str(meta.taskName, 80) || `批量执行 ${shortStamp(at)}` : "";

			const recorded = [];
			for (const { c, verdict, note, env } of resolved) {
				const envHit = resolveEnv(env || meta.env, c);
				const run = {
					id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
					caseId: c.id,
					code: c.code,
					verdict,
					note,
					at,
					source: source === "manual" ? "manual" : "ai",
					caseUpdatedAt: c.updatedAt,
					taskId,
					taskName,
					env: envHit.env,
					envId: envHit.envId,
				};
				recorded.push(run);
			}
			if (recorded.length) {
				commitRuns({ ...runs, runs: [...runs.runs, ...recorded], revision: runs.revision + 1 });
			}
			return { ok: true, recorded, unknown, runsRevision: runs.revision };
		}

		const automation = createAutomation({ host, store: () => store, runs: () => runs, commitStore, commitRuns });
		function snapshot() {
			return {
				ok: true,
				automationSync: automation.status(),
				workspace: host.cwd,
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
				envs: store.envs,
				purged: store.purged ?? null,
				storeVersion: store.version,
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
						Promise.resolve(handler(req, res)).catch((err) => {
							host.log("error", "数据空间异步请求失败", String(err));
							if (!res.headersSent) res.status(400).json({ ok: false, error: String(err.message || err) });
						});
					} catch (err) {
						host.log("error", `数据空间 http ${method} ${path} 失败：`, String(err));
						if (!res.headersSent) res.status(500).json({ ok: false, error: "服务端处理失败" });
					}
				}),
			);
		};

		route("POST", "/automation", async (req, res) => {
			const input = req.body ?? {};
			if (!input.workspace || realpathSync(input.workspace) !== realpathSync(host.cwd))
				throw new Error("工作区已切换，请刷新数据空间后重试");
			res.json(await automation.call(input.workspace, input));
		});

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
			const next = {
				version: 3,
				revision: store.revision + 1,
				updatedAt: now(),
				...normalized,
				// 清理记录属于「这台机器上发生过什么」，不当作用户内容随保存一起改掉。
				...(store.purged ? { purged: store.purged } : {}),
			};
			commitStore(next);
			res.json(snapshot());
		});

		// 页面里手工登记执行结果（与 AI 回写同一条记录链，只是 source=manual）
		route("POST", "/runs", (req, res) => {
			const body = req.body && typeof req.body === "object" ? req.body : {};
			const entries = Array.isArray(body.results)
				? body.results
				: [{ case: body.caseId || body.code, verdict: body.verdict, note: body.note, env: body.env }];
			const out = recordResults(entries, "manual", { taskName: str(body.task, 80), env: body.env });
			if (!out.recorded.length) {
				res.status(400).json({ ok: false, error: "没有可记录的结果：确认用例存在且结果合法", unknown: out.unknown });
				return;
			}
			res.json({
				ok: true,
				recorded: out.recorded,
				unknown: out.unknown,
				runs: runs.runs,
				taskId: out.recorded[0]?.taskId || "",
				runsRevision: out.runsRevision,
			});
		});

		// 示例执行记录（演示用）：只允许在空台账上载入，避免假结论混进真实记录
		route("POST", "/runs/demo", (req, res) => {
			const body = req.body && typeof req.body === "object" ? req.body : {};
			if (body.confirm !== true) {
				res.status(400).json({ ok: false, error: "需要 confirm:true 才能载入示例记录" });
				return;
			}
			if (runs.runs.length) {
				res.status(409).json({
					ok: false,
					error: "已有执行记录：示例记录只用于空台账预览，请先清空",
					runs: runs.runs,
					runsRevision: runs.revision,
				});
				return;
			}
			const demo = buildDemoRuns(store);
			if (!demo.length) {
				res.status(400).json({ ok: false, error: "还没有用例，先建用例再载入示例记录" });
				return;
			}
			// 走一遍 normalizeRuns，校验形状并排好序
			commitRuns(normalizeRuns({ revision: runs.revision + 1, runs: demo }, store.cases));
			res.json({ ok: true, runs: runs.runs, runsRevision: runs.revision });
		});

		// 清空执行记录（只删流水，不动用例）：演示数据用完、或想重新开始跑一轮时用
		route("POST", "/runs/clear", (req, res) => {
			const body = req.body && typeof req.body === "object" ? req.body : {};
			if (body.confirm !== true) {
				res.status(400).json({ ok: false, error: "需要 confirm:true 才能清空执行记录" });
				return;
			}
			const removed = runs.runs.length;
			if (removed) {
				commitRuns({ version: 1, revision: runs.revision + 1, runs: [] });
			}
			res.json({ ok: true, removed, runs: runs.runs, runsRevision: runs.revision });
		});

		route("POST", "/reset", (req, res) => {
			const body = req.body && typeof req.body === "object" ? req.body : {};
			if (body.confirm !== true) {
				res.status(400).json({ ok: false, error: "需要 confirm:true 才能重置" });
				return;
			}
			// Old runs remain an audit trail even after replacing the case library.
			commitStore({ ...seedStore(), revision: store.revision + 1 });
			res.json(snapshot());
		});

		// AI 工具（v2 查询 / v3 回写）：用当前内存快照作答，页面刚保存的数据也看得到。
		const toolOffs = [];
		try {
			if (typeof host.registerAgentTool === "function") {
				const tools = createDataSpaceTools({
					store: () => store,
					runs: () => runs,
					record: (entries, source, meta) => recordResults(entries, source, meta),
				});
				tools.push({
					name: "data_space_automation",
					label: "测试资产与原生结果关联",
					description:
						"Initialize project test environments, import native cases, bind assets, or synchronize verified runs. Does not approve or execute tests.",
					promptSnippet: "Connect project environments, generated cases and native results.",
					promptGuidelines: [
						"Initialize with engine and targetUrl before discovery. Use returned environment IDs and nonsecret parameters; configured does not mean reachable or authenticated.",
						"Import a generated asset to verify writeback. Native generation and execution events also synchronize automatically after initialization.",
						"Use route to obtain the original execution entry. Never replace native approval or preflight.",
						"Use sync for an existing run after a synchronization error; do not replay execution.",
					],
					parameters: {
						type: "object",
						properties: {
							action: {
								type: "string",
								enum: ["initialize", "disconnect", "import", "inspect", "bind", "unbind", "route", "sync"],
							},
							systemId: { type: "string" },
							targetUrl: { type: "string" },
							featureId: { type: "string" },
							caseId: { type: "string" },
							engine: { type: "string", enum: ["ui", "api"] },
							assetRef: { anyOf: [{ type: "string" }, { type: "object" }] },
							runRef: { anyOf: [{ type: "string" }, { type: "object" }] },
							nativeCaseId: { type: "string" },
							envId: { type: "string" },
						},
						required: ["action"],
					},
					execute: async (_id, input, signal, _update, context) => {
						if (!context?.cwd) throw new Error("当前引擎缺少绑定会话的工具上下文");
						signal?.throwIfAborted();
						return automation.call(context.cwd, input);
					},
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
			automation.dispose();
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
