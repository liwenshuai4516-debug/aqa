# 目录树参考（directory-reference）

[文档导航](README.md) · [按功能查模块](project-map.md) · [模块开发规范](module-development.md)

> 来源：2026-09 精简前的 `AGENTS.md` §3 全文（备份见 `AGENTS.md.bak`）＋ 之后新增文件的补齐。
> 约定：`★` = 单源/入口，先读；行内注释里的数字（工具个数、slot 个数等）以源码为准；
> 新增文件先在树里占位，注释以后补（以各文件头注释为准）。
> 新增顶层文件 / `server/*.ts` / `web/src/*` / 组件时，同步更新本文档。

## 顶层

```
pi-web-ui/
├── server/                     # 后端（Node ESM，编译到 dist/server/；完整分组见 server/README.md）
│   ├── agent/                  # Pi 会话、守护、子代理与模板
│   ├── model/                  # 模型/服务商配置、解析与 OAuth
│   ├── prompt/                 # 系统/工具提示词、persona 与覆盖
│   ├── skill/                  # 技能发现、读取与内容填充
│   └── mcp/                    # MCP 连接、管理、热加载、插件门禁
├── .pi/skills/                 # 项目 API/UI 技能入口（其他 .pi 配置/运行数据继续忽略）
├── web/                        # 前端（React + Vite，编译到 web/dist/）
├── bin/pi-web-ui.mjs           # CLI：前台启动 / server install|uninstall|start|stop|restart|status
├── desktop/                    # Electron 桌面壳（sidecar：随机空闲口起 dist/server + BrowserWindow）
│   ├── main.ts                 # 主进程：ready → 选空闲口 → spawn server(ELECTRON_RUN_AS_NODE) → loadURL
│   ├── electron-builder.yml    # 打包配置（win nsis / mac dmg / linux AppImage；npmRebuild:false）
│   └── README.md               # 桌面版说明：跑起来 / 约定 / 发布 / 签名（SignPath）
├── deploy/                     # 部署示例：launchd plist / systemd unit / Windows 任务 XML
├── .pi/skills/ui-testing-workflow/ # UI 技能统一维护入口，assets/ 资源、references/ 维护说明
├── capabilities/ui-testing/    # 旧应用路径兼容转接，无独立实现
├── scripts/enable-ui-testing.mjs # 默认项目级登记；显式 --agent-dir 可登记到应用专用 Pi 配置
├── scripts/clean-project.mjs    # 预览/回收白名单缓存及测试依赖，保留证据、跟踪文件和保留标记
├── tests/ui-testing-integration-test.mjs # 真实 SDK/测试 MCP/Chromium 接线，临时项目零模型请求
├── tests/ui-testing-visibility-test.mjs # 隔离 Electron 中复现工作区错位、验证技能页与 /ui 菜单
├── themes/                     # 内置主题（完整样式表：:root 变量 + 任意选择器/布局覆盖皆可，styles.css 只是共享基线）
├── make-light-theme.mjs        # 主题生成器（从 styles.css 的 :root 变量清单生成纯调色板）
├── plugins/api-testing/        # P0-2 最小受控 fixture 工具与专属 MCP runner（未上市场）
├── server/mcp/plugin-mcp.ts       # 插件工具短期调用身份和内部 MCP 门禁
├── server/api-testing-runner.ts # 手工批准 fixture、一次性引用与运行生命周期
├── plugins/api-testing/skills/ # P1-4 分发工作流/评审/分析技能，项目入口在 .pi/skills/
├── tests/api-testing-model-test.mjs # P1-4 按需真实模型验收，会消耗配置模型额度
├── tests/api-testing-skills-test.mjs # 真实 SDK 发现与宿主加载，隔离 agentDir
├── plugins/api-testing/tracking.mjs # P3-2 历史问题关联与分析修订
├── plugins/api-testing/schedules.mjs # P3-1 固定 fixture 授权与触发账本
├── plugins/api-testing/asset-management.mjs # P2-2 最小资产管理与受校验备份
├── tests/api-testing-asset-management-test.mjs # 管理入口/恢复冲突/引用与边界
├── plugins/api-testing/assets.mjs # P2-1 宿主独立根、不可变套件与持久 runs
├── tests/api-testing-assets-test.mjs # 跨重启零模型复用与文件损坏/取消检查
├── plugins/api-testing/workflow.mjs # P1-3 会话绑定工作流与不可变文件证据
├── plugins/api-testing/report.mjs # 确定性分类、历史与定向复测关闭
├── tests/api-testing-workflow-test.mjs # 真实执行闭环；模型替身
├── plugins/api-testing/review.mjs # P1-2 确定性重编译、独立评审与共享预算
├── tests/api-testing-review-test.mjs # P1-2 模型替身控制检查（非实际模型验收）
├── plugins/api-testing/suite.mjs # P1-1 本地 OAS 3.0 与固定模板草稿编译
├── tests/api-testing-suite-test.mjs # P1-1 导入/候选/冻结草稿工程检查
├── tests/fixtures/api-testing-workflow/ # 脱敏契约与闭环 fixture
├── tests/api-testing-controlled-test.mjs # P0-2 真实插件/适配器/MCP/Newman 集成验收
├── tests/api-testing-p0-test.mjs # P0-1 真实 MCP/Newman 验证（手动运行，需隔离依赖）
├── tests/fixtures/api-testing-p0/ # P0-1 专用依赖锁、本地执行入口、网络诊断钩子
├── server/agent/lazy-tools-state.ts # 仅按真实工具调用/成功加载回执恢复延迟工具名单
├── tests/tool-context-budget-test.mjs # 真实宿主/SDK 出站 Schema 预算与插件/恢复回归（本地 mock）
├── tests/                      # 单测与集成/UI 测试；自包含用例独立端口 ≥8900 + 临时 data-dir，外部依赖用例见 development.md
│   ├── run-smoke.mjs           # 零 token 协议冒烟聚合跑器（ALL 列表；插件后台作业/目录同步 plugin-jobs-test、多根工作区
│   │                           #   workspace-roots-test 都在里面）
│   ├── unit/                   # vitest 纯函数单测（插件 UI 扩展点：plugin-ui-manifest / ui-slots / context-menu /
│   │                           #   plugin-grants / plugin-project / plugin-installer / plugin-catalog-sync；多根工作区：workspace-roots）
│   │                           #   插件设置（声明式 schema / select 候选值）：plugin-settings / plugin-setting-options
│   ├── *-test.mjs              # 手写 Playwright E2E / WS 协议测试
│   │                           #   ⚠ 需 Chrome 的浏览器 E2E **不入 run-smoke**，手动 `node tests/<name>.mjs` 跑（缺 Chrome 自动 SKIP）：
│   │                           #     context-menu-ui-test（右键菜单槽位）/ ui-layout-ui-test（布局页 ↔ 界面一致性）/ plugin-settings-page-test（插件设置页）/ plugin-settings-select-ui-test（插件设置下拉）/ plugin-topbar-ui-test（顶栏条目 + 面板内后台卸载）/ elsewhere-click-takeover-ui-test（「另一处」行左键两段确认过户）
│   └── scratch/                # 一次性调试脚本（gitignore，不入库）
├── scripts/check-protocol-sync.mjs  # 守护 types.ts shim 单源机制 + protocol.ts 纯类型约束
├── .github/workflows/ci.yml    # CI：协议同步 → typecheck → build → vitest → 冒烟
├── .github/workflows/release-notes.yml   # tag 推送 → 按 CHANGELOG 建/更新 GitHub Release
├── .github/workflows/desktop-release.yml  # tag 推送 → windows-latest 出 NSIS 安装包并附到 Release（签名以后加这里）
├── extensions/                 # pi 扩展：webui.ts（/webui 命令启动本机服务并打开浏览器）
├── plugin-sdk/                 # 插件 SDK、类型与脚手架使用说明
├── desktop/client-identity.ts  # 主进程生成/持久化单窗口编号；main.ts/preload.cts仅向自有服务主窗口恢复
├── launcher/                   # Windows 便携版启动器
├── locales/                    # 可下载语言包（核心 zh/en 在 web/src/i18n.tsx）
├── assets/                     # 项目展示资源
├── cf-worker-feature-board/    # 独立 Cloudflare 功能看板 API
├── plugins/                    # 官方插件（webmail / db-client / vscode-editor / sftp / demo-mailbox / mermaid / run-trace / legado-web / wechat-ilink / image-toolkit / notes / live-preview / voice-input / desktop-use / pm2-manager，各自的 README.md 见其目录；page-picker/extension 是**浏览器扩展**，不是 pi-web-ui 插件）
│   └── catalog.json            # ★ 插件市场内置列表（随包发布；社区加插件 = 在此加一条 + PR）
├── dev/                        # 本地开发辅助（notice/search 预览等，不入 npm 包）
├── Dockerfile / docker-compose.yml
├── docs/                       # 详细文档，专题全集见 README.md
│   ├── README.md               # ★ 阅读顺序、专题导航与维护分工
│   ├── project-map.md          # 模块职责、请求路径、状态归属与目录管理
│   ├── module-development.md   # 模块开发规范、联动检查表与设计/验收清单
│   ├── project-cleanup.md      # 大文件评估、清理范围、保留期、复原与实测记录
│   ├── api-testing-workflow-design.md # 接口自动化闭环设计提案（尚未实现）
│   ├── api-testing-implementation-plan.md # 接口测试实施顺序、约束与验收计划
│   ├── api-testing-evidence/    # 分任务验收、脱敏摘要与调试历史；真实目标仍阻塞
│   ├── api-testing-assets-design.md # 测试资产、回放与定时执行设计（主流程之后实施）
│   ├── directory-reference.md  # 本文件：文件级定位参考
│   └── desktop-delivery/      # 桌面范围决定、验收矩阵与历史证据
└── tsconfig.server.json / tsconfig.extensions.json / tsconfig.tests.json / web/tsconfig.json
```

