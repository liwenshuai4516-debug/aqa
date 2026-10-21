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

## T15 通知与声音实测

新增两个安装包验收/诊断脚本及证据；生产代码未修改。声音合成通过，实际听感未确认；系统通知被 macOS 原生接口拒绝，用户明确暂不调整、保留待验收。测试失败与诊断边界详见 T15-notification-acceptance.md。

## T16 原回归测试前置条件修正

仅修改两条测试：终端会话夹具使用同一个独立 agent 目录、规范化工作区路径并清理；elsewhere 等待原服务当前 scheduler 提示文案。原行为断言与后续回收验证保留，实际服务集成及相关单测通过。详见 T16-regression-fixtures.md。

## T17 真实原生目录选择器

新增人工选择 + 自动核对/重启测试，生产代码不变。实际选择 Downloads 的保存及恢复通过；临时中文目录选择预期不符，失败证据单独保留。详见 T17-native-picker.md。

## T18 原浏览器测试复验

只修改测试：输入区上传定位、真实服务附件消息观察、明确终端关闭按钮、等待文件监视、使用剩余终端后验证会话恢复；新增独立本地供应商夹具。生产代码和包不变。文件/图片/终端各 7/9/24 断言通过，所有失败阶段保留。详见 T18-original-browser-regressions.md。

## T19/T20 真实模型与 D06

D06 经用户明确批准，仅在 server/agent-service.ts 的 setDelegateMode 重载后重放已有工具门控。新增原委派回归的工具列表断言，旧服务失败、修复后通过；登记哈希并重建 DMG/ZIP，实际安装与工具列表复验通过。新增模型请求/预算守卫及本地/真实安装包目标测试；真实凭据仅 stdin/内存。真实委派通过，严格文件目标仍失败，累计 12 次未超批准 14 次、每次 128 输出和 1 元。T19/T20 失败、实际会话及账本均保留；详细边界见对应文档。原安装测试新增 agent-service 编译一致性检查，package-smoke 新增可选证据路径，历史证据恢复保留。未知 bottombar 差异仍不纳入本轮提交。

## T21 界面对照与完整回归

新增真实安装包/Web、只读原宿主/Web 界面对照测试及原聚合回归的隔离启动器；native-app 测试辅助函数新增可选入口及就绪标记，原调用默认不变。生产代码和安装包不变。保留初始夹具/启动失败、色彩工具干预及最终对齐截图，不覆盖失败证据。完整单测 5145 PASS/9 SKIP、完整集成 85/86、最终每轮 24 场景/31 交互检查通过。更新矩阵与阶段完成核对，未知 bottombar 差异继续独立保留。详见 T21-ui-parity-and-regression.md。

## T22 最新安装包生命周期

仅修改 lifecycle-run 的独立证据前缀和真实重复启动断言、no-replay-run 的实际安装包启动/独立证据路径/可选实际追加后中断检查。原有行为断言保留；新增当前产物身份核对、完整系统生命周期与写入后不重放证据。未修改生产代码、安装包或未知 bottombar 差异，未新增付费请求。详见 T22-latest-package-lifecycle.md。

## T23 原浏览器交互

仅修改 original-ui-run 独立证据前缀/拒绝覆盖/凭据环境清理/SKIP 汇总，以及声音与插件顶栏原测试的实际入口定位、中文夹具、与冻结源一致的五声音事件检查；通知可显式跳过，默认原通知断言保留。新增多轮真实浏览器结果及失败诊断，生产代码和安装包不变，未知 bottombar 差异未纳入。详见 T23-browser-interactions.md。

## T24 目标、搜索与置顶界面

仅修改 goal-ui-test 的独立工作区/中文夹具/折叠入口与原 Enter 提交，以及 global-search-ui-test 的中文/稳定等待/实际模型入口/预览关闭和过滤断言。原置顶测试不变。保留全部失败分轮，最终 4/17/10 断言通过，未知 bottombar 差异不变，生产与安装包不变。详见 T24-goal-search-pin-ui.md。

## T25 离线备份与同版本恢复

新增独立备份恢复验收脚本及恢复操作说明，实际安装包 8 项通过；保留前三轮失败 JSON，并明确 v3 原日志被误重定向覆盖的证据限制。无生产代码、依赖或安装包变化。详见 T25-backup-restore.md。

## T26 严格目标重试准备

仅调整 goal-model-run 验收脚本的独立前缀、最新真实账本延续与本地账本隔离，新增可选精确字节要求和成功文件 hex 证据；精确字节断言保持不变。实际安装包本地预演 2 项通过、6 个本地请求，3 文件/64 单测与类型检查、源码门禁通过。真实累计仍 12/14，扩至 18 的方案等待用户批准，未放宽预算守卫。详见 T26-strict-goal-proposal.md。

