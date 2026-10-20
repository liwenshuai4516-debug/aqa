# macOS 验收矩阵

审计日期：2026-10-20。当前为工作树实施版本；macOS arm64、Electron 44.4.2（Node 24.21.0）、SDK 1.1.0，开发 Node 24.19.0。全部日志位于本目录 evidence/。PASS 仅适用于所列断言，不能推导整项全部完成。

用户已调整优先范围为 macOS，Windows/Linux 暂不实施。正式名称、App ID、签名、公证和更新源仍未确定，当前产品身份仅用于内部测试。

| ID  | 状态             | 已有证据及尚缺内容                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | 部分 PASS        | snapshot-delta、token-auth、重连原集成回归通过；D02 真实 SDK 与本地流式供应商通过。deepseek-ui.json：真实安装包界面 → 原服务 → 包内 SDK → DeepSeek 流式回复通过。                                                                                                                                                                                                                     |
| A02 | 部分 PASS        | ephemeral、cross-client、历史恢复原回归；no-replay.json 实际退出重开历史可读且不自动继续。全部 UI 组合未完成。                                                                                                                                                                                                                                                                        |
| A03 | 部分 PASS        | provider-keys、provider-oauth、fetch-models 原回归通过；真实 DeepSeek：包内 SDK 实际连接通过，1 次请求、15 输入 / 8 输出 tokens（deepseek-sdk.json）；deepseek-ui.json 已补界面发送到真实供应商回复；测试凭据使用内存代理，T12 model-config-ui.json 已验证原设置 UI 保存本地测试密钥、供应商、模型并实际发送；未在 UI 保存真实供应商密钥。真实 OAuth 仍未验证。                       |
| A04 | 部分 PASS        | approval-policy、approval-rules、tool-prompt、lazy-tools 原回归通过；T14-mcp-filesystem.json 通过实际 SDK、原 write 工具和 UI 弹窗验证拒绝不落盘、批准后落盘，模型为本机脚本驱动；不得当作真实模型自主选择工具通过。                                                                                                                                                                  |
| A05 | 部分 PASS / FAIL | preview、preview-http、sftp、vscode-editor 原回归通过；D03-ssh-sftp.json 真实 SSH/SFTP 读写、嵌套上传、权限失败、版本同步通过。packaged-ui.json 已验证安装包中文文本、二进制与 SVG 文件上传、PNG 粘贴、附件卡片和本地流式回复。原 file-upload/image-paste UI 测试因旧选择器匹配两个输入而失败，保留原结果。                                                                           |
| A06 | 部分 PASS / FAIL | packaged-smoke.json：实际包内 PTY 输入、尺寸和退出通过，SCM 原回归通过。T16 修正独立 agent 会话夹具路径后 terminal-smoke 全部 55 断言通过；terminal-browser 受浮层阻挡的旧结果保留。                                                                                                                                                                                                  |
| A07 | 部分 PASS        | 原 plugin 安装、授权、工作区、更新回归通过；D03 验证隔离版本升级。全部插件 UI 未逐一验收。                                                                                                                                                                                                                                                                                            |
| A08 | 部分 PASS        | goal、goal-delegated、plan-mode、delegate-mode、子代理相关原回归通过；真实模型审查/委派未验证。                                                                                                                                                                                                                                                                                       |
| A09 | 部分 PASS        | dsh、mcp-bridge、sftp、预设单测通过；T14 官方 MCP filesystem 2.0.0 真实读写/越界/故障隔离/启停与退出，发现并经批准修复首会话接线及重载通知；外部官方 DSH 0.1.5-rc.3 初始化、四健康预设、工具/技能/模型 RPC 通过，原 DSH 协议及 UI 测试通过。DSH 模型目标/工具执行尚未验证。早前 dsh-ui 首次配置浮层失败保留。                                                                         |
| A10 | 部分 PASS / FAIL | cross-client、takeover、rollback、offline、cross-device 原回归通过；D01 扩展会话接管通过。elsewhere-lifecycle 旧失败保留；T16 将等待文案与原服务 scheduler 分支对齐后，全部生命周期与回收断言通过。                                                                                                                                                                                   |
| A11 | 部分 PASS        | native-launch.json：实际包连续启动，端口变化时主题/语言/面板宽度恢复；窗口生命周期源码测试通过。T11 同机原宿主/当前包的长对话及草稿截图对照，主要布局记录一致、差异像素 0.2844%；仅覆盖该样本，其他页面与草稿组合仍未完成。                                                                                                                                                           |
| A12 | 部分 PASS        | D01-browser.json：真实 Chrome 0.4.1 扩展、授权、接管、工具往返通过。T14-system-browser.json 另外通过未经替换的系统默认 Chrome 派发与第二个认证客户端连接；浏览器侧测试页签自动清理不可用。                                                                                                                                                                                            |
| A13 | 部分 PASS / FAIL | 桌面专项 49 项通过；原生包启动通过；packaged-lifecycle 中崩溃恢复、Dock 重建、退出通过，原 Playwright 启动接管在最后重开出现窗口发现超时；采用不拦截 ready 事件的原生启动、加载后接入调试，同一套完整断言全部通过（native-lifecycle.json）。签名、更新升级及中断恢复未运行。                                                                                                          |
| A14 | 部分 PASS / FAIL | 最小化/恢复及全屏进出、preload 事件实测通过（T09-source-lifecycle.log）；packaged-ui.json 验证声音主开关、事件开关、音量、重载持久化及实际 WebAudio Oscillator/Gain 音频图；T15 实际声音合成再次通过，用户未观察听感；原完成通知请求已发出但无送达，原生通知诊断返回 UNErrorDomain 1（系统不允许）。用户明确暂不调整，通知保留待验收。旧 sound-settings UI 选择器及本轮失败证据保留。 |

