# 测试结果交付约定 v1

本约定仅规范 Agent 的结果交付，工具调用仍使用运行时公开 schema。原生数据及宿主同步回执是事实源；不要把以下对象直接传给 `data_space_record_result`、`sync` 或写入存储文件。只在用户要求保存文件时保存交付，不自动另建长期台账。

## 最小结构

一个对象对应同一工作区、项目、环境、来源和实际批次。不同原生 run、重跑、人工登记批次分别输出；多批次用对象数组，不混成一次“全通过”。使用以下字段；条件字段无可靠值用 `null`，并在 `gaps` 说明，不用空串、0 或虚构 ID 代替未知。

| 字段               | 内容及来源                                                                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`           | 固定 `data-space-result/v1`，仅标识交付约定。                                                                                                                                                                                                                  |
| `context`          | `workspace`、`project`、`environment`：实际测试工作区、项目和环境。项目／环境是 `{id,name}`；取不到 ID 可为 `null`，名称须来自查询。仅在已有证据时附 `baseUrl`、`deploymentVersion`。不含环境参数值。                                                          |
| `origin`           | `native`（原工作流证据）或 `observed`（明确观察的人工／AI 结果）；尚无结果证据为 `null`。它不等同于已成功入库的 `source`。                                                                                                                                     |
| `native`           | 原生结果含 `{engine,assetRef,runRef,runId,parentRunId}`，原样保留引用类型。无原生批次为 `null`；没有父批次为 `null`（原回执空字符串表示无父批次时，交付归一为 null，原回执保持原样）。已知资产修订可附 `assetRevision`。                                       |
| `results`          | 每条含 `{case,verdict,note}`，`case` 为已核对的台账 ID 或编号；原生结果再附 `nativeCaseId`、`featureId`、`caseVersion`（目标功能 ID、绑定版本指纹；未知用 null 并留 gap）。使用下述八态，描述实际观察，不复制整份用例步骤。                                    |
| `evidence`         | 真实证据引用数组，原生文件保留 `{path,sha256}`；普通观察文件可只有 `path`，不得补造摘要。API 与 UI 的路径根不同，沿用原工具说明，不猜为当前目录。空数组不证明证据完整。                                                                                        |
| `evidenceComplete` | 原生工具核验值；未提供／未核验为 `null`。不能从 `completed`、有截图或同步成功推导为 `true`。                                                                                                                                                                   |
| `reportReview`     | 原工具的独立报告评审状态／引用，无则 `null`。`execution-evidence-only` 不能写成独立报告获批。                                                                                                                                                                  |
| `writeback`        | `{method,status,receipt}`。method 为 `native-sync`／`ai-record`／`none`；status 为 `confirmed`／`partial`／`unknown`／`not-requested`／`blocked`。receipt 只摘录工具实际回执：同步计数与错误，或普通登记数量、结果 revision 和未匹配项。不要补造 run/task ID。 |
| `gaps`             | `{case,reason}` 数组；批次级缺口的 case 为 `null`。包括未匹配、未返回、缺证据、版本变化、接口不支持及写入不明。没有结果证据的对象放这里，不凭空生成执行记录。                                                                                                  |

`writeback.status=confirmed` 仅在本次全部目标有明确写入或重复确认时成立。`sync` 可能同步同一原生 run 的多条关联用例，回执计数不一定等于用户选中的条数；若缺少逐项信息，明确核对范围，不能把全批计数当成某条用例的成功证明。`duplicate` 表示已存在，不算新执行或新增记录。工具未核验时保留 `unknown`／`blocked`，不得从最近一条结果倒推某个历史 run 已同步。

## 用例归档与执行同步分别核对

生成用例入库可引用 `archive-status` / `import` 的真实归档回执，包含项目、环境、工作区、资产和修订、目标功能及逐项状态；这不是 run 同步回执。`new/existing/pending/stale` 为互斥归档状态，`unclassified` 为独立分类维度；`classificationComplete=false` 时保留归类缺口。旧数据没有映射元数据时不推断已归类。

`itemsTruncated=true` 时全量计数仍有效，但前 100 条不能冒充全量逐项证据。`pending` 表示尚未入库，不是未执行或测试失败；`stale` 表示需核对归属，不迁移或覆盖历史。执行结果核对使用原 `engine/runRef` 的只读 `sync-status`；仅分析／查看时保留缺口，不补同步、入库、绑定或重跑。用户已授权同步／回写且待写关联全部在授权范围内时才调用 `sync`，不把用例子集授权扩大为整批写入；归档 `ok` 和 `imported=0` 均不证明结果已同步。

## 状态与计数

| 原生用例状态 | 交付 verdict |
| ------------ | ------------ |
| passed       | 通过         |
| failed       | 失败         |
| blocked      | 阻塞         |
| skipped      | 跳过         |
| cancelled    | 取消         |
| not-run      | 未执行       |
| flaky        | 不稳定       |
| unknown      | 未知         |

同步时使用宿主投影的结论，不自己聚合原生实例；声明通过但证据不完整的实例由宿主降为未知。流程 `completed`、API 顶层执行状态、HTTP 200、工具 `ok` 都不是用例通过状态。一个台账用例映射多个实例时保留原生明细引用，不逐实例追加普通登记。

需要汇总时可加 `summary`，注明 `unit`（`case` 或 `instance`）、`scope`（本批全部／本次选中子集）、`total`、八态 `counts` 和 `unresolved`。八态计数加 unresolved 必须等于该范围 total；无法确认 total 则为 `null`。只对当前范围计数，去重键采用台账用例或原生实例标识；父批次、示例、过期记录及其他环境不得混入。默认交付计数即可；确需通过率，明确分子／分母，分母为 0 时为 `null`，不要把台账“最近结果”概览当成本轮执行统计。

## 普通登记的参数示例

以下为合成示例，不可直接写入实际台账；替换为已核对的真实用例和环境后才调用：

```json
{
	"task": "合同保存回归",
	"env": "synthetic-env-01",
	"results": [
		{
			"case": "synthetic-case-01",
			"verdict": "失败",
			"note": "步骤3：预期保存后仍显示金额；实际刷新后为空。证据：qa/evidence/save.png。根因未确认。"
		}
	]
}
```

`task` 最长 80 字，`note` 最长 300 字，单条任务名可能不会保存；备注只留关键差异与短证据引用，完整内容放本次交付。不要把结构化报告塞进 note，也不传接口未声明的 source、runId、sha256 等字段。一次调用中同一真实用例只出现一次，避免 ID 和编号各写一条；不同尝试分开交付。部分成功只核对未匹配项，普通登记返回不明时不自动重试。

## 交付示例：仅整理，环境未确认

以下为合成说明，展示无执行证据时如何保留缺口；并非本项目测试结果：

```json
{
	"format": "data-space-result/v1",
	"context": {
		"workspace": null,
		"project": { "id": null, "name": "合成示例项目" },
		"environment": null
	},
	"origin": null,
	"native": null,
	"results": [],
	"evidence": [],
	"evidenceComplete": null,
	"reportReview": null,
	"writeback": { "method": "none", "status": "not-requested", "receipt": null },
	"gaps": [
		{ "case": null, "reason": "工作区、项目 ID 和环境未确认；未执行或回写。" },
		{ "case": "SAMPLE-001", "reason": "只收到旧聊天编号；工作区、所属项目、执行环境和本次结果均未核验，未执行或回写。" }
	]
}
```

## 契约维护

参数与限制以当前工具 schema 为准。维护本约定时核对 `plugins/data-space/tools.mjs`（查询／普通登记）、`automation.mjs`（绑定／同步／幂等）、`runs.mjs`（状态／过期）、`server/test-asset-reader.ts`（原生证据核验），不复制它们的存储 schema 或执行规则。用 `sync-status` 查询单个原生 run 的当前归档对账，`archive-status` 查询资产用例入库；两者均只读，不替代原生证据检查。`sync-status` 的 `complete` 是同步完整性，不能填入 `evidenceComplete`。回执按用例关联计数，不能直接填入按用例/实例计数的 summary。其余查询主要返回文本，未提供通用结构化历史明细查询；本约定不能补出接口未返回的字段，只有实际运行校验器的交付才有结构一致性校验结论；校验器不证明证据真实性。

## 离线一致性校验

交付前使用本 Skill 的 `scripts/validate-result.mjs`。已有交付文件时运行 `node <Skill目录>/scripts/validate-result.mjs <delivery.json>`；文件可为一个批次对象或批次数组。它只读指定文件，输出 `{ok,reports}`，不通过时退出码为1；不向应用写入、不执行测试。未要求保存文件时可直接调用导出的 `validateResult(object)`，不要为校验另建长期台账。

工作区使用宿主回执的规范化 workspace，避免将 macOS /var 与 /private/var 两种路径写成不同批次。核对必需字段、八态、case去重、summary算术、原生引用、同步计数和逐项项目/环境/功能/版本及结论。`writeback.receipt` 使用原生 `sync` / `sync-status` 的真实结构；不要自造简化计数来获得通过。批次回执可包含其他关联，交付结果只核对本次明确范围，summary不能照抄整批关联计数。被截断且缺少目标逐项回执时不能确认该用例，保留gap和非confirmed状态。

合法的未知项可用null和gap通过结构检查；通过仅表示内部一致，不代表已执行、证据字节有效、真实归属核验或模型遵循度通过。实例统计只检查算术，须另以原生实例明细对账；人工登记不具备原生逐项版本回执，不能由此补造核验。格式错误、跨项目/环境、引用或版本冲突、状态/计数矛盾均应修正后再交付。相关合成正反例见 `tests/unit/data-space-delivery.test.ts`，桌面实际回执样例随该轮隔离验收证据保存。

数据空间用例库的“最近入库版本”只按明确来源及入库顺序投影，不等于原生当前版本或已批准。查看历史时切换“全部版本”；旧数据/API未确认关系会全部显示。执行结果历史仍保留，自动化弹窗可读原生来源、修订、批次和证据；工具查询仍返回原数据，不因列表筛选而删行或改变原生执行范围。