## server/

```
server/
├── agent/
│   ├── agent-service.ts # 核心：ClientSession（每客户端一个会话组，可并行多个对话）+ AgentService
│   ├── agent-service-daemon.ts
│   ├── agent-formatters.ts
│   ├── subagents.ts # 第一方子代理：统一的 subagent 工具（spawn/get_result/steer/list/stop/templates/wait_all/handoff）+ 运行态快照
│   ├── subagent-handoff.ts
│   ├── subagent-helpers.ts
│   ├── subagent-templates.ts # 子代理模板库（全局 <dataDir>/subagent-templates.json；白名单语义；可选模型/思考强度，空=跟随主对话；enabled=false 对 AI 不可见）
│   └── subagent-templates-hant.ts # 内置子代理模板的繁中（台湾用语）文案；zh-TW/zh-HK/zh-Hant 共用，仅作展示/取用视图，不回写库
├── model/
│   ├── model-admin.ts # 模型/服务商配置管理（含内置服务商多密钥：provider-keys.json + add/activate/remove_provider_key，模型目录复用系统默认，不复制）
│   ├── model-resolver.ts
│   ├── model-enrich.ts # 用公开模型目录给自定义供应商的模型行补参数
│   └── provider-oauth-flow.ts # 见文件头注释
├── prompt/
│   ├── prompt-assembler.ts
│   ├── prompt-composer.ts # 主会话系统提示词自由组合模板（{{token}} 在每次 run 前展开）
│   ├── persona-chain.ts
│   ├── tool-prompts.ts # bash 工具模型可见文案（description/snippet/guidelines/参数 schema）的唯一事实源（三条执行路径共用）
│   └── tool-prompt-overrides.ts # 逐工具文案覆盖（设置→工具区「编辑文案」）：归一化 + 给会话 _toolRegistry 打 description/snippet/guidelines 补丁（出厂定义永不动，可复原）
├── skill/
│   ├── skill-tool.ts # 让 AI 按名取技能全文（名录 + skill 工具）
│   ├── skill-discovery.ts
│   ├── skill-presentation.ts # 中文展示元数据与技能所属能力门禁
│   └── skill-content-filler.ts
├── mcp/
│   ├── mcp-bridge.ts # MCP 工具桥（外部 stdio MCP 服务器的工具接入 pi 会话）
│   ├── mcp-manager.ts
│   ├── mcp-hot-reload.ts # mcp.json 热加载（改完即生效，不重启）
│   ├── mcp-agent-tool.ts
│   └── plugin-mcp.ts
├── index.ts                # 入口：express 静态 + /ws 端点、消息分发、心跳、优雅停机
├── protocol.ts             # ★ 唯一事实源：wire 协议类型（client↔server 消息）
├── protocol-version.ts     # wire 协议版本（新旧端互斥时顶掉旧 tab）
├── serialize.ts            # SDK 消息 → UiMessage 序列化
├── text-sniff.ts           # 文件预览纯函数（previewKind/looksLikeText/decodeText/sniffImageMime/hexDump/countLines）
├── queue-utils.ts          # 排队消息纯函数（removeFirstOccurrence：只移除第一条匹配，重复文本不连带删除）
├── process-utils.ts        # 进程工具：snapshotListeningPorts/killPidTree/lookupProcessName
├── client-state.ts         # ClientStateStore：<dataDir>/client-state.json 持久化
├── uploads.ts              # 文件对话上传 + 保留期清理
├── bg-servers.ts           # 后台任务跟踪（bash 前后端口快照 diff + 存活刷新 + 闲置超阈值自动清理/📌钉住）
├── settings-service.ts     # 设置面板状态机
├── preset-share.ts         # ★ 设置预设的导入/导出/分享/社区目录（交换格式 pi-web-ui-preset v1：白名单净化、SSRF 收口、gh issue 回落预填网页、index.json 目录 5 分钟缓存；编排走 PresetSharePort，见 docs/preset-sharing.md）
├── preset-fields.ts        # 预设可携带的字段清单 + 分组（零依赖，前后端共用；编译期守卫对齐 ClientSettings 全集）
├── goal-service.ts         # 目标/审查循环/调研向导
├── i18n.ts                 # 服务端语言协商 + 翻译表注册（resolveServerLang/pick/bilingual/getServerBlock）
├── locales.ts              # 可下载语言包（核心只含 zh/en，其余语言走语言包 serverStrings 节）
├── tool-manager.ts         # ★ Agent 工具统一开关：AGENT_TOOL_CATALOG ＋ tool_manage 出入口（setAgentToolEnabled/applyAgentToolsGating），持久化只有 disabledAgentTools
├── tool-approval.ts        # 人机协同拦截与改写执行（HITL：Edit & Run），门禁在 ClientSession.askApproval
├── approval-rules.ts       # ★ 审批规则库与匹配引擎（ApprovalRulesStore：<dataDir>/approval-rules.json，多工具/多字段/多模式规则；ask/deny/allow 三种动作；纯函数评估）
├── compact-context-tool.ts # ★ 主动压缩上下文工具（compact_context）：AI 主动根据当前任务精简上下文，自主控制保留范围并在回合后生效
├── compaction-markers.ts   # 压缩 transcript 标记 + 修复（issue #235）
├── context-budget.ts       # 多级分层上下文预算裁剪（触发 LLM 全文摘要之前的梯度裁剪）
├── soft-cap.ts             # 自定义上下文压缩软上限（Soft Cap，issue #229；纯函数 normalize/effective/softCapToReserve）
├── dangling-tools.ts       # 悬空 toolCall 检测与修复（issue #280）
├── edit-soft-tool.ts       # 独立宽松编辑工具 edit_soft（行核心匹配，忽略缩进差异；开关走统一工具 tab）
├── read-tool.ts            # 覆盖内置 read：路径是目录时列目录条目（复用 SDK ls 的口径，其余原样转发内置；行为开关 readDirEnabled 在设置「工具」页，不入 AGENT_TOOL_CATALOG）
├── present-files-tool.ts   # ★ AI 展示文件（present_files）：只读探测 stat/未知扩展嗅探/文本摘录 → 结构化 items 走 toolResult 的 details → 前端预览卡片；不自动打开任何窗口
├── claim-files-tool.ts     # 文件认领（claim_files）：并行冲突的事前打招呼
├── claim-store.ts          # 文件认领表（claim store）+ 触碰 sidecar
├── conversation-read-tool.ts # 让 AI（含子代理）读取别的对话（list 看运行+历史，read 分页读）
├── conversation-touches.ts # 会话「触碰文件集」提取（纯函数，零 node 依赖）
├── delegate-task.ts        # 结构化派单工具 delegate_task（委派协议的代码级硬化）
├── eval-tool.ts            # 受控的持久代码求值沙箱工具（eval，opt-in）
├── hashline-engine.ts      # 基于内容哈希锚定与语法块解析的高可靠 Patch 引擎
├── patch-tool.ts           # 导出给 AI 的结构化补丁工具（Hashline Patch Tool）
├── lsp-tool.ts             # 导出给 AI 的原生 LSP 语言服务器工具
├── plan-manager.ts         # 结构化任务计划看板与步骤状态机（Plan Mode / Step State Machine）
├── schedule-agent-tool.ts  # 把内置调度器暴露给 Agent（issue #193）
├── scheduler-tasks.ts      # 内置定时任务调度（issue #184）：任务 CRUD + cron/间隔触发 + 无头执行
├── tool-info.ts            # 工具定义说明（工具卡右键 → 显示工具详细信息）：按名现取 SDK / DSH 运行时的工具定义 → `tool_info`（定义是大对象，不进快照；DSH 拿不到时回 `unsupported`）
├── load-tools-tool.ts      # 工具延迟加载入口（load_tools）：目录（名字 + 一行摘要）在系统提示词里，模型按需把参数 schema 拉进本对话
├── wait-subscription-scan.ts # 挂起 wake 订阅扫描（保留带 pending 子代理 wake 的对话）
├── slash-commands.ts       # 斜杠命令（NATIVE_COMMANDS 内置命令拦截执行 + 目录推送）
├── resolve-global-sdk.ts   # 优先用全局/祖先那份 pi SDK 的解析钩子（issue #260）
├── sdk-origin.ts           # 本进程实际加载的是哪份 pi SDK 及被遮蔽的副本（issue #260）
├── update-check.ts         # 全源更新检查（本体 / pi core / DIRECT 扩展）
├── managed.ts              # 外部托管实例（自更新：顶栏更新徽标 + 面板）
├── attachments.ts          # 附件构建（路径/行范围引用 + imageData/fileData + 视觉桥；内容不注入）
├── attachment-store.ts     # 基于 SHA-256 内容寻址（CAS）的附件存储
├── file-archives.ts        # 见文件头注释
├── file-transfer-routes.ts # 见文件头注释
├── office-parse.ts         # Office 文档纯文本提取（docx / xlsx，供预览与附件走 file_content 用）
├── composer-drafts.ts      # 未发送输入框草稿单中心文件（<dataDir>/composer-drafts.json，issue #166）
├── webui-context.ts        # 扩展 UI 桥（WebUIContext：widgets/statuses/dialog → 浏览器）
├── themes.ts               # 主题管理（listThemes/resolveThemeFile）
├── tabs.ts                 # 实例能力页签选择（Chat / Terminal / Git / Search / …）
├── plugins.ts              # 可选界面组件插件（扫描 <dataDir>/plugins/<id>/；renderer 插件字段 view:false + renderers）
├── plugin-api-catalog.ts   # 机器可读的注册面目录（slot 的 key/kind/occupants/example）
├── plugin-catalog.ts       # 插件市场列表（builtin plugins/catalog.json + 用户自定义 <dataDir>/plugin-catalog.json）+ 目录同步纯函数（normalizeSyncPayload/writeCustomCatalog，issue #148）
├── plugin-catalog-sync.ts  # 市场目录同步编排（拉取/校验/原子写/可选安装/重载+重推，issue #148）
├── plugin-conversation-view.ts # ★ 插件会话快照选会话策略（#542：按 clientId 取本标签页正看的对话 / 缺省跳过子代理回落 + 模型变更去重键，纯函数）
├── plugin-dom.ts           # 特权 DOM 访问授权表（<dataDir>/plugin-dom.json）
├── plugin-facilities.ts    # 插件宿主设施：插件私有 KV 存储 + 加密 secrets
├── plugin-grants.ts        # 插件目录授权表（<dataDir>/plugin-grants.json）：工作区外目录的「记住」授权（父目录覆盖子目录），设置面板可撤销
├── plugin-install-spec.ts  # 「安装前先读 spec」（引导式安装）
├── plugin-installer.ts     # ★ 插件后台作业：安装/更新/卸载跑 CLI 子进程（不占用户终端、不打断设置面板），输出按行回传 + 单作业锁 + 看门狗（issue #152）
├── plugin-llm.ts           # 插件直调模型（host.llm.complete 的底层：一次性孤立无工具会话）
├── plugin-manifest-validate.ts # manifest 本体校验（schema 失败即拒）
├── plugin-permissions.ts   # 插件能力动态授权表（host.requestPermission 的底层）
├── plugin-project.ts       # ★ 插件项目组装执行层（host.project.create：clone/写文件/git init；路径越界三道校验，授权由上层判，本模块不动授权）
├── plugin-schedule.ts      # 插件定时任务的 cron 解析与持久化（host.schedule 的底层）
├── plugin-tool-guard.ts    # 插件工具拦截扩展点（pre + post，只覆盖已接管的 bash/read）
├── plugin-updater.ts       # 插件更新辅助（备份/回滚 + 远端 sha 对比）
├── icon-svg.ts             # 插件内联 SVG 图标（manifest `iconSvg`）校验与规范化
├── host-metrics.ts         # 见文件头注释
├── http-proxy.ts           # 代理设置透传（~/.pi/agent/settings.json + 环境变量）
├── auth-cookie.ts          # pi_web_token cookie 编解码（decodeCookieToken；脏值原样返回）
├── vision-bridge.ts        # 视觉桥：纯文本主模型看图转写
├── files-service.ts        # 文件服务（readDirForUI/readFile/searchFiles/watcher）
├── workspace-snapshot.ts   # 工作区版本影子快照（Workspace Snapshot / Dual-State Rollback）
├── scm.ts                  # SCM 只读 git 查询（execFile git status/branches/history/filediff/commit）
├── scm-commitmsg.ts        # AI commit-message 生成（prompt 拼装 + 回复清洗；git 采集在 scm.ts）
├── patch-node-pty.ts       # node-pty × Node --watch 兼容自愈补丁
├── patch-remote-catalog.ts # pi.dev 模型目录整表替换补丁（幂等改写 SDK remote-catalog-provider：刷新后内置服务商列表=官方目录整表，不保留内置旧模型/不报“新增 N 个”）
├── ensure-bash.ts          # Windows 轻量 bash 兜底（busybox-w32）
├── control-socket.ts       # 本地控制 socket（status / quiesce / unquiesce）
├── launch-origin.ts        # ★ 启动来源探测：本实例是否被 launchd/systemd/Windows watchdog 托管（更新面板「重启服务」的前置条件）
├── terminals.ts            # TerminalManager（PTY 管理 + 增量输出/按键工具）
├── marker-service.ts       # 标记服务（内置版 pi-marker-tools）
├── dsh/                    # DSH 引擎（详见 docs/dsh-engine.md）：dsh-agent-service / dsh-client / dsh-serialize /
│                           #   dsh-sessions / dsh-usage（底栏统计纯映射）/ preset-clones（file: 克隆）/ probe-*.mjs /
│                           #   runtime/{launcher.mjs, goal-rpc.mjs（问卷 answerer + 技能钩子挂 agent scope）, custom-prompt.mjs, cordis.yml, override.patch.yml, runtime-root.mjs}
└── markers/                # 标记子系统（配 marker-service.ts）：index / marker / registry / store / builtins
```

