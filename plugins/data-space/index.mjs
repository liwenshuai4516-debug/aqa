/**
 * data-space 服务端入口 —— 测试数据的唯一事实源。
 *
 * 分工：
 *   - 数据落 `<dataDir>/data-space/store.json`（原子写：临时文件 + rename）。**不放插件目录**：
 *     内置插件升级会整目录覆盖、卸载会删目录，用户数据必须活在外面。默认 `<dataDir>` = ~/.pi-web。
 *   - 全局一份，不按项目 cwd、不按会话隔离：切项目 / 换会话读到的是同一批数据。
 *   - 浏览器只走 HTTP：`GET /state` 取快照、`POST /save` 整份保存（带 revision 乐观并发）、
 *     `POST /reset` 回到示例数据。冲突时回 409 + 服务端最新快照，由页面决定重载。
 *   - 演示版本不注册 AI 工具：需要 AI 改数据时直接改 store.json 即可（页面里显示路径）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** 单文件上限，防止一份畸形 store 把页面顶爆（演示版够用，真实数据量大再拆文件）。 */
const MAX = { groups: 100, datasets: 500, records: 200, tags: 12 };
const COLORS = new Set(["blue", "green", "amber", "purple", "gray"]);

const now = () => new Date().toISOString();
const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const uid = () => randomUUID();

/** 示例数据：首次打开时给一份可直接看的样例，用户可一键清空或恢复。 */
function seedStore() {
	const t = now();
	const groups = [
		{ id: "g-user", name: "用户与权限", color: "blue", note: "登录、账号、角色相关数据", createdAt: t },
		{ id: "g-device", name: "设备与监测", color: "green", note: "设备台账、监测点位、实时数据", createdAt: t },
		{ id: "g-order", name: "工单与调度", color: "amber", note: "工单创建、派发、回单", createdAt: t },
	];
	const datasets = [
		{
			id: "d-login-ok",
			name: "登录成功-普通账号",
			groupId: "g-user",
			env: "测试环境",
			tags: ["冒烟", "登录"],
			note: "正常账号登录，断言返回 token 与角色。",
			records: [
				{ id: uid(), key: "username", value: "test_user", remark: "已授权普通账号" },
				{ id: uid(), key: "password", value: "Abc@12345", remark: "测试专用，禁止复用生产口令" },
				{ id: uid(), key: "expectCode", value: "200", remark: "" },
				{ id: uid(), key: "expectRole", value: "operator", remark: "" },
			],
			createdAt: t,
			updatedAt: t,
		},
		{
			id: "d-login-bad",
			name: "登录失败-密码错误",
			groupId: "g-user",
			env: "测试环境",
			tags: ["异常", "登录"],
			note: "错误口令应返回 401 且不返回 token。",
			records: [
				{ id: uid(), key: "username", value: "test_user", remark: "" },
				{ id: uid(), key: "password", value: "wrong-pass", remark: "" },
				{ id: uid(), key: "expectCode", value: "401", remark: "" },
			],
			createdAt: t,
			updatedAt: t,
		},
		{
			id: "d-device-list",
			name: "设备列表查询参数",
			groupId: "g-device",
			env: "预发环境",
			tags: ["查询", "分页"],
			note: "按站点与状态过滤，校验分页总数。",
			records: [
				{ id: uid(), key: "stationId", value: "ST-001", remark: "" },
				{ id: uid(), key: "status", value: "running", remark: "运行中" },
				{ id: uid(), key: "page", value: "1", remark: "" },
				{ id: uid(), key: "pageSize", value: "20", remark: "" },
			],
			createdAt: t,
			updatedAt: t,
		},
		{
			id: "d-order-create",
			name: "工单创建-必填校验",
			groupId: "g-order",
			env: "本地",
			tags: ["校验"],
			note: "缺少必填项时应拒绝创建并给出字段级提示。",
			records: [
				{ id: uid(), key: "type", value: "repair", remark: "维修工单" },
				{ id: uid(), key: "title", value: "", remark: "故意留空，触发必填校验" },
				{ id: uid(), key: "expectCode", value: "400", remark: "" },
			],
			createdAt: t,
			updatedAt: t,
		},
	];
	return { version: 1, revision: 1, updatedAt: t, groups, datasets };
}

