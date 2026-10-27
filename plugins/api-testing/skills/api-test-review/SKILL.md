---
name: api-test-review
description: 使用 api-testing 插件，核查冻结 API 测试套件的依据，并在限定范围和预算内进行独立评审批准。
---

# API 测试套件评审

使用可用的 `api_test_execute` 工具，对准确的工作流 `runRef` 调用 `review` action，传入 `{action: "review", runRef, model?}`。`verdict` 只有三值：`pass` 由宿主签发批准（套件落到 `<bundle>-approved-<uuid>`，签发前复检 `suiteHash`，变了即报 `Suite changed while under review`）；`revise` 须修订后重新评审；`blocked` 看 `reason`。宿主管理的独立 `llm.complete` 调用负责检查冻结产物，且不具备执行工具。对话中的意见或导入的通过标签不能作为批准。通过正常权限门禁复用宿主已配置的模型，独立模型配置为可选项。模型替身只能验证控制流程。

依据提供的契约和已确认规则，逐一核查选定用例：请求方法与路径、必需请求数据、预期状态码、JSON 媒体类型、必需字段、类型或枚举，以及明确取值。缺失的授权语义、通配响应媒体类型或未记载的状态码映射须保持待确认。检查不受支持项的诊断信息；不得悄悄丢弃关键约束，也不得为适配实际行为而放宽失败断言。

将模型发现视为修正建议。宿主校验结构化输出、产物哈希和当前用例 ID：`findings` ≤20 条，`caseId` ≤80 字符且须为当前用例 ID 或 `suite`，`code` 1–80 字符，`message` 1–600 字符，`pass` 必须 0 条 findings。非法或截断的输出、错误哈希都会消耗共享预算，不能授权执行。根据返回的问题进行针对性 `revise`，写入新的 `outputPath`，然后重新评审。缺少业务事实时标记为阻塞；相同问题反复出现且无变化时，应在预算内停止——每工作流累计 3 次调用、总额 180 秒、单次调用 ≤30 秒，同一问题连续 2 轮无变化即 `two-rounds-without-improvement`。不得通过重建工作流绕过调用、时限或修订预算。

记录实际评审版本、发现的问题和模型用量；缺失的用量标记为未知。`blocked` 的 `reason` 取值仅：`model-unavailable`、`model-call-budget`、`overall-time-budget`、`canceled`、`canceled-or-budget-expired`、`review-batch-too-large`（单条 prompt 超 7500 字符）、`two-rounds-without-improvement`；剩余预算不足 5000ms 时按 `overall-time-budget` 收尾。宿主无法取消供应商侧调用：超时会阻止后续工作流步骤，但不能证明远端模型调用已停止或未产生费用。真实模型的语义验收须与确定性编译检查、模型替身测试分开报告。
