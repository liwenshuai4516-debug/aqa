# T40 实际安装包预设 URL 边界

日期：2026-10-21。补验 A09 的 URL 导入与目录失败行为，使用 T19/D06 实际 DMG 安装应用、独立中文工作区/数据及空模型认证；没有生产源码或安装包修改。

脚本 `tests/desktop/preset-url-boundary-run.mjs` 通过原界面点击和真实 WebSocket 回执观察，不替换 fetch、DNS、URL 校验、服务回执或 UI 状态。原功能按设计拒绝本机/私网 URL，因此不以回环服务冒充成功公网导入。启动一个只记录请求的回环 HTTP 服务器，用于证明拒绝发生在网络访问之前；测试结束关闭应用和监听服务。

## 结果

实际包 11 检查 PASS，见 evidence/T40-preset-url.json/log 与恢复预览截图（已查看）：

- 目录地址为回环 URL 时，原服务返回 Invalid catalog URL；浏览页显示错误，刷新正常返回、不挂起。
- `file:`、127.0.0.1、localhost、10.0.0.1 导入分别返回原协议/私网拒绝，保留完整回执；未启动文件读取或私网访问。
- 测试 HTTP 服务器实际收到 0 个请求，拒绝路径未创建任何预设。
- 随后通过原粘贴输入可正常预览中文预设；dryRun 不创建预设，也未改变当前提示词。失焦与点击会产生两条相同的正常预览回执，均保留，不误算模型调用。

独立读取退出后 client-state.json，再次确认预设为空、提示词未应用；回执中四条导入拒绝、两条目录拒绝，原日志与最终 JSON 一致。见 T40-independent.json。无付费请求、社区发布、GitHub Issue 或消息发送；累计付费额度仍 18/18。

## 公网边界

准备阶段只读访问 `https://raw.githubusercontent.com/xing-shuyin/pi-web-ui-presets/main/index.json`，系统 curl 退出 35，诊断为 `Recv failure: Connection reset by peer`（本轮终端工具输出）。这是环境网络失败，未取得有效目录，不能据此判定产品缺陷或公网成功。没有绕过证书/私网校验，没有更改代理设置或反复重试。

当前测试只证明拒绝与恢复路径。公网目录成功浏览、有效 URL 导入及失败后目录缓存保持仍未在实际包验证；社区发布也未执行。T28 本地导入/导出成功证据继续有效；本轮不能关闭 A09 的全部分支或全项目目标。

## 工程验证

按顺序完成定向 Prettier、全项目 typecheck、preset-share/pi-presets 两文件 84 单测；lint、只读源目录与受保护哈希门禁通过。新证据凭据模式扫描通过；未知 bottombar 测试差异保持原样、不纳入提交。相关日志均为 T40 前缀。
