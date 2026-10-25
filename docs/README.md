# 项目文档导航

本目录是当前仓库的开发与维护入口。用户安装说明见 [简体中文 README](../README.zh-CN.md)；参与开发先读 [AGENTS.md](../AGENTS.md)。

## 建议阅读顺序

1. [项目与模块地图](project-map.md)：了解各目录负责什么、一次请求经过哪些模块。
2. [模块开发规范](module-development.md)：选择扩展方式，填写功能设计清单，确认需要联动的文件。
3. [开发工作流](development.md)：运行、测试、格式和提交前验证。
4. 按任务阅读下表中的专题；查具体文件时使用 [目录参考](directory-reference.md)。

能力目录与项目 API/UI 技能维护见 [能力维护指南](capability-layout.md)；桌面技能/插件管理与 `/api` 快捷接入见 [API 管理入口验收](api-testing-visibility.md)。

## 按任务查找

| 任务                                 | 文档                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| 新增功能、划分模块、准备验收         | [模块开发规范](module-development.md)                                                    |
| 定位代码、维护目录与文档             | [项目与模块地图](project-map.md)、[目录参考](directory-reference.md)                     |
| 会话、协议、快照、全局状态、安全边界 | [核心架构](architecture-core.md)                                                         |
| 文件上传、附件、预览与下载           | [附件架构](architecture-attachments.md)                                                  |
| PTY、终端接管、Git 操作              | [终端架构](architecture-terminal.md)                                                     |
| 插件、UI 插槽、MCP、工作区授权       | [插件架构](architecture-plugins.md)、[插件 SDK](../plugin-sdk/README.md)                 |
| 系统提示词、工具定义、上下文预算     | [系统提示词](architecture-system-prompt.md)、[工具上下文预算](tool-context-budget.md)    |
| 引擎接入与 DSH                       | [项目与模块地图](project-map.md)、[DSH 引擎](dsh-engine.md)                              |
| 目标审查、执行对话、轮次管理         | [目标模式设计](goal-conversation-design.md)                                              |
| 设置预设导入、导出与分享             | [预设分享](preset-sharing.md)                                                            |
| 本地开发、测试、CI                   | [开发工作流](development.md)                                                             |
| 大文件评估、缓存与临时依赖清理       | [项目体积维护](project-cleanup.md)                                                       |
| 配置、部署、反向代理                 | [环境变量](env-vars.md)、[部署](deployment.md)、[Antigravity 反代](antigravity-proxy.md) |
| 日常代码备份、正式发布               | [备份与发布](backup-and-release.md)、[发布说明](release.md)                              |
| Electron 开发、安装包与桌面验收      | [桌面说明](../desktop/README.md)、下方桌面交付记录                                       |

## UI 测试维护与验收

- [本项目环境与数据 fixture](../qa/ui/README.md)：临时服务、身份与初态预检、归属数据、重复执行及中断清理。
- [P0 守卫与 fixture 验收](ui-testing-p0-evidence.md)：操作分类、实际 SDK/宿主门禁、隔离浏览器和残留证据。
- [UI 优化执行记录](ui-testing-optimization-execution.md)：分阶段工程证据、私密捕获回归及未完成门禁；分发包维护见[统一入口](../.pi/skills/ui-testing-workflow/references/maintenance.md)。
- [U05 源码候选证据](ui-testing-evidence/optimization-u05-source-candidate.json)：六功能、13 断言的静态映射与评审阻塞；不代表设计获批或候选已执行。
- [U05 定位重验证据](ui-testing-evidence/optimization-u05-locator-revalidation.json)：重复按钮、iframe及受控wrapper变化的原生录制检查，保留partial边界。
- [U05 诊断输入准备](ui-testing-evidence/optimization-u05-probes.json)：13个错误副本及诊断契约，明确区分HTTP/静态检查与未执行的浏览器正反诊断。
- [U05 原生评审续跑](ui-testing-evidence/optimization-u05-native-continuation.json)：14地址恢复与3轮错误记录；HTTP402额度阻塞，无批准，13浏览器诊断未执行。
- [U05 浏览器候选交接](ui-testing-evidence/optimization-u05-browser-candidate.json)：58动作完整录制、六功能/13断言静态候选；旧partial/预算分支保留，设计批准仍阻塞。
- [U05 追加授权评审](ui-testing-evidence/optimization-u05-authorization2.json)：追加3次原生尝试、1次供应商请求仍HTTP402；未批准、未诊断。
- [U05 官方额度路径核对](ui-testing-evidence/optimization-u05-quota-path.json)：同一原生认证路径的官方余额不可用；新增授权未消耗，待充值后续跑。
- [U05 GPT独立评审及v2修订](ui-testing-evidence/optimization-u05-gpt-review.json)：模型路径已恢复，D4/D8退回并静态修订；未重评、未批准。

