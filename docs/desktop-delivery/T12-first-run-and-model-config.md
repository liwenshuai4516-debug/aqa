# T12：首次工作区与模型设置交互

日期：2026-10-20，macOS arm64，Electron 44.4.2，包内 SDK 1.1.0。生产代码和安装产物未变。本轮只新增/调整测试及验收记录。

## 首次启动

`node tests/desktop/first-run-run.mjs` 使用新建临时数据目录、不提供 PI_WEB_CWD，加载当前 dist/desktop/main.js。测试入口只替换 dialog.showOpenDialog 返回值和记录 showErrorBox，实际选择循环、路径校验、保存、服务启动与窗口加载仍执行生产代码。

通过三个场景：取消只触发一次选择、退出码 0、不启动服务、不写 startup.json；先选择家目录触发错误提示并再次选择，再选择中文具体工作区后窗口加载且保存真实路径；同目录重启无需 PI_WEB_CWD，读取最近工作区且不调用选择器。

首次尝试直接从安装包传 `-r` 注入对话框测试脚本未执行，等待取消超时。最终采用编译后宿主的测试入口，不能称为已完成安装包原生选择器的人工点击验收。结果 first-run.json 与 T12-first-run.log 明确标注这一边界。

## 模型管理页面

`PI_DESKTOP_CONFIGURE_UI=1 node tests/desktop/ui-acceptance-run.mjs` 从空白隔离 Agent 目录启动真实安装包，不预写 models.json 或 auth.json。

通过设置 → 模型与服务商 → 打开管理面板 → 添加自定义服务商，填写 loopback 本地供应商地址、fixture ID、测试密码、openai-completions API 与模型 ID/name，点击保存。确认 models.json 由原业务保存，再在聊天输入区选择刚创建模型。测试密码只用于本地服务器，不是用户真实密钥。

随后复用已建立的声音、重载、文本/二进制/SVG 上传、PNG 粘贴、附件卡片与流式回复断言，全部通过。此链路证明原设置页保存配置到原 SDK/服务/聊天界面实际发送；真实 DeepSeek 则已有独立 deepseek-ui.json 证据，不混为同一次测试。

实施中按源码核对了实际入口文案，发现保存函数本身调用 onClose，修正了测试中重复关闭的动作；没有改变原 UI、业务行为或删除旧测试断言。原 sound-settings、上传测试失败仍按原结果保留。

结果：model-config-ui.json、T12-model-config-ui.log、first-run.json。Typecheck、lint、受保护目录与原目录基线检查通过。没有产生额外真实模型费用。

仍需完成：真实原生目录选择器人工交互、系统浏览器派发、系统通知/扬声器感知、其余功能组合、正式签名与更新链路。目标保持未完成。
