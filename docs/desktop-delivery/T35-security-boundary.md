# T35 实际安装包的桌面安全边界

日期：2026-10-21。任务书 §5.5、T07/A13。源依据 desktop/main.ts 的 trustedSender、窗口安全参数、setWindowOpenHandler/will-navigate，desktop/preload.cts 和 external-url.ts。本轮只新增 tests/desktop/security-boundary-run.mjs 与证据，不修改生产源码或安装包。

## 测试方法

直接启动 T19/D06 实际 DMG 安装应用，独立中文工作区、数据目录及空 auth/models，无全局 Node PATH 或真实模型请求。原窗口加载后接入调试，读取实际 webPreferences、原桥调用及窗口状态。

仅在测试主进程拦截 shell.openExternal，记录原导航策略决定派发的 URL，避免打开外部应用；没有替换原导航处理器、IPC handler 或 trustedSender。额外创建隐藏测试 BrowserWindow，显式加载包内原 preload 和同源 /api/health 文档，以实际 IPC 请求验证不同发送窗口的拒绝。测试窗口由本轮销毁。

## 通过范围

最终 evidence/T35-security-boundary-verified.json 的 12 项检查通过：

- 主页面没有 require、process 或通用 ipcRenderer；实际 sandbox/contextIsolation 开启，nodeIntegration 与 nodeIntegrationInSubFrames 关闭。
- file/data/ftp/自定义协议的新窗口动作没有向系统外链层派发，也没有创建额外 BrowserWindow。部分协议可由 Chromium 更早拦截，本证据不声称每个动作都到达应用处理器。
- HTTPS 同帧外部导航经原策略派发一次，记录的 URL 无服务 token；主文档 origin 保持、健康接口仍为 200。外部应用派发被测试替换，不替代 T14 未拦截的系统浏览器证据。
- 实际同源 iframe 没有桌面桥或 Node 访问；不声称已用 iframe 直接发送原生 IPC。
- 原主窗口调用 toggleMaximize 两次均返回 true，作为合法调用对照；同源其他 BrowserWindow 虽有原 preload 桥，其 close/minimize/toggleMaximize 均返回 false，主窗口保持存在、可见且未最小化。
- 将测试窗口导航至 data: 其他 origin 后，原桥 close/toggleMaximize 仍返回 false。macOS overlay 自身就不支持，false 只记录结果，不单独当作发送者校验通过的依据。
- 拒绝操作后业务健康检查仍为 200，正常退出。

首轮 FAIL 保留：外部导航被阻止后，Playwright 可见元素等待受到未完成导航状态影响，未到达 iframe 断言；改用 DOM 就绪检查和真实已连接 frame 后继续。v2 FAIL 保留：测试错误依赖 getLastWebPreferences().preload 恢复 preload 路径，额外窗口没有加载原桥；改为明确使用包内 dist/desktop/preload.cjs。v3 首次 12 项通过。加强合法调用对照后的 final 轮在切换其他 origin 时被原 React 页面的一次重载中断，ERR_ABORTED 原失败保留；测试窗口改用同源 /api/health 文档，保留同一 sender/origin 判定且避免加载聊天 UI 的重载竞态，再进行 verified 复验。没有忽略导航错误或改写原服务。

定向格式化、全项目类型检查、4 文件/16 相关单测及源目录/受保护源码哈希门禁通过，见 T35-verified-*、T35-source.json、T35-protected.json。截图见最终 -main.png。来源未明的 bottombar 单测差异保持未提交。

这证明所列窗口、导航和桥边界，不是所有 Electron 攻击面的安全审计。正式更新签名、真实 OAuth、原生保存、通知等剩余缺口不因本轮通过而关闭。没有新增付费请求。