/** 收进来的任何东西都必须先过这里：丢掉未知字段、截断长度、补 id。 */
function normalizeStore(raw, previous) {
	const o = raw && typeof raw === "object" ? raw : {};
	const prevById = new Map((previous?.datasets ?? []).map((d) => [d.id, d]));
	const seenGroups = new Set();
	const groups = (Array.isArray(o.groups) ? o.groups : [])
		.slice(0, MAX.groups)
		.map((g) => {
			const go = g && typeof g === "object" ? g : {};
			const id = str(go.id, 64) || uid();
			return {
				id,
				name: str(go.name, 60) || "未命名分组",
				color: COLORS.has(go.color) ? go.color : "blue",
				note: str(go.note, 200),
				createdAt: str(go.createdAt, 40) || now(),
			};
		})
		.filter((g) => {
			if (seenGroups.has(g.id)) return false;
			seenGroups.add(g.id);
			return true;
		});
	const groupIds = new Set(groups.map((g) => g.id));
	const seenDatasets = new Set();
	const datasets = (Array.isArray(o.datasets) ? o.datasets : [])
		.slice(0, MAX.datasets)
		.map((d) => {
			const dobj = d && typeof d === "object" ? d : {};
			const id = str(dobj.id, 64) || uid();
			const records = (Array.isArray(dobj.records) ? dobj.records : [])
				.slice(0, MAX.records)
				.map((r) => {
					const ro = r && typeof r === "object" ? r : {};
					return {
						id: str(ro.id, 64) || uid(),
						key: str(ro.key, 80),
						value: typeof ro.value === "string" ? ro.value.slice(0, 4000) : "",
						remark: str(ro.remark, 200),
					};
				})
				.filter((r) => r.key || r.value || r.remark);
			const tags = (Array.isArray(dobj.tags) ? dobj.tags : [])
				.map((x) => str(x, 24))
				.filter(Boolean)
				.slice(0, MAX.tags);
			return {
				id,
				name: str(dobj.name, 80) || "未命名数据集",
				groupId: groupIds.has(str(dobj.groupId, 64)) ? str(dobj.groupId, 64) : "",
				env: str(dobj.env, 40),
				tags: [...new Set(tags)],
				note: str(dobj.note, 2000),
				records,
				createdAt: str(dobj.createdAt, 40) || prevById.get(id)?.createdAt || now(),
				updatedAt: str(dobj.updatedAt, 40) || now(),
			};
		})
		.filter((d) => {
			if (seenDatasets.has(d.id)) return false;
			seenDatasets.add(d.id);
			return true;
		});
	return { groups, datasets };
}

export default {
	activate(host) {
		const dir = join(host.dataDir, "data-space");
		const file = join(dir, "store.json");

		let store = load();

		function load() {
			try {
				const parsed = JSON.parse(readFileSync(file, "utf8"));
				const { groups, datasets } = normalizeStore(parsed, null);
				return {
					version: 1,
					revision: Number.isFinite(parsed?.revision) ? parsed.revision : 1,
					updatedAt: str(parsed?.updatedAt, 40) || now(),
					groups,
					datasets,
				};
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
				const seeded = seedStore();
				return seeded;
			}
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
				groups: store.groups,
				datasets: store.datasets,
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
			const { groups, datasets } = normalizeStore(body, store);
			store = { version: 1, revision: store.revision + 1, updatedAt: now(), groups, datasets };
			persist();
			res.json(snapshot());
		});

		route("POST", "/reset", (req, res) => {
			const body = req.body && typeof req.body === "object" ? req.body : {};
			if (body.confirm !== true) {
				res.status(400).json({ ok: false, error: "需要 confirm:true 才能重置" });
				return;
			}
			const seeded = seedStore();
			store = { ...seeded, revision: store.revision + 1 };
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
