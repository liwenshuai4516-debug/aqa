# data-space-testing 基线原始证据

本目录是只读评估归档，不是运行时技能安装目录；source 下副本不参与项目技能发现。

- `manifest.json`：当前工作树的来源、时间、完整 SHA-256；Git HEAD 并不包含当时全部既有技能修改。
- `source/`：当时正文、两个参考及校验器的原始字节副本。仅复制目标直接依赖，不增加运行时实现。
- `test-prompts.json`、六份 `*-task.txt`：已确认问题及各独立上下文的实际任务，预期在 `judge-input.json` 中。
- 六份 `with-P*.md` / `without-P*.md`：实际回答原文，未经排版或内容修订。
- `agent-records.json`：匿名标签与组别、Agent 身份、回答 SHA-256。无历史聊天 fork，不传评估预期给答题组。
- `judge-task.txt` / `judge-input.json` / `judge.md`：一名新上下文评估者的完整任务、匿名输入及原始结论；评估者仅见预期和回答，不见技能、组别或主评分。
- `assessment.json`：主 Agent 静态评分、原始行为分及权重计算；不作 keep/revert 决策。
- `output-validation.json`：主 Agent 对 with-P3 实际 JSON 使用冻结校验器的复核；不是原生执行或证据真实性检查。
- `results.tsv`：项目内适配的 Darwin 九列记录。`full_test` 严格指实际子 Agent prompt 回答，非工具执行。本轮无原生工具、真实 ID/ref 或业务证据，原生操作 0/3，不能据此认可真实业务效果。
- `verification.json`：本轮保存前检查结果；协议历史启发式跳过单列，未替代业务或桌面验收。

答题组共同获知工具不可用且不得虚构；这会增强两组的诚实阻塞倾向。三个问题偏重异常、授权和只读边界，没有覆盖工具成功路径、真实失败恢复、桌面加载或独立原生报告批准。只有一个样本/场景/组和一个行为评估者，没有统计置信区间。

评委 P2 对默认目录“缺乏独立依据”的提醒来自匿名材料不含完整技能参考；主 Agent 核对 source/references/native-handoff.md 中已有该目录规则。这一提醒不当作技能缺陷；原始分数和优胜判断完整保留。P3 自报结构校验也未直接采信，父 Agent 已另外复核并保存回执。
