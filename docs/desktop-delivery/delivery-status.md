# macOS 内部测试交付状态

当前目标尚未全部完成。本次交付仅支持已验证的 macOS arm64 内部测试；用户已要求暂不实施 Windows/Linux。版本 0.109.0，临时名称 Pi Agent Desktop，临时 App ID local.pi-agent.desktop。

安装文件位于项目根目录 release/：

- Pi-Agent-Desktop-0.109.0-arm64.dmg
- Pi-Agent-Desktop-0.109.0-arm64.zip
- SHA256SUMS.txt

DMG 可挂载后复制应用；ZIP 可直接解压。应用未签名、公证，正式分发尚未具备条件。测试使用 ZIP 解压到源码目录外的中文和空格目录，明确去除 PATH 中的 Node；这不等同于全新 macOS 用户或 Gatekeeper 下载隔离验收。

默认数据与个人 Web/CLI 隔离。首次启动选择工作区，再通过原设置页面配置模型。测试凭据未预装进交付物；日志和独立数据位置、启动与恢复说明见 desktop/README.md。

已验证：独立工作区、包内 SDK、原生 PTY、资源服务、端口冲突与偏好恢复、Dock 重建、服务故障恢复、历史保留且不自动续跑、真实 Chrome 扩展和会话接管、D03 的真实 SSH/SFTP 读写上传及权限错误。真实 DeepSeek 使用包内 SDK 单次请求正常返回，15 输入 / 8 输出 tokens。

仍需完成的 macOS 验收：

1. 生命周期自动化在最后重开出现间歇窗口发现超时；原生启动测试与此前源码生命周期曾通过，但不能据此删除失败证据。
2. 原集成回归 83/86；SSH 后半旧同步接口、elsewhere-lifecycle、terminal-smoke 失败。额外 UI 测试的旧选择器、首次设置浮层遮挡问题须逐条复核。
3. 真正的系统浏览器派发、完整模型设置到对话链、真实 OAuth/MCP/DSH、通知和音频感知、完整视觉对照与性能基线。
4. 正式身份、签名、公证、独立更新源以及旧版到新版更新、中断恢复。

失败、未运行和部分通过均见 acceptance-matrix.md；证据不得解释为全功能通过。来源未明的 bottombar 单测差异单独保留，未归因，不能作为真实 CLI 通过依据。

D02 与 D03 是用户明确批准的受保护代码例外，具体逐行差异和哈希见批准登记。原源目录仍通过只读基线检查。
