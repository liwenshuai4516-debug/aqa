# api-test-workflow 基线原始证据

仅 Phase 1，未修改技能。正文 SHA-256 `585b8d6a27b63ccec10e2cc71d32f313da670794709bd10caf09a2a471e5cb71`，6458 bytes。回答层 6 次实际独立 Agent 运行，真实业务操作 0/3。

| 文件                                          | 内容                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `manifest.json`、`sources/`                   | 冻结来源、原始字节、SHA、当时 HEAD 和工具可用性。                    |
| `inputs/with-p1.json` 至 `with-p3.json`       | 技能组实际输入，含公共约束、原测试问题、完整技能正文；无 expected。  |
| `inputs/without-p1.json` 至 `without-p3.json` | 对照组相同公共约束及问题，无技能或 expected。                        |
| `responses/`                                  | 六份原始回答；不格式化或修复其内容。                                 |
| `judge-input.json`                            | 标签匿名回答、共同条件及核实的契约事实，不含组别、技能正文或主评分。 |
| `judge.json`                                  | 独立行为评估者原始判断，未改票。                                     |
| `blinding-map.json`                           | A/B 到回答组别映射与原始回答 SHA。                                   |
| `static-assessment.json`                      | 主 Agent 静态维度原始诊断，先于行为评估结果汇总。                    |
| `contract-audit.json`                         | 源码参数与状态契约、runtime 扫描及路径核对；不是运行时回执。         |
| `assessment.json`、`results.tsv`              | 原始分数计算与标签还原；分数仅作诊断，非优化增益或通过率。           |
| `verification.json`                           | 格式、工程检查、归档完整性与清理记录。                               |
| `artifact-index.json`                         | 除索引自身外的归档文件 SHA。                                         |

`sdk-discovery.json` 保存既有隔离发现测试的原始结果，`cleanup.json` 保存本轮测试目录清理计数；这两项不是桌面或业务验收。

P1 标签 A=不带、B=带；P2 A=带、B=不带；P3 A=不带、B=带。评委三场原始优胜标签均为 B，因此真实结论是技能组两胜、对照组一胜，而非技能组三胜。

每组每题只有一个样本，一位行为评估者；技能正文可能从回答风格中被推测。公共条件限制了真实工具和文件读取，两组均容易选择诚实阻塞。`full_test` 只记实际 Agent 回答，不能解读为 API 端到端测试通过。宿主付费模型与业务请求为零，七个评估 Agent 调用另计。原始样本错误保留，解读见主报告。
