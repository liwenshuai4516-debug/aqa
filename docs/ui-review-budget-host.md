# UI 评审预算的宿主续授

本接入只把已明确的用户授权交给原生预算接口。`pi-ui-testing` 的 task、scope、循环、尝试、预算登记和评审实现保持唯一事实源。预算增加不产生设计批准，也不授予浏览器或业务写入权限。

## 入口与信任边界

- 入口是 canonical `.pi/skills/ui-testing-workflow/assets/mcp-extension.mjs` 加载的 `review-budget-host.mjs`，与既有 UI 扩展一起启停、重载；不另建空壳插件，不注册模型可调用的续授 tool/MCP operation。
- 授权来自活动 SDK `sessionManager` 的当前 branch 中明确的 user 指令，包含原任务 ID、追加 1–3 轮独立设计评审和目标修订，例如本次原任务、追加 1 轮、r6。普通“继续”、引用、示例、否定、条件语句和 assistant/tool 文本不构成追加授权。
- 任务须处于原生支持的未终结设计评审阶段，目标修订须来自该任务已关联的唯一资产 ID，scope/module 一致；不按全局最近目录回落。
- `cwd`、session ID、sessionDir 和 branch 来自真实 SDK context。模型不能提交 `authorized=true`、authorityRoot、任意会话文件或额外额度。宿主不离线读 JSONL 回填授权，不复制个人凭据。
- 本接入沿用 SDK 对已加载扩展及 user 消息的信任边界；不宣称新增了独立的真人签名鉴别机制。

## 原生登记与续评

宿主调用物理运行时的 `DesignReviewService.renewBudget`，入口和原生 callback 均核对原授权及活动 branch。授权 ID 稳定绑定 session、原授权 entry、原任务输入/scope、目标资产和追加轮数；普通 leaf 前进、任务状态更新和重载不能制造第二次增额。

锁、pending 拒绝、原预算与全部 attempt/grant 保留、同授权幂等及过期对象检查仍由原生实现处理。宿主不写 authority 文件，不删除旧 error，不另开任务恢复预算。

登记成功后，宿主以 SDK custom message 将准确 task/asset 引用及追加边界交给正常模型回合。独立评审仍调用已安装的 `ui_design_review`，必须使用新 request ID。普通模型回合不直接调用续授接口，也不能将宿主回执当作设计批准。

`/ui-review-budget` 只重新核对当前会话中已存在的明确授权，不把命令本身当作新增授权，也不接受调用者的授权布尔或增额参数。

## 实际应用接入

1. 沿用 `scripts/enable-ui-testing.mjs` 的项目或显式应用登记，canonical 扩展引用保持不变，新增 helper 随该入口加载。
2. 在实际目标会话加载新代码。流式期间宿主将 extension reload 延迟到 `agent_end`；仓库文件变更不意味着旧闭包已热更新。必要时在原对话执行 `/reload`，不需要重新同意已明确授权的追加轮次。
3. 等待宿主续授回执后，在原任务对指定修订调用原生独立评审。未登记 grant、缺少明确授权、存在 pending 或范围变化时不评。
4. 获批后仍需独立满足诊断、运行登记和正式执行门禁。

设置沿用已有 UI 扩展与技能管理。禁用 canonical 扩展时不会注册宿主生命周期或命令；启用并重载后恢复。`/skill:ui-testing-workflow` 为技能发现入口，`/ui-review-budget` 为宿主复核命令。

## 验证与证据

单测入口：`tests/unit/ui-review-budget-host.test.ts`。实际 Electron 隔离回归入口：`tests/ui-review-budget-host-desktop-test.mjs`；采用临时 UI/agent/data 配置及本地受控 provider，不调用付费模型或 PMS，不替代当前用户会话的加载、grant 或评审事实。

本次原任务的阶段状态、实际应用接入限制及验证结果见 [续授阶段证据](ui-testing-evidence/pms-review-budget-renewal-20261030.json)。原 task/scope 不迁移，原 9 条用例分母保持不变。
