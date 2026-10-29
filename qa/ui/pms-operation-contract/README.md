# PMS 经营合同受管录制

目标页面：`http://192.168.90.224:8238/pms/OperationContract`。

授权范围：只创建、修改和清理本次测试专属合同数据。首次发现阶段只观察页面和查询入口；创建业务数据前必须具备可验证的归属和清理流程。

## 环境与启动前提

- 执行 `npm run install:e2e`，使用锁定的 e2e profile。根目录的 `pi-ui-testing`、`@playwright/test`、`playwright`、`playwright-core` 应指向同一 profile；遇到非 profile 目录时先备份再修复，不直接删除。
- 工作区入口为根目录 `playwright.config.mjs`。它引用本目录的配置，不改变现有应用冒烟脚本使用的显式配置。
- `seed.spec.ts`、`seed-v3.spec.ts` 与 `seed-v4.spec.ts` 保留四次零动作准备尝试的输入，不是可复用的获批测试。它们绑定各自的录制 ID；新录制必须新建 seed 文件并使用新 ID，保留历史失败。配置只收集 `seed*.spec.ts`；受管录制仍须明确选定本次 seed。
- seed 通过 `pi-ui-testing/recording-fixtures` 使用私有身份引用。禁止把 token、口令或 storageState 内容写入文件、工具参数或报告。
- `查询` 控件只校验页面初态；seed 中的同浏览器 profile 布尔比较才校验配置账号。业务角色仍需页面探索确认。
- 受管录制须通过 `ui_discover_record`，按原有 scope、输入摘要、环境、权限、预算及采集门禁执行。CLI `--list` 只收集，不执行业务。

## 可选参数的兼容调用

本会话直接工具接口将 `start.input` 的可选引用呈现成必填，原生 `new` 模式又禁止 `asset_ref` 和 `run_ref`。不要为满足展示 schema 填入假引用。已验证可通过 `codemode` 调用同一个原生工具，仅传该模式所需的真实字段：

```javascript
await tools.ui_test_workflow({
	request: {
		operation: "start",
		input: { task_id, mode: "new", discovery: "browser", scope_ref },
	},
});
```

此路径保留正常 SDK 工具执行、权限与工作流校验。缺少阶段/MCP 工具时先 `load_tools` 加载，再以当前真实 `task_ref` 执行 `resume-task`；不新建任务绕过失败。

## 2026-10-29 修复与续跑状态

- 入口任务 `pms-operation-contract-new-20261029` 已创建并恢复至 `discover-record`。
- 修复准入模块对 TypeScript 编译器 API 的解析，只接受原生 UI 包声明的精确版本和真实 parser API；宿主 TypeScript 7 CLI 不能代替 AST 编译器。
- 已备份旧测试依赖至 `.workbuddy/tmp/pms-ui-runtime-backup-20261029`，重新安装锁定 profile。原包版本现为 `0.1.30`，编译器为 `5.9.3`。
- 此前三次录制准备失败均未开始浏览器动作，已保存 partial；它们不是测试结果。旧内存扩展是当时判断，尚未通过实际会话重载与接入验证确认根因。
- 新加载的 SDK/Chromium 受管采集与隔离 Electron 工作流回归已通过；这不代表 PMS 页面或实际用户桌面会话已验证。
- 当前会话须实际执行 `/reload` 后再次核验；普通“继续执行”消息不执行该命令。随后查询旧任务，刷新/重建私有引用，使用新录制 ID 和新 seed，核对身份和角色，再按发现、设计、入库、独立评审、诊断、正式执行、分析与结果评审继续。授权仍有效，无需重复询问入库和测试专属数据操作。

## 本轮续跑：源码草稿已入库，正式执行仍阻塞

- v4 seed 静态准入通过；受管启动仍返回“私密会话准备失败；会话已保留，请保存 partial 记录”。已保存 `qa/ui/recordings/pms-operation-contract-observe-v4/manifest.json`，浏览器动作和业务写入均为 0，不能确认活动宿主已加载修复。
- 本轮通过公开 HTTP GET 200 取得部署资源 `index-Dryv8enx.js`。仅据代码声明生成 9 条查询、重置与筛选限制草稿；不是浏览器观察、业务需求确认或获批执行资产。
- 原生用例引用为 `qa/ui/cases/pms-contract-current-source-20261029/manifest.json`，部署来源与摘要见 `qa/ui/scopes/pms-contract-current-source/provenance.json`。已通过原生 `inspect` 核对全量范围后，按既有授权导入“项目管理系统 / 经营合同 / 合同查询与重置”；只读复核为 9 条 existing、pending/stale/unclassified 均为 0。
- 源码明确声明具体审批节点及项目类型筛选暂不支持；删除入口只显示“暂不支持删除”。这些属于代码声明及待验证限制，尚不能据此判定业务缺陷。可靠清理能力未确认前不创建合同数据。
- 9 条用例均为草稿、未评审、未执行；本轮通过和失败均为 0。部门数据夹具、DOM 定位器、实际身份与角色仍须补齐。原任务保留阻塞，不将草稿入库当作发现录制或最终交付完成。
- 本轮阶段证据：`docs/ui-testing-evidence/pms-contract-source-drafts-20261029.json`；历史开发回归证据不改写为本轮 PMS 测试结果。
