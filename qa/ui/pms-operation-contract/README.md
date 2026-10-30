# PMS 经营合同受管录制

目标页面：`http://192.168.90.224:8238/pms/OperationContract`。

授权范围：只创建、修改和清理本次测试专属合同数据。首次发现阶段只观察页面和查询入口；创建业务数据前必须具备可验证的归属和清理流程。

当前状态（2026-10-30）：原任务已完成 `discover-record`、`case-design`，现为 `blocked / design-review`。活动父会话的 TypeScript 运行时检查已恢复；r6 两条 P0 候选连同诊断计划通过原生全文件静态检查（`issues=[]`）。同一评审循环三轮已耗尽，仍无可信批准：第 1 轮运行时错误，第 2 轮非法 JSON，第 3 轮引用不存在的 anchors。诊断、正式执行及结果回写均未启动，原 9 条全部保留未执行。

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
- 已备份旧测试依赖至 `.workbuddy/tmp/pms-ui-runtime-backup-20261029`，重新安装锁定 profile。原生 UI 包版本现为 `0.1.30`，其 parser 编译器为 `5.9.3`；工作区核心 TypeScript 则按自身配置保留 `7.0.2`，不能将两者混报。
- 此前三次录制准备失败均未开始浏览器动作，已保存 partial；它们不是测试结果。旧内存扩展是当时判断，尚未通过实际会话重载与接入验证确认根因。
- 新加载的 SDK/Chromium 受管采集与隔离 Electron 工作流回归已通过；这不代表 PMS 页面或实际用户桌面会话已验证。
- 当前会话须实际执行 `/reload` 后再次核验；普通“继续执行”消息不执行该命令。随后查询旧任务，刷新/重建私有引用，使用新录制 ID 和新 seed，核对身份和角色，再按发现、设计、入库、独立评审、诊断、正式执行、分析与结果评审继续。授权仍有效，无需重复询问入库和测试专属数据操作。

## 前次续跑：源码草稿已入库，正式执行仍阻塞

- v4 seed 静态准入通过；受管启动仍返回“私密会话准备失败；会话已保留，请保存 partial 记录”。已保存 `qa/ui/recordings/pms-operation-contract-observe-v4/manifest.json`，浏览器动作和业务写入均为 0，不能确认活动宿主已加载修复。
- 本轮通过公开 HTTP GET 200 取得部署资源 `index-Dryv8enx.js`。仅据代码声明生成 9 条查询、重置与筛选限制草稿；不是浏览器观察、业务需求确认或获批执行资产。
- 原生用例引用为 `qa/ui/cases/pms-contract-current-source-20261029/manifest.json`，部署来源与摘要见 `qa/ui/scopes/pms-contract-current-source/provenance.json`。已通过原生 `inspect` 核对全量范围后，按既有授权导入“项目管理系统 / 经营合同 / 合同查询与重置”；只读复核为 9 条 existing、pending/stale/unclassified 均为 0。
- 源码明确声明具体审批节点及项目类型筛选暂不支持；删除入口只显示“暂不支持删除”。这些属于代码声明及待验证限制，尚不能据此判定业务缺陷。可靠清理能力未确认前不创建合同数据。
- 9 条用例均为草稿、未评审、未执行；本轮通过和失败均为 0。部门数据夹具、DOM 定位器、实际身份与角色仍须补齐。原任务保留阻塞，不将草稿入库当作发现录制或最终交付完成。
- 本轮阶段证据：`docs/ui-testing-evidence/pms-contract-source-drafts-20261029.json`；历史开发回归证据不改写为本轮 PMS 测试结果。

## 重载后续跑：真实录制完整，独立评估受运行时阻塞

