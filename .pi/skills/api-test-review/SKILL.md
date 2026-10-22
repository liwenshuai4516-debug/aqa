---
name: api-test-review
description: Review the basis and bounded independent approval of a frozen API test suite when using the api-testing plugin.
---

读取并遵循本仓库插件内的 [api-test-review](../../../plugins/api-testing/skills/api-test-review/SKILL.md)。这里是项目发现入口；用例规则、评审与执行边界以该技能及 `api_test_execute` 的实际能力为准。

若当前会话没有 `api_test_execute`，明确报告缺少 API testing 插件或引擎支持；技能加载不等于工具已安装或业务验收通过。不要用直接 HTTP 或私有 MCP 绕过原执行链路，不把凭据放进提示词、工具参数或证据。
