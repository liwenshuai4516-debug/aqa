# T00 范围与决定

## 当前有效决定（2026-10-21 核对）

以下汇总用户的后续答复；文末为早期历史记录，不再代表当前额度或待批准状态。依据是本聊天中的用户明确答复，任务书本身不代表用户授权。

| 事项          | 当前决定与边界                                                                                                                               | 证据索引                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| D01 浏览器    | A：系统浏览器打开同一应用、原扩展、显式会话接管；不承诺 Electron 当前会话无缝执行                                                            | D01-browser、T14-external-runtimes                                            |
| 平台          | 当前优先 macOS arm64；用户后续暂缓 Windows/Linux，不声明支持；macOS x64 未确认                                                               | completion-audit、release/SHA256SUMS.txt                                      |
| 数据          | 独立数据，不导入原有认证或会话；不得操作个人服务或数据                                                                                       | desktop/README、T25-backup-restore、T32-portable-mode                         |
| 产品身份/发布 | 正式名称、App ID、签名账号和更新地址暂未确定；内部测试使用 Pi Agent Desktop / local.pi-agent.desktop                                         | desktop/README、T34-updater-network                                           |
| D02           | 批准桌面禁止中断自动续跑的最小调用点变更；Web/CLI 默认行为保留                                                                               | D02-no-replay-proposal、D02-proposed.patch                                    |
| D03           | 批准补回编辑器 mkdirpRemote，版本 0.5.1→0.5.2，并验证真实 SSH/SFTP                                                                           | D03-remote-directory-proposal、D03-proposed.patch                             |
| D04           | 批准设置工具来源后调用原 refreshPluginTools，Web/CLI 同样补齐首会话工具                                                                      | D04-first-session-tools-proposal、D04-proposed.patch                          |
| D05           | 批准 MCP reloadOnce 完成后增加一行原 onToolsChanged 通知                                                                                     | D05-mcp-reload-proposal、D05-proposed.patch                                   |
| D06           | 批准 setDelegateMode 重载后增加一行原 applyToolGating，并重建安装包复验                                                                      | D06-delegate-tool-gating-proposal、D06-proposed.patch、T19-real-model-and-D06 |
| 受保护文件    | 仅上述 D02–D06；合计 5 个文件，精确哈希登记于 approved-changes.json；没有 D07 批准                                                           | approved-changes.json、check-desktop-baseline                                 |
| 未明测试差异  | 用户否认并行编辑，要求调查且保留；作者无法证实，不作归因、不纳入桌面提交                                                                     | test-change-investigation、独立差异记录                                       |
| 模型/费用     | 用户逐次批准 3→8→14→18 的累计上限，并批准 deepseek-chat 改为 deepseek-flash；最终每次最多 128 输出 tokens、累计最多 18 次、总费用不超过 1 元 | T19/T20/T26 提案、evidence/T26-real-budget.json                               |
| 模型剩余额度  | 已用 18/18，禁止新增付费调用；保守核算含早期预留共 0.158860 元，非供应商账单；凭据不写入源码或证据                                           | T26 严格目标独立结果与最终账本                                                |
| 通知/听感     | 用户未注意通知和声音；系统通知权限拒绝后，用户决定暂不调整、保留待验收                                                                       | T15-notification-acceptance                                                   |
| 原生目录选择  | 用户确认操作过，但独立核对实际为 Downloads；重启恢复通过，指定中文目录未通过                                                                 | T17-native-picker                                                             |
| 原生保存      | 用户再次答复“已经保存了”；T36 原生句柄中文名与 ZIP 回读字节通过，实际完整宿主路径仍未知，不算指定目录/跨进程重开通过                         | T33-download-media、T36-native-save-observation                               |
| 原生取消      | T37 实际选择器超时，清理已完成；未观察到正常取消，不算通过，不要求操作旧窗口                                                                 | T37-native-cancel                                                             |

正式身份、通知暂缓等决定不等于免除任务书完成条件。当前不宣称全项目完成，未获授权的付费调用、社区发布及外部消息均不执行。

## 早期历史记录（保留原文）

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