## web/src/

带注释的是常用/有机制的模块；其余按文件名自解释，读源码（`use-*.ts` 均为 React Hook，`*.css` 只有 model-management.css 一个例外）：

```
web/src/
├── App.tsx             # 顶层布局
├── main.tsx            # 入口：首帧前应用主题防闪烁 + initAuthToken
├── use-chat.ts         # ★ useChat()：WebSocket 连接管理、reducer 状态机、终端 bridge
├── app-globals.ts      # ★ 全局运行态 store（engine/managed/tabs/版本号 + 全局发送器 appSend）
├── types.ts            # ★ wire 协议 re-export shim（export type * from "../../server/protocol"）
├── protocol-version.ts # 协议版本常量
├── i18n.tsx            # ★ 多语文案（核心 zh/en；新 key 两处都加；value 只许字符串字面量，见 AGENTS.md §9）
├── pick-locale.ts      # 语言选择辅助
├── styles.css          # ★ 全部样式（按组件分区，带注释分隔线）；也是默认深色主题本体
├── model-management.css # 模型管理页专用样式（唯一的第二个 css）
├── theme.ts            # 主题切换（/api/themes 列表 + localStorage 持久化 + applyTheme）
├── wallpaper.ts        # 壁纸（主题伴随资源）
├── sounds.ts           # WebAudio 提示音
├── notify.ts           # 桌面/OS 通知（PWA）：是否吞掉通知的判定（Windows 最小化检测）+ 诊断
├── download.ts         # 下载（fetch→blob，绕开 Chrome Safe Browsing）
├── base-url.ts         # appUrl()：服务端 URL 包应用根前缀（子路径部署必需）
├── auth-token.ts       # PI_WEB_TOKEN 口令注入
├── ui-slots.ts         # ★ 宿主 UI 扩展点引擎：BUILTIN_UI_ITEMS + buildUiSlots（宿主默认→插件贡献→插件 arrange→用户偏好 四层合并）+ splitOverflow/restoreUiItem
├── slot-toolbar.tsx    # 各组件 *HostNodes + renderMergedToolbar
├── topbar-fit.ts       # ★ 顶栏「放不下的自动进 ⋯」纯函数（fitTopbar）：按实测宽度从尾部丢，宽度 0 的条目不占位也不进菜单，测不到宽度全保留，有单测
├── context-menu-state.ts # ★ 通用右键菜单状态（contextmenu.* 槽位的 open/close + 定位/禁用/键盘导航纯函数，有单测）
├── use-floating-panel.ts # ★ 浮层统一 Hook（scroll/resize 只重算锚点；mousedown/Escape 才关）
├── composer-bridge.ts  # ★ 输入框注入桥：宿主（扩展/插件）把内容塞进输入框草稿的模块级 sink 注册点，有单测
├── composer-draft.ts   # 草稿合并/去重 + advanceComposerSession（附件跟会话走）纯函数，有单测
├── use-composer-session.ts # 输入框会话绑定 Hook
├── caret-visual-line.ts # ★ 输入框光标的首/末视觉行判定（镜像 div 量 offsetTop），供 ↑/↓ 翻输入历史用，有单测 + 真浏览器回归
├── prompt-history.ts   # 输入历史（↑/↓）存储
├── message-delta.ts    # message_delta 增量 patch 纯函数，有单测
├── lazy-window.ts      # 消息列表惰性窗口化纯函数，有单测
├── search-folded.ts    # 折叠区搜索辅助
├── present-items.ts    # ★ present_files 卡片纯函数（参数解析/与 details 合并/能力判定/自动打开闸门），有单测
├── present-settings.ts # 卡片偏好：自动打开预览弹窗（localStorage，默认关）+ 已开过的 toolCallId 去重表
├── file-preview-bridge.ts # 工具卡片 → 文件预览弹窗的模块级 sink（App 注册 opener）
├── file-link.ts           # Markdown 本地文件链接识别与路径规范化，复用预览桥
├── file-transfer.ts    # 文件传输前端逻辑（配 FileTransferDialog + file-transfer-routes）
├── tool-info-state.ts  # 工具定义弹窗的模块级 store（打开/关闭/应答 → 视图，纯函数 + 单测）
├── tool-prompt-state.ts # 逐工具文案编辑器的默认值 store（get_tool_prompt 应答 → 视图，纯函数）
├── tool-schema.ts      # 参数 JSON Schema → 表格行（参数名/类型/必填/说明，纯函数 + 单测）
├── tool-args.ts        # 工具卡头参数提示纯函数（路径/超时安全提取，脏参数不抛错），有单测
├── skill-block.ts      # parseSkillBlock：<skill> 块解析，有单测
├── image-paste.ts      # 粘贴图片等比缩放 ≤1568px + PNG/JPEG 转码
├── message-image.ts    # 消息内图片渲染辅助
├── export-image-state.ts # 图片导出状态
├── uuid.ts             # randomUuid（crypto 兜底），有单测
├── pending-question.ts # 待答问卷恢复（UiState.pendingQuestion → 恢复对话框）
├── optimistic-queue.ts # 流式排队/插队消息与撤回的本地乐观更新与权威快照对账纯函数（有单测）
├── question-attachments.ts # 问卷附件 chips
├── plugin-host.ts      # 插件宿主桥（window.__piWebUiHost，宿主 API 时序）
├── plugin-loader.ts    # 插件 client bundle 加载（含 view:false 懒加载 / preload 预加载）
├── plugin-fence.ts     # fenced-code 渲染插件匹配
├── plugin-file-handlers.ts # 插件文件处理器
├── plugin-logs.ts      # 插件日志视图数据
├── plugin-phase.ts     # 插件生命周期阶段
├── plugin-setting-options.ts # 插件设置 select 候选值
├── plugin-icon.tsx     # 插件图标渲染
├── at-mention.ts       # @ 提及补全
├── slash-filter.ts     # 斜杠命令过滤
├── quick-phrases.ts    # 快捷短语
├── conv-groups.ts      # 对话分组（左栏）
├── copy-text.ts        # 复制文本辅助
├── use-copy-feedback.ts # 复制反馈 Hook
├── scroll-classify.ts（在 components/，见下）
├── banner-notice.ts    # 顶栏公告条数据
├── browser-control.ts  # 浏览器操作桥逻辑（配 BrowserControl 组件 + page-picker 扩展）
├── cache-stats.ts      # 缓存统计（底栏）
├── chat-width-settings.ts # 聊天列宽设置
├── code-lines.ts       # 代码行号辅助
├── desktop.ts / desktop-updater.ts # 桌面壳前端侧（更新检查/重启）
├── model-usage.ts      # 模型用量统计
├── panel-sash.ts       # 面板分隔条（拖拽调宽）
├── provider-oauth-state.ts # 服务商 OAuth 前端状态（配 ProviderOAuthControls）
├── rollback-state.ts   # 回滚（workspace-snapshot）前端状态
├── scm-commit-history.ts / scm-history-filter.ts / scm-quote.ts / scm-sidebar.ts # SCM 面板辅助模块
├── scrollbar-gutter.ts # 滚动条槽位
├── shortcut-stack.ts   # 快捷键栈
├── stream-markdown.ts  # 流式 Markdown 渲染
├── swipe-drawer.ts / use-swipe-drawer.ts # 手机端抽屉横滑手势（纯判定 + DOM 粘合）
├── term-touch.ts       # 终端触屏支持
├── thinking-levels.ts  # 思考强度档位
├── tip-position.ts     # 提示定位
├── title-settings.ts   # 标题设置
├── token-input.ts      # Token 输入框
├── touch-device.ts     # 触屏设备判定（IS_TOUCH）
├── update-command.ts   # 更新命令拼装
├── use-click-outside.ts # 点击外部关闭（浮层通用）
└── components/         # 见下
```

