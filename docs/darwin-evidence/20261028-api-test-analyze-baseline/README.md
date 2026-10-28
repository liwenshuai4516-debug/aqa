# api-test-analyze 基线证据

本轮仅做第四项 Phase 1 基线，未创建候选或开始第五项。原三题经用户确认复用。

- `manifest.json`、`sources/`：起始提交、分支、13 份冻结来源及字节／SHA-256。正文未改。
- `inputs/`、`responses/`、`agent-provenance.json`：六次无历史独立回答；两组共享环境和原问题，仅带技能组附正文。输入不含 expected，原始内容不格式化。
- `contract-audit.json`：当前实现事实，用于核对真实参数、回执与边界，不把旧 expected 当实现标准。
- `judge-input.json`、`judge.json`、`blinding-map.json`：匿名输入、原始评分、组别还原；评委不读取映射或主评。A/B 位置随机，每题每组一份样本、一名基线评委。
- `static-assessment.json`、`assessment.json`、`results.tsv`：九维诊断 71.8；D8 来自独立回答评价。绝对分不用于 keep/revert。
- `sdk-output.log`、`sdk-discovery.json`：5 项实际 SDK／宿主加载检查。
- `tracking-output.log`、`tracking-summary.json`：14 项真实宿主／私有 MCP／Newman 合成测试，7 个本机 HTTP 请求、7 次明确模型替身调用、0 真实供应商模型调用。保留预期失败及 unknown，不改为全部运行通过。
- `engineering-evidence.tar.gz`、`engineering-index.json`：隔离 SDK 与问题跟踪输出，不打包依赖；索引含各普通文件 SHA 及归档 SHA。
- `test-environment.json`、`verification.json`、各检查日志、`cleanup.json`：隔离环境、验证范围及仅本轮临时目录的清理结果。
- `artifact-index.json`：除自身外所有交付文件的大小及摘要。

`results.tsv` 的 `full_test` 仅表示六次 Agent 回答生成与评价，不表示真实业务工具执行。原三题业务执行 **0/3**；本项没有真实模型语义、真实业务或 Electron 验收。定时分支调用已登记回调，不表示验证了真实墙钟调度。
