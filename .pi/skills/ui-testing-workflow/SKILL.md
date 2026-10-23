---
name: ui-testing-workflow
description: UI 自动化测试工作流入口：发现录制、用例设计与独立评估、执行已有资产、分析旧批次和查看证据。复用已安装的 pi-ui-testing 阶段技能与工具。
---

用户要求新建或执行测试，且数据空间工具可用时，先读 [数据空间测试数据规范](../data-space-testing/SKILL.md)，用 `data_space_automation.initialize` 按目标 URL 核对环境并建立归档通道；沿用返回的地址和非敏感参数，实际访问／登录仍由浏览器验证。工具未安装或停用时明确无法自动归档，不虚构关联。仅分析历史结果时按原批次引用处理，不重新初始化或执行。

然后调用 `ui_test_workflow`：`{"request":{"operation":"catalog"}}`，核对当前工作区的资产、阶段技能和运行能力；然后读取原包的 [ui-test-workflow](../../../node_modules/pi-ui-testing/skills/ui-test-workflow/SKILL.md)，按用户意图选择路径并按需加载当前阶段说明。

这是原包的同名入口，不另定义阶段、批准或执行规则。后续优先使用工具返回的原包技能路径。应用级安装只使能力在不同工作区可发现；正式测试仍以当前工作区为目标，须满足原包的依赖、来源、环境和数据门禁。缺少项目依赖时明确报告阻塞，不向个人目录自动安装依赖或执行业务测试。

录制前，确认目标工作区的 Playwright 配置、依赖、浏览器 project 和相对 seed 路径；先用该工作区的 CLI / 配置收集 seed，确认匹配一个种子测试后再启动录制。MCP 优先使用工作区配置；无配置才使用 `qa/ui` 后备配置（不提供业务 baseURL）。不要把 seed 改成绝对路径绕过录制绑定。初始化阻塞不是产品用例失败。生成原生 candidate 后用数据空间 `import` 核对归档回执，执行后核对原 run 的同步结果。

维护安装、资源归属与升级时，查阅 [维护入口](references/maintenance.md)。
