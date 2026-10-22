# 能力资源

这里保存可复用能力的分发资源与薄接入，服务端实现归属见 [server](../server/README.md)，项目可发现技能统一在 [.pi/skills](../.pi/skills/)。

| 能力         | 项目技能入口                                               | 原实现/资源                                                                               |
| ------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| API 接口测试 | `api-test-workflow`、`api-test-review`、`api-test-analyze` | `plugins/api-testing/` 的现有工具、阶段技能、MCP/Newman runner                            |
| UI 测试      | `ui-testing-workflow`                                      | `ui-testing/` 原版包、MCP 薄接入及 Playwright 配置；8 个阶段技能由 `pi-ui-testing` 包提供 |

技能入口只指向原有说明和工具，不复制执行实现。Agent/模型/prompt/MCP 的服务端职责分别位于 `server/agent`、`server/model`、`server/prompt`、`server/mcp`；个人认证、模型配置和运行数据维持原位置，不搬入能力目录。
