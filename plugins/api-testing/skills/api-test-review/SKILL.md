---
name: api-test-review
description: 使用 api-testing 插件，核查冻结 API 测试套件的依据，并在限定范围和预算内进行独立评审批准。
---

# API 测试套件评审

使用可用的 `api_test_execute` 工具，对准确的 `runRef` 调用 `review` action，参数 `{action: "review", runRef, model?}`。`verdict` 只有三值：`pass` 由宿主签发批准（套件落 `<bundle>-approved-<uuid>`，签发前复检 `suiteHash`，变了即报 `Suite changed while under review`）；`revise` 须修订后重新评审；`blocked` 看 `reason`。宿主管理的独立 `llm.complete` 检查冻结产物，不具备执行工具。对话中的意见或导入的通过标签不能作为批准。正常权限门禁内复用宿主已配置模型，独立模型可选。模型替身只能验证控制流程。

依据契约与已确认规则逐条核查选定用例：请求方法与路径、必需请求数据、预期状态码、JSON 媒体类型、必需字段、类型或枚举，以及明确取值。缺失的授权语义、通配响应媒体类型或未记载的状态码映射须保持待确认。检查不受支持项诊断信息。

将模型发现视为修正建议。宿主校验结构化输出、产物哈希和当前用例 ID：`findings` ≤20 条，`caseId` ≤80（须为当前用例 ID 或 `suite`）、`code` 1–80 字符、`message` 1–600 字符，`pass` 必须 0 条 findings。非法或截断输出、错误哈希消耗共享预算，不能授权执行。据返回问题针对性 `revise`，写入新 `outputPath` 后重评。缺少业务事实时标记为阻塞；相同问题反复出现且无变化时，应在预算内停止——每工作流累计 3 次调用、总额 180 秒、单次调用 ≤30 秒，同一问题连续 2 轮无变化即 `two-rounds-without-improvement`。

记录评审版本、`findings` 与用量；缺失标未知。`blocked` 的 `reason` 仅：`model-unavailable`、`model-call-budget`、`overall-time-budget`、`canceled`、`canceled-or-budget-expired`、`review-batch-too-large`（单条 prompt 超 7500 字符）、`two-rounds-without-improvement`；剩余 <5000ms 按 `overall-time-budget` 收尾。宿主无法取消供应商侧调用：超时只阻止后续步骤，不证明远端已停止或未计费。真实模型的语义验收须与确定性编译检查、模型替身测试分开报告。

## 不要做

- 悄悄丢弃关键约束，或为适配实际行为放宽失败断言。
- 拿导入的通过标签冒充批准。
- 重建工作流绕过调用、时限或修订预算。
- 把 `blocked` 当通过，或自行签发批准。
- 编造 `verdict`、`findings` 或模型用量。
- 用未登记的 `reason` 上报阻塞。
