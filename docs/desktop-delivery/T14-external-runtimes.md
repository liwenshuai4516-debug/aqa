# T14：解锁回归、真实 MCP/DSH 与系统浏览器

平台仍为 macOS arm64，Electron 44.4.2 / 内置 Node 24.21.0 / SDK 1.1.0；开发 Node 24.19.0。正式身份、签名、公证和更新源尚未具备，本轮仍是未签名内部测试包。

## 本轮发现与最小修改

D04：官方 MCP 服务先于客户端就绪时，首个 SDK 会话创建早于工具 provider 接线，会漏掉工具；空白“新对话”会复用该会话。实际首会话与空白复用失败证据分别保存在 T14-mcp-initial-session-failure.json 和 T14-mcp-blank-reuse-failure.json。创建新临时会话后真实读写成功，定位到接线时序。SDK 的 `_refreshToolRegistry` 实际存在，不归因于 SDK 接口缺失。用户明确批准后，在原 daemon 赋值 provider 后补一次原刷新调用；没有重写会话或执行管线。新的单测通过真实 SDK attach 验证首会话工具已注册并激活。

D05：MCP 设置禁用/启用后进程更换成功，但同一聊天仍引用旧客户端，返回“客户端已关闭，不会重启”。两次操作在文件监视轮询周期内完成时，最终配置不变，轮询无法补通知。T14-mcp-reenable-failure.json/log 保留真实安装包失败；T14-mcp-reload-before-fix.log 保留新单测的失败。用户明确批准后，仅在原 reloadOnce 聚合并关闭旧进程之后，补一行已有 onToolsChanged 通知。

DSH 打包：旧内部包在加载原 goal-rpc 适配器时提示找不到 dsh-tools，见 T14-dsh-missing-dependency.json/log。原开发依赖树虽存在这些 peer 包，打包器未将其纳入生产闭包。将原适配器与原 JSON-RPC 服务静态导入所需的 11 个现有锁定包显式列为生产依赖：cordis 4.0.2，及 anonymous-user-id、atomic-write、attachment、credentials、home-paths、launch-environment、llm、llm-deepseek、scope、tools 的 0.1.5-rc.3。保留原解析地址、完整性和全部现有版本；未升级 SDK/Electron 或引入完整 DSH 运行时。资源审计补充检查适配器依赖。

## 真实运行证据与边界

官方外部依赖独立安装在 `/tmp/pi-T14-runtimes.JdW099`，不写项目依赖：MCP filesystem 2.0.0 与官方 DSH 0.1.5-rc.3。安装日志 T14-runtime-install.log；部分外部可选原生安装脚本未执行，本轮实际初始化与协议测试成功，不能推导全部 DSH 外部工具成功。

MCP 测试通过实际原聊天输入框、本机脚本 SSE 模型、包内真实 SDK 和原 MCP 桥，调用官方 stdio 文件服务。覆盖首会话中文路径与内容读取、实际写入、配置根外读取拒绝、原 write 工具人工审批前不落盘/拒绝不落盘/批准后落盘、错误服务器隔离、设置禁用启用与不同进程、配置保存、同会话重启后再次读文件、退出回收。结果见 T14-mcp-filesystem.json/log 与 T14-mcp-settings.png。模型只是确定性测试驱动；没有声称真实模型自行选择工具或验证全部 MCP 协议/HTTP 服务器。

DSH 测试使用包内 Electron 的 Node、已安装包中的原适配器/launcher、原 generatePresetClones 和官方外部运行时。移除系统 Node PATH，隔离 DSH_HOME、agent、数据、会话和工作区。初始化、四个健康预设、工具/技能/模型目录 RPC 通过，见 T14-dsh-runtime.json/log。原测试 tests/dsh-smoke-test.mjs 与 tests/dsh-ui-test.mjs 保持不变并通过，见 T14-dsh-original-smoke.log、T14-dsh-original-ui.log；UI 测试使用独立目录与本地占位凭据，避免首次未配置浮层。没有 DSH 模型请求，也没有完成 DSH 实际模型目标/工具执行。

用户解锁后完整原生命周期断言通过，随后对本轮实际安装包重验。T14-native-lifecycle.json/log 覆盖全屏事件、Dock 重建、服务故障恢复、正常退出、端口回退与返回、偏好保留和令牌日志隐私。之前的锁屏失败继续保留，未更改原生命周期断言；T14-unlocked-before-D04-lifecycle 为较早成功样本。

T14-system-browser.json/log 验证真实生产 window.open、未替换的 shell.openExternal、macOS 默认 Chrome 派发；原服务接入第二个独立认证客户端，匿名 API 仍是 401。该项基于 D04 后、D05 前安装包；宿主与浏览器代码未发生变化。首轮自动化 CDP 恰分配到 65535 端口而无法连接，失败单独保留，重试通过。按测试 origin 关闭 Chrome 页签的自动化不可用，应用和自有服务已退出；浏览器测试页签可能保留。此前真实扩展/授权/接管/工具链证据仍按 D01-browser.json 理解。

## 检查与产物

相关 6 个单测文件 / 49 项通过（T14-unit.log），另运行桌面专项 14 文件 / 51 项通过（T14-desktop-unit.log；两组存在重叠，不合计数量），全项目类型检查与 lint 通过；原源码只读核对、受保护路径核对（含 D02–D05 明确批准例外）通过。新文件与原差异均保留，来源未明 bottombar 测试不纳入本轮提交。

完整 Vitest 再运行：461 文件 / 5145 PASS / 9 SKIP（T14-all-unit.log）。与早前证据相同，未知来源的 bottombar 测试目前仍是解析夹具，不能从全量绿灯推导真实 CLI 已验证。

重新生成内部 DMG/ZIP。T14-installed-artifacts.json/log 验证实际 DMG 挂载复制后卸载镜像、ZIP 解压，均在源码目录外中文/空格路径启动；检查主进程和 daemon 与当前编译文件一致，服务健康、正常退出。不是全新 macOS 账户、下载隔离/Gatekeeper 或签名验收。

最新 DMG 安装包另通过 package-smoke：从源码外目录启动、去除 Node PATH、包内 SDK/sandbox/鉴权、原安装器离线安装 Mermaid/runtrace、真实 PTY 输入与尺寸调整及关闭事件，结果 T14-packaged-smoke.json/png、T14-package-smoke.log。原 historical packaged-smoke.json/png 保留，未覆盖为本轮结果。

- DMG SHA-256：`a0501744c7a9140a6bc8dbc55646d18568a3d4bf628893dac33e4ce5ec8b07f8`
- ZIP SHA-256：`e99c76b079951f483f87d15efd8a8af8332d705dc49670a2baff4b3ae1bd5515`

本轮没有额外真实模型请求。此前 DeepSeek 仍累计 2 次、输入 3235 / 输出 16 tokens；不超过用户批准的 3 次、每次输出 128 tokens、人民币 1 元边界。密钥未进入源码或交付物。

整个目标继续保持未完成；真实 OAuth、DSH 模型执行、其它页面/交互组合、系统通知/扬声器听感、正式发布身份/签名/更新与故障恢复仍按矩阵逐项验收。
