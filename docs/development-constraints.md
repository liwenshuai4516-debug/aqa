# 开发约束与历史避坑

按任务阅读相关小节；这些约束从原 AGENTS.md 迁入，继续有效。通用验证与提交规则见根 AGENTS.md。

### 1. 通信协议与数据安全

- **`details` 字段硬限制 ≤64KB**：下发与持久化会超限整包丢弃。新工具严禁塞入大块原始数据（参照 `present-files-tool.ts` 做摘录预算）；前端渲染必须支持无 details 降级（`present-items.ts`）。
- **服务端 URL 必须包裹 `appUrl()`**：包括 `/ws`、`/api/*`、`/plugins/*`、`/themes/*`，杜绝反向代理子路径部署时 404。
- **Token Cookie 校验前必须解码**：`pi_web_token` 经 `encodeURIComponent` 存储，服务端读取必须先 `decodeCookieToken` 再校验（`server/auth-cookie.ts`）。
- **工作区严禁使用家目录根**：禁止设置 `$HOME` 为工作区根，防止递归扫描坏挂载造成事件循环卡死。
- **远期定时器必须使用 `armDelay` 分片**：Node.js 中 `setTimeout` 超过 2^31-1 毫秒（约 24.8 天）会整型溢出被截断为 1ms 从而引发死循环。超过 6 小时任务必须分片（守卫：`plugin-cron-overflow-test.mjs`）。
- **文本解码与行号统计规范**：预览与附件统一使用 `decodeText`（UTF-8 → GBK → latin1）；`countLines` 不计末尾空行，前端需 pop 末尾空串。

### 2. 工具定义与提示词规范

- **工具提示词三处职责分离（严禁跨处复述）**：
  1. Tool Schema 的 `description`：仅描述“做什么与边界”，≤600 字符；
  2. 系统提示词中的 `promptSnippet`：仅写“何时触发”，≤80 字符，不带工具名前缀；
  3. `Guidelines` 段落的 `promptGuidelines`：仅写“调用顺序/禁令/跨工具路由”。
     _必须使用精炼纯英文，违规会被守卫单测拦截_（守卫：`tests/unit/tool-prompt-hygiene.test.ts`）。`edit` 工具提示词亦归本项目单源覆盖（`agent-service.ts`）。
- **工具延迟加载硬约束：绝不破坏前缀缓存**：
  供应商 Prompt Cache 依赖系统提示词前缀完全一致。系统提示词 `{{tools}}` 目录必须保持完整且不随已加载状态变化；新加载工具的要点随 `load_tools` 回执进入对话；注册表仅允许追加（`toolsAdded`），严禁就地修改或删除（守卫：`tests/lazy-tools-test.mjs`，文档：`docs/tool-context-budget.md`）。
- **单工具多执行路径必须提示词单源**：以 bash 为例，原生、终端和自适应分流路径共用 `server/prompt/tool-prompts.ts`，禁止在 execute 覆盖实现中硬编码或复制描述。
- **新增工具三处联动**：新增可开关工具必须同时登记到 `tool-manager.ts`（`AGENT_TOOL_CATALOG` 事实源）、`agent-service.ts`（`customTools` 列表）以及 `tests/unit/tool-registration.test.ts`；内置工具覆盖必须走 `tool-overrides.ts`。
- **逐工具文案可编辑机制**：用户自定义文案仅作为偏好存入 `toolPromptOverrides`，新增可配置维度必须同步打补丁逻辑、wire 协议与设置页编辑器三处（守卫：`tests/unit/tool-prompt-overrides.test.ts`）。

### 3. UI 布局与样式规范

