# T10：macOS 验收补证

平台：macOS arm64；产物为 c56bcf6 的内部测试包，本轮只修改测试和交付记录，没有修改生产代码或重打包。运行时 Electron 44.4.2、包内 Node 24.21.0、SDK 1.1.0。

## 生命周期启动环境对照

原 tests/desktop/lifecycle-run.mjs 的 Playwright Electron loader 会拦截 app.whenReady/ready，并设置一组 Chromium 开关。多次复测时最后一次启动出现可见窗口、空 URL、loading=true，但自动化没有发现 page；原失败日志未删。

新增 native-app.mjs：通过正常可执行文件启动，等待应用自己的“window loaded”记录之后，才接入 Chromium CDP 和主进程 inspector。没有替换生产入口、拦截 ready 事件或注入 Chromium 功能开关。执行同一份 lifecycle-run 的全部断言，全部通过，包括最后一次恢复到首选端口。

命令：`PI_DESKTOP_NATIVE_AUTOMATION=1 PI_DESKTOP_TEST_EXECUTABLE='<app>/Contents/MacOS/Pi Agent Desktop' node tests/desktop/lifecycle-run.mjs`。

证据：evidence/native-lifecycle.json、T10-native-lifecycle.log；原失败对照为 T09-source-lifecycle.log、packaged-lifecycle.log。结论是失败与自动化启动环境相关；尚未将每个 Chromium 开关逐一隔离，不能指认为某个确定的 Electron 缺陷。

## 安装包界面

`node tests/desktop/ui-acceptance-run.mjs` 使用独立数据、工作区、Agent 目录和本地 SSE 供应商，无真实模型费用。通过原设置页“声音与语音”入口，验证声音主开关、事件开关、音量 30、页面重载后的保存，以及试听实际创建 WebAudio Oscillator/Gain 节点。

同一测试从聊天输入区的文件输入框选择中文文本、二进制、SVG，确认 SVG 保持文件附件；通过 ClipboardEvent 粘贴 PNG，实际点击发送、附件卡片与本地流式回复可见。证据：packaged-ui.json、packaged-ui.png。音频图成功不等于人耳确认系统扬声器可听；系统通知仍未验收。

## 真实 DeepSeek 链路

用户批准 deepseek-chat、最多 3 次短请求、每次输出 128 tokens、人民币 1 元预算。此前包内 SDK 验证 1 次，输入 15、输出 8 tokens。

本轮界面验证使用只在内存保存凭据的 loopback 代理。Agent 配置文件只含本地占位密钥；真实凭据由测试 stdin 输入，代理替换认证头、模型 ID 为 deepseek-chat，并强制 max_tokens=128。单次运行上游最多 1 次请求，最大请求体 30,000 字节；拒绝重试或工具循环。没有读取用户文件。

首次尝试在向供应商发送前因上下文超限而停止，上游请求数为 0。随后明确为测试启用原有按需工具加载，正常请求体 12,533 字节，通过真实包内 SDK/原服务/聊天界面完成一次模型回复。

结果：HTTP 200；输入 3,220、输出 8 tokens；总实际模型调用 2 次，累计输入 3,235、输出 16 tokens。证据：deepseek-sdk.json、deepseek-ui.json。未查询账单，不能将 token 用量转换成已核实扣款金额；无第三次调用。此验证使用测试模型配置与内存代理，不能代替模型设置 UI 的凭据录入、真实 OAuth 或其它供应商验收。

## 原冒烟失败定位

- terminal-smoke 的历史会话样本写死在 homedir/.pi/agent，而隔离测试宿主使用 PI_CODING_AGENT_DIR；其样本与宿主查询的根目录不同。保持原断言与结果，不改写个人目录来换取通过。
- elsewhere-lifecycle 等待“定时任务/插件会话不支持过户”，实际 scheduler 守卫返回“定时任务会话不支持过户”，两者都含后台任务引导；旧测试的精确字符串不匹配。没有修改受保护服务或原预期来消除失败。
- sound-settings 仍寻找默认顶栏中未显示的声音入口；当前设置页实际入口已独立验收。
- 上传旧测试全页面文件输入选择器匹配两个元素，当前聊天输入区实际上传路径已独立验收。

本轮所有原始失败记录继续保留。完整验收矩阵仍有未完成项，目标不标完成。