## web/src/components/

| 组件                                                                                      | 职责                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FilePreview.tsx`                                                                         | 文件预览弹窗：行号、点选/拖拽/Shift 选区、添加到对话；Markdown 预览可切换原文；可编辑保存                                                                                            |
| `PluginFilePreview.tsx`                                                                   | 插件提供的文件预览器宿主                                                                                                                                                             |
| `PresentedFiles.tsx`                                                                      | `present_files` 工具卡片正文：图片/视频/音频内联显示/播放，文本开头摘录 + 「预览」按钮；每行「预览/本地打开/在文件夹中显示/下载/复制路径」；`focus` 条目按偏好自动弹预览窗（三道闸） |
| `ToolInfoDialog.tsx`                                                                      | 「工具详细信息」弹窗（工具卡右键）：展示工具**定义**（说明/参数 schema 表格+原始 JSON），点开现取不进快照；portal 到 body（消息流祖先有 overflow/transform）                         |
| `ToolPromptEditor.tsx`                                                                    | 逐工具文案编辑器（设置→工具区「编辑文案」）：description/snippet/guidelines 三字段，留空=默认；保存走 `set_settings.toolPromptOverrides`                                             |
| `ToolApprovalDialog.tsx`                                                                  | 审批弹窗（ask 规则命中时的人机协同拦截 + 改写执行）                                                                                                                                  |
| `LeftPanel.tsx`                                                                           | 左栏：最近项目、运行的对话、历史对话（含删除）                                                                                                                                       |
| `RightPanel.tsx`                                                                          | 文件树浏览（list_files），文件名点击→预览，🔗 引用路径（仅路径，无内容注入）/👁 预览/⬇ 下载等按钮；服务端原生递归 watcher                                                             |
| `ChatInput.tsx`                                                                           | 输入框 + 附件 chips（引用/行范围/图片/上传/网页/对话多彩）；全窗口拖放目标；followUp 排队/steer 插队；斜杠命令选择器                                                                 |
| `Message.tsx` / `MessageList.tsx`                                                         | 消息渲染（附件卡片、流式光标、tool 结果关联）；编辑重问保留原附件；技能卡片折叠；惰性窗口化；问题导航双通道；流式 StreamMarkdown                                                     |
| `ModelTiming.tsx` / `../chat-presentation.ts`                                             | 模型请求耗时与成功回合展示投影：运行中显示过程，完成后仅显示最终结果；保留原始历史供 trace、搜索与导出                                                                               |
| `StreamMarkdown.tsx`                                                                      | 流式 Markdown 渲染组件（配 stream-markdown.ts）                                                                                                                                      |
| `ToolCallBlock.tsx` / `ThinkingBlock.tsx` / `BashBlock`                                   | 工具调用卡片（卡头关键参数提示 `.toolcall-path`/`.toolcall-timeout`，脏参数静默不显示）、思考块、bash 输出                                                                           |
| `TerminalPanel.tsx` / `TermXterm.tsx`                                                     | 终端视图 + xterm 实例桥接                                                                                                                                                            |
| `SCMPanel.tsx`                                                                            | 源代码管理（Git）视图：status/branch/diff；提交/推送/拉取/切换分支；左栏宽度可拖分隔条调、双击复位、宽度存 localStorage（#139）                                                      |
| `BrowserControl.tsx`                                                                      | 顶栏「浏览器操作」入口 + 状态面板；已授权页面一键「引用到对话」（单页面时按钮直接变页面标题）                                                                                        |
| `TopBar.tsx` / `FooterBar.tsx`                                                            | 顶栏（模型/思考强度/后台任务/声音/新对话/视图切换）、底栏（上下文/成本/工作目录）；单一扁平流，slot 顺序直排 + `hostNodes`                                                           |
| `Dialog.tsx`                                                                              | 扩展 `ui.select/confirm/input` → 浏览器弹窗（正文/选项走 `Markdown(rawHtml)` 富渲染）                                                                                                |
| `Modal.tsx`                                                                               | 通用弹窗壳                                                                                                                                                                           |
| `DshQuestionDialog.tsx`                                                                   | 模型提问对话框（`question_pending`，DSH 经 goal-rpc / pi 经 `ask_user_question` 共用）：单选/多选/自定义文本 + 选项 `preview` 富文本；挂 `UiState.pendingQuestion`，刷新后恢复       |
| `DshPresetBar.tsx`                                                                        | DSH Agent 预设条（模式切换 + 首轮锁定）                                                                                                                                              |
| `DshPermissionBar.tsx`                                                                    | DSH 权限提示条                                                                                                                                                                       |
| `ModelConfigModal.tsx` / `PiSetupModal.tsx`                                               | models.json 管理 / 首次配置引导                                                                                                                                                      |
| `ProviderOAuthControls.tsx`                                                               | 服务商 OAuth 授权控件                                                                                                                                                                |
| `SettingsModal.tsx`                                                                       | 设置面板（侧边栏分页：提示词/工具/消息显示/技能/插件/界面插件/目标审查/视觉桥/预设/子代理模板；DSH 另有问卷页、无工具页）                                                            |
| `PluginSettingsForm.tsx`                                                                  | 插件声明式设置表单（schema 驱动）                                                                                                                                                    |
| `PromptTemplates.tsx`                                                                     | 提示词模板管理                                                                                                                                                                       |
| `GoalBar.tsx`                                                                             | 输入框上方目标条：设目标/清除/AI 提炼/轮数下拉                                                                                                                                       |
| `PlanBoard.tsx`                                                                           | 结构化任务计划看板（配 plan-manager.ts）                                                                                                                                             |
| `BgTasksModal.tsx`                                                                        | 后台任务弹窗：AI 启动的监听端口进程列表                                                                                                                                              |
| `SchedulerPanel.tsx`                                                                      | 定时任务面板（配 scheduler-tasks.ts）                                                                                                                                                |
| `ModelThinking.tsx`                                                                       | 模型 + 思考强度下拉（按服务商筛选 + 顶部搜索）                                                                                                                                       |
| `GlobalSearchModal.tsx`                                                                   | 全局搜索弹窗（Ctrl+K）：搜历史对话/最近项目/工作区文件名                                                                                                                             |
| `ProjectPicker.tsx`                                                                       | 项目选择器                                                                                                                                                                           |
| `LocaleModal.tsx`                                                                         | 语言切换弹窗                                                                                                                                                                         |
| `PluginView.tsx`                                                                          | 插件视图宿主：薄 React 壳 + 动态 import client bundle                                                                                                                                |
| `PluginViewFallback.tsx`                                                                  | 插件视图加载失败兜底                                                                                                                                                                 |
| `PluginFenceBlock.tsx`                                                                    | fenced-code 渲染插件块（配 plugin-fence.ts）                                                                                                                                         |
| `PluginMenu.tsx`                                                                          | 插件菜单面板（浮层，走 useFloatingPanel）                                                                                                                                            |
| `PluginModal.tsx`                                                                         | 插件弹窗宿主（host.openModal）                                                                                                                                                       |
| `SlotTabs.tsx`                                                                            | slot 驱动的 tab 容器（`rightpanel.tabs` 与设置面板共用）：除当前选中项一律不挂载，切走即 cleanup；选中态存 localStorage                                                              |
| `SlotErrorBoundary.tsx`                                                                   | slot 内容错误边界                                                                                                                                                                    |
| `ContextMenu.tsx`                                                                         | 通用右键菜单渲染层（`contextmenu.*` 槽位）：portal + fixed + 先渲染再实测尺寸钳制；只渲染，点条目交回宿主 `onAction`                                                                 |
| `PluginPage.tsx`                                                                          | 插件自定义设置页宿主（`settings.pages` 槽位）：随选中项挂载/卸载；容器子节点只由插件写                                                                                               |
| `CollapsedMessage.tsx` / `LazyMount.tsx`                                                  | 消息折叠摘要行 / 消息级惰性挂载包装                                                                                                                                                  |
| `SearchBar.tsx`                                                                           | 会话内搜索栏（Ctrl+F，CSS Custom Highlight API 高亮）                                                                                                                                |
| `HoverDetail.tsx`                                                                         | 悬浮详情（? 提示内容体，配 HintTip 定位）                                                                                                                                            |
| `RollbackDialog.tsx`                                                                      | 工作区回滚确认（配 workspace-snapshot.ts）                                                                                                                                           |
| `SaveImageDialog.tsx`                                                                     | 图片保存对话框                                                                                                                                                                       |
| `FileTransferDialog.tsx`                                                                  | 文件传输对话框（配 file-transfer.ts）                                                                                                                                                |
| `BannerContainer.tsx`                                                                     | 公告条容器（配 banner-notice.ts）                                                                                                                                                    |
| `NotifyToggle.tsx`                                                                        | 声音/通知开关（含隐藏的通知诊断面板 `SHOW_NOTIFY_TEST_PANEL`）                                                                                                                       |
| `Markdown.tsx` / `Dropdown.tsx` / `copy-button.tsx` / `HintTip.tsx` / `SoundSettings.tsx` | 通用件（HintTip：`?` 悬浮提示 portal 顶层渲染）                                                                                                                                      |
| `mermaid.ts` / `scroll-classify.ts`                                                       | 非组件辅助（mermaid 渲染 / 滚动分类，与组件同目录存放）                                                                                                                              |

接口测试真实目标接入探测：`tests/api-testing-os-isolation-test.mjs` 验证 macOS 本机 OS/MCP 边界，证据见 `docs/api-testing-evidence/isolation-local-mcp.md`；不会安装或放宽产品目标。

接口测试宿主隔离：`server/api-testing-isolation.ts` 生成 macOS fixture 的 sandbox-exec profile，`api-testing-runner.ts` 强制接入；OS 探针复用该生成器，仍无远端目标支持，见 [宿主隔离接入](api-testing-evidence/isolation-host.md)。

远端传输可行性验收：`tests/api-testing-relay-isolation-test.mjs` 使用测试内固定 TCP relay 与真实 MCP/Newman；默认仅合成服务，显式 `--public-docs` 才读已提供的 Swagger 页面。它不是产品目标接线，见 [证据](api-testing-evidence/isolation-relay.md)。

手动 HTTP 目标：`server/api-testing-relay.ts` 固定转发与执行副本映射，`server/api-testing-runner.ts` 绑定启动项目/目标、批准 hash 与取消清理；`tests/api-testing-target-test.mjs` 验证完整宿主路径，原 relay 隔离探针已改为复用产品转发模块。见 [接线验收](api-testing-evidence/target-host.md)。

手动目标专用凭据：`server/api-testing-credential.ts` 读取并验证绑定项目/目标的短期测试 token 引用，`api-testing-runner.ts` 负责私有交付与撤销清理；`tests/api-testing-target-test.mjs` 使用合成凭据验证，见 [凭据验收](api-testing-evidence/credential-host.md)。

API 管理与快捷入口：`scripts/enable-api-testing.mjs` 为项目/应用配置技能与宿主插件，拒绝覆盖其他安装；`tests/unit/api-testing-registration.test.ts` 验证配置保留/冲突，`tests/api-testing-visibility-test.mjs` 验证桌面实际可见与快捷操作。见 [验收](api-testing-visibility.md)。

## 精简与依赖工具

- `desktop/package*.json`：桌面可选开发工具。
- `tools/vendor/package*.json`、`tools/e2e/package*.json`：vendor 与 E2E 独立锁文件。
- `scripts/install-profile.mjs`、`scripts/run-profile.mjs`：可选工具安装、兼容链接和本地执行。
- `scripts/project-budget.mjs`、`project-budget.json`：固定体积预算及本机目录统计。
- `scripts/archive-evidence.mjs`：外部证据副本、校验索引，不删除原件。
- `tests/lib/api-test-runtime.mjs`：共享 API 依赖与每次隔离的源码副本。
- `tests/unit/project-slimming.test.ts`：安装冲突与归档完整性验证。

## UI 执行守卫与本项目 fixture

- `server/extension-tool-policy.ts`：UI 工具 operation 的查询、写资产、浏览器动作、正式执行分类；未知 UI/MCP 操作在受限模式保守拒绝。
- `server/extension-tool-gate.ts`：宿主隐藏 SDK 扩展，统一检查顶层、嵌套及后注册工具；不依赖工具是否从 UI 隐藏。
- `qa/ui/`：本项目隔离服务、数据、Playwright fixture 与预检，维护见 [README](../qa/ui/README.md)。
- `tests/ui-tool-guards-test.mjs`、`tests/ui-project-fixture-test.mjs`、`tests/ui-project-browser-test.mjs`：门禁、生命周期及真实浏览器验收。

数据空间接入：`plugins/data-space/test-channel.mjs`（环境初始化与资产归档）、`environment-preparation.mjs`（模式及非敏感参数准备回执）、`plugins/data-space/automation.mjs`（关联与幂等同步）、`durable.mjs`（原子写）、`client/modal-automation.mjs`（管理入口）；`server/test-asset-reader.ts` / `test-execution-notice.ts`（原生证据桥）；`.pi/skills/data-space-testing/`；`scripts/enable-data-space.mjs`；`tests/data-space-{native,browser}-test.mjs`。

数据空间修订视图：`plugins/data-space/client/case-versions.mjs`（最近入库/全部版本及zh/en）；`client/modal-automation.mjs`（原生来源、修订及历史证据）。

数据空间结果规范：`.pi/skills/data-space-testing/references/result-output.md`（Agent 交付约定，不是存储 schema）、同 Skill `scripts/validate-result.mjs`（只读一致性检查）；`tests/data-space-skill-desktop-test.mjs`（Electron 技能、插件归属和快捷发现验收）。

Agent 评估 EC01/EC02：`plugins/agent-evaluation/schema.mjs`（运行校验）、`store.mjs`（单写者/幂等/授权/导出）、`durable.mjs`（原子持久化）、`collect.mjs`/`adapters/pi.mjs`（采集与封存）、`server/agent/evaluation-evidence.ts`（授权 SDK 选区）；`tests/unit/agent-evaluation-{store,evidence,host}.test.ts` 与 `tests/agent-evaluation-{native,server}-test.mjs` 为工程验收。产品接线待 EC04，见 [EC02](agent-evaluation-evidence/EC02.md)。

Agent 评估 EC03 基础：`plugins/agent-evaluation/registry.mjs`（三类扩展校验）、`evaluate.mjs`（快照作业）、`aggregate.mjs`（聚合）；`tests/fixtures/agent-evaluation/engine.mjs` 与 `tests/unit/agent-evaluation-{registry,engine}.test.ts` 提供合成对照。`evaluators/{basic,metrics,common}.mjs`、`profiles/internal.mjs` 为七条基础规则/指标与默认 profile；`server/agent/evaluation-artifact.ts` 为有界授权文件观察；新增 rules/artifact 单测、`tests/agent-evaluation-timing-test.mjs` 实测并行计时和原生评分对照见 [EC03](agent-evaluation-evidence/EC03.md)。

Agent 评估 EC04：`service.mjs`（操作/授权/分页）、`index.mjs`（UI/工具通道）、`client/{entry,transport,configuration,i18n,style}.mjs`（页面/生命周期/双语/主题）、`scripts/enable-agent-evaluation.mjs`（显式登记）；`tests/fixtures/agent-evaluation/active-jobs.mjs`为隔离规则延迟/迟到结果探针（desktop-test的--active-jobs）；service/client/enable 单测及 `tests/agent-evaluation-{desktop,native-desktop,performance}-test.mjs` 记录真实桌面与固定性能对照，性能失败保留，见 [EC04](agent-evaluation-evidence/EC04.md)。

`plugins/agent-evaluation/pack.mjs` 为 EC04 物理批量证据格式与范围校验；逻辑 schema 不变，旧 JSON/blob 兼容读取，`store.mjs`/`durable.mjs` 负责发布、恢复和逐引用授权。相关断点/丢回执/真实进程退出验证在 store/evidence 单测。

EC05：`plugins/agent-evaluation/adapters/atif.mjs`（有界解析/转换）、`adapters/atif/{schema.json,README.md,LICENSE.txt}`（官方格式来源与严格profile）；`tests/unit/agent-evaluation-atif.test.ts`和`tests/agent-evaluation-atif-test.mjs`覆盖边界及禁止IO探针。service/存储/报告接线进展见[EC05记录](agent-evaluation-evidence/EC05.md)。

EC05 `plugins/agent-evaluation/import.mjs`负责离线来源校验、确定性阶段回执和封存；store新增受授权原包读写，schema新增offline scope。`tests/unit/agent-evaluation-import.test.ts`覆盖权限/恢复/子进程退出与不提权评分；`tests/agent-evaluation-import-test.mjs`为零业务原生集成，非桌面导入验收。

EC05 产品上传：`plugins/agent-evaluation/upload.mjs`维护有界临时原字节、身份绑定、分块重试与过期清除；`service.mjs`的人审专用动作连接原有import/store/engine，`client/`提供上传预览/确认与离线报告来源/损失/原包分页。`tests/unit/agent-evaluation-upload.test.ts`覆盖资源/权限边界；`tests/fixtures/agent-evaluation/offline-import.mjs`在实际Electron主用例中验证文件上传和跨进程回读。

EC06 隔离可行性：`tests/agent-evaluation-isolation-test.mjs` 与 `tests/fixtures/agent-evaluation/isolation-probe.mjs` 仅运行原生 macOS 零模型探针，保存文件/网络拒绝及逃逸子进程取消反例；诊断 PASS 不代表执行后端获批，见 [EC06](agent-evaluation-evidence/EC06.md)。

EC04 桌面可选补验：`tests/agent-evaluation-desktop-test.mjs --evidence-matrix`复用`tests/fixtures/agent-evaluation/evidence-matrix.mjs`，验证160K合成证据完整分页、真实缺文件/恢复、窄屏与小样本绘制耗时；不改产品，不替代性能或完整回滚门禁，见[记录](agent-evaluation-evidence/EC04.md)。

EC04 回滚验收：`tests/agent-evaluation-desktop-test.mjs --rollback`通过`tests/fixtures/agent-evaluation/rollback.mjs`在自有数据目录执行实际插件revert、完整停止后userData备份/恢复及旧版未知格式写入拒绝；版本/同宿主边界和原始证据见[记录](agent-evaluation-evidence/EC04-rollback-diagnostics.json)。

EC04规模与分页回归：`tests/agent-evaluation-desktop-test.mjs --scale`使用`tests/fixtures/agent-evaluation/scale.mjs`在停止自有应用后生成50份合成报告/1000证据快照，验证实际Electron分页与投影有界；service单测覆盖可见引用摘要，原始失败和结果见[EC04](agent-evaluation-evidence/EC04.md)。

EC04工具通道补验：`tests/fixtures/agent-evaluation/tool-channel.mjs`只提供本地脚本化SSE；`tests/agent-evaluation-native-desktop-test.mjs --tool-matrix`驱动原SDK工具，核对get成功、review入口拒绝及可信UI正对照，不修改产品或调用真实模型，见[证据](agent-evaluation-evidence/EC04-tool-channel-diagnostics.json)。

`tests/agent-evaluation-ui-matrix-test.mjs`：41条本地UI真实执行混合状态夹具；`tests/fixtures/data-space/ui-{design-fixture,fixture}.mjs`仅增测试规模与按名称前缀的目标故障控制，默认单用例行为保留。详见[EC04执行分页证据](agent-evaluation-evidence/EC04-executed-matrix-diagnostics.json)。

EC04 规则扩展补验：`tests/agent-evaluation-desktop-test.mjs --rule-upgrade`使用`tests/fixtures/agent-evaluation/rule-upgrade.mjs`，在自有profile追加纯规则、V1/V2并存、精确重评和无数据空间F07；原执行器/注册表/引擎/存储不替换，合成调用历史不冒充真实执行，见[证据](agent-evaluation-evidence/EC04-rule-upgrade-diagnostics.json)。

EC04 双任务补验：`tests/agent-evaluation-desktop-test.mjs --task-scope`使用`tests/fixtures/agent-evaluation/task-scope.mjs`生成同会话两个合成任务，经实际界面核对选区、空业务条件诊断、原请求回执重放及独立重评；零真实工具/模型调用，见[证据](agent-evaluation-evidence/EC04-task-scope-diagnostics.json)。

EC04 结论边界补验：`tests/agent-evaluation-desktop-test.mjs --verdict-matrix`使用`tests/fixtures/agent-evaluation/verdict-matrix.mjs`构造10组合成历史，经可信桌面连接创建契约并逐一打开报告，核对目标、依赖约束、交付及缺口；零真实工具/模型调用，见[证据](agent-evaluation-evidence/EC04-verdict-matrix-diagnostics.json)。
