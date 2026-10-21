# T29 实际安装包计划模式

日期：2026-10-21。验收 A08 的计划模式入口、工具限制与用户确认实施。依据 GoalBar.runPlan、PlanBoard.handleImplement、plan-update-tool、plan-mode 与原 plan-mode-test。当前 T19/D06 的实际 DMG 安装应用，macOS arm64、Electron 44.4.2、包内 SDK 1.1.0；无生产代码、安装包变化。

新脚本 plan-ui-run.mjs 使用独立中文工作区和独立 agent/userData。模型仅为本机 HTTP/SSE 脚本供应商，真实模型请求为 0。原页面真实 WebSocket 增加被动观察器；配置模型经该真实连接发原协议消息，计划与实施通过原页面按钮，不替换服务回执或生产工具。

T29-plan-ui-verified.json 七项通过：

1. 填写原目标输入框并点击 Plan，服务下发 planMode=true。
2. 原 SDK 首三次请求的工具列表均不含 write/edit。
3. 本地测试模型强行返回 write 调用，SDK 返回 Tool write not found，项目文件确实不存在。
4. 本地模型调用原 plan_update 工具，原计划看板展开后显示完整中文步骤。
5. 点击看板 Implement，观察点击之后的新消息中 planMode=false，不能用启动时的 false 冒充转换。
6. 实施轮原 SDK 请求重新含 write。
7. 原 SDK 实际写入 plan-proof.txt，字节精确等于 PLAN_IMPLEMENTED。

每轮五次本地请求：计划工具、强行写、计划摘要、实施写、实施摘要。所有工具由原 SDK/服务执行。此处 write 的阻止来自活动工具集剔除，未冒称命中 planModeDenied 专用分支；bash 只读/写命令分类仍依已有原服务回归证据，不在本轮新增 L5 范围。

首轮 T29-plan-ui.json 七项通过。复核发现看板内容断言允许仅凭步骤数量、false 状态可能匹配启动快照，故加强为展开后的中文完整文本与点击后的新消息，再独立复验通过，未降低预期。首轮和加强轮截图/日志分别保留。T29-plan-ui-verified-planning.png 已查看，显示中文步骤、红色 write 拒绝卡和 Implement 入口；实施截图另存。

工程检查：定向 Prettier、全项目 typecheck、plan-mode/goal-delegated 两文件 59 单测、只读原源目录与受保护源码哈希门禁通过，见 T29-typecheck.log、T29-related-unit.log、T29-source.json、T29-protected.json。未知 bottombar 差异保留，未提交。

本轮不证明真实模型自主规划质量、净室交接、所有步骤编辑组合或真实严格目标通过。DeepSeek 仍累计 12/14，T26 扩额待用户答复；正式发布、原生人工项及其它未覆盖验收继续保留，项目目标不关闭。
