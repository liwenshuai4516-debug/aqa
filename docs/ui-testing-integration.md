# UI 测试 workflow 能力接入

2026-10-22。范围为将用户提供的 UI workflow 接入本仓库的 **Pi agent**。附件作为外部能力包评估，未将其历史验收或示例业务作为本项目的新需求。

## 兼容结论与改动

能够接入，但不能只安装 Skill 文本。源包为 `/Users/liyingjun/Desktop/SW-QA/13-pi/agent-client/release/ui-testing-workflow/`；其 101 项 manifest 摘要均匹配，当前 Codex 技能副本也与之相同。Codex 有技能说明不等于项目内 Pi 已注册工具。

| 检查项        | 接入前                                        | 本次处理                                                                  |
| ------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Pi SDK 系列   | 1.1.0；包仅接受 1.2.0                         | 锁定 SDK 与配套包为 1.2.0                                                 |
| typebox       | 1.3.34                                        | 对齐已验证的 1.3.27；保留宿主包 peer/optional 声明                        |
| Playwright    | 现有 `playwright-core` 1.63 系列，无 Test CLI | 增加 `@playwright/test`、`playwright` 1.62.1，保留原测试依赖              |
| Workflow 资源 | 无运行包、阶段技能和工具                      | 原包作为本地 devDependency，项目资源加载器发现 10 工具与 8 Skills         |
| 测试 MCP      | 宿主现有桥使用原工具名                        | 薄扩展复用 SDK 原生 MCP，提供 `mcp__ui_playwright_test__*` 及嵌套调用事件 |
| 宿主实现      | 已支持包资源、技能和扩展                      | 无需修改 `server/`、协议、UI 或重写 workflow                              |

唯一分发包位于 [能力目录](../capabilities/ui-testing/README.md)，安装包内容未修改；文件摘要及来源提交记录在该目录。小型适配仅包含原生 MCP 配置、Playwright 配置和项目资源登记脚本。`package-lock.json` 固定本地包完整性与依赖版本。测试包复用 SDK peer 后，npm 用 `devOptional` 标注生产可选/开发必需依赖，现有宿主包守卫同步识别该标记，仍禁止将宿主包移入普通 dependencies。

## 加载与使用

### 桌面技能不可见修正（2026-10-22）

用户截图中技能数为 0、输入 `/ui` 无候选。实际桌面服务已使用 SDK 1.2.0，但启动工作区为 `Downloads`；此前仅在本仓库 `.pi/settings.json` 登记资源，切到其他工作区自然不可见。日志同样记录了目录从 8 项变为 0 项。此前的 SDK/宿主目录验证没有覆盖该桌面配置，不能据此认定用户窗口已加载。

本次给登记脚本增加显式 `--agent-dir`，已把本包、MCP 薄扩展及同名入口登记到本机桌面应用专用 `~/Library/Application Support/Pi Agent Desktop/agent/settings.json`；保留原有包与模型偏好，不修改认证、项目选择或宿主发现代码。项目登记继续有效。仅新增短 Skill `ui-testing-workflow` 转入原包 `ui-test-workflow`，共 9 个技能，不复制原包实现。MCP 的程序/配置从能力安装位置解析，测试目录按当前工作区定位。

当前用户窗口执行一次 `/reload` 后，标准预设的技能页可列出同名入口与 8 个阶段技能；输入 `/ui` 选择入口会填入 `/skill:ui-testing-workflow `。能力经 SDK 包/扩展加载，Web UI 插件市场不额外创建一份插件。登记本身不使无依赖的 `Downloads` 成为正式测试项目，也不自动安装项目依赖。应用级登记使用安装仓库绝对路径，移动仓库后需重新登记；不是独立桌面分发包。

本次运行真实 SDK/MCP 集成 10 项通过，能力安装目录与被测项目不同。另用隔离 Electron、空 agent 配置、不同工作区、端口 18975，在实际界面复现空列表/无候选，登记后通过 `/reload` 验证 9 个技能启用及 `/ui` 选中后填入原生技能指令。没有发送该技能提示给模型，没有业务请求。用户正在使用的窗口未被自动操作或重启；配置已写入，其当前内存目录仍需由 `/reload` 更新。可迁移结果见 [可见性验收](ui-testing-evidence/visibility-summary.json)，原始截图与结果位于忽略目录 `tests/scratch/ui-workflow-visibility/`。

```sh
npm run ui-testing:enable -- --agent-dir "$HOME/Library/Application Support/Pi Agent Desktop/agent"
PI_WEB_SMOKE_PREBUILT=1 node tests/ui-testing-visibility-test.mjs
```

第二条须先有已构建的 server/web/desktop。测试只关闭自己启动的应用实例，不操作用户窗口。

### MCP 连接补验（2026-10-22）

用户随后看到 `ui-playwright-test: failed: MCP connection closed`，但在取得完整 `/mcp` 错误前确认“现在不报错了”。此次未重现该连接失败，不能据此认定具体根因，也没有修改运行配置或加入自动重试来掩盖它。此前可见性验证只覆盖技能与菜单，未验证桌面 MCP 连接，覆盖确实不足。

