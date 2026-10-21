# T32 实际安装包便携模式兼容

日期：2026-10-21。对应 T03 的原有便携模式兼容要求；源依据 desktop/portable.ts 的 setupPortableMode、desktop/main.ts 的启动次序及原 terminal/session 协议。运行当前 T19/D06 实际 DMG 安装应用，macOS arm64。新增 tests/desktop/portable-ui-run.mjs；生产与安装包不变。

独立临时夹具在中文含空格目录，通过原 PI_PORTABLE_ROOT 显式选择便携根，不提供 PI_WEB_CWD/业务数据/agent 路径覆盖，验证原便携分支自己解析路径。PI_PORTABLE_HOME 指向测试 home，空白独立 agent 配置仅连接 localhost 脚本供应商；移除环境凭据与外部目录覆盖，PATH 不含 Node。为普通 PI_DESKTOP_USER_DATA 建立独立 sentinel 目录，用作便携优先级和不互写对照，不读取个人数据。

T32-portable-ui.json 共 12 项 PASS：

- 实际主进程 PI_PORTABLE=1；Electron userData/sessionData、原业务数据、agent 和默认 workspace 均位于指定便携根。
- 原界面发送聊天，经包内 SDK 获得本地回复，transcript 在便携 agent/sessions 下真实落盘。
- 原 terminal_create/input 创建真实 PTY，写入 portable-proof.txt，精确字节 PORTABLE_PTY_OK；terminal_kill 收到原退出事件。
- 退出将 nord 主题保存到便携 ui-preferences.json，完整重启后恢复该偏好。
- 原历史 UI 可打开已保存便携会话，回复内容恢复，工作区文件字节保持。
- 普通 userData 目录只保留原 sentinel 且内容未变；重启和打开历史未新增模型请求，总计 1 次本地请求、0 次真实供应商请求。

最终恢复截图已查看，显示原历史与聊天内容及终端生成的文件。工程检查：定向 Prettier、全项目 typecheck、desktop-portable/desktop-preferences 两文件 17 单测、只读原目录及受保护哈希门禁均通过，证据 T32-*。来源未明 bottombar 差异继续保留，不纳入提交。

范围限制：这是 macOS 显式便携根在同一路径的启动和重启兼容证据，不是自动标记发现、便携根迁移后所有历史绝对路径改写或 Windows PortableGit/PortableNode 验收。未使用 U 盘设备，不宣称整个宿主文件系统没有 OS 级缓存；隔离断言限于实际配置路径及独立普通数据对照目录。真实模型累计仍 18/18，不再调用。项目其它缺口保持未完成。
