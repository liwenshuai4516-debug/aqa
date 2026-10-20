# T13：更新渠道异常不阻断启动

需求：T04、T08、A13。平台 macOS arm64，Electron 44.4.2，SDK 1.1.0；基于 71c5014 后的本轮宿主差异。生产代码仅修改 desktop/main.ts，不触及受保护业务代码或依赖版本。

原实现虽然允许缺少 desktop-update.json，却把 JSON 解析、URL 校验或 updater 导入异常交给应用启动失败处理。真实内部包副本放入损坏 JSON 后，窗口加载，随后日志出现“桌面版启动失败 / Unexpected end of JSON input”，弹出错误框。自动化因该原生错误框无法接入而超时；本次测试自己的应用和服务进程被定向终止。复现见 updater-startup-before.json 和 T13-updater-before-process.log。

最小修复：原接线代码保留，增加异常边界。初始化失败时注册三个明确的“更新不可用”响应，不进入应用启动失败清理。异常原文不写日志，以免配置中的用户名、密码随 URL 泄漏。没有新增更新源，也没有绕过 HTTPS 或原仓库拒绝规则。

验证脚本 tests/desktop/updater-startup-run.mjs 克隆当前内部应用，仅改变副本的更新配置。最终运行校验包内主进程与当前编译文件完全一致，使用独立工作区、数据目录、临时端口和无全局 Node 的 PATH，原生启动后接入调试。

六种配置：缺失、损坏 JSON、无效 URL、HTTP、含用户名密码的 HTTPS、原作者仓库地址。逐一通过原 preload 调用检查、下载、安装，要求全部得到可理解错误、没有缺失 handler、窗口保持可用、真实 /api/health 为 200、正常退出，日志不含测试密码。此测试不发出更新网络请求或模型请求。

首次修复后运行五种通过，HTTP 场景在原前端 build-ID 自动刷新时发生执行上下文销毁，见 updater-startup-first.json。测试增加加载稳定等待后六种通过；保留首轮结果，未更改业务界面。

检查证据：T13-typecheck.log、T13-desktop-unit.log（60 PASS）、T13-package-build.log、T13-package-audit.json（35 插件及 SDK 1.1.0）、T13-checksums.log。最终场景结果见 updater-startup.json。

新版真实安装包冒烟通过（T13-packaged-smoke.json / T13-package-smoke.log）：去除 Node PATH，加载包内 SDK 和安全 renderer，离线资源可读，真实 PTY 创建、输入、尺寸调整、退出事件通过。独立的 artifact-install-run.mjs 从实际 DMG 挂载复制并卸载镜像、从实际 ZIP 解压，再在源码目录外中文/空格安装路径启动，校验包内 main 与当前编译文件一致。具体结果与边界见 T13-installed-artifacts.json；不冒充干净账户或下载隔离/Gatekeeper 验收。

重新生成同版本内部 DMG/ZIP，校验和已更新到 release/SHA256SUMS.txt：

- DMG：60c2833409f91a4d1f7a995365a1b56e7b82828ae4daa9492aecde1c5c194d58
- ZIP：b7955ce750221fb456ad8a8cd1fd2bc21fdef9a1ecb5bd82b17184444dbdf083

这些证据只证明更新不可用时的退化行为。正式身份、签名、公证、独立 HTTPS 发布渠道、实际下载安装和中断恢复仍未完成。没有执行发布，整个目标保持未完成。

新版完整生命周期重验：两次在进入全屏事件等待超时；实验性增加窗口聚焦后，聚焦本身也超时，窗口当时 visible=true、focused=false、fullscreen=false、fullscreenable=true。系统只读状态确认 CGSSessionScreenIsLocked=true，锁屏时间早于这几次测试，见 T13-screen-state.json。已请求用户解锁。三轮原始结果分别保存为 T13-native-lifecycle-first/second/focused.json 及对应日志；聚焦实验差异保存在 T13-focus-test.patch 并撤回，原测试和断言均保留。旧 native-lifecycle.json 仍是 T10 已通过版本，不拿来替代新版结果。新版启动/鉴权/SDK 通过，全屏与其后生命周期步骤尚未通过，需解锁重验。