原全量 Vitest：459 文件、5143 PASS、9 SKIP（final-unit.log）。其中来源未明的 bottombar 测试将真实 CLI 改成解析夹具，已保留差异与调查，不能计作真实 CLI 证据。

原完整集成冒烟：83/86 通过（final-smoke.log）。三项失败为 ssh-plugin、elsewhere-lifecycle、terminal-smoke。D03 修复后 SSH 的远程目录、读写和分片上传已通过；旧 ssh-plugin 测试后续 sync_* API 已迁移，仍失败，未删断言。

性能：T11 已完成各三次新配置启动、空闲 RSS、200 条消息滚动和 PTY 响应对照，见 T11-comparison.md；未清系统缓存，不是严格冷盘测量，不承诺固定性能指标。

最终状态：尚未达到任务书全部完成条件。内部 macOS 安装包可运行；未覆盖项与失败项保留在本矩阵，不作为后续优化移出范围。

T13 / A13 补证：更新配置缺失、JSON 损坏、URL 无效、HTTP、携带认证和原仓库地址均通过真实窗口/preload 的禁用响应、服务可用和正常退出验证（updater-startup.json）。修复配置异常导致应用启动失败，重新打包。正式下载、安装更新、签名和中断恢复不在此证据覆盖范围；此前完整生命周期等证据仍按其原产物版本理解。

T13 / A14 新包回归：启动、隔离鉴权、SDK 检查通过；两次全屏事件等待失败，聚焦实验也未获得焦点。T13-screen-state.json 确认测试期间 macOS 锁屏，已请求解锁。新版完整生命周期需解锁后重验，不能用旧包 PASS 替代。原始失败与实验差异均保留，原生命周期测试未改。

T14 / A13–A14：用户解锁后，同一套完整生命周期断言已通过；本轮真实安装包继续重验，见 T14-native-lifecycle.json/log。T13 锁屏失败为历史结果。本轮另修复 DSH 适配器生产依赖遗漏，保留原版本并重建 DMG/ZIP；相关 49 单测、类型检查、lint、资源审计和两份基线核对通过。具体产物哈希和真实外部运行边界见 T14-external-runtimes.md。

T14 全量 Vitest：461 文件 / 5145 PASS / 9 SKIP（T14-all-unit.log）；未知 bottombar 差异仍不能作为真实 CLI 通过证据。最新实际 DMG 安装包 package-smoke、完整 native-lifecycle、官方 MCP 首会话与重启后同会话调用、DSH 原适配器/官方运行时均通过，详见对应 T14 JSON。

T16：修复两条回归脚本的隔离夹具/过时文案，终端 55 断言、elsewhere 全流程及 8 文件 / 55 相关单测通过。没有重跑或重新汇总完整 86 项；生产代码不变，详见 T16-regression-fixtures.md。
