# T33 实际安装包下载与媒体读取

日期：2026-10-21。对应 A05；源依据 web/src/download.ts、RightPanel.tsx 的原下载按钮、FilePreview.tsx 的文本/音频预览及 server/index.ts 的 /api/file。当前 T19/D06 实际 DMG 安装应用，macOS arm64，生产和安装包不变。

新增 file-download-media-run.mjs，独立中文工作区、空 agent auth/models、无 Node PATH、无模型请求。夹具包含有效空 ZIP、UTF-8 中文文本、GBK 编码中文文本和 1 秒静音 PCM WAV。静音仅用于解码/分段读取，不验证扬声器听感或完成通知。

运行记录：

- 首轮假设 Electron 没有 showSaveFilePicker，因此断言失败；实际 Electron 44.4.2 在安全上下文提供该原生接口。失败 JSON/日志/截图保留，未关闭或替换 API 来获取通过。
- v2 原文本下载字节、RFC 5987 中文 attachment 名称、GBK 原预览、WAV 解码元数据、精确 Range、suffix Range 和 416 均通过。无认证测试错误地重用了携带原 token 参数的媒体 URL，故该测试前提不成立，原失败保留。
- v3 明确移除 token query，再由无 Cookie 的外部 fetch 请求原地址，验证 401；原有效媒体 URL 仅在内存使用，不写入证据。完成媒体检查后，通过原文件行下载按钮打开未经替换的 showSaveFilePicker，等待用户实际保存到独立测试目录。

原生保存尚未完成前不得计为 PASS；用户已回复完成保存，并明确给出 /private/tmp/pi-file-media-4Ywng5/中文 downloads；与 /tmp 路径解析一致，但实际核对目录仍为空。另存 T33-native-save-observation.json，不把人工答复替代文件证据。运行器仍在有界等待中。脚本只在指定路径实际存在且字节精确相同时继续，保存后再次读取并记录 SHA-256；未模拟原生选择器或 FileSystemFileHandle。

工程检查：类型检查、3 文件/19 项相关单测、源码与受保护哈希门禁通过，记录在 T33-final-*；5 项 Windows 专属单测 SKIP；files-wire-path 的 Windows 专属测试在 macOS SKIP，不能计为通过。源码及受保护哈希门禁不改变生产逻辑。未知 bottombar 差异保持独立。本轮真实模型请求为 0，累计限额仍 18/18。其它正式发布和人工暂缓项保持未完成。

## 后续诊断与证据边界

v3 原有界运行已终止，状态 FAIL，原生保存目标路径未出现文件；9 条前置接口/预览/媒体检查通过。不能继续写为运行中。用户确认保存与目录的两次答复保留，但没有相应文件证据，未计原生保存 PASS。

被动包装原接口并原样返回 handle 的诊断，在 Playwright 连接下记录即时 AbortError。v3 诊断明确重置 chooser interception 和 download behavior 后仍在约 2 毫秒拒绝。单凭这些自动化记录不足以认定产品缺陷。

原 blob 回退诊断显式在测试 renderer 中关闭可选选择器，不能当作未修改生产页面通过。第一次 will-download 已 completed，但目标路径未出现文件；恢复 CDP Browser.setDownloadBehavior=default 后，真实 Electron will-download 的 getSavePath 和实际磁盘文件一致，原 ZIP 字节正确。分别保存 T33-blob-default-behavior.json、T33-blob-default-final.json。原 blob 综合诊断最终 11 项 PASS 是通过额外两次真实 UI 下载诊断完成的，不是首击就成功，也不是原生选择器成功。原 ZIP 内容始终没有由测试写入下载目标替代。

进一步新建独立 userData，以原始 CDP WebSocket 连接实际应用，完全不创建 Playwright browser/context、不改变下载和选择器行为，原 API 在两秒后仍 pending，随后由测试关闭自己的应用结束探测（T33-native-save-raw.json）。这与即时自动取消不同，说明不能直接将自动化连接下的失败归为产品问题。尚未应用的受保护前端条件草案已经撤回，未请求批准，也未修改受保护源码。

首个原始 CDP 的原 UI 下载运行曾进入 pending，随后返回 AbortError，记录在 T33-native-save-raw-ui.json；取消的来源未证实，不推断为用户主动取消。第二个原 UI 运行 T33-native-save-raw-ui-v2 进入 pending 后已明确请求用户保存，但随后也收到 AbortError 并退出，状态 FAIL；取消来源未证实。测试仅被动保存原 handle 引用，原返回值和方法不替换，没有获得可核对持久字节的 handle。当前没有仍在运行的选择器，不应继续按旧提示操作。

诊断结论：原生保存未验证、不得计 PASS；原 blob 下载在显式选择回退分支并恢复 CDP 默认下载策略后，真实磁盘文件与名字通过。Playwright 下即时拒绝与原始 CDP 下 pending 后拒绝是不同观察，不能把后者默认为已解释。官方 Electron 44.4.2 session 文档还明确说明 file-system-access-restricted 的 deny 会触发 AbortError；当前未采集相应事件，不能断言这是本轮原因。没有通过关闭保护或自动放行目录来取得成功。

工程收尾：全部新增脚本定向格式化，T33-raw-final-typecheck.log 与 T33-raw-final-related-unit.log 记录类型检查、3 文件/19 PASS / 5 Windows 专属 SKIP，T33-raw-source.json、T33-raw-protected.json 均 PASS。所有测试应用已正常退出，原真实供应商累计仍 18/18；没有生产代码、前端源码或安装包变化。
