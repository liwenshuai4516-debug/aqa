# Pi Agent Desktop（内部测试）

基于本地 pi-web-ui 0.109.0 基线，Electron 管理原服务子进程并加载原界面。业务仍使用原 HTTP/WS、Pi Agent SDK 和工具协议。正式名称、App ID、签名与更新地址尚未确定；当前身份为 `Pi Agent Desktop` / `local.pi-agent.desktop`。

## 开发与构建

使用 Node 24 LTS（本机验证 24.19.0）；锁文件保持原样。Electron 44.4.2 内置 Node 24.21.0，包内 SDK 为 1.1.0。

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

产物在 `release/`。Windows x64 NSIS 与 Linux x64 AppImage 配置位于同一文件；须在对应系统构建、运行验收后才能声明支持。桌面 workflow 仅手动生成内部构建附件，不向原作者仓库发布。既有便携版入口仍保留，尚未进行本次独立验收。

## 启动与数据

首次启动通过原生目录选择器选择已有项目，取消则退出；禁止选择家目录根。后续恢复最近工作区，无效时重新选择。开发和受控测试可显式指定 `PI_WEB_CWD`。

默认数据位置为 Electron appData 下的 `Pi Agent Desktop/`，其中 `data/` 为业务数据、`agent/` 为模型配置和会话、`logs/` 为脱敏日志；`startup.json` 保存工作区，`ui-preferences.json` 只保存允许的界面偏好。不自动导入原 Web/CLI 凭据或会话，不宣称认证文件已加密。首次模型配置使用原设置页面。

服务只监听 127.0.0.1，优先端口 8790，已占用则安全回退，不终止占用进程。每次启动随机生成鉴权令牌，并以原 cookie 流程交给界面；健康与身份校验通过才打开窗口。主题、语言和面板设置按明确白名单跨端口恢复，不复制身份或授权。

客户端自身启动不需要全局 Node/Pi CLI。用户项目的 Git、Shell、Python、MCP 等仍需原有外部环境；模型和市场需要网络及用户配置。

## 窗口、恢复与浏览器

macOS 关闭窗口保留服务，Dock 激活重建窗口；重复实例聚焦原窗口。正常退出等待原服务落盘并清理自己的子进程。服务崩溃提示重新启动或退出；内存输出和 PTY 不会恢复。

D02 已获批准：桌面设置 `PI_WEB_RESUME_INTERRUPTED=0`，保留中断记录、历史与手动恢复，不自动发送“继续”。Web/CLI 默认行为保留。

D01 已选择 A：浏览器操作在系统浏览器中打开同一应用后，安装并授权原 page-picker 扩展，明确接管会话后执行。Electron 当前会话不提供无缝浏览器桥接。真实 Chrome 扩展、接管和 SDK 工具结果链路的证据见 `docs/desktop-delivery/evidence/D01-browser.json`；测试将外链路由至隔离 Chrome，未证明系统默认应用派发。

## 安装、更新与故障处理

当前 macOS arm64 包仅供内部测试，未完成 Developer ID 签名、公证及下载隔离属性验收。不得作为正式分发包。保留原 LICENSE 与插件许可证。

独立更新渠道尚未配置，因此应用内更新明确提示不可用，不连接原作者更新源。正式渠道需要产品身份、HTTPS feed 与签名条件；旧版到新版升级及中断恢复必须实际验证。目前不能宣称自动更新已通过。

应用启动或恢复失败会显示日志位置。先保留日志与数据，检查项目是否可访问、安装资源是否完整；手动重新安装只替换应用文件，保留独立 userData。备份应在应用退出后复制整个 userData；恢复也在应用退出后进行，不能与运行服务并写。卸载应用不自动删除项目或数据；不要将删除数据作为默认排障步骤。

完整结果、失败和未验证项见 `docs/desktop-delivery/`。编译或 mock 成功不能替代原生平台与安装验收。