- [U04 目录/状态读取计量](ui-testing-evidence/optimization-u04-catalog.json)：真实历史批次的逐路径计数与变更重验，不代表整体性能验收。
- [U04 单次引用读取去重](ui-testing-evidence/optimization-u04-reference-reuse.json)：0.1.4源码修复、相同历史样本对比及安装/桌面回归；不声明整体提速。
- [U04 五组成对查询测量](ui-testing-evidence/optimization-u04-paired.json)：交替版本、480查询、全部耗时及失败留证；整体性能收益未证实。

## 功能设计提案

- [Agent 评估中心统一技术方案与分期实施规范](agent-evaluation-design-plan.md)：内部任务与外部 Agent 合并为一个中心；统一证据、状态、独立核验及扩展契约；EC00–EC14 实施步骤、AC01–AC40 验收与分批执行约束；设计 2.1，功能待实施。
- [Agent 评估 EC00 基线](agent-evaluation-evidence/EC00.md)：当前代码复用审计、M1 契约/权限/资源门槛、合成基线与外部实测前置条件；实施与验收按工作包记录，不以基线冻结代替功能通过。
- [外部 Agent 评估旧入口](external-agent-evaluation-design.md)：转向统一规范，保留旧 EX/T 编号迁移说明，不再维护独立实施方案。
- [接口测试本机 OS/MCP 隔离补验](api-testing-evidence/isolation-local-mcp.md)：合成文件、进程继承与端口边界；真实目标仍未开放。
- [接口测试当前完成审计](api-testing-evidence/completion-audit.md)：工程/实际模型证据、真实业务缺口和按需延后项。
- [P3-2 持续问题跟踪](api-testing-evidence/P3-2.md)：历史关联、预算分析修订、已知异常零重复调用及站内变化提示。
- [P3-1 宿主定时执行](api-testing-evidence/P3-1.md)：固定 fixture 授权、计划时间账本、严格保存和停止/恢复。
- [P2-2 最小资产管理](api-testing-evidence/P2-2.md)：列表、草稿克隆、归档、引用检查及同宿主备份恢复。
- [P2-1 持久化与复用](api-testing-evidence/P2-1.md)：重启回看、零模型重跑、文件校验与未知写入阻断；仍仅 fixture。
- [P1-4 实际模型补验](api-testing-evidence/P1-4-model.md)：复用系统 GPT，独立语义退回/批准与真实 MCP fixture 闭环通过；业务验收另列。
- [P1-4 技能发现与接入清单](api-testing-evidence/P1-4.md)：技能工程检查通过；用户确认暂无专用模型，实际主流程验收阻塞。
- [P1-3 执行与问题闭环](api-testing-evidence/P1-3.md)：17 项 fixture 检查、真实 MCP/Newman，实际模型/业务另验收。
- [P1-2 评审控制工程验收](api-testing-evidence/P1-2.md)：确定性重编译、有界独立评审；模型替身不代表实际模型语义验收。
- [P1-1 契约与固定模板验收](api-testing-evidence/P1-1.md)：本地 OAS 3.0、带依据候选、草稿包和真实文档只读接入限制。
- [P0-2 受控宿主接线验收](api-testing-evidence/P0-2.md)：身份、权限、专属 runner 与取消收尾；仅自包含 fixture。
- [P0-1 执行可行性验收](api-testing-evidence/P0-1.md)：真实 MCP/Newman fixture 结果、接入决定、隔离缺口与复现方式；不代表真实业务已接入。
- [接口测试分阶段执行计划](api-testing-implementation-plan.md)：复审结论、优先级任务、依赖、约束、方案依据与 Codex 执行模板；后续实施先读此文。
- [Agent 接口自动化测试闭环](api-testing-workflow-design.md)：多格式导入、用例评审回路、MCP 执行选型、异常分析与复测关闭；当前为设计，尚未实现。
- [接口测试资产、回放与定时执行](api-testing-assets-design.md)：版本持久化、批准复用、历史回看与再次执行、低成本定时回归；先跑通主流程，再实施存储管理和调度。

