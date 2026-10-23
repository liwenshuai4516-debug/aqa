# 数据空间登录脚本与 Agent 通信检查（2026-10-23）

范围：数据空间 0.12.1 的 `data_space_env` → `refreshEnv` → 声明式 HTTP 步骤 → 动态值返回。使用临时数据目录、虚构口令及宿主网络替身；未读取个人凭据、未请求真实登录服务、未调用实际模型。

## 结果

- 66 项相关单测通过（env-agent、env-script、envs、channel）；类型、lint、协议检查通过。
- 新增插件激活级回归，实际登记工具并调用 `data_space_env`：保存脚本可读取，模板参数传给宿主网络接口，默认查询自动刷新，缓存有效时不重复登录，显式 refresh 返回本次 token，HTTP 401 不返回旧 token。
- 已复现并修复：默认 list 自动刷新后也拼接明文动态值。现在仅显式 `action=refresh` 返回明文，静态敏感参数始终不返回。版本 0.12.0 → 0.12.1。
- 桌面应用插件目录链接到本仓库，版本核对为 0.12.1；没有重载或中断正在使用的应用。

## 宿主集成复验（2026-10-23）

已确认上述两次 404 的根因：WebSocket `ready` 只代表传输连接就绪，插件随 SDK 会话异步挂载，测试固定等待 900ms 仍存在竞争。现改为等待初始化 `snapshot`，并为子进程创建隔离 agentDir 及空模型/认证配置，避免继承个人设置。

复验 `tests/data-space-plugin-test.mjs`：139 项断言全部通过，包含真实宿主路由、模拟 HTTP 登录、动态参数缓存与提取失败。原始日志：`tests/scratch/data-space-login-agent-attach-check.log`；相关 3 个单测文件 42 项通过，全量 typecheck、lint、协议检查通过。历史失败日志保留。此结果不代表实际模型、桌面窗口或 PMS 登录已验证。

## 历史失败与当前边界

完整宿主脚本 `tests/data-space-plugin-test.mjs` 两次运行均在初始 `GET /state` 返回 404，最终 16 项断言失败；静态资源可加载，正式登录集成步骤未运行，不能视为通过。日志保留在 `tests/scratch/data-space-login-agent-integration.log` 与 `tests/scratch/data-space-login-agent-integration-retry.log`。这是修复前的历史结果，根因和复验见上一节。

未完成实际桌面窗口、模型调用及真实业务登录验收。显式 refresh 会把动态值交给 Agent，即进入工具回执/对话上下文；“不回显、不写文件”的提示不等同于凭据隔离机制。这里的 HTTP 登录步骤也不会自动建立 Playwright 浏览器登录会话。