已扩展原界面回归：通过真实 `/mcp` 回执确认 `connected, 87 tools (direct)`，再验证连续 3 次 `/reload` 和显式 `/mcp reconnect ui-playwright-test` 后的连接。每条命令都等待其后的新 WS 通知，不用旧 toast 判断成功。同时用 Electron 的 Node 模式执行原 SDK/MCP 集成，10 项通过，包括工作流要求的 7 个录制工具、真实合成页面、嵌套调用与取消。87 是测试 MCP 的全部工具，7 是工作流要求的子集。零模型调用、零业务请求。

若再次出现，先执行 `/mcp` 保留完整状态与错误；需要恢复连接时可执行已验证的 `/mcp reconnect ui-playwright-test`，再用 `/mcp` 确认 connected。重连验证不代表中断的业务动作可以重放，仍按原包的恢复规则核对已有证据和副作用。

### 首次项目登记记录

本机已执行 `npm run ui-testing:enable`，项目 `.pi/settings.json` 登记 `../node_modules/pi-ui-testing` 与 `../capabilities/ui-testing/mcp-extension.mjs`。该文件按既有规则忽略，保留个人配置及已有项目字段；重复执行不重复登记。新克隆按能力目录说明重新登记。

原生 MCP 配置由能力扩展动态提供，只连接本服务，不再将它重复登记到宿主常规 `.pi/mcp.json`；否则会出现两套工具与浏览器实例。测试 MCP 使用 45 **秒**超时、当前项目 cwd，命令路径按项目定位。需要关闭该能力时，从 `.pi/settings.json` 移除上述两项再重载，保留测试资产和原始证据。

已运行的服务若加载过 SDK 1.1.0，必须先重启服务；`/reload` 能刷新资源，不能替换进程中已导入的 SDK。此次未中断用户服务。之后在可信项目新建 Pi 会话或 `/reload`，使用标准预设，确认 `read`、本包扩展和 8 个阶段 Skills 未被设置/模板白名单禁用。若自定义系统提示词把技能全文替代 `<name>` 目录，原包的能力探测可能无法识别；保持默认技能目录并按需加载正文。

需要固定实际服务版本时，用 `PI_WEB_SDK=bundled` 启动项目服务，避免自动跟随机器上其他更高版本的 SDK；原包对未验证版本会阻塞，不能仅凭 lockfile 声称运行进程版本已对齐。

向 Pi 提出 UI 测试任务时，先使用包内 `ui-test-workflow` Skill，调用：

```json
{ "request": { "operation": "catalog" } }
```

然后按真实资产选择发现/录制、执行、分析或查看。规则、schema 与阶段说明以安装包为单一来源，不另写一套。包内位置为 `node_modules/pi-ui-testing/skills/`；契约可通过 `node node_modules/pi-ui-testing/dist/cli.js schema <kind>` 查询。录制 action 的 `input` 必须符合实际测试 MCP schema；部分浏览器操作要求 `input.intent`，不能仅填写 workflow 外层的 `intent`。

现有 `npm test`、核心冒烟和接口测试仍是工程回归入口；本能力为按需的 agent UI 测试流程，独立工程检查入口为 `npm run test:ui:integration`。原包正式执行需来源、批准、诊断、环境/身份/数据规则均就绪；当前没有为用户选择业务模块或生成可执行批准。

## 本轮验收

原始调试日志在忽略目录 `tests/scratch/ui-workflow-integration/`；可迁移摘要见 [验收摘要](ui-testing-evidence/integration-summary.json)。测试环境为本机 macOS、Node v23.10.0、SDK 1.2.0、Playwright Test 1.62.1，临时项目、空 agentDir、合成页面，无个人认证读取、模型请求或业务站点请求。Node v23.10.0 满足包的最低版本，但不在部分既有开发依赖的受支持范围；团队环境应采用依赖共同支持的 LTS。

- 原版 doctor：16 项通过，包括版本、8 个阶段技能/2 套规则/10 个工具定义、契约正反例、存储往返和 Chromium 启动。
- 宿主接线：9 项通过，包括真实包加载、技能目录/版本门禁、catalog、测试 MCP、合成页面、嵌套调用和取消；受控调用消息只用于基础设施派发，不代表实际模型规划通过。
- 格式、五组类型检查、4 文件/64 项相关单测、lint、锁文件安装预检及 diff 检查通过。宿主 `slash-commands-test`、`tool-info-test` 冒烟 2/2 通过，其中命令目录真实列出 8 个阶段技能。协议三项检查通过，无 tag 的 git 启发式 SKIP。
- 扩大全量单测：463 文件，5156 通过、5 失败、9 SKIP。失败为插件链接清理 1 项、`api-testing` 图标 3 项、插件 SDK 版本不一致 1 项。未包含本次变更的 `2e997fb08b536c6762d18f317f7615b7bdd0d25c` 隔离源码快照复用当前依赖树，同样重现这 5 项失败（其余 30 项通过）；本次不修改这些无关模块。全量测试不能记作通过。
- 业务录制、独立模型设计/结果评估、正反诊断、正式业务回归及重启后资产复用未执行，不计为业务通过。未来执行业务测试前仍需具体模块、目标部署、角色、初态和可清理数据规则。

本次支持范围为本地 Pi agent、Chromium、单 worker、零自动重试。DSH/其他引擎、SSH 工作区、多浏览器、并行测试和桌面分发未验收；源包原项目的历史结果不作为本轮结果。