- **CSS 变量必须先定义后引用**：未定义的 `var(--x)` 会导致整条 CSS 声明失效；内联代码前景色与背景色对比度必须 ≥2:1（守卫：`tests/unit/css-tokens.test.ts`、`theme-inline-code-contrast.test.ts`）。
- **强调色实底上的文字必须走 `--accent-contrast`**：`background: var(--accent)` 配 `color: #fff` 会在浅色强调主题（`flow`/`wallpaper-flow` 的纯白、`wallpaper-obsidian` 的 `#e2e8f0`、`aetheris`/`cyberpunk`/`nord` 等）变成白底白字，按钮直接隐形。前景一律写 `var(--accent-contrast, #fff)`（插件同理，宿主 `:root` 提供回退值）；半透明 `color-mix(… var(--accent) 30% …)` 染色底则用 `var(--text)`；主题若把 `--accent` 定成浅色，必须同时声明反色的 `--accent-contrast`（守卫：`tests/unit/accent-contrast.test.ts`）。
- **语义色实底同理走 `--on-*`**：`background: var(--green|--red|--amber|--blue|--send-blue|--stop-red)` 配 `color: #fff` 同样会隐形（默认主题 `--amber` 白字 1.67:1、`--green` 1.92:1、`--red` 2.77:1）。前景写 `var(--on-green|--on-red|--on-amber|--on-blue|--on-send-blue|--on-stop-red)`；状态色按「白/深取对比更高者」派生、动作色（blue/send/stop）白字 ≥3:1 就保留白字，主题侧由 `make-light-theme.mjs` 自动派生（守卫：`tests/unit/semantic-contrast.test.ts`）。
- **主题的「文字令牌」必须有明暗下限**：`--text-faint`（3.05:1）、`--accent`（3.5:1）、`--amber/--green/--red/--blue/--link/--link-soft/--info-blue/--skill-blue/--auth-green/--plugin-purple/--amber-text/--red-text/--err-text/--md-strong/--code-text`（4.5:1）在 `--bg` 与 `--bg-elev2` 上必须够对比——亮色主题照抄深色默认值会让警告文字、状态 chip、链接整体糊掉（曾出现 `--plugin-purple` 1.50:1）。`make-light-theme.mjs` 的 `TEXT_FLOORS` 会自动保持色相压暗，手写主题自行声明（守卫：`tests/unit/theme-text-contrast.test.ts`）。
- **长文本与长路径防溢出标准**：
  - 行容器（flex 容器）必须添加 `min-width: 0` 与 `max-width: 100%`；
  - 可断行文本（`.md` 内正文、路径）必须使用 `overflow-wrap: anywhere` 与 `word-break: break-word`；
  - 单行文本使用 `overflow: hidden` 与 `text-overflow: ellipsis`；
  - 独立面板与弹窗列表（如计划看板、沙箱差异）必须声明 `overscroll-behavior: contain` 防止整页滚动条穿透；但流内工具输出与代码文本块等非独立浮层容器严禁声明 `overscroll-behavior: contain`，防止滚轮黑洞锁死外部对话流（守卫：`tests/unit/text-wrap.test.ts`）。
- **卡头与操作按钮落点规范**：
  - 折叠卡头（`.chead`）右端**仅放置自身复制键**（`.chead-copy`，钉 `flex: none`），卡头内严禁悬挂消息级操作按钮；卡头提示文本设置 `flex: 0 1 auto` + `min-width: 0` 吸收缩放，窄屏下限制最大宽度，严禁用 `flex-wrap: wrap`。
  - 消息级操作栏（`.msg-actions`）仅对有正文的助手消息和用户消息生效；助手消息操作栏必须紧锚在最后一个正文块后，杜绝与工具卡分离。
- **UI 扩展点与浮层规则**：
  - 下拉菜单必须 Portal 到 `body` + `fixed` 布局，防止被父容器 `overflow` 截断；
  - 浮层统一使用 `useFloatingPanel`，禁止在 `scroll` 事件中强制关闭浮层（仅重算锚点，通过 mousedown/Escape 关闭）；
  - 侧边停靠栏（`SideDock`）为流内 flex 项目，浮动模式由 `sideDockFloat` 控制，严禁写死 fixed 遮挡侧边按钮。
- **输入框上方那条带子属于消息区**：快捷短语行只是浮在它上面，正文从芯片**之间**的缝里透出来（芯片本身是实底小卡片，压在正文上必须压得住字）。带子高度单源在 `.main` 的 `--composer-strip`（= `--composer-pad-top` + ChatInput 实测写入的 `--quick-row-h` + 6px）；改输入区上内边距或短语行留白必须同时顾三处：`.messages-wrap` 的负 margin、`.messages` 的底部留白、以及按容器底缘定位的 `.scroll-bottom` / `.qn-rail`（都要 `+ var(--composer-strip)` 回补），严禁把短语行改回 `position: absolute`（会与药丸/浮标抢同一条带子，折行时必叠）。守卫：`messages-behind-composer.test.ts`。
- **拖拽与触控交互标准**：
  - 图标编辑与拖拽必须监听 Pointer 事件，严禁使用 HTML5 DnD（移动端触屏不触发）；内置图标须在 `host-icon.tsx` 登记；菜单行文字统一 12.5px（守卫：`host-icon.test.ts`、`topbar-overflow-menu.test.ts`）。
  - 手机端横滑手势（`swipe-drawer.ts`）必须避开系统侧滑区，手势期间直写内联 transform 禁用动画过渡，松手后清理内联值交由 CSS 类过渡；移动端遮罩常驻（守卫：`swipe-drawer.test.ts`）。
- **新会话初始化交互**：切换或新建会话须经 `focusComposer()` 聚焦（触屏除外），非 chat 视图自动切回，待发附件 chips 随新会话清空（守卫：`composer-draft.test.ts`）。

