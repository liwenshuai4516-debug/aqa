# PMS 经营合同受管录制

目标页面：`http://192.168.90.224:8238/pms/OperationContract`。

授权范围：只创建、修改和清理本次测试专属合同数据。首次发现阶段只观察页面和查询入口；创建业务数据前必须具备可验证的归属和清理流程。

## 环境与启动前提

- 执行 `npm run install:e2e`，使用锁定的 e2e profile。根目录的 `pi-ui-testing`、`@playwright/test`、`playwright`、`playwright-core` 应指向同一 profile；遇到非 profile 目录时先备份再修复，不直接删除。
- 工作区入口为根目录 `playwright.config.mjs`。它引用本目录的配置，不改变现有应用冒烟脚本使用的显式配置。
- `seed.spec.ts` 与 `seed-v3.spec.ts` 是三次零动作准备尝试保留的输入，不是可复用的获批测试。它们绑定各自的录制 ID；新录制必须新建 seed 文件并使用新 ID，保留历史失败。
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
- 在旧内存扩展中尝试的三次录制均未开始浏览器动作，已保存 partial；它们不是测试结果。
- 新加载的 SDK/Chromium 受管采集与隔离 Electron 工作流回归已通过；这不代表 PMS 页面或实际用户桌面会话已验证。
- 当前会话须先 `/reload`。随后查询旧任务，刷新/重建私有引用，使用新录制 ID 和新 seed，核对身份和角色，再按发现、设计、入库、独立评审、诊断、正式执行、分析与结果评审继续。授权仍有效，无需重复询问入库和测试专属数据操作。