- 修复专用配置中 `new URL(...).pathname` 对桌面 `Application Support` 空格目录留下 `%20` 的问题，改用 `fileURLToPath`。项目本地 extension 登记统一为 canonical 入口，迁移脚本将 legacy/canonical 去重，保留其他 extension、对象过滤及禁用标志；个人安装未覆盖。
- v5 至 v13 的不完整尝试均保留 partial，包括 seed 准备、动态 MCP 尚未就绪、私有引用过期、草稿固定录制数据等问题。最终 v14 通过同工作区 fresh SDK 的完整 `ctx.executeTool` 管线，实际完成同浏览器 `pms_admin` 布尔核验、输入声明的合成名称、查询、重置、读日志、保存参数化草稿并关闭浏览器；无模型调用的临时驱动只做原生工具分发，没有批准或执行门禁覆盖。
- 完整录制：`qa/ui/recordings/pms-operation-contract-observe-v14/manifest.json`。**更正**：v13/v14 finish 初态文本中的“无数据”不准确，setup 原始快照显示共 4 条；合成名称查询后的共 0 条不能倒推初态。冻结历史未修改，更正依据见 `qa/ui/assets/pms-contract-query-reset/revisions/r2/observations.md`。
- 两条 P0 候选：`PMS-OC-SRC-001` 名称 trim/第一页查询、`PMS-OC-SRC-009` 六项条件设值后重置；候选为 `qa/ui/assets/pms-contract-query-reset/revisions/r3/manifest.json`。UI 与真实 GET 参数采用冻结预期，选项或身份前置不足记录 blocked；六项全部设值路径仍待真实运行验证。
- r3 fresh 原生静态检查为 issues=0、planned/covered=2、missing=0、ready_for_review=true。原任务已通过 case-design 原生 handoff。原 002–008 共 7 条源码草稿保留未执行；本次没有重复导入或回写执行结果。
- 当前活动主/子会话 `ui_case_design check` 仍报 `Cannot read properties of undefined (reading 'ES2022')`；实际 `ui_design_review` 请求 `pms-contract-query-reset-review-r3-01` 返回 runner-error“评估调用失败；保留已有输入与响应，不批准”。fresh 与活动宿主的加载差异已复现，具体原因待核验，不能把隔离检查当作当前桌面扩展重新加载通过。
- 原任务最新为 blocked / design-review；阶段证据：`docs/ui-testing-evidence/pms-contract-managed-continuation-20261029.json`，准确 native 静态返回：`docs/ui-testing-evidence/pms-contract-query-reset-r3-static-20261029.json`。本轮原 9 条：获批 0、正式执行 0、通过 0、失败 0、未执行 9；合同业务写入 0。不交付虚构的正式测试报告。
- 接续：在当前应用再执行 `/reload` 以加载本次登记/依赖变更；用 status/resume-task 恢复同一任务，先复核 r3 活动工具检查，再核对旧评审请求与预算，以新 request ID 续评，完成正反诊断和运行登记后才可正式执行。既有授权持续有效。绑定/同步前需对齐数据空间中的用例版本。

## 2026-10-30 续跑：活动运行时恢复，评审预算耗尽

- 项目本地显式登记原生扩展物理入口，避免已复现的 SDK/Jiti 逻辑 symlink 转译回退解析到根 TypeScript 的风险；未声称已取得旧宿主实际加载路径的完整跟踪。迁移脚本与回归已提交推送 `e65cd998d1973aab25fde4573fc919ff293ec042`；本轮父会话原生 r3 check 也为 issues=[]。这不代表 PMS 用例通过。无需重复请求旧授权或以重载替代评审续授。
- 当前 HTML 引用 `index-ByeuxnbH.js`；已冻结完整 gzip、入口、AST 精确组件/API 原文及校验索引，目录 `qa/ui/scopes/pms-contract-deployment-20261030/`。旧 Dryv8enx 文件仍可访问，不能据此认为部署未变。v15/v16 受管私密准备失败，均保留 partial，没有新浏览器动作。
- r4 原生检查暴露隔离副本 checkJs 的73项类型问题；r5 补充类型/DOM空值检查后 issues=[]。r6 针对未登记评估响应中的来源质疑，再补节点/类型 placeholder=全部、空选项 label=全部 与 reset 模型清空的精确原文，脚本及预期保持不变，原生检查同样 issues=[]。原9条断言未因实际数据只有4条而要求第二页；非首页回1的状态转换明确未覆盖。
- 最新候选：`qa/ui/assets/pms-contract-query-reset/revisions/r6/manifest.json`，SHA256 `693552cf63fe8fd2b002d26d2a7b452dc930ea20b74ec7f837d66d93863d0ce1`；两条 cases 为 `qa/ui/cases/pms-contract-query-reset-r6/manifest.json`。诊断 spec 复用已纳入候选的 r5 文件；全部配置、环境、mutation/helper 均在 files 内，但尚未批准或执行。
- 第2轮 `pms-contract-query-reset-review-r5-02` 返回非法JSON；第3轮 `pms-contract-query-reset-review-r5-03` 引用了不存在的 E15L175/E15L211/E15L243。原始 input/raw/static 均在 r5/reviews 下，未修补输出或伪造 review manifest。三轮均为 error，无pending，没有可信 approved/revise/blocked 评审产物。
- 续跑需要用户明确追加1–3轮，由受信任宿主对原 task/scope/cycle 续授；当前工具没有续授 operation，不能写 authority 文件或另建任务绕过。准备追加1轮评审 r6，诊断与正式执行授权沿用此前授权。
- 002–008 的七条未批准设计草稿另存 `qa/ui/assets/pms-contract-remaining-seven/revisions/draft-r1/cases-draft.json`。原生已交接 inventory 只含001/009，评审阶段无扩展入口，七条仍待安全追加清单及完整准入。数据空间只读 archive-status 再次核实9条 existing，pending/stale/unclassified=0；未重复入库、未绑定或回写结果。
- 本轮统计：原9条、当前候选2条、可信批准0、诊断0、正式执行0、通过0、失败0、未执行9、合同业务写入0。阶段证据 `docs/ui-testing-evidence/pms-contract-r4-continuation-20261030.json` 不构成最终测试报告。