### 4. 架构与运行态约束

- **目标模式 2.0 运行铁律**：主对话作为审查者，服务端另起落盘执行者；轮次、代次与停滞熔断全由服务端管控，严禁模型自行调用 wait/spawn；审查指令必须注入执行证据（`goal-evidence.ts`）；会话中止或关闭即停止循环，不得无限续轮（守卫：`goal-delegated.test.ts`、`goal-evidence.test.ts`，文档：`docs/goal-conversation-design.md`）。
- **审查者委派模式（Delegate Mode）**：开启后主对话只审不干，用户输入自动派发给常驻执行会话；闸门强制拦截写操作与子代理派发；计划模式优先级高于委派。
- **预设分享必须白名单严格净化**：导入外部 JSON 必须通过 `server/preset-share.ts` 白名单校验（`preset-fields.ts`），丢弃未知字段，执行 dryRun 确认，严禁未经校验直接摊入 `ClientSettings`（守卫：`preset-share.test.ts`，文档：`docs/preset-sharing.md`）。
- **Windows 最小化通知**：Windows 最小化时页面 visibility 状态不准确，必须通过窗口尺寸矩形判断（`isCollapsedWindow`）；通知禁止携带 `tag` 字段，防止被系统静默吞并。
- **模型目录官方整表替换**：通过 `patch-remote-catalog.ts` 幂等改写 SDK 目录，不残留旧定义，升级后自动重新应用。
- **DSH 运行态三规则**：shipped 预设使用 `preset-clones.ts` 的 file: 克隆隔离；问卷与过滤钩子挂 agent scope；统计指标吃直播帧与 assistant/message.usage（`dsh-usage.ts`）。
- **会话过户与状态迁移**：`take_over_conversation` 完整搬迁 runtime 本体，且**是事务性的**（源侧已摘、目标侧接入失败就原样搬回，绝不留「还在跑但没人持有」的幽灵会话，见 `#556` / `tests/takeover-rollback-test.mjs`）；**断连残骸的「另一处」行有宽限期**（`PI_WEB_OFFLINE_ROWS_TTL_MS`，默认 30 分钟，标 `ownerOffline`，仍可过户——手机 run 途中关页面后换设备仍能接管）；`ask_user_question` / `browser_page` 解析创建时的 session 对象（`bridgeTarget`）；跨页答复带 owner。
- **宿主提供的包只能声明在 `peerDependencies`（`"*"`）**：pi 扩展加载器只扫 `dependencies`（命中 `@earendil-works/pi-coding-agent` / `typebox` 就告警：嵌套副本会绕开加载器注入、搞出重复运行时模块）。本包同时是扩展与独立服务端，服务端子进程真要这两个包（`PI_WEB_SDK=bundled` 也要自带副本）→ 落在 `optionalDependencies`（npm 默认照装）。守卫 `tests/unit/extension-host-packages.test.ts`。
- **布局页改名 / 插件 `arrange.label` 必须落到渲染层**：合并引擎对「显式指定的文案」置 `UiSlotEntry.labelExplicit`；内置条目（顶栏按钮、底栏数值徽标）一直画写死的 i18n 与实时数值，只有旗立着时才让位（名字型顶掉内置文案；数值型把名字插在数值前，不吞实时数据）。只在设置页生效 = 假承诺（`#555`，守卫 `tests/unit/bar-item-unified.test.ts`）。
- **插件修改必须递增版本号（Bump Version）**：内置官方插件（`plugins/<id>/`）凡修改了代码/功能/静态资源（非纯文档），必须同步递增 `manifest.json` 中的 `version`（若有 `package.json` 的 `version` 须保持一致）。原因：随包热同步（`syncBuiltinPlugins`）与更新器（`plugin-updater`）均以 `compareVersions(srcVer, tgtVer) > 0` 作为升级判定的唯一权威事实源；若漏改版本号，老用户更新主程序后数据目录中的旧插件代码永远不会被热更新覆盖，导致缺陷滞留（守卫：`tests/unit/plugin-version-bump-guard.test.ts`）。
- **修改测试插件一定要及时更新测试目录中的插件**：实际运行加载的插件位于 `<dataDir>/plugins/<id>/`。修改或测试工作区内置插件时，除递增版本号外，必须将最新源码同步到隔离测试 data-dir 的对应插件中（或显式指定该目录使用现有链接脚本），确认加载新代码；不得默认覆盖个人数据目录的插件。
- **国际化字面量要求**：`i18n.tsx` 的词条值必须使用字符串字面量（仅允许 `+` 拼接），确保 `scripts/i18n-diff.mjs` 静态解析器正常运行。
