# 数据空间（data-space）

测试数据的管理与区分工具：把「哪个环境、哪个模块」的测试数据集中记到一处，避免散落各处的账号、设备号、工单编号互相打架。

- 顶栏一级入口（与「对话 / 终端 / Git」平级），可在「插件管理」里关掉。
- 只做数据管理，不做用例、执行与报告。
- 数据全局一份，不按项目/会话隔离；换会话、换项目读到的是同一批数据。

## 四个页面

| 页面   | 作用                                                                 |
| ------ | -------------------------------------------------------------------- |
| 概览   | 数据集 / 分组 / 记录 / 环境的数量，按分组分布与最近更新。            |
| 数据集 | 搜索（名称 / 标签 / 环境）、按分组筛选、新建 / 编辑 / 复制 / 删除。  |
| 分组   | 新建分组，改名、换色、写备注；删除分组不会删数据（变为「未分组」）。 |
| 设置   | 数据文件路径、导入 / 导出 JSON、恢复示例数据、当前 revision。        |

## 数据放在哪

```
<dataDir>/data-space/store.json
```

`<dataDir>` 就是 `PI_WEB_DATA_DIR`（默认 `~/.pi-web`）。放在这里而不是插件目录，是为了让插件升级、重装、卸载都不会碰用户数据。「设置」页会显示当前的真实路径。

结构（`JSON.stringify(…, null, "\t")`，可手改）：

```json
{
	"version": 1,
	"revision": 3,
	"updatedAt": "2026-10-22T08:07:00.000Z",
	"groups": [{ "id": "g-…", "name": "用户与权限", "color": "blue", "note": "", "createdAt": "…" }],
	"datasets": [
		{
			"id": "d-…",
			"name": "登录成功-普通账号",
			"groupId": "g-…",
			"env": "测试环境",
			"tags": ["冒烟", "登录"],
			"note": "",
			"records": [{ "id": "r-…", "key": "username", "value": "test_user", "remark": "" }],
			"createdAt": "…",
			"updatedAt": "…"
		}
	]
}
```

- `groupId` 为空表示「未分组」；`color` 取 `blue | green | amber | purple | gray`。
- 想让 AI 批量改数据，直接把这份文件交给它改，刷新页面即可看到（不必重启服务）。
- 手改后如需让其它窗口重新读，刷新页面即可；不要同时手改又在页面上保存，否则后保存的一方会收到「数据已被其他窗口更新」的提示。

## 写入与并发

整份快照提交 + `baseRevision` 乐观锁：

- `POST /plugins-api/data-space/save`，body `{ baseRevision, groups, datasets }`；
- 版本对得上 → 落盘并 `revision + 1`；
- 版本对不上 → `409 { code: "conflict", store }`，前端载入返回的最新快照并提示重新修改（不静默覆盖）。

落盘走 `store.json.tmp.<pid>` + rename，写入中途崩溃不会留下半份文件；文件解析失败时会被隔离成 `store.json.corrupt-<时间戳>`，随后按示例数据重新播种。

## 本地查看

```bash
npm run plugins:link   # 把工作区内置插件链到本机 dataDir
npm run dev            # 打开 http://localhost:5173
```

`plugins:link` 只影响本机开发用的 dataDir；打包发布时插件随主程序走 `plugins/catalog.json`，内置同步会把已存在的 catalog 插件热更新到新版本。

## 测试

```bash
node tests/data-space-plugin-test.mjs
```

零 token：自起服务 + 独立 dataDir，覆盖示例播种、保存、版本冲突、视图文件下发、重启后数据仍在、恢复示例。也登记在 `tests/run-smoke.mjs`。