UI 测试能力接入见 [Pi UI workflow 接入与验收](ui-testing-integration.md)：复用原版运行包与阶段技能，仅对齐依赖并接入原生测试 MCP。

技能中文别名、描述、插件联动及 UI 扩展加载状态见 [技能与能力管理](skill-capability-management.md)。

## 桌面交付记录

`desktop-delivery/` 保存当前决定与历史验证证据，阅读顺序如下：

1. [当前范围与用户决定](desktop-delivery/scope-decisions.md)。
2. [完成条件与缺口](desktop-delivery/completion-audit.md)、[验收矩阵](desktop-delivery/acceptance-matrix.md)。
3. [交付状态](desktop-delivery/delivery-status.md)、[变更登记](desktop-delivery/change-register.md)、[已批准差异](desktop-delivery/approved-changes.json)。
4. 需要追溯时再查看 `Txx-*`、`Dxx-*`、基线和补丁文件。提案不代表已经实施，历史通过不代表本轮通过。

## 文档维护分工

| 文档                            | 维护内容                                     |
| ------------------------------- | -------------------------------------------- |
| `AGENTS.md`                     | 核心规则、验证与提交要求；详细约束按主题读取 |
| `docs/README.md`                | 阅读顺序与专题链接，不复制实现细节           |
| `docs/project-map.md`           | 模块职责、入口、依赖边界与目录管理           |
| `docs/module-development.md`    | 新功能开发步骤、联动清单与验收模板           |
| `docs/directory-reference.md`   | 文件级定位说明；以实际源码为准               |
| `docs/architecture-*.md` 等专题 | 实现机制、设计取舍和对应测试                 |

新增模块时更新地图与目录参考；新增专题时在本文登记。规范冲突先核对当前用户决定、`AGENTS.md` 和代码事实，修正文档，不把历史描述当作新需求。

项目精简与分组依赖见 [项目精简](project-slimming.md)；按改动主题读取 [开发约束](development-constraints.md)，新增能力先读 [能力交付规则](capability-delivery.md)。

UI 测试日常修改、安装与升级统一从 [技能维护入口](../.pi/skills/ui-testing-workflow/references/maintenance.md) 开始，旧接入记录用于追溯。

- [UI 测试优化执行记录](ui-testing-optimization-execution.md)：基线、原生修复、回归证据及未完成项。
- [UI 测试链路优化实施计划](ui-testing-optimization-plan.md)：U00–U09 顺序、前置门禁、分项验收、性能对照和 Electron 交付标准。
- [数据空间与 UI/API 自动化接入](data-space-integration.md)：环境初始化、双向归档、启动修复、验收状态与证据。
- [数据空间测试数据规范](../.pi/skills/data-space-testing/SKILL.md)：Agent 查询、结果回写与结构化交付，含离线一致性校验，复用原生证据和既有数据空间工具。

UI 浏览器候选诊断准备入口：`tests/ui-browser-diagnostic-prepare.mjs`；范围、未执行门禁与恢复点见 [UI 优化执行记录](ui-testing-optimization-execution.md)。

UI 获批浏览器候选正式执行入口：`tests/ui-browser-approved-run.mjs`；评审、诊断、正式结果与报告状态见 [UI 优化执行记录](ui-testing-optimization-execution.md)。

UI 现行获批资产基准：`tests/ui-approved-baseline-measure.mjs`；测量与未覆盖项见 [优化执行记录](ui-testing-optimization-execution.md)。

UI 子进程/API基准观察：`tests/ui-approved-baseline-measure.mjs <获批证据目录> --observe-children`；记录Playwright 1.62.1调用开始/完成/失败，参数不入计数，校准及范围见 [优化执行记录](ui-testing-optimization-execution.md)。

UI 获批产物桌面归档：`tests/ui-approved-archive-desktop-test.mjs`，复用原独立批准的六功能正式批次，验证隔离Electron映射/同步/重启恢复；见 [执行记录](ui-testing-optimization-execution.md)。

UI 首次候选计量：`tests/ui-function-discovery-test.mjs --complete-candidate --measure`；范围和未测项见 [优化执行记录](ui-testing-optimization-execution.md)。
