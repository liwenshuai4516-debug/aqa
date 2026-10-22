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
 *   - 演示版本不注册 AI 工具：需要 AI 改数据时直接改 store.json 即可（页面里显示路径）。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CASE_TYPES, MAX, migrateLegacy, normalizeStore, now, str } from "./model.mjs";
import { seedStore } from "./seed.mjs";

export default {
	activate(host) {
		const dir = join(host.dataDir, "data-space");
		const file = join(dir, "store.json");

		const loaded = load();
		let store = loaded.store;
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

		function snapshot() {
			return {
				ok: true,
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

		// 首次访问前把种子落盘：用户直接改文件也有东西可改；文件已存在则不碰。
		if (!existsSync(file)) persist();

		return () => {
			for (const off of offs) {
				try {
					off?.();
				} catch {
					/* 已注销 */
				}
			}
		};
	},
};
