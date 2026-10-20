# T16：修复两条旧回归测试的前置条件

范围：tests/terminal-smoke-test.mjs、tests/elsewhere-lifecycle-test.mjs；生产代码、受保护区域及安装包不变。旧失败证据 final-smoke.log 保留，不用本轮结果改写旧日志。

终端测试把模拟 CLI 历史文件写到 homedir()/.pi/agent，而隔离运行的服务使用 PI_CODING_AGENT_DIR，因目录不同找不到该会话。本轮创建专属临时 agent 目录，在启动服务之前指定环境变量，并将会话夹具放入同一目录；临时工作区使用 realpath，避免 macOS /var 与 /private/var 的会话路径编码不同。退出仅清理本测试目录。全部原行为断言保持，实际运行 55 checks passed，证据 T16-terminal-smoke.log。历史会话依然是测试生成的文件，不能解释为真实 CLI 启动验证。

另一处生命周期测试等待“定时任务/插件会话不支持过户”，而原服务的 scheduler 分支实际返回“定时任务会话不支持过户”。仅将等待文案与原代码对齐，保留“拒绝过户且包含后台任务面板引导”的断言及后续删除回收断言。离线行宽限期、到期回收、定时任务伪会话标记、拒绝接管、删除后消失全部通过，证据 T16-elsewhere-lifecycle.log。没有为测试修改服务文案或过户逻辑。

验证：定向 Prettier → 全项目 typecheck → 8 文件 / 55 条相关单测通过（T16-unit.log）；两条真实服务集成脚本均通过。本轮没有重跑完整 86 项，也没有将历史 83/86 日志改写成新一轮总数。旧 SSH 同步 API 测试后半仍不匹配现有协议，保留失败；D03 真实 SSH/SFTP 的独立通过证据仍按原范围解释。
