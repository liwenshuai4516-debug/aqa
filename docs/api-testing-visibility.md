# API 技能、插件管理与快捷入口验收

执行日期：2026-10-22。范围为当前 API 能力的应用接入、管理和快捷发现，不重新执行实际模型评审或业务接口验收。

## 原因与修改

仓库 `.pi/skills/` 中已有 API 技能入口，但桌面应用使用自己的 agent 配置和其他工作区，未登记这些路径；实际 dataDir 也没有安装 `api-testing` 插件，插件运行依赖尚未安装。因此技能、快捷菜单和宿主插件均不可见。

新增 `scripts/enable-api-testing.mjs`：显式指定应用目录，检查运行依赖，合并三个技能路径，将原插件链接到 dataDir。重复运行保留已有设置；不同安装冲突时拒绝覆盖。插件补齐图标元数据，版本同步为 0.4.2；工作流、权限与执行限制保持原有实现。

界面验收还复现了外部技能关闭后 `/reload` 自动打开的问题：失效记录清理只检查默认目录，漏掉 `settings.json.skills`。`server/settings-service.ts` 复用 SDK 发现逻辑检查配置路径，保留有效技能的禁用状态；源文件真正删除后仍清理残留。新增绝对路径、相对路径和单文件路径回归，覆盖服务重建。

`AGENTS.md` 和模块开发规范已增加同一任务补齐实际应用登记、技能管理、适用插件/工具管理、`/` 快捷发现与界面验收的要求。普通技能无需创建空插件，不自动发布市场。

后续增加了 [技能中文显示与能力联动](skill-capability-management.md)：API 插件关闭时三项技能一并停用；同页还展示 UI 测试的 SDK 扩展能力。以下为原接入轮次的历史记录。

## 当前应用登记状态

已安装 `plugins/api-testing` 的固定依赖，并实际执行登记脚本，核对当前 macOS 默认桌面目录：

- agent：`~/Library/Application Support/Pi Agent Desktop/agent`；新增三个仓库技能绝对路径。
- data：`~/Library/Application Support/Pi Agent Desktop/data`；`plugins/api-testing` 链接到仓库原插件。
- 原有配置保留，重复执行未增加重复项；未读取认证文件、未请求实际模型或业务接口。

**已运行的旧桌面进程尚未重启，不能声称已加载新宿主代码。请重启桌面应用一次。** 后续仅新增登记时，已有 Pi 会话执行 `/reload`，并在“设置 → 界面插件 → 插件列表”点击“重新扫描”。API 属于宿主插件，显示在该列表，不属于 SDK 扩展的“插件”页或公开插件市场。

设置 → 技能可管理 `api-test-workflow`、`api-test-review`、`api-test-analyze`。输入 `/api` 显示 `/skill:api-test-*` 候选，可点击或 Tab 补全。设置 → 工具可管理 `api_test_execute`。

仓库移动后应检查绝对技能路径和插件链接，不覆盖其他安装。其他桌面实例必须传其实际 agent/data 目录，不能直接套用默认目录。

## 本轮验证与证据

原生 Electron 隔离实例使用不同于仓库的工作区，先复现三个入口缺失，再登记并刷新；空模型配置，不执行模型或接口请求。

| 验证项                               | 本轮结果                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 原生桌面管理与快捷入口验收           | 8 项通过：缺失复现、幂等登记、技能显示、禁用后重载保持及恢复、快捷候选/点击/Tab、插件启停和重扫、工具管理、再次重载 |
| 相关设置/技能/快捷菜单/插件/登记单测 | 19 文件，115 通过，0 失败                                                                                           |
| 核心冒烟                             | 22/22 通过                                                                                                          |
| 类型检查、构建、lint、协议守卫       | 全部通过                                                                                                            |
| 实际模型调用 / 业务请求              | 0 / 0                                                                                                               |

[结构化结果](api-testing-evidence/visibility/summary.json)；[技能页](api-testing-evidence/visibility/after-skills.png)；[插件列表](api-testing-evidence/visibility/after-plugin.png)；[/api 候选](api-testing-evidence/visibility/slash-api.png)。原始过程日志与失败复现保留在已忽略的 `tests/scratch/api-testing-visibility/`；本轮最终界面证据目录为 `1792637875718`。早期尝试包含测试定位器修正，不能将其算成产品功能通过；技能禁用缺陷先有失败回归，再修复并通过最终验收。

复现：先安装根开发依赖与插件依赖，然后运行 `npm run test:api:visibility`。脚本使用临时 agent/data 和专属端口，不修改实际应用配置；`ensureBuild` 负责构建就绪。实际应用登记方法见 [插件说明](../plugins/api-testing/README.md#在应用中管理和快捷调用)。本轮验收不代表历史业务验收缺口已完成。
