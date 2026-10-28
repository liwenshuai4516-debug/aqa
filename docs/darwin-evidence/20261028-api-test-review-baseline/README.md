# api-test-review 基线证据

本目录对应第三项的当前基线：用户确认继续第三项并复用原三题，技能未修改，优化候选及第四项均未开始。诊断分 68.4/100；当前只允许据此提出首轮方案，保留／回滚将另用三位 paired 评委。

- `manifest.json` 与 `sources/`：开始 HEAD、授权、唯一来源和九份冻结快照。技能2712 bytes，SHA 与当前原文一致；本次150%上限4068 bytes。
- `inputs/` 与 `responses/`：带技能／不带技能各三份新回答。共同条件一致，输入无 expected；回答组不读其他文件、不调业务工具、不继承聊天历史。
- `judge-input.json`、`judge.json`、`blinding-map.json`：独立匿名回答评分及分离的映射；评委不看技能和组别，不修改原始回答。
- `static-assessment.json`、`assessment.json`、`results.tsv`：九维诊断、逐题解盲及九列日志。full_test 仅指真实 Agent 回答层采样；三题原生业务执行0/3，不算业务通过。
- `contract-audit.json`：以当前实现核对公共phase、内部verdict、reason和预算单位；原expected及历史报告不作为权威契约。
- `sdk-discovery.json`：五项真实加载检查；`review-controls.json`：十一项既有评审控制测试，13次明确模型替身调用、零HTTP／业务／真实模型调用。
- `engineering-evidence.tar.gz`、`engineering-index.json`：115份工程原始证据及逐文件SHA。绝对临时路径保留为历史位置，实际目录已清理；归档内保留预期错误、revise和blocked，不全写成pass。
- `verification.json`、`check-outputs.json`、`cleanup.json`：实际检查、输出及本轮清理；`artifact-index.json`为本目录除自身外全部文件摘要。

每题每组一个样本，单个匿名回答评委，不能建立因果或统计置信度。历史报告未重做，不继承其分数、通过率或预算起点。第二项桌面通过不计本项通过；本项候选尚未产生。
