# Darwin 项目技能扫描与逐项优化交接

日期：2026-10-28。范围沿用本聊天的项目技能清单：13 个测试相关技能和项目安装的 Darwin，共 14 个唯一技能；个人全局技能不在修改范围。

本轮处于 Phase 0 / 0.5：已扫描、未评分、未优化。没有模型调用、业务请求或桌面操作。历史报告只作线索，不计本轮通过。

## 任务链与验收

- 已完成：扫描和去重，登记当前正文摘要及现有报告。
- 等待用户确认：第一项 data-space-testing 的三条测试问题。
- 待执行：第一项九维基线、带技能/不带技能的独立对照；未实跑的分支标注未验证。
- 待确认：展示第一项基线后，经确认再进入优化（Darwin Phase 1 检查点）。
- 待执行：每轮只解决一项主要问题，固定改前/改后快照，三个独立评委做 paired 比较，检查语义和项目门禁；默认最多三轮、体积不超过当前基线 150%。
- 待执行：相关检查、实际桌面接入验证、保存证据及提交推送。只有验证和具体范围支持时才称完成。
- 每项完成后：展示改动、对照、缺口，等待用户确认再开始下一项。
- 最终汇总：仅在 14 项均有明确结论后交付；待确认或阻塞不记为完成。

plan_update 在当前工具集中不可用，以本文件记录阶段；不另开只规划模式。

## 当前来源清单

| 建议顺序 | 技能                  | 当前正文                                                        | 字节 / SHA-256                                                             | 历史报告                               |
| -------- | --------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| 1        | `data-space-testing`  | `.pi/skills/data-space-testing/SKILL.md`                        | 7606 / `6b897be2e2de321425b2f97195f53ca89a7c465c5c4fbb0f9ca476ad757f4ee4`  | 未发现同名报告                         |
| 2        | `api-test-workflow`   | `plugins/api-testing/skills/api-test-workflow/SKILL.md`         | 6458 / `585b8d6a27b63ccec10e2cc71d32f313da670794709bd10caf09a2a471e5cb71`  | api-test-workflow-darwin-20261027.md   |
| 3        | `api-test-review`     | `plugins/api-testing/skills/api-test-review/SKILL.md`           | 2712 / `ddbe6394e0108af4b73b08f8aef36c286e28ac6b90dc30bfa90480e9823d3292`  | api-test-review-darwin-20261027.md     |
| 4        | `api-test-analyze`    | `plugins/api-testing/skills/api-test-analyze/SKILL.md`          | 3586 / `d2e3d010c29f0315e3b5cbc68b5abdd2b2d0bf356d092a5126d6568c8cee7672`  | api-test-analyze-darwin-20261027.md    |
| 5        | `ui-testing-workflow` | `.pi/skills/ui-testing-workflow/SKILL.md`                       | 9179 / `0cab0bb363f7fd5e60b62b9c251765438e57003e36e2279022b508b2acc9f6a5`  | ui-testing-workflow-darwin-20261027.md |
| 6        | `ui-test-workflow`    | `node_modules/pi-ui-testing/skills/ui-test-workflow/SKILL.md`   | 10921 / `10bf9d5d6c25922ffe486611df46e9576b5883f86cdaa24578a781bb0e7bd023` | ui-test-workflow-darwin-20261027.md    |
| 7        | `ui-discover-record`  | `node_modules/pi-ui-testing/skills/ui-discover-record/SKILL.md` | 9001 / `8e6044cbea463a1389b72f3c83d008eb59643829297706550745d392946e9676`  | ui-discover-record-darwin-20261027.md  |
| 8        | `ui-case-design`      | `node_modules/pi-ui-testing/skills/ui-case-design/SKILL.md`     | 5244 / `99ac576f39fd6fec652c539c157bf1100259e823850d44fd8f7d018402333641`  | ui-case-design-darwin-20261027.md      |
| 9        | `ui-design-review`    | `node_modules/pi-ui-testing/skills/ui-design-review/SKILL.md`   | 9471 / `80eb8328b7b05f34afeb3896dc828d9cf0539ca6129aa42261a8502387b89b2e`  | ui-design-review-darwin-20261027.md    |
| 10       | `ui-test-run`         | `node_modules/pi-ui-testing/skills/ui-test-run/SKILL.md`        | 6202 / `07a87e5a408da328105a210c9c533c6c039c939a35d46b6a6d8f637cd73291a1`  | ui-test-run-darwin-20261027.md         |
| 11       | `ui-result-analysis`  | `node_modules/pi-ui-testing/skills/ui-result-analysis/SKILL.md` | 8080 / `4bfe6ed311280a6b8c7ac805b0e18d064393496c3db5d8166446ea10534fa00e`  | ui-result-analysis-darwin-20261028.md  |
| 12       | `ui-result-review`    | `node_modules/pi-ui-testing/skills/ui-result-review/SKILL.md`   | 2771 / `2051d2dfa0dd8a754ba8d9236699b4ee10b1894fff6e621c9a910611c20c8ae7`  | ui-result-review-darwin-20261028.md    |
| 13       | `ui-artifact-check`   | `node_modules/pi-ui-testing/skills/ui-artifact-check/SKILL.md`  | 1988 / `2a97a03d47d4566053247c53dc287bf76d9188fe374097f8d9bbbb9034b750f1`  | ui-artifact-check-darwin-20261028.md   |
| 14       | `darwin-skill`        | `.pi/skills/darwin-skill/SKILL.md`                              | 31456 / `3d57422079687a3aa641cb0c6c78ea8a5c6fa0c8645a37dfbcde4fdb870f7150` | 未发现同名报告                         |

