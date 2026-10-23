# 数据空间登录脚本与 Agent 通信检查（2026-10-23）

范围：数据空间 0.12.1 的 `data_space_env` → `refreshEnv` → 声明式 HTTP 步骤 → 动态值返回。使用临时数据目录、虚构口令及宿主网络替身；未读取个人凭据、未请求真实登录服务、未调用实际模型。

## 结果

- 66 项相关单测通过（env-agent、env-script、envs、channel）；类型、lint、协议检查通过。
- 新增插件激活级回归，实际登记工具并调用 `data_space_env`：保存脚本可读取，模板参数传给宿主网络接口，默认查询自动刷新，缓存有效时不重复登录，显式 refresh 返回本次 token，HTTP 401 不返回旧 token。
- 已复现并修复：默认 list 自动刷新后也拼接明文动态值。现在仅显式 `action=refresh` 返回明文，静态敏感参数始终不返回。版本 0.12.0 → 0.12.1。
- 桌面应用插件目录链接到本仓库，版本核对为 0.12.1；没有重载或中断正在使用的应用。

## 阻塞与边界

完整宿主脚本 `tests/data-space-plugin-test.mjs` 两次运行均在初始 `GET /state` 返回 404，最终 16 项断言失败；静态资源可加载，正式登录集成步骤未运行，不能视为通过。日志保留在 `tests/scratch/data-space-login-agent-integration.log` 与 `tests/scratch/data-space-login-agent-integration-retry.log`。本轮没有认定该 404 的根因。

未完成实际桌面窗口、模型调用及真实业务登录验收。显式 refresh 会把动态值交给 Agent，即进入工具回执/对话上下文；“不回显、不写文件”的提示不等同于凭据隔离机制。这里的 HTTP 登录步骤也不会自动建立 Playwright 浏览器登录会话。
