---
name: api-test-review
description: 使用 api-testing 插件，核查冻结 API 测试套件的依据，并在限定范围和预算内进行独立评审批准。
---

# API 测试套件评审

使用可用的 `api_test_execute` 工具，对准确 `runRef` 调 `review` action，参数 `{action: "review", runRef, model?}`。内部评审记录的 `verdict` 为 `pass`/`revise`/`blocked`；公共工具回执用 `phase`，不以顶层 `verdict: pass` 判断批准。按实际回执分流：

- `phase: approved`：宿主完成批准（套件落 `<bundle>-approved-<uuid>`，签发前复检 `suiteHash`，变了即报 `Suite changed while under review`）。已获执行授权时，对同一 `runRef` 调 `run`，无需重复确认。
- `phase: revise`：按 `reviewPath` 核查评审记录的 `findings` 与依据；在已有修订授权和剩余预算内，提交有依据的 `cases` 及新的 `outputPath`，对同一 `runRef` 调 `revise` 后重新 `review`。缺少必要事实时先列待确认项，不放宽断言凑通过。
- `phase: blocked`：保留原始 `reason` 和证据路径并停止；处理原因、核实预算后再决定能否继续，不盲目重评。
- 工具抛错、回执缺失或未知 `phase`：保留错误及已取得的回执，说明尚未取得批准并停止，不伪造 `blocked` 或 `reason`。

宿主管理的独立 `llm.complete` 查冻结产物，无执行工具。对话中的意见或导入的通过标签不能作为批准。权限门禁内复用宿主已配置模型，独立模型可选。模型替身只验控制流程。

🛑 执行门禁：仅宿主返回 `phase: approved` 且执行在用户授权范围内才可运行；`revise`、`blocked`、报错或未知回执均不得执行。

按契约与已确认规则逐条核查选定用例：请求方法与路径、必需请求数据、预期状态码、JSON 媒体类型、必需字段、类型或枚举，及明确取值。缺失的授权语义、通配响应媒体类型、未记载的状态码映射须保持待确认。检查不受支持项诊断信息。

模型发现视为修正建议。宿主校验结构化输出、产物哈希、当前用例 ID：`findings` ≤20 条，`caseId` ≤80（须为当前用例 ID 或 `suite`）、`code` 1–80 字符、`message` 1–600 字符，`pass` 必须 0 条 findings。非法/截断输出、错误哈希耗共享预算，不能授权执行。据返回问题针对性 `revise`，写新 `outputPath` 后重评。缺少业务事实标阻塞；相同问题反复且无变化时应在预算内停止——每工作流累计 3 次调用、总额 180 秒、单次调用 ≤30 秒，同一问题连续 2 轮无变化即 `two-rounds-without-improvement`。

记录评审版本、`findings`、用量；缺失标未知。`blocked` 的 `reason` 以原始回执为准，已知值包括：`model-unavailable`、`model-call-budget`、`overall-time-budget`、`canceled`、`canceled-or-budget-expired`、`review-batch-too-large`（单条 prompt 超 7500 字符）、`two-rounds-without-improvement`、`missing-business-facts`、`MODEL_TIMEOUT`、`CANCELED`；未列举值也原样保留，不自行改码。直接抛错单独报告，不伪造为 `blocked`。剩余 <5000ms 按 `overall-time-budget` 收尾。宿主无法取消供应商侧调用：超时只阻止后续步骤，不证明远端已停或未计费。真实模型语义验收须与确定性编译检查、模型替身测试分开报告。

## 不要做

- 悄悄丢弃关键约束，或为适配实际行为放宽失败断言。
- 拿导入通过标签冒充批准。
- 重建工作流绕过调用、时限或修订预算。
- 把 `blocked` 当通过或自行签发批准。
- 编造 `verdict`、`findings`、模型用量。
- 改写或编造工具的 `reason`、错误原文或 `phase`。
