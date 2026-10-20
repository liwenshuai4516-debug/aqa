# D06：委派开关重载后遗失工具禁用设置（已批准，复验中）

T19 使用最新实际 DMG 安装包、本地供应商、独立数据目录复现：设置只启用 read/write，执行会话的请求确实只有这两个工具；开启再关闭委派模式后，主对话的目标审查请求却重新携带全部 30 个工具（含 bash、write、subagent），请求 43,652 字节。费用输入限制在转发前拦截，尚未发生本轮付费请求。

失败证据：`evidence/D06-before-package.json` 的 lastRequestShape。先前输入限制失败均独立保留。该结果验证的是模型可见工具禁用设置丢失，不代表已经绕过执行时的审批或审查写保护。

原因：`server/agent-service.ts` 的 setDelegateMode 调用 SDK reload，但没有像现有 SettingsService reloadSession 回调一样重放 applyToolGating；源码自身注释明确指出 reload 会恢复全部 custom 工具。

最小修复：reload 成功后，调用已有 `this.applyToolGating(target.session, target.agentPreset)`。不新增开关、不改变委派路由或审批策略，Web/CLI 同步恢复原禁用设置。逐行差异见 D06-proposed.patch。等待批准期间只继续测试和文档，不修改此受保护源码。

批准后验收：先补充可失败的委派开关端到端断言，再修复、执行相关单测与类型检查，重建包并用同一 T19 本地脚本验证实际请求仍只有 read/write；通过后才进行真实模型验收。

用户同日明确批准这一行修复及重建包复验。新增原 delegate-mode-test 的工具列表断言，在旧编译服务上失败（D06-before-regression.log），一行修复重新编译后同一测试全部通过（D06-after-regression.log）。相关 17 文件 / 113 单测、类型检查与源码/受保护路径哈希核对通过。原源码目录未修改。
