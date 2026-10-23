---
name: data-space-testing
description: 规范 Agent 与数据空间之间的测试数据交接：初始化项目环境、归档生成的 UI/API 用例、同步原生执行证据，并结构化输出结果与未入库项。适用于数据空间测试、结果回写和批次整理，不用于直接清洗存储文件。
metadata:
  display-name: 数据空间测试数据规范
  description-zh: 统一测试数据定位、原生结果同步和结构化交付，保留来源、版本、环境与未入库项。
  description-en: Normalize test data handoffs, synchronize native runs, and report structured outcomes with provenance and unresolved items.
  plugin-id: data-space
---

# 数据空间测试数据规范

数据空间保存用例台账和执行流水；UI/API 原工作流持有资产、批准及执行证据。本 Skill 规范两者交接和 Agent 输出，复用现有工具，不创建另一份结果库、runner 或批准路径。只读整理不自动绑定、执行或回写；用户已要求回写时在该范围内完成，无需逐条重复确认。

## 先定位，后交接

1. 开始新测试时，调用 `data_space_automation` 的 `initialize`，传 `engine`、当前 `mode` 和用户的 `targetUrl`（或明确的 `systemId` / `envId`），从结构化回执取得项目、环境 ID、`baseUrl`、非敏感 `parameters` 和 `privateParameterKeys`。`analyze`、`view` 或 `new/record` 配 `discovery=source` 返回 `not-required`，不选新环境、不建通道；普通查询不初始化。`missing-environment` 时补齐配置；`ambiguous` 时用候选真实 ID 消歧，不能套用默认项。
2. 读取本次 `preparation` 与 `parameterSources`：有效动态值优先于同名静态值；`refresh-required` 时显式刷新再初始化，不能回退旧值或使用脱敏占位。`configured` 仅代表配置匹配，网络、身份、角色和数据未检查均为 `unknown`，仍须原生执行预检。UI 录制先核对 Playwright 依赖、配置、project 与相对 seed，再由浏览器验证前置条件；已有资产执行不新增录制 seed。参数不得当脚本或任意进程环境变量执行。API 沿用原目标许可与预检；配置冲突不能悄悄切换目标。用例范围通过 `data_space_cases` 查询，优先真实 ID；`get` 不按 project 消歧，前 100 条不是全量。
3. 保留本次取得的 `revision`、用例引用和原生资产／批次引用。聊天锚点只帮助定位，不是版本锁或结果证据。写前发现用例已变更，先核对对应测试版本；原生关联过期需重新关联，不能把旧结论贴到新用例上。

数据空间在同一 dataDir 内跨工作区共享，项目名、环境名不能单独充当全局身份。敏感参数只返回脱敏占位或名称；不使用 `***` 执行，不把密钥、cookies、storageState 或连接口令写进备注与结果。只有原工作流明确支持的私有引用才能用于执行；当前数据空间动态私密参数尚未接入浏览器执行链，遇到此依赖应阻塞，不经聊天传递秘密。

返回 `configured` 即建立持久通道，**不授权生成用例自动入库**。通道仅含工作区、引擎、项目、环境和归档位置，不复制环境参数。环境改动后重新初始化；`disconnect` 加 `engine` / `envId` 停止该通道的新交接，已绑定用例的结果同步仍沿原绑定（停止须逐项 `unbind`）。同地址多个通道不能自动判断归属，须按所选 `envId` 消歧。

## 按需交接

处理生成用例入库、归类、资产绑定、执行路由或结果回写时，先读 [原生交接规则](references/native-handoff.md)，沿用原工具、引用、权限和去重口径。纯查询和环境准备不加载该参考。

用例入库须取得本批明确授权；已授权则不重复询问。入库、绑定、执行和结果同步分别办理，不能用初始化或设计批准代替入库授权。已有原生批次仅按原 runRef 同步，不用普通登记重复写入；结果未知先查原引用，不重放业务。

## 结构化结果输出

需要整理、同步或回写结果时，读取 [结果交付约定](references/result-output.md)，按一次真实原生 run 或一次人工登记批次输出 JSON；纯用例／环境查询可直接简答。该 JSON 是交付格式，不是新工具参数或 `runs.json` 的文件格式。批次引用、用例结果、同步回执、证据完整性与报告评审分别表达，未知值保留 `null` 和具体原因。

结构化交付可用 [离线一致性校验器](scripts/validate-result.mjs) 检查，调用方法见结果约定末节；校验通过不代替原生证据或独立评审。

交付前核对：范围是否完整；用例／环境是否唯一；结果是否来自本次证据；状态及统计是否保留全部分母；写入回执是否逐项核对。失败原因只写证据支持的事实，推测明确标注。原始失败、父批次及过期结果保留，不用新成功覆盖历史。

维护与接入见 [数据空间接入说明](../../../docs/data-space-integration.md)。
