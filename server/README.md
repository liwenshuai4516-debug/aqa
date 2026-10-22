# 服务端能力目录

[项目地图](../docs/project-map.md) · [能力维护指南](../docs/capability-layout.md)

业务实现按职责分组；入口、协议和跨模块公共机制保留在根目录。目录迁移只改变导入与文件引用，不改变工具注册、模型选择、提示词、权限或执行行为。

| 目录     | 现有模块                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`  | `agent-service.ts`、`agent-service-daemon.ts`、`agent-formatters.ts`、`subagents.ts`、`subagent-handoff.ts`、`subagent-helpers.ts`、`subagent-templates.ts`、`subagent-templates-hant.ts` |
| `model`  | `model-admin.ts`、`model-resolver.ts`、`model-enrich.ts`、`provider-oauth-flow.ts`                                                                                                        |
| `prompt` | `prompt-assembler.ts`、`prompt-composer.ts`、`persona-chain.ts`、`tool-prompts.ts`、`tool-prompt-overrides.ts`                                                                            |
| `skill`  | `skill-tool.ts`、`skill-discovery.ts`、`skill-content-filler.ts`、`skill-presentation.ts`                                                                                                 |
| `mcp`    | `mcp-bridge.ts`、`mcp-manager.ts`、`mcp-hot-reload.ts`、`mcp-agent-tool.ts`、`plugin-mcp.ts`                                                                                              |

`index.ts` 继续作为服务入口，`protocol.ts` 继续作为跨端协议单源；`tool-manager.ts` 继续作为工具开关目录单源。`dsh/`、`durable/`、`universal/` 保持原有引擎边界；`plugins.ts` 与 `plugin-*` 仍负责宿主插件服务（MCP 门禁位于 `mcp/plugin-mcp.ts`）。跨目录依赖使用明确相对导入，不增设重导出兼容层或第二份实现。

构建目录相应为 `dist/server/<目录>/`，启动入口仍是 `dist/server/index.js`。修改引用时同步测试内源码读取路径、动态导入和文档链接；源码扫描守卫必须继续覆盖已移动的原文件。
