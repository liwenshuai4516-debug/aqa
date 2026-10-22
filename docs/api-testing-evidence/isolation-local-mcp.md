# 真实目标接入补查：本机 OS / MCP 隔离证据

2026-10-22；前置工程提交 `410b6b3`、完成审计 `985e1a5`。本轮继续处理真实业务接入阻塞，新增可复现的系统级本机实验，不放宽生产运行器的目标限制，不安装虚拟机/容器或读取个人凭据。

## 已证明的局部边界

`tests/api-testing-os-isolation-test.mjs` 使用 macOS 自带 sandbox-exec、原有 McpClient、未改动的插件 runner 以及锁定 Postman MCP executor/Newman。临时 run 与数据目录、两个本机空闲端口均由该测试创建；本轮没有业务 API 请求或模型调用。

前次严格 profile 导致 Node 启动 SIGABRT。通过宽读取/宽写入两个受控对照定位到读取规则，再补齐系统父目录的精确 literal 读取后，Node 可以启动。去掉新增的宽 `/Library`、`/private/var/db` 读取仍可通过；未把它们保留为解决办法。操作系统/已安装 Node 库、依赖 runtime 为只读白名单，写入仅本 run（及 /dev/null）；不读取个人文件。metadata、系统目录与 mach 服务规则仍较宽，**不是任意恶意原生代码沙箱**。

最终 8 项设计/执行、8 项符合预期：

- 合成目录外文件读取、越界软链接读取、目录外写入被拒绝；子进程继承限制。目录内文件读写正常。
- 真实 MCP → 未修改上游 executor → Newman 正常通过；故意错误断言保持失败。
- 不加载 JavaScript network guard，OS 仍拒绝未批准 loopback 端口，接收端 0 请求。
- Newman 跟随跨端口重定向被 OS 拒绝，接收端仍 0 请求。
- Newman 可以读取并上传明确允许的 run 内合成文件，接收端字节数匹配。
- Newman 无法读取/上传目录外合成 canary，接收端没有 canary。
- 取消只结束本轮专属 sandbox/MCP 进程，保留 unknown，慢请求恰好 1 次、无重试。

其中合成目录外文件拒绝使 Newman 文件流产生未处理 EPERM 并退出，留下的是 unknown，而非结构化 error；测试明确验证进程退出、EPERM 与无外发，**不把该 run 记为测试通过或已完成**。首轮测试原来预期结构化 error，因此失败；随后将其登记为已观察的进程退出限制，并保留所有尝试。未修改 Newman、吞掉文件错误或伪造结果。

## 复现与证据

```sh
node --import tsx tests/api-testing-os-isolation-test.mjs tests/scratch/api-testing-p1-1/runtime
```

需要已有 P1-1 隔离依赖及 macOS sandbox-exec；其他平台不报告通过。[所有尝试及摘要](isolation-followup.json)；本地完整输入、profile、标准错误和运行结果在 `tests/scratch/api-testing-isolation-probe/evidence/`。新增测试未加入默认 smoke，不隐式安装依赖。

本轮格式、typecheck、MCP bridge 单测 33/33、lint、主要协议及 diff 检查通过；无 tag 启发式 SKIP。本轮只新增测试/证据文档，未修改宿主、产品执行器或构建链，故没有重复 build/核心冒烟；此前核心结果仍按原轮次保留。

## 尚未证明的真实目标条件

该 profile 只验证 `localhost:指定端口`。尝试使用数值远端 IP 的过滤表达式被系统拒绝，不能改为“任意主机同端口”来宣称限制已实现。非 loopback 地址、DNS/TLS、系统凭据服务、生产宿主 profile 接线及实际运行目录/依赖校验仍未验收，故不开放用户真实地址。测试中的成功不能替代它们。

公开前端还提供了新的可信接入线索：网关 API 前缀为 `/api/project-management-backend`；登录为 `/api/base-service/login`，请求头使用 token。响应处理 `rc` 观察到的成功谓词为 code 等于 200、8000000（源码 8e6），或 message 包含“成功”；这是前端行为，不等于后端保证。契约已包含必填字段、枚举、后端生成业务编号及流程编号规则，已逐条记录来源指针于 [业务接入清单](business-intake.json)。

`generateFlowCode` 虽为 GET，契约明确取号占号且不回收，因此不能用作无副作用探针。创建需要真实关联的部门、商务经理、创建人及经营合同 ID；未猜测 ID 或借用个人数据。仍缺可使用的专用测试鉴权/数据引用、确切成功结果和清理映射。全目标未完成，P4 仍按具体需求/样例逐项启动。
