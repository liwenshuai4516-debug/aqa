# D02 / T05：桌面退出与原服务自动续跑冲突（已批准）

原需求：退出/崩溃/更新后的重启恢复持久化状态，但不得自动重放模型请求、工具或写操作。

源码事实：`server/agent-service-daemon.ts` 的 disposeAll() 调用 recordInterruptedRuns()；attach() 无条件消费中断记录并调用 ClientSession.resumeInterrupted()。`server/agent-service.ts` 的 resumeInterrupted() 会重新打开 sessionFile 并发送 Continue prompt。这不仅是恢复 UI，会实际再次调用模型及其工具。

无法同时满足：完全不修改受保护服务层 + 保留既有自动续跑语义 + 桌面不自动重放。

最小方案（建议）：新增仅桌面设置的 `PI_WEB_RESUME_INTERRUPTED=0`。在 daemon.attach() 消费记录后，传递不含 sessionFile 的标题/cwd/at 给原 resumeInterrupted()，复用原有“中断任务请从历史手动恢复”通知，禁止自动 Continue。普通 Web/CLI 不设此变量，原行为原样保留。源目录仍只读。

受影响受保护文件：`server/agent-service-daemon.ts`（一个调用点）。其他修改：desktop/main.ts 注入变量；定向单测和真实 mock-provider Electron 退出/重开回归。协议、UI、会话格式不变。不移除业务能力，历史会话仍可手动恢复。

备选：在桌面层编辑 client-state.json 清除中断标记，需要耦合内部数据结构并改写用户运行记录，不推荐。

用户决定：2026-10-20 明确批准最小修改，桌面禁止自动续跑，Web/CLI 原行为保留。

批准后验收：Web 原自动续跑单测继续通过；桌面有真实运行中会话退出后重开，mock provider 请求计数不增长；通知与历史会话仍存在。
