# Pi Agent Desktop（内部测试）

基于本地 pi-web-ui 0.109.0 基线，Electron 管理原服务子进程并加载原界面。业务仍使用原 HTTP/WS、Pi Agent SDK 和工具协议。正式名称、App ID、签名与更新地址尚未确定；当前身份为 `Pi Agent Desktop` / `local.pi-agent.desktop`。

## 开发与构建

使用 Node 24 LTS（本机验证 24.19.0）。Electron 44.4.2 内置 Node 24.21.0，包内 SDK 为 1.1.0。T14 将已锁定版本的 DSH 适配器运行依赖显式列入生产依赖，修复安装包遗漏 peer 依赖的问题；没有升级现有依赖版本。

```sh
npm ci --include=dev --include=optional
npm run build
npm run desktop:dev
npm run typecheck
npm run lint
npm test
npm run build:desktop
npx electron-builder -c desktop/electron-builder.yml --mac --arm64 --publish never
```

产物在 `release/`。Windows x64 NSIS 与 Linux x64 AppImage 配置位于同一文件；须在对应系统构建、运行验收后才能声明支持。桌面 workflow 仅手动生成内部构建附件，不向原作者仓库发布。既有便携版入口保留；macOS 显式便携根的实际安装包启动、聊天/终端和重启恢复已验证，见 `docs/desktop-delivery/T32-portable-mode.md`，不代表 Windows 便携版已验收。

## 启动与数据

首次启动通过原生目录选择器选择已有项目，取消则退出；禁止选择家目录根。后续恢复最近工作区，无效时重新选择。开发和受控测试可显式指定 `PI_WEB_CWD`。

默认数据位置为 Electron appData 下的 `Pi Agent Desktop/`，其中 `data/` 为业务数据、`agent/` 为模型配置和会话、`logs/` 为脱敏日志；`startup.json` 保存工作区，`ui-preferences.json` 只保存允许的界面偏好。不自动导入原 Web/CLI 凭据或会话，不宣称认证文件已加密。首次模型配置使用原设置页面。

服务只监听 127.0.0.1，优先端口 8790，已占用则安全回退，不终止占用进程。每次启动随机生成鉴权令牌，并以原 cookie 流程交给界面；健康与身份校验通过才打开窗口。主题、语言和面板设置按明确白名单跨端口恢复，不复制身份或授权。

客户端自身启动不需要全局 Node/Pi CLI。用户项目的 Git、Shell、Python、MCP 等仍需原有外部环境；模型和市场需要网络及用户配置。DSH 引擎还需官方运行时树（本次验证 `@deepseek-ai/dsh@0.1.5-rc.3`），可由 `PI_WEB_DSH_RUNTIME` 指向其 node_modules；应用仅随包携带原适配器所需依赖，不内置完整官方 DSH 运行时。

便携模式可通过原 `PI_PORTABLE_ROOT` 指向可写便携根，默认数据布局为其 `data/electron`、`data/web`、`data/agent` 和 `data/workspace`。macOS `.app` 不依赖同级标记自动发现，受控启动时显式指定根；需要独立 shell home 时沿用 `PI_PORTABLE_HOME`。不要在便携启动中混入个人 agent/data 路径覆盖。当前仅验证同路径重启，移动目录后的历史绝对路径处理没有新增验收。

## 窗口、恢复与浏览器

macOS 关闭窗口保留服务，Dock 激活重建窗口；重复实例聚焦原窗口。正常退出等待原服务落盘并清理自己的子进程。服务崩溃提示重新启动或退出；内存输出和 PTY 不会恢复。

D02 已获批准：桌面设置 `PI_WEB_RESUME_INTERRUPTED=0`，保留中断记录、历史与手动恢复，不自动发送“继续”。Web/CLI 默认行为保留。

D01 已选择 A：浏览器操作在系统浏览器中打开同一应用后，安装并授权原 page-picker 扩展，明确接管会话后执行。Electron 当前会话不提供无缝浏览器桥接。真实 Chrome 扩展、接管和 SDK 工具结果链路的证据见 `docs/desktop-delivery/evidence/D01-browser.json`；T14-system-browser.json 另外验证了未经拦截的系统默认 Chrome 派发及第二个认证会话连接。

D04/D05 已获批准：首次客户端连接后同步已经就绪的插件/MCP 工具；MCP 重载完成后通知原会话刷新，避免继续调用已关闭的旧客户端。两处均使用原刷新管线，适用于 Web/CLI。

## 安装、更新与故障处理

当前 macOS arm64 包仅供内部测试，未完成 Developer ID 签名、公证及下载隔离属性验收。不得作为正式分发包。保留原 LICENSE 与插件许可证。

独立更新渠道尚未配置，因此应用内更新明确提示不可用，不连接原作者更新源。正式渠道需要产品身份、HTTPS feed 与签名条件；旧版到新版升级及中断恢复必须实际验证。目前不能宣称自动更新已通过。

应用启动或恢复失败会显示日志位置。先保留日志与数据，检查项目是否可访问、安装资源是否完整；手动重新安装只替换应用文件，保留独立 userData。备份应在应用退出后复制整个 userData；恢复也在应用退出后进行，不能与运行服务并写。卸载应用不自动删除项目或数据；不要将删除数据作为默认排障步骤。

macOS 默认数据目录为 `~/Library/Application Support/Pi Agent Desktop/`；显式指定独立目录时使用实际目录。手动恢复步骤：

1. 使用“退出”彻底关闭应用，确认服务退出，再复制整个数据目录作为离线备份；工作区项目文件另行备份。
2. 重新安装时只替换 `.app`。需要恢复数据时，先把现有数据目录另存，保留回退副本。
3. 将完整备份复制回原数据路径，再启动应用，检查历史、模型设置和项目文件。

当前内部版本已验证同版本应用重装和完整离线恢复，见 `docs/desktop-delivery/T25-backup-restore.md`。这不代表跨版本迁移或自动更新已通过。

完整结果、失败和未验证项见 `docs/desktop-delivery/`。编译或 mock 成功不能替代原生平台与安装验收。