## T27 实际包预设与技能界面

新增独立验收脚本，实际 SDK 发现技能、开关/全文偏好、中文预设保存/应用/删除、全退出后恢复及原配置落盘共 12 项通过。两轮脚本定位/存储层级失败保留，最终 3 文件/88 单测及类型/源码门禁通过。无生产改动或新增付费请求，详见 T27-preset-skill-ui.md。

## T28 预设导入导出实际界面

新增独立安装包 UI 验收脚本，本地导出/错误拒绝/中文文件预览/dryRun 不落盘/字段勾选/白名单/应用/重启共 12 检查通过；三轮脚本断言或异步等待失败保留。未联网发布，无生产代码或包变化，详见 T28-preset-import-export.md。

## T29 实际包计划模式

新增实际安装包计划入口、原计划工具/看板、工具剔除和强行写拒绝、确认实施后重新允许写入的专项脚本。初轮及加强断言复验各 7 检查通过，5 次本地请求/轮；两文件/59 单测通过。无生产改动或付费请求，详见 T29-plan-mode-ui.md。

## T30 实际包 Git 界面与终端执行

新增独立临时仓库验收脚本，中文差异、原终端暂存/取消暂存/提交、实际提交 blob/未跟踪保持、历史与筛选共 13 项通过，三文件/21 单测通过。三轮原页签/自动终端切换/悬停前置失败保留；无生产或包变更，无付费请求，详见 T30-git-ui.md。

T31：实际安装包临时会话保存/丢弃、原历史切换和完整重启恢复共 12 项通过，三文件/7 单测通过；每轮仅 3 次本地请求，无生产改动。用户已批准 T26 累计 18 次上限，真实仍已用 12，严格目标待执行；此前等待批准的段落为历史状态。详见 T31-session-ui.md。

T26 实际补验：用户批准累计 18 次后，真实 DeepSeek 严格目标两项 PASS；独立核对文件七字节及执行者 write、审查者 read/verdict、goal 清除。新增 6 次、累计 18/18，停止付费请求；最终账本保守总额含先前预留 0.158860 元。T20 失败与结果快照/最终账本时序差异保留。详见 T26-strict-goal-proposal.md 和 T26-real-independent.json；仍不能关闭整个项目。

T32 / T03：实际安装包 macOS 显式便携根启动、路径优先级、SDK 聊天落盘、真实 PTY 写入/关闭、完整重启历史/主题和普通独立数据对照共 12 项通过，2 文件/17 单测通过；仅 1 次本地请求，无生产改动。未覆盖根迁移或 Windows PortableGit/Node，详见 T32-portable-mode.md。

T33 进行中 / A05：实际安装包中文 UTF-8 下载接口字节/文件名、GBK 原预览、WAV 元数据和分段读取已检查；原生 showSaveFilePicker 已打开，等待用户保存，尚不计下载闭环 PASS。3 文件/19 单测通过、5 个 Windows 专属 SKIP，原失败保留。无生产修改或模型请求，详见 T33-download-media.md。

T33 诊断收尾：原有界保存及两轮原始 CDP 原 UI 保存均 FAIL/未验证，选择器现已退出；不能继续视为等待或 PASS。原 blob 回退在测试显式选择分支、恢复 CDP 默认下载行为后，实际 ZIP 文件/中文名通过，完整范围见 T33-download-media.md。未应用前端修复草案，无生产改动、模型请求或遗留测试应用。原生取消来源待定位。

T34 / T08、A13/A14：实际安装应用副本使用原更新器、preload 和业务服务，回环 HTTPS 版本检查/不自动下载、下载中断、SHA512 错误、渠道 503、完整退出重启及独立缓存共 14 检查通过；2 文件/11 单测与类型/源码门禁通过。测试引导仅向更新器专用 session 信任精确回环证书，原 main 字节不变；前两轮 TLS 夹具失败保留。没有安装更新、生产修改或付费请求；正式升级和安装中断恢复仍未完成，详见 T34-updater-network.md。

T35 / T07、A13：实际 DMG 安装应用的 renderer 隔离、危险弹窗协议、外部同帧导航/token 隔离、同源 iframe、合法主窗口调用和其他窗口原 preload 的真实 IPC 拒绝，共 12 检查通过。4 文件/16 单测、类型和源目录/受保护哈希门禁通过。shell.openExternal 仅在测试中记录派发，不冒充系统浏览器实际打开；失败三轮保留。无生产改动或付费请求，详见 T35-security-boundary.md。