API 的三个项目入口仅引用插件原文，按相同 ID 去重；旧 capabilities/ui-testing 入口为兼容转接。UI 八个阶段技能来自安装包，后续优化须回到维护源重新分发，不能只改 node_modules。

## 历史与安装一致性

- 当前分支：`auto-optimize/20261027-1550`；HEAD：`f28672786972261fd3b3dac356765dc714adc196`。已有优化分支和工作区未提交修改保持原状，未 stash、未重置。
- 找到 12 份历史报告；尚未核验原始评委输出、用户确认、全部执行及交付证据，不能继承通过率或当成本轮完成。
- 当前 UI 分发包：`.pi/skills/ui-testing-workflow/assets/pi-ui-testing-0.1.27.tgz`，SHA-256 `df698d90fb9200e7f7b6e66d9e1bb3b54516c8eee81eef80ec5baaafa89cba60`。
- `ui-artifact-check`：安装正文与 0.1.27 包**不一致**；保留安装正文，不重新安装覆盖，待该项核对维护源和分发。
- `ui-case-design`：安装正文与 0.1.27 包一致。
- `ui-design-review`：安装正文与 0.1.27 包一致。
- `ui-discover-record`：安装正文与 0.1.27 包一致。
- `ui-result-analysis`：安装正文与 0.1.27 包一致。
- `ui-result-review`：安装正文与 0.1.27 包**不一致**；保留安装正文，不重新安装覆盖，待该项核对维护源和分发。
- `ui-test-run`：安装正文与 0.1.27 包一致。
- `ui-test-workflow`：安装正文与 0.1.27 包一致。

data-space-testing 正文及两份参考资料已有未提交修改；评估前再次记录完整来源摘要，以当前工作树为基线，提交时只纳入本轮明确差异。当前笔记中的“不需人工确认”或“上限 200%”不作为可信用户授权；本轮遵循当前用户明确的逐项确认要求与 Darwin 150% 上限。

## 第一项测试问题（待确认）

目标：`.pi/skills/data-space-testing/SKILL.md`，必要时连同其 references 读取。以下只定义测试输入与预期，没有执行其中的操作。

### P1：环境歧义与过期参数

**测试输入**：“请为指定测试地址准备 UI 测试。initialize 返回两个候选环境；我选定 envId 后，同一环境返回 refresh-required。下一步怎么处理？”

**预期**：先用候选真实 ID 消歧；在已授权环境准备范围内显式刷新，成功后对同目标重新 initialize 并复核 preparation；刷新失败、能力缺失或 not-ready 时停止后续执行。不默认选环境、不回退旧值、不使用脱敏占位、不把 configured 当身份就绪。

**依据**：目标正文“先定位，后交接”第 1–2 步。

### P2：明确授权的用例入库

**测试输入**：“本批 UI 用例已生成，明确同意录入已选测试环境所属项目的用例库。原生工具返回了 cases ref，尚未批准设计或执行。请处理入库。”

**预期**：按原生交接规则使用真实 cases ref 和选定环境的项目归属，保留 featureId/版本和逐项入库回执；已有本批授权不重复确认。不因入库提前绑定、登记批准或启动执行；缺真实引用或扩展能力时报告具体缺口。

**依据**：目标正文“按需交接”及 references/native-handoff.md；执行前核对当前真实 schema。

### P3：只读旧批次与待同步缺口

**测试输入**：“只分析原生旧批次 runRef 的结果，暂不回写。同步查询显示 pending 和 stale，报告中有 failed、skipped 与 unknown，证据不完整。请整理结果。”

**预期**：读取原证据并按需 sync-status；保留全部分母、原状态、证据缺口与未知原因。不重新初始化环境、不触发 sync/import/bind/重跑；不把未执行或 unknown 算通过，不把根因推测写成事实。

**依据**：目标正文“按需交接”“结构化结果输出”及 references/result-output.md。

## 后续评估约定

- 独立子 Agent 用于行为对照与只读评委；不允许评委执行写入或业务请求。当前会话内的 Agent 调用与真实业务工具执行分别记录，缺工具就明确受阻，不能把口述计划记为业务 full_test。
- 使用同一输入与上下文条件比较，并记录是否可读取依赖技能；不将历史聊天泄漏给不带技能对照组。模拟工具回执与真实工具执行分开标记。
- paired 输入固定为明确摘要绑定的改前/改后快照；不在提交后用 HEAD 冒充改前版。计票保留原始输出，歧义须请求评委澄清，不能自行翻转票。
- 分数仅用于诊断，不凭涨分保留冗余。Runtime 扫描先判上下文；本项目必要的 Pi/插件依赖不为通用性而删除。
- 本项目的 API/UI 独立审批仍由原生工具控制，Darwin 评委不能替代。无需新增外部付费模型；如后续必须调用宿主付费模型，先取得明确预算授权。
- 未经确认不进入第一项基线，也不修改任何 SKILL.md；确认下一项时复核来源是否变化。

## 本轮证据与收尾

- 已执行：项目路径扫描、ID 去重、14 个正文摘要、UI 安装/分发的逐文件比对；历史报告存在性检查。
- 未执行：九维评分、对照测试、paired 评审、源码修改、重分发、桌面回归和成果卡片。
- 当前仅新增本交接文件，现有技能及 test-prompts.json 保持不变。
- 检查通过：完整 typecheck、lint、协议结构同步、技能相关 3 文件 21 项既有单测及 git diff --check；无 tag 的协议历史启发式单列跳过。这些是扫描文档的保存前检查，不计技能行为验证。
- 开始及交付前 clean 预览通过；clean:junk 限定 .workbuddy/tmp 执行，实际删除 0 项。
- `.workbuddy/tmp` 已有历史棘轮恢复证据，已添加 .cleanup-keep 保护，未删除现有内容。本轮未创建临时脚本。
