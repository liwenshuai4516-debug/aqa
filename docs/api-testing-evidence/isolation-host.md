# macOS fixture 宿主隔离接入

2026-10-22；前置提交 `c7be6dc`。本轮继续处理 goal 的隔离缺口，仅接入已实测的本机边界，不开放真实业务地址。

`server/api-testing-isolation.ts` 按宿主确定的 run、依赖目录及批准端口生成限制配置；目录先规范化，控制字符与非法端口拒绝。`server/api-testing-runner.ts` 在清空继承环境后，强制由 sandbox-exec 启动原有私有 MCP/Newman，保留 JavaScript 网络检查作为附加门禁。没有改变执行引擎、导入脚本限制、固定断言或模型评审流程。

每个 run 保存 `isolation.sb`，`run.json` 记录策略 `darwin-seatbelt-loopback-v1`。策略纳入持久资产指纹，旧批准失效，需按现有流程重新评审。执行只支持本轮验证过的 macOS；缺少 sandbox-exec 或其他平台拒绝执行，没有非隔离降级。此前 Linux fixture 路径也因此收紧，不能把 Linux/Windows 记作已支持。

## 验收与复现

[本轮原始摘要与检查记录](isolation-host-summary.json)；完整原始日志及受控输入在 `tests/scratch/api-testing-isolation-host/`，未复制私有备份签名 key。

```sh
node --import tsx tests/api-testing-controlled-test.mjs tests/scratch/api-testing-p1-1/runtime
node --import tsx tests/api-testing-os-isolation-test.mjs tests/scratch/api-testing-p1-1/runtime
```

OS 测试已去掉重复的实验 profile，直接调用产品生成器；不加载 JavaScript 网络 guard。8 项符合预期：目录内读写/上传正常；目录外读取、软链接、写入及子进程越界被拒绝；真实 MCP/Newman 正反断言保留；未批准端口和跨端口重定向的接收端均 0 请求；目录外合成文件未外发；取消专属进程后保留 unknown、不重试。该证据与宿主路径 15/15 一起证明接线，而非仅检查配置字符串。

Newman 越界文件读取仍出现未处理 EPERM 并退出，保留 unknown；此项验证的是拒绝外发，不能把这次 run 记为执行通过。

相关单测 41/41；P1 主流程 17/17、P2 持久化 15/15、管理 14/14、P3 跟踪控制 14/14、调度门禁 15/15；真实 60 秒定时回归见摘要。控制轮实际模型调用为 0，未重复消耗已通过的 GPT 验收。typecheck、build、lint、格式、主要协议及 diff 检查见本轮记录。

核心冒烟本轮 21/22：失败仍为 `plugin-scaffold-test` 的 ui-slot 激活日志检查，历史已在隔离基线复现。本轮不修改该无关用例，不将部分通过或历史结果当作全部通过。无 tag 协议启发式 SKIP 与主要检查分开记录。

## 剩余限制

只允许批准的 localhost 端口。未证明远端 IP、DNS/TLS 限制，不改用任意主机规则开放真实环境。系统和依赖目录读取、metadata 与 mach 服务规则较宽，不是任意恶意原生代码沙箱。

真实业务所需的专用测试鉴权与关联记录仍无可使用引用；公开契约/前端只能提供规则线索，不能生成合法登录凭据或证明匿名访问可用。成功响应、创建 ID 与清理路径还需真实依据。未读取个人凭据/会话、猜测账户/ID 或发送业务 API 请求。真实无人值守未授权、未启用；P4 继续按具体需求和样例启动。全 goal 未完成。
