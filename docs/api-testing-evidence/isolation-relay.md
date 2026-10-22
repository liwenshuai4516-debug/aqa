# 固定目标 TCP 转发可行性补验

2026-10-22；前置 `9464d14`。目标是寻找 macOS sandbox-exec 不能直接绑定远端数值 IP 的可行解法；不改为任意主机放行，不替换 Newman 或自研 HTTP 测试引擎。

测试专用的宿主 TCP relay 只向事先固定的数值 IPv4/端口建立连接，双向转发字节，不解析 HTTP、不选择重定向目标、不运行断言。Newman 的 OS 配置只允许连接 relay 本机端口；HTTP 和脚本仍由原有 MCP/executor/Newman 执行。不加载 JavaScript 网络 guard，用真实接收端记录验证系统边界。

## 本轮结果

[完整尝试与原始摘要](isolation-relay-summary.json)。`tests/api-testing-relay-isolation-test.mjs` 可复现：

```sh
# 默认仅本机合成服务，3 项
node --import tsx tests/api-testing-relay-isolation-test.mjs tests/scratch/api-testing-p1-1/runtime
# 显式增加用户提供的公开 Swagger 页面，4 项
node --import tsx tests/api-testing-relay-isolation-test.mjs tests/scratch/api-testing-p1-1/runtime --public-docs
```

带标记轮 4 项符合预期：真实 MCP/Newman 经固定 relay 得到合成 HTTP 200；直接绕过 relay 访问上游被 OS 拒绝，上游 `/direct` 为 0 请求；跨端口重定向被拒绝，未批准服务为 0 请求；经固定 `192.168.90.224:18168` 读取 `/doc.html` 得到 HTTP 200，显式 HTML 内容断言通过。未将 HTML 假装为 JSON 或业务成功。另执行默认无标记轮 3 项通过，未访问远端。

首轮 scratch 合成服务在 writeHead 后设置响应头，产生未捕获 `ERR_HTTP_HEADERS_SENT`，没有完成摘要；失败日志完整保留。修正响应头顺序后 scratch 轮及纳入仓库的验收轮通过。没有忽略错误或重发业务写请求；异常退出后核对无本实验遗留 runner 进程。

typecheck、MCP/可信身份相关单测 41/41、lint、主要协议检查、显式格式及 diff 检查通过，结果见摘要。只新增实验测试和证据文档，没有改产品运行路径或生命周期，未重复 build/核心冒烟；上一轮核心 21/22 的已知失败保留在原记录，不充作本轮结果。无实际模型调用。

## 结论与下一步

这改变了“缺少远端传输可行方案”的判断：已有固定地址字节转发 + 本机 OS 端口边界的真实 MCP 可行证据。但 relay 当前仅在测试内，**不是生产宿主已支持远端目标**。

产品接入还需可信目标配置、原获批逻辑目标与有效传输地址的不可变映射、目标/策略变更后的批准失效，以及停止/撤权时 relay 连接与专属进程的一并清理。不能把集合改写成 localhost 就沿用旧批准或开放真实调度。DNS/TLS、鉴权运行时注入、端点并发/断连等也未由本轮证明。

用户业务仍缺可使用的测试鉴权、关联测试记录、成功/创建 ID/清理映射；契约 `*/*` 仍不能作为 JSON 声明。没有调用登录、业务查询、占号或创建接口，没有读取个人凭据。下一步先完成固定目标宿主接线的可信边界与生命周期验证，再按真实接入条件推进 P1-4；全目标未完成，P4 按条件延后。
