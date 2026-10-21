# T33 实际安装包下载与媒体读取

日期：2026-10-21。对应 A05；源依据 web/src/download.ts、RightPanel.tsx 的原下载按钮、FilePreview.tsx 的文本/音频预览及 server/index.ts 的 /api/file。当前 T19/D06 实际 DMG 安装应用，macOS arm64，生产和安装包不变。

新增 file-download-media-run.mjs，独立中文工作区、空 agent auth/models、无 Node PATH、无模型请求。夹具包含有效空 ZIP、UTF-8 中文文本、GBK 编码中文文本和 1 秒静音 PCM WAV。静音仅用于解码/分段读取，不验证扬声器听感或完成通知。

运行记录：

- 首轮假设 Electron 没有 showSaveFilePicker，因此断言失败；实际 Electron 44.4.2 在安全上下文提供该原生接口。失败 JSON/日志/截图保留，未关闭或替换 API 来获取通过。
- v2 原文本下载字节、RFC 5987 中文 attachment 名称、GBK 原预览、WAV 解码元数据、精确 Range、suffix Range 和 416 均通过。无认证测试错误地重用了携带原 token 参数的媒体 URL，故该测试前提不成立，原失败保留。
- v3 明确移除 token query，再由无 Cookie 的外部 fetch 请求原地址，验证 401；原有效媒体 URL 仅在内存使用，不写入证据。完成媒体检查后，通过原文件行下载按钮打开未经替换的 showSaveFilePicker，等待用户实际保存到独立测试目录。

原生保存尚未完成前不得计为 PASS；用户已回复完成保存，并明确给出 /private/tmp/pi-file-media-4Ywng5/中文 downloads；与 /tmp 路径解析一致，但实际核对目录仍为空。另存 T33-native-save-observation.json，不把人工答复替代文件证据。运行器仍在有界等待中。脚本只在指定路径实际存在且字节精确相同时继续，保存后再次读取并记录 SHA-256；未模拟原生选择器或 FileSystemFileHandle。

工程检查：类型检查、3 文件/19 项相关单测、源码与受保护哈希门禁通过，记录在 T33-final-*；5 项 Windows 专属单测 SKIP；files-wire-path 的 Windows 专属测试在 macOS SKIP，不能计为通过。源码及受保护哈希门禁不改变生产逻辑。未知 bottombar 差异保持独立。本轮真实模型请求为 0，累计限额仍 18/18。其它正式发布和人工暂缓项保持未完成。
