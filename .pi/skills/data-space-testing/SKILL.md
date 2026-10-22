---
name: data-space-testing
description: 从数据空间用例查找、关联 UI/API 原生自动化资产，继续原工作流执行并核对原生结果同步；也可只同步已有批次，不重跑。
---

使用 `data_space_cases` 按编号查询步骤与预期。`data_space_automation` 的 `inspect` 读取当前工作区的原生资产；`bind` 关联 `caseId`、`engine`（ui/api）、`assetRef`、`nativeCaseId` 和项目 `envId`。UI 引用含真实 `path` 与 `sha256`，API 引用为原生资产摘要，不自造引用或批准。

执行范围为整个原生资产，先核对其中全部用例及写操作授权。执行已关联用例时调用 `route`（带 `caseId`），再使用返回的原工具和参数：API 继续 `api_test_execute`，UI 继续 `ui_test_workflow` 的 execute 路径，按需读取各自阶段技能。原有批准、诊断、环境预检与操作授权仍生效；台账“已评审”不能代替原工作流批准。仅绑定或查询不执行测试。

宿主在实际执行结束后自动同步，并在重载后从原生记录补同步。同步失败使用 `sync`（`engine`、原 `runRef`）核对已有证据，不能因同步失败重放业务操作。结果须说明原生 run、父批次、资产版本、环境、完整性和证据；原始执行结论与独立报告评审分别报告。

`data_space_record_result` 只用于明确标识的人工/AI 登记，不能代替原生结果同步。用例修改后须重新检查并关联对应资产版本。维护及验收见 `docs/data-space-integration.md`。

取消或工具失败可能没有发出完成引用：查询原工作流的批次历史后，对已落盘的原 run 执行 sync；不完整批次记为未知。也可重载后由历史补同步恢复，绝不自动重放。
