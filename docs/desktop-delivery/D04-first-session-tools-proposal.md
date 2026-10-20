# D04：首个会话遗漏已就绪 MCP 工具

状态：2026-10-20 用户明确批准最小修复，并允许 Web/CLI 同样补齐首会话工具；已实施。

实际 macOS 安装包连接官方 `@modelcontextprotocol/server-filesystem@2.0.0` 后，服务已完成握手并列出 14 个工具，但首次空白会话发送给模型的工具表不含这些工具。等待设置页显示运行中，再点“新对话”仍失败，因为原逻辑复用已有空白会话。改为创建新的临时对话后，真实 MCP 中文文件读取、写入和越界拒绝均通过。全部使用本机脚本模型，无外部模型费用。

证据：`evidence/T14-mcp-initial-session-failure.json`、`evidence/T14-mcp-blank-reuse-failure.json`；后续真实工具往返记录在 `evidence/T14-mcp-filesystem.json`。当前测试还需完成审批与进程管理部分，不能解释为完整通过。

原因：`AgentService.attach()` 先调用 `ClientSession.create()` 构建首个运行态，之后才赋值 `cs.pluginToolsProvider`。如果 MCP 在此客户端创建前已经就绪，启动通知没有客户端可刷新；初次构建也取不到 provider。SDK 1.1.0 实际支持 `_refreshToolRegistry`，并非该接口缺失。

最小方案：在 `server/agent-service-daemon.ts` 完成 provider 赋值后调用原有 `cs.refreshPluginTools()` 一次。该方法已用于 MCP/插件注册变化，会按原预设、禁用名单及子代理白名单刷新现有会话；不改执行体、审批和协议。逐行提案见 `D04-proposed.patch`。此方案对 Web/CLI 同样补齐原本应有的首会话工具；如需仅限桌面，可改用明确的桌面环境开关，但会增加分支与配置。

批准后验证：首会话直接读取真实 MCP 文件，既不切换会话也不人为触发注册；审批拒绝/允许；MCP 禁用/启用与退出回收；相关单测、全项目类型检查、原源码基线和受保护哈希例外登记。
