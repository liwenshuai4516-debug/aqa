---
name: api-test-analyze
description: 解读 API 测试报告、留存问题、清理结果与定向复测证据，不擅自重新发送请求。
---

读取并遵循本仓库插件内的 [api-test-analyze](../../../plugins/api-testing/skills/api-test-analyze/SKILL.md)。这里是项目发现入口；用例规则、评审与执行边界以该技能及 `api_test_execute` 的实际能力为准。

若当前会话没有 `api_test_execute`，明确报告缺少 API testing 插件或引擎支持；技能加载不等于工具已安装或业务验收通过。不要用直接 HTTP 或私有 MCP 绕过原执行链路，不把凭据放进提示词、工具参数或证据。
