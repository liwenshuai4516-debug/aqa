---
name: ui-testing-workflow
description: UI 自动化测试工作流入口：发现录制、用例设计与独立评估、执行已有资产、分析旧批次和查看证据。复用已安装的 pi-ui-testing 阶段技能与工具。
---

先调用 `ui_test_workflow`：`{"request":{"operation":"catalog"}}`，核对当前工作区的资产、阶段技能和运行能力；然后读取原包的 [ui-test-workflow](../../../node_modules/pi-ui-testing/skills/ui-test-workflow/SKILL.md)，按用户意图选择路径并按需加载当前阶段说明。

这是原包的同名入口，不另定义阶段、批准或执行规则。后续优先使用工具返回的原包技能路径。应用级安装只使能力在不同工作区可发现；正式测试仍以当前工作区为目标，须满足原包的依赖、来源、环境和数据门禁。缺少项目依赖时明确报告阻塞，不向个人目录自动安装依赖或执行业务测试。

维护安装、资源归属与升级时，查阅 [维护入口](references/maintenance.md)。
