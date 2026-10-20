# 变更登记

| 任务    | 文件                                         | 原因                                                                     | 受保护区 | 验证                                               |
| ------- | -------------------------------------------- | ------------------------------------------------------------------------ | -------- | -------------------------------------------------- |
| T00/T02 | 完整原目录结构、两个 manifest、交付文档      | 冻结本地基线与完整资源                                                   | 原样     | 1,481 文件 SHA-256；补充 47 文件                   |
| T02     | scripts/check-desktop-baseline.mjs           | 检查受保护目录及原目录未漂移                                             | 否       | node scripts/check-desktop-baseline.mjs [--source] |
| T03     | desktop/main.ts、workspace.ts、tsconfig.json | 首次/最近工作区；禁止家目录；独立 agent；固定 bundled SDK；独立 userData | 否       | T03-typecheck.log；T03-unit.log 8 PASS             |
| T03     | tests/unit/desktop-workspace.test.ts         | 中文路径、无效选择和 symlink 拒绝                                        | 否       | 同上                                               |
| T01     | tests/desktop/baseline-run.mjs               | 未改宿主真实窗口基线                                                     | 否       | baseline-electron.json/png/log                     |

正式身份/更新 feed 未定；仅使用临时内部测试身份。未批准任何受保护业务层差异。

## T04–T08 补充登记

以下为工作树中的实施差异，提交号在阶段提交后补记。批准的受保护业务差异为 D02、D03；此前“未批准任何差异”的阶段记录已由本决定更新。

| 任务    | 文件                                                                | 原因及边界                                                                    | 验证证据                                                   |
| ------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| T04     | desktop/startup.ts、main.ts、preferences.ts、preload.cts            | 有界健康/身份校验、随机令牌、严格偏好恢复、可信 IPC 来源                      | T04/T07 单测、desktop-lifecycle.json                       |
| T04     | desktop/logging.ts                                                  | 分块 UTF-8 日志与凭据脱敏                                                     | desktop-logging 单测                                       |
| T05     | desktop/main.ts、process-lifecycle.ts、sidecar.ts                   | Dock 重建、单实例、故障提示、原服务正常退出和有界自有进程清理                 | lifecycle-final.log；no-replay.json                        |
| D02     | server/agent-service-daemon.ts 一个调用点                           | 用户明确批准：桌面 env=0 时剥离自动续跑字段，保留通知和手动恢复；Web/CLI 不变 | D02-proposed.patch、desktop-no-replay 单测、no-replay.json |
| T06     | desktop/electron-builder.yml、.github/workflows/desktop-release.yml | 临时独立身份、完整包资源、手动内部构建、不发布原仓库                          | T06-package-resources.json、packaged-smoke.json            |
| T06     | scripts/check-desktop-package.mjs、desktop-checksums.mjs            | 实际资源审计及安装包校验和                                                    | 包内 35 个插件 manifest 审计                               |
| T07/D01 | desktop/external-url.ts                                             | 仅给自己的服务地址附当前令牌，其他外链不泄露                                  | desktop-browser-handoff 单测、D01-browser.json             |
| T04–T08 | tests/unit/desktop-_.test.ts、tests/desktop/_.mjs                   | 桌面边界、真实窗口/SDK/PTY/扩展验收；失败保留                                 | evidence/ 各日志与 JSON                                    |
| T08     | desktop/main.ts loadWindowUrl                                       | 界面加载 30 秒上限及完成记录，防止无限白屏                                    | 原生连续三次启动通过（native-launch.json）                 |
| T09     | desktop/README.md、docs/desktop-delivery/                           | 纠正旧文档中共享凭据、随机端口、发布与更新通过的错误描述                      | 与实际实现及证据核对                                       |

`tests/unit/bottombar-metrics-universal.test.ts` 来源仍未知，单独保留差异与调查记录，不归因于用户或其他聊天。该变化使真实 CLI 调用变成解析夹具，不能将后来全量绿灯当作真实 CLI 验收。

| D03 | plugins/vscode-editor/index.mjs、manifest.json | 用户明确批准：补回远程目录递归创建；版本 0.5.1 → 0.5.2 | D03-proposed.patch；D03-ssh-sftp.json |

## T10 验收补证

新增原生加载后接入的测试适配器，复用完整生命周期断言并通过；新增安装包声音/附件交互与受限真实 DeepSeek UI 链路。生产代码未改。详见 T10-verification.md。

## T11 同机对照

新增 baseline-comparison-run.mjs 与只读原宿主对照证据；六个有效样本覆盖新配置启动、进程树 RSS、长对话滚动、终端响应和相同内容区截图。另从真实 DMG 挂载复制后验证。生产代码与安装包未改。

## T12 首次启动与模型设置

新增 first-run-run.mjs 验证生产选择循环、取消、路径错误和最近工作区；ui-acceptance-run.mjs 增加空白配置下通过原设置 UI 录入本地测试密钥并实际发送。测试与交付记录以外未修改。详见 T12-first-run-and-model-config.md。

## T13 更新渠道异常

desktop/main.ts 增加更新初始化异常边界，防止损坏配置或 updater 加载失败关闭已经可用的应用；只记录通用错误。tests/desktop/updater-startup-run.mjs 验证六种配置下真实 preload 响应、服务可用、正常退出及日志隐私；artifact-install-run.mjs 检验实际 DMG/ZIP 在源码目录外安装后的启动与主进程一致性。新增失败复现和最终证据，重新构建 macOS 内部包、资源审计及校验和。未改受保护业务层，未配置或发布正式更新。详见 T13-updater-startup.md。

## T14 外部运行时与两处批准例外

- D04：server/agent-service-daemon.ts 在 provider 赋值后增加一次原会话工具刷新；用户批准同时补齐 Web/CLI 首会话工具。逐行提案、真实首会话失败与 SDK attach 回归保留。
- D05：server/mcp-bridge.ts 的 reloadOnce 完成后增加一行原 onToolsChanged 通知；用户明确批准，修复同一聊天持有已关闭 MCP 客户端。单测先失败后通过，真实官方服务重启回归保留。
- package.json / lock：将原 DSH 适配器静态导入所需的现有锁定 peer 包纳入生产依赖，未升级任何已锁版本；scripts/check-desktop-package.mjs 补依赖资源检查。
- tests/desktop、tests/unit/desktop-*：新增真实 MCP、DSH 与系统浏览器验收，以及两处缺陷回归。原始 DSH 测试和生命周期断言保持；安装产物测试增加 daemon 文件一致性和可选证据路径，保留原默认行为。
- docs/desktop-delivery、desktop/README.md：记录批准、失败证据、当前产物和覆盖边界。未知 bottombar 差异继续独立保留。

详见 T14-external-runtimes.md；解锁后生命周期、外部 DSH 与真实系统浏览器证据均已补齐，目标仍未全部完成。
