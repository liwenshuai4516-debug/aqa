# api-test-workflow 第一轮证据（回滚）

结论：0 better / 2 worse / 1 tie；候选不保留，原文恢复，未开始下一轮或下一项。新绝对总分未计算，基线 78.0 仅供诊断。

| 文件                                                               | 内容                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `manifest.json`、`sources/`                                        | 改前、候选原始字节及已确认问题、必要源码契约快照。                              |
| `change.patch`                                                     | 仅两段新增的零上下文补丁；重放需 `git apply --unidiff-zero`，当前未应用。       |
| `inputs/after-p*.json`、`responses/after-p*.md`                    | 三次独立复测的完整任务和未经修复的原始回答，无 expected。                       |
| `inputs/judge-*.json`、`judges/judge-*.json`                       | 三个评委各自一次调用读取两版全文及对应样本；原始判断不改票。                    |
| `blinding-map.json`、`decision.json`                               | 匿名版本映射、还原计票、恢复摘要及停止依据。                                    |
| `parameter-check.json`                                             | 真实编译器四项静态参数检查；无请求或模型调用。                                  |
| `sdk-discovery.json`、`workflow-summary.json`                      | 候选的既有工程检查原始摘要，后者明确为模型替身／合成 fixture。                  |
| `desktop-result.json`                                              | 真实 Electron 回归的页面连接前置失败，登记断言未执行。                          |
| `integration-evidence.tar.gz`、`integration-index.json`            | 204 份原始 fixture／桌面证据与 SHA；依赖、runner 代码副本、私钥和认证配置排除。 |
| `results.tsv`、`verification.json`                                 | 棘轮记录、检查范围与清理结果。                                                  |
| `result-card.html`、`result-card.png`、`result-card-metadata.json` | 如实展示回滚与未验证范围的结果卡，不声称涨分。                                  |
| `artifact-index.json`                                              | 除自身外的归档文件 SHA。                                                        |

改前回答沿用 [基线原始样本](../20261028-api-test-workflow-baseline/responses/)，评委实际输入也嵌有它们，摘要可独立复核。每版每题一个样本；评委一致看到相同六份回答，不构成行为错误的三次复现，更不能证明改动与错误的因果关系。

原始 P1 的“可提交空 cases”错误保留，不能替它修正后再计算通过。工程检查不等于 Agent 行为通过，也不改变两票不利、一票持平的整体裁断。原始文本、输入、评委及机器回执不格式化；说明文档和结果卡可格式化。
