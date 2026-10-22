# 数据空间（data-space）

测试资产的台账：把「哪个系统、哪个模块、哪个功能」下的用例、步骤、预期和数据集中记到一处，避免用例散落在表格、聊天和文档里各说一套。

- 顶栏一级入口（与「对话 / 终端 / Git」平级），可在「插件管理」里关掉。
- 演示版本只做「记下来 + 找得到 + 导出得了」，不执行用例、不连测试环境、不生成报告。
- 数据全局一份，不按项目/会话隔离；换会话、换项目读到的是同一批数据。

## 三层结构

```
系统（system）
└─ 模块（module）
   └─ 功能（feature）   ← 用例与数据集的挂载点
      ├─ 用例（case）
      └─ 数据集（dataset，可留空表示未归类）
```

例：`项目管理系统 / 合同管理 / 经营合同` 下面挂「新建经营合同-必填项完整可保存」这条用例，以及它用到的账号、参数。

层级只存父引用（`systemId` / `moduleId` / `featureId`），不存嵌套数组——搜索、移动节点、导入导出都简单，悬空引用在服务端统一清洗。

## 四个页面

| 页面   | 作用                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------- |
| 概览   | 系统 / 功能 / 用例 / 数据集数量、功能覆盖率（有用例的功能占比）、按系统分布、覆盖缺口、最近更新。 |
| 用例库 | 左侧系统 → 模块 → 功能树，右侧对应用例表；支持按编号 / 标题 / 标签搜索，优先级与状态筛选。        |
| 数据集 | 键值记录按功能归类，按系统 / 模块 / 功能筛选，新建 / 编辑 / 复制 / 删除。                         |
| 设置   | 数据文件路径、导入 / 导出 JSON、恢复示例数据、当前 revision、维护提示。                           |

用例字段：编号（按系统前缀自动生成，如 `PMS-004`）、标题、优先级 `P0~P3`、类型（功能 / 接口 / UI / 性能 / 兼容 / 安全）、状态（草稿 / 待评审 / 已评审 / 已废弃）、负责人、标签、前置条件、步骤（操作 → 预期，多步）、关联数据集、备注。

「覆盖缺口」列的是还没有任何用例的功能，点一下直接跳到该功能下新建用例——这是本页的主要用法：先看缺口，再补用例。

删除节点只删层级：删系统会连带删它的模块与功能，但用例与数据集不删，退回「未归类」，编辑时选一个新功能即可归位。

## 数据放在哪

```
<dataDir>/data-space/store.json
```

`<dataDir>` 就是 `PI_WEB_DATA_DIR`（默认 `~/.pi-web`）。放在这里而不是插件目录，是为了让插件升级、重装、卸载都不会碰用户数据。「设置」页会显示当前的真实路径。

结构（`JSON.stringify(…, null, "\t")`，可手改）：

```json
{
	"version": 2,
	"revision": 12,
	"updatedAt": "2026-10-22T08:07:00.000Z",
	"systems": [{ "id": "s-…", "name": "项目管理系统", "code": "PMS", "color": "blue", "note": "", "createdAt": "…" }],
	"modules": [{ "id": "m-…", "systemId": "s-…", "name": "合同管理", "note": "", "createdAt": "…" }],
	"features": [{ "id": "f-…", "moduleId": "m-…", "name": "经营合同", "note": "", "createdAt": "…" }],
	"cases": [
		{
			"id": "c-…",
			"featureId": "f-…",
			"code": "PMS-001",
			"title": "新建经营合同-必填项完整可保存",
			"priority": "P0",
			"type": "功能",
			"status": "已评审",
			"owner": "张工",
			"tags": ["冒烟", "合同"],
			"preconditions": "已登录且有合同新建权限",
			"steps": [{ "id": "st-…", "action": "打开合同管理-经营合同", "expect": "列表加载完成" }],
			"datasetIds": ["d-…"],
			"note": "",
			"createdAt": "…",
			"updatedAt": "…"
		}
	],
	"datasets": [
		{
			"id": "d-…",
			"featureId": "f-…",
			"name": "经营合同-新建参数",
			"env": "测试环境",
			"tags": ["冒烟"],
			"note": "",
			"records": [{ "id": "r-…", "key": "contractName", "value": "自动化合同", "remark": "" }],
			"createdAt": "…",
			"updatedAt": "…"
		}
	]
}
```

- `systemId` / `moduleId` / `featureId` 为空或指向不存在的节点时，服务端保存时会把这条数据丢掉（模块、功能）或置空归属（用例、数据集）。
- `color` 取 `blue | green | amber | purple | teal | gray | red`；`env` 取 `本地 | 测试环境 | 预发环境 | 生产`，留空也允许。
- 想让 AI 批量改数据，直接把这份文件交给它改，刷新页面即可看到（不必重启服务）。
- 单个文件上限：系统 60 / 模块 240 / 功能 720 / 用例 3000 / 数据集 500，每份数据集 200 行，每条用例 60 步、12 个标签、20 份关联数据。演示版够用，真超了再拆文件。

## 与 0.1.0 的差异

0.1.0 只有「分组 + 数据集」（`version: 1`）。新版本读到时自动迁移：

- 每个分组变成一个系统（`code` 留空、颜色保留）；
- 数据集全部保留，归属清空为「未归类」；
- 旧文件先备份为 `store.json.v1-<时间戳>.bak`，迁移结果立刻落盘，只迁移一次；
- 页面「概览」「设置」会显示迁移提示，直到下一次保存（之后 `migratedFrom` 归零）。

旧格式 `{ groups, datasets }` 的 JSON 也能从「设置 → 导入」进来，导入时按同样规则转换。

## 写入与并发

整份快照提交 + `baseRevision` 乐观锁：

- `POST /plugins-api/data-space/save`，body `{ baseRevision, systems, modules, features, cases, datasets }`；
- 版本对得上 → 清洗、落盘并 `revision + 1`；
- 版本对不上 → `409 { code: "conflict", store }`，前端载入返回的最新快照并提示重新修改（不静默覆盖）；
- `POST /plugins-api/data-space/reset`，必须 `{ confirm: true }`，回到示例数据。

落盘走 `store.json.tmp.<pid>` + rename，写入中途崩溃不会留下半份文件；文件解析失败时会被隔离成 `store.json.corrupt-<时间戳>`，随后播种示例数据。

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

零 token：自起服务 + 独立 dataDir，覆盖示例播种（三层结构）、保存、悬空引用清洗、版本冲突、视图文件下发、重启后数据仍在、0.1.0 旧库迁移与备份、恢复示例。也登记在 `tests/run-smoke.mjs`。
