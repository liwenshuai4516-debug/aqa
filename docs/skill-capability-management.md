# 技能中文显示与能力联动

2026-10-22。范围：当前 Pi 引擎的技能管理、`/` 与 `@` 快捷发现、插件依赖和 UI 测试能力管理。依据为用户的四项界面要求、现有 SDK 资源加载链及隔离桌面行为；不重新实现测试 runner，不执行真实业务测试。

## 原因与结果

原界面直接展示技能原始 `name` 和英文 `description`；插件禁用仅限制插件工具和界面，没有限制独立安装的关联技能。UI 测试通过 SDK package/extension 加载，原宿主插件列表只读取 Web 插件，所以无法显示它。

现在使用中文展示别名和描述，保留 SDK 原技能 ID。设置页名称悬停可查看 ID；输入 `/接口`、`/api`、`/ui` 或 `@接口` 都可查找，补全仍插入规范调用，如 `/skill:api-test-workflow `。内置翻译覆盖当前 API、UI 与钉钉技能；未提供翻译的第三方技能保留原描述，不伪造翻译。英文界面保留原技能名和原说明。

API 三项技能依赖 `api-testing`，钉钉技能依赖 `dingtalk`，UI 九项技能依赖原工作流与测试 MCP 扩展。关闭所属能力后，关联技能显示关闭原因且开关不可操作，名录和快捷候选移除，手工输入旧技能命令被服务端拦截。技能工具也读取实时依赖门禁。模板白名单不能绕过关闭的依赖。

关联关闭不写入技能的单独禁用名单，重新开启能力会恢复原偏好。技能、Pi 扩展和插件列表均将开启项排列在关闭项之前。设置变更重载各个 Pi 会话；正在回复时延迟资源重载，技能工具和扩展工具门禁先实时生效，避免拆毁运行中的回复。

插件列表新增“UI 自动化测试”，展示真实 SDK 扩展加载、错误或关闭状态，开关沿用 `disabledExtensions` 同时控制原包和 MCP 薄扩展，重载后保留。没有复制一份 Web 插件或测试实现。“扩展已加载”指模块已进入 SDK 资源表；MCP 是否连接成功仍以 `/mcp` 回执为准，不能把模块加载等同于业务测试通过。

## 第三方技能的可选元数据

原技能正文无需改动。若需要自定义中文别名、双语说明和宿主插件关联，可在 `SKILL.md` 的标准 `metadata` 中声明：

```yaml
---
name: example-workflow
description: Original English description.
metadata:
  display-name: 示例测试流程
  description-zh: 示例流程的中文说明。
  description-en: Example workflow description.
  plugin-id: example-plugin
---
```

`name` 继续作为唯一调用 ID。元数据仅参与展示、搜索与关闭依赖判断，不授权工具、不增加插件权限。修改后在 Pi 中执行 `/reload`。已安装的外部技能与原版 UI 运行包均未被改写。

## 验证

环境为 macOS arm64、Node 23.10.0、项目绑定的 Pi SDK 1.2.0，原生 Electron 配合 Chromium 自动化。测试使用临时 agentDir/dataDir、不同于仓库的工作区和独立端口，无个人认证、付费模型或业务请求。用户正在运行的应用未被自动重启。

- 修复前新增中文别名搜索回归，复现返回空候选；修复后相关单测通过。
- 隔离桌面综合验收通过 10 项，覆盖中文名称/描述、中文及英文前缀查找、点击/Tab 补全、插件关闭后技能不可调用、恢复原偏好、启用排序、UI 能力加载/关闭/恢复、重载持久性、原 API 工具管理。
- 原始证据：`tests/scratch/api-testing-visibility/1792640154082/`，包括 `result.json`、`after-skills.png`、`slash-api.png`、`owner-disabled-skills.png`、`ui-capability-loaded.png`、`ui-capability-disabled.png`。最终轮次与其他检查结果见下方交付记录。
- 全量单测：5175 通过、2 失败、9 跳过，共 5186 项；两项失败在未修改的 HEAD 文件中独立复现：`link-plugins.test.ts` 的软链接删除出现 `ERR_FS_EISDIR`；`plugin-sdk-mock.test.ts` 检测到包版本 `0.1.3` 与导出版本 `0.1.2` 不同。没有为本任务修改无关实现或跳过失败。

本轮仅验证 Pi 管理链路，不宣称其他引擎、Windows/Linux 或正式业务用例已验收。运行中的旧应用需要重新启动才能加载新宿主代码，单独 `/reload` 不能替换进程内已经导入的代码；启动新代码后即可使用现有登记，无需重装工作流。

### 最终交付检查

| 检查                           | 结果                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 相关单测                       | 12 文件、101 项通过；包含实时技能工具门禁、中文别名、依赖关闭/恢复、磁盘元数据和扩展身份匹配                                            |
| 类型、lint、协议、语言包、格式 | 通过；协议新增字段均为可选，其他引擎和旧快照可以省略                                                                                    |
| 项目构建                       | 通过；末次服务端变更后重建并完成桌面综合复验                                                                                            |
| 桌面综合复验                   | 10 项通过，九项 UI 技能均验证依赖关闭；恢复后 `/mcp` 为 `ui-playwright-test: connected, 87 tools (direct)`                              |
| UI 桌面连接回归                | 6 项通过，包含连续三次 `/reload` 和显式 MCP reconnect                                                                                   |
| 核心冒烟                       | 首轮 20/22；`quiesce-test` 首轮失败、单独复跑通过；`plugin-scaffold-test` 仍失败，其 UI-slot 激活日志缺失在干净 HEAD 归档构建中同样复现 |
| 最终设置/快捷命令冒烟          | 2/2 通过                                                                                                                                |
| 实际模型和业务测试             | 未执行；模型调用 0，业务请求 0                                                                                                          |

最终截图与完整回执位于 `tests/scratch/api-testing-visibility/1792640947978/`；UI 连接回归位于 `tests/scratch/ui-workflow-visibility/1792640396005/`。核心失败复跑日志为 `tests/scratch/skill-capability-smoke-failures.log`，干净基线复现日志为 `tests/scratch/skill-capability-baseline-scaffold.log`，最终相关冒烟日志为 `tests/scratch/skill-capability-final-smoke.log`。

自动化首次附加曾遇到已关闭页面及关闭超时，失败保留；测试改为选择实际打开的本地应用页、等待设置应用回执后再检查状态，并在关闭失败时仍保存原始断言错误。没有跳过功能断言或将失败轮次改记为通过。
