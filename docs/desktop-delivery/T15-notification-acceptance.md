# T15：通知与声音验收

需求：A14。产物：T14 最新实际 DMG 安装包（0.109.0 / macOS arm64）。本轮仅增加测试和证据，不修改生产代码、不重新打包。

原声音界面启用事件、设置音量 30、点击试听后，实际 WebAudio Oscillator/Gain 节点创建通过；未更改系统音量。用户回答“没注意看”，因此不能将扬声器听感计为通过。

原通知开关取得页面 Notification.permission=granted；使用本机脚本供应商完成一条实际 SDK 聊天，最小化真实窗口并确认页面失去焦点后，原任务完成路径调用 Service Worker.showNotification。未取得送达事件，查询 getNotifications 也未返回。独立页面 Notification 诊断只收到创建记录，未收到显示事件。不能据此单独归因于原通知代码。

进一步调用实际安装包的 Electron 原生 Notification，isSupported=true，但收到 failed 事件：`未能完成操作。（UNErrorDomain错误1。）`，对应系统不允许通知。证据：evidence/T15-native-notification.json/log。原生诊断不能替代原界面任务完成验收。

2026-10-20 用户明确选择“暂不调整，保留待验收”。系统授权调整及通知重验暂停；没有提出或实施新的受保护源码例外。没有自动开启系统权限。

测试全部使用独立工作区和数据，无真实模型调用、无额外供应商费用。notification-run.mjs 观察实际 API 调用并转发到原 API，不伪造权限、显示事件或通知结果。已关闭 Playwright 默认焦点模拟以读取真实焦点。历史失败记录保留：错误选择器、未启用 start 事件、过早检查异步最小化、默认模拟焦点、通知列表查询挂起。最后一次原完成路径仍为 FAIL，不得因声音或权限检查通过而改记整项 PASS。

验证：定向 Prettier、全项目 typecheck、notify 14 条单测通过。测试自身失败与系统拒绝证据保留，A14 整体尚未通过。原生目录选择器仍需实际交互验收；当前系统辅助功能自动化权限为 false，先前对话框返回夹具不能替代这一项。
