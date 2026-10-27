# Agent 能力目录与项目技能

本轮整理只迁移模块与同步路径、增加技能发现入口，没有修改现有功能实现。历史验收记录保留当时路径；当前查找以本文、[模块地图](project-map.md)和 [server 导航](../server/README.md)为准。

## 目录归属

| 路径                                    | 维护职责                                     |
| --------------------------------------- | -------------------------------------------- |
| `server/agent/`                         | Pi 会话、后台会话守护、子代理及模板          |
| `server/model/`                         | 模型解析、模型/服务商管理和 OAuth 流程       |
| `server/prompt/`                        | 提示词组装、persona、工具提示词及覆盖        |
| `server/skill/`                         | 技能发现、读取工具和内容填充                 |
| `server/mcp/`                           | MCP 连接、管理、热加载和插件调用身份门禁     |
| `.pi/skills/`                           | 当前项目的 API/UI 测试技能入口，纳入版本管理 |
| `plugins/api-testing/`                  | API 测试原实现与可分发阶段说明               |
| `.pi/skills/ui-testing-workflow/`       | UI 技能、原包、MCP/Playwright 与维护说明     |
| `server/dsh/`、`durable/`、`universal/` | 原有引擎实现，保留既定边界                   |

协议、入口、工具目录仍分别以 `server/protocol.ts`、`server/index.ts`、`server/tool-manager.ts` 为单源；插件、Web、桌面和部署目录仍按原职责维护。没有移动认证文件、个人模型配置、运行状态或历史证据，也没有修改模型选项、提示词正文、工具权限或业务流程。

## 项目技能

`.pi/skills/` 当前维护 `agent-evaluation`、`api-test-workflow`、`api-test-review`、`api-test-analyze`、`data-space-testing`、`ui-testing-workflow` 六个真实技能目录。Agent 评估入口按需读取插件中的唯一实现；API 入口按需读取插件中的原技能；UI 入口读取已安装 `pi-ui-testing` 包的阶段说明。原版 8 个 UI 阶段技能仍由包登记，不另外维护副本。

Pi SDK 默认发现当前项目 `.pi/skills/`；本项目的非 Pi 磁盘发现也能读取六个入口。UI 包及原生 MCP 登记沿用 `npm run ui-testing:enable`，项目模式指向 `.pi/skills/ui-testing-workflow`，新应用级登记也使用此目录；旧 `capabilities/ui-testing/` 仅保留转接，已有登记继续兼容，重跑不会重复加载。不自动修改个人应用设置。已有项目配置中若仍显式登记旧 UI 入口，应移除该重复项再刷新；本工作区已处理。

执行 `npm ci` 后运行 `npm run install:e2e` 安装原 UI 包，再按需执行 `npm run ui-testing:enable`；Pi 会话执行 `/reload` 刷新技能。技能被发现不等于运行工具可用：API 仍需当前引擎加载 API testing 插件并授予原权限；UI 仍需原包依赖和测试 MCP。缺失时按现有技能报告阻塞，不改为直接 HTTP 或绕过执行门禁。正式业务测试仍受环境、数据和授权条件约束。

`.pi/settings.json`、认证及会话数据继续忽略；仅明确列出的四个技能目录进入 Git。新增技能时同时检查忽略白名单、唯一名称、相对引用与 SDK 发现，避免复制原实现。不要将个人 `auth.json`、`models.json`、MCP 凭据或专用测试 token 放入仓库。

## 验收与回滚

模块移动清单、实现一致性和本轮执行结果见 [验收记录](capability-layout-evidence.md)。一致性检查将相对路径归一化后比较迁移前后文本；必要格式化后再统一格式比较。类型检查、相关单测、构建和冒烟验证加载链路；技能发现用隔离项目和空 agentDir，模型调用及业务请求均为零。

目录迁移涉及源码、动态读取路径、编译输出引用、测试扫描与文档导航，回滚应整体 revert 本次提交，不能只搬回单个目录。

应用级 API 接入已补齐：使用 `api-testing:enable` 同时登记三项技能和实际宿主插件，保留现有配置。实际桌面管理页与 `/api` 验收见 [记录](api-testing-visibility.md)，不能再把仅项目内技能发现当作应用接入完成。

## 日常维护从哪里开始

| 能力                                           | 入口                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| UI 测试入口、安装、MCP、Playwright、升级与验证 | [UI 维护入口](../.pi/skills/ui-testing-workflow/references/maintenance.md)                          |
| API 测试阶段说明与实现                         | `plugins/api-testing/skills/`、`plugins/api-testing/README.md`，项目入口在 `.pi/skills/api-test-*/` |
| 新增能力的管理页、快捷命令与交付验收           | [能力交付规则](capability-delivery.md)                                                              |
| 可选依赖与体积管理                             | [项目精简](project-slimming.md)                                                                     |

UI 技能目录只维护一份调度入口和配套资源；八个阶段技能仍以原分发包为事实源。历史证据保留原路径，不作为当前导航。

数据空间测试技能入口：`.pi/skills/data-space-testing/SKILL.md`，实现仍在 `plugins/data-space/`；`npm run data-space:enable -- --agent-dir <目录> --data-dir <目录>` 显式登记，保留禁用设置、不覆盖其他安装。
