# T00 范围与决定

- 2026-10-20 用户明确批准 D01 A：系统浏览器打开同一应用，通过原扩展和会话接管验证。未验证前不报通过。
- 用户批准：macOS arm64 优先，然后 Windows x64、Linux x64；macOS x64 不在已确认组合。
- 用户批准：独立数据目录，不导入原认证和会话。
- 正式产品名、App ID、feed、签名账号：用户答复暂未确定。仅内部测试使用 Pi Agent Desktop / local.pi-agent.desktop；正式发布及受控更新待决。
- 真实模型验收：未提供测试账号与费用限额，不读取个人凭据。
- D02：用户已明确批准 `server/agent-service-daemon.ts` 单调用点最小例外，桌面禁用中断任务自动续跑；保留 Web/CLI 默认行为、历史、通知和手动恢复。提案与原始差异保存在 D02-no-replay-proposal.md / D02-proposed.patch。
- 未明测试修改：用户否认同时编辑，要求调查并保留差异；调查未找到可证实的作者，不作归因。见 test-change-investigation.md。

- D03：用户明确批准补回编辑器 mkdirpRemote 与插件版本 0.5.2；仅这两个文件的提案差异获准。真实 SSH/SFTP 错误路径和隔离版本同步需留证。

- 范围更新（2026-10-20）：用户要求暂不考虑其他运行环境，当前优先完成 macOS arm64；Windows/Linux 暂不实施，不列为已支持。
- 用户已提供 DeepSeek 测试凭据；不将凭据保存在源码、交付证据或日志。真实调用模型和费用限额待用户确认。

- DeepSeek 用户批准：deepseek-chat，最多 3 次短请求、每次输出最多 128 tokens、人民币 1 元预算。已使用包内 SDK 请求 1 次，输入 15 / 输出 8 tokens；未在源码或证据保存凭据。
