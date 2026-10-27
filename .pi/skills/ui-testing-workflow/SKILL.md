---
name: ui-testing-workflow
description: UI 自动化测试工作流入口：发现录制、用例设计与独立评估、执行已有资产、分析旧批次和查看证据。复用已安装的 pi-ui-testing 阶段技能与工具。
---

用户要求新建或执行测试，且数据空间工具可用时，先读 [数据空间测试数据规范](../data-space-testing/SKILL.md)，用 `data_space_automation.initialize` 传当前 `mode`，按目标 URL 或所选 `envId` 核对环境；仅源码设计传 `new/record` 和 `discovery=source`，不创建通道；沿用返回的地址和非敏感参数，读取 `preparation`，动态参数过期时显式刷新再初始化；实际访问、身份和数据仍由原生浏览器预检验证。初始化不授权用例入库。工具未安装或停用时明确无法录入用例库，不虚构关联。仅分析历史结果时按原批次引用处理，不重新初始化或执行。

然后调用 `ui_test_workflow`：`{"request":{"operation":"catalog"}}`，核对当前工作区的资产、阶段技能和运行能力；然后读取原包的 [ui-test-workflow](../../../node_modules/pi-ui-testing/skills/ui-test-workflow/SKILL.md)，按用户意图选择路径并按需加载当前阶段说明。

这是原包的同名入口，不另定义阶段、批准或执行规则。后续优先使用工具返回的原包技能路径。应用级安装只使能力在不同工作区可发现；正式测试仍以当前工作区为目标，须满足原包的依赖、来源、环境和数据门禁。缺少项目依赖时明确报告阻塞，不向个人目录自动安装依赖或执行业务测试。

录制前，确认目标工作区的 Playwright 配置、依赖、浏览器 project 和相对 seed 路径；先用该工作区的 CLI / 配置收集 seed，确认匹配一个种子测试后再启动录制。MCP 优先使用工作区配置；无配置才使用 `qa/ui` 后备配置（不提供业务 baseURL）。不要把 seed 改成绝对路径绕过录制绑定。初始化阻塞不是产品用例失败。

私密录制仅支持显式受管协议：配置 `private_recording.capture:"chromium-single-page-v1"`，使用同一物理 Playwright 实例的 `pi-ui-testing/recording-fixtures`，直接声明与会话一致的环境/归属及 `trace:off`。受信工作区的明确输入须全部登记；收集配置仍会执行模块代码，不是任意代码安全沙箱或依赖闭包证明。限新建单页面/单frame Chromium，最多8个非清理动作，预算至少 `2 * max_steps + 1`。实际动作必须经本会话 `ui_discover_record`，固定采集仍经过宿主权限门禁；普通嵌套调用不授予私密浏览器权限。准备回执不表示异步MCP已连接或业务身份/数据就绪。

省略采集声明的旧私密路径仍只准备/握手，浏览器动作阻塞。坏证据、取消、失效或预算耗尽保留 partial 和真实缺口，关闭自有 context 后显式 finish；禁止匿名回退、覆盖已有草稿或换任务重放。数据空间通用 `record` 准备仍为 unsupported；本协议的合成产品验证不代表真实 PMS 或 Electron 业务全链已通过。

录制期间重载 Agent 后，原生只允许查询旧记录，不从点击中间续跑；MCP 重连也不能复用已撤销的私密快照。先核对原日志和数据归属，再保存 partial；原生关闭动作被拒绝时保留 `browser-cleanup-not-confirmed`，不能把连接退出当作浏览器关闭成功。未知副作用仍须核对，不换任务重放。

生成 UI 用例后，保留 `save-cases` 等原生工具返回的 cases ref，并提供以下实际内联选项；未明确同意前不导入，用户已明确要求本批入库则直接办理，不重复询问：

[[action:suggest:录入用例库,prompt=将本批生成的测试用例录入所选测试环境所属项目的用例库]]
[[action:suggest:暂不录入,prompt=本批生成的测试用例暂不录入用例库]]

选择录入后，按数据空间规范显式调用 `import`，以原生 cases ref 为 `assetRef`，按所选 `envId` 匹配所属 `systemId`。保留显式或既有通道 `featureId`；无目录时默认使用“测试用例 → UI用例”，不存在则建、存在则复用，用户重命名后跟随目录 ID。可选 `moduleName` / `featureName` / `envId` / `featureId` 以实际工具 schema 为准；缺少扩展能力时报告阻塞。不要为了入库提前创建 candidate、绑定或执行测试，不生成执行结果。入库不替代设计批准、诊断或正式执行门禁；正式批次仍按原 run 的 `sync` 路径核对结果。

维护安装、资源归属与升级时，查阅 [维护入口](references/maintenance.md)。
