# 固定 HTTP IPv4 目标的宿主接线

2026-10-22；前置 `659eff4`，插件 0.4.0。本轮将已实测的固定 TCP relay 接入实际受控宿主，不替换 MCP/Newman，不加入任意脚本或 HTTP 引擎。

## 最终行为

宿主启动参数 `PI_API_TEST_HTTP_TARGET` 默认为空；显式配置时只接受一个规范 HTTP 数值 IPv4 origin，并绑定启动项目的真实目录。配置在构造时复制并冻结，模型工具参数和项目内文件不能注册新目标。域名、HTTPS、路径及内联凭据拒绝。目标仍需独立评审；配置不生成测试数据、不代表业务通过。当前真实业务没有启用该设置。

宿主保留原获批集合和 hash，为每次执行生成传输副本：请求路径/查询和脚本保持原值，地址指向本 run 唯一 relay，Host 绑定原目标；冲突 Host 拒绝。`run.json` 保存逻辑目标，`transport.json` 保存策略、逻辑/有效 origin、原集合 hash 和执行副本 hash。原评审绑定的集合不改写；目标、项目与 relay 策略加入持久资产指纹，配置变化使旧批准失效。

relay 仅转发到固定数值 IP/端口，最多 4 条下游连接、5 秒无活动即关闭；不解释 HTTP 或跟随重定向。OS 仍只允许 Newman 访问本 run 的本机端口，原 JavaScript 网络门禁保留。调用停止/撤权时关闭专属 MCP、relay 监听和两端 socket；证明清理后才释放项目锁，未知请求不重发。配置目标即使是 loopback，也不能创建或恢复调度；宿主执行入口还拒绝其后台调度身份。

## 本轮验证

[原始摘要、失败尝试与检查记录](target-host-summary.json)。完整本地输入和日志在 `tests/scratch/api-testing-relay-host/`，未复制凭据或备份 key。

```sh
node --import tsx tests/api-testing-target-test.mjs tests/scratch/api-testing-p1-1/runtime
node --import tsx tests/api-testing-target-test.mjs tests/scratch/api-testing-p1-1/runtime --public-docs
node --import tsx tests/api-testing-relay-isolation-test.mjs tests/scratch/api-testing-p1-1/runtime
```

配置目标验收带标记 11 项、默认合成轮 10 项通过：配置/项目门禁；真实插件与 MCP/Newman 执行、原 hash 和 Host 保留、传输 hash 对应；故意错误保持 failed；跨目标重定向 unknown 且未外发、不重试、relay 已关闭；取消一个并发运行不结束另一个；实时模式撤权关闭上游和本机监听；主流程导入/独立评审控制/持久资产执行；配置目标不能启用定时；改目标后旧资产批准拒绝；可选真实宿主 GET 用户公开 Swagger 页面返回 HTTP 200。评审使用显式控制替身，无实际模型调用。

最初验收脚本将 asset_run 的 `executionVerdict` 误写为 `status`，前 7 项通过后失败，修正读取字段后通过；未修改产品 verdict 或断言预期。既有 P1 测试只匹配旧“Real targets”文案，新行为仍保留零请求断言并改为匹配“not configured”；失败轮与修正轮分开保存。

不加载 JS 网络门禁的探针已移除测试内 relay 副本，直接复用产品 `startApiTargetRelay`，3 项系统边界验证通过：真实 MCP 经固定转发成功，直连上游与跨端口重定向被 OS 拒绝，未批准服务 0 请求。原文件/软链接/进程继承/上传/取消 OS 探针 8 项通过；越界文件仍使 Newman EPERM 退出并保留 unknown。它不证明任意恶意原生程序的隔离。

相关单测、P0–P3 回归、真实 60 秒定时器、技能发现/加载、skill-creator 校验、typecheck/build/lint/主要协议/格式/diff 的本轮结果见摘要；核心本轮 22/22。历史核心失败不删除，不将本轮通过倒填旧记录。无 tag 协议启发式仍单独 SKIP。检测到其他并发工作的根依赖、UI 测试配置等改动，均保留并排除在本提交外；本轮环境文件 hash 已记录，结果不声称来自无其他差异的工作区。

## 仍未完成

HTTP 数值 IPv4 的固定传输接线已证明，不再以“没有任何远端隔离方案”笼统阻塞它。DNS/TLS、运行时凭据注入尚不支持；不把明文 token 塞入集合绕过该缺口。用户真实业务还缺可使用的专用鉴权、合法关联数据、准确成功/创建 ID/清理映射；契约 `*/*` 不能冒充 JSON 声明。未发登录、业务查询、占号、创建或删除请求，也未读取个人凭据。真实无人值守未授权、未启用；P4 按实际需求和样例延后，全 goal 未完成。
