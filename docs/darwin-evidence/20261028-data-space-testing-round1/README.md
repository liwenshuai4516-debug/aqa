# 第一项第一轮原始证据

- `manifest.json`：开始时间、来源摘要、体积和范围。`before/`、`after/` 是含既有未提交规则的完整评审版本；两个参考及校验器没有变化。
- `tracked-before.md` / `tracked-after.md`：已提交正文的同一排版变换，不混入既有工作树规则；`tracked-change.patch` 是排版提交的唯一运行时差异，`worktree-change.patch` 用于核对本机实际变化。
- `after-P*-task.txt` / `after-P*.md`：三个问题的实际复测任务及原始回答。基线旧回答引用上一轮已提交归档，不覆盖历史。
- `judge*-task.txt` / `judge*-input.json` / `judge*.md`：三个新上下文配对评委的任务、匿名完整输入和原票。每位同时读取两版及三场输出；共享参考允许读取范围明确。
- `response-records.json`：Agent 身份、回答摘要、匿名映射；`decision.json` 保留原票映射及保留依据，未将歧义票自行改写。
- `output-validation.json`：父 Agent 对实际 P3 JSON 的结构复核，含原警告，不证明真实证据。
- `desktop-evidence.tar.gz` / `desktop-evidence-index.json`：专项 PASS 的原始结果、截图和测试脚本，以及首次完整回归连接失败的日志、结果和原脚本。第二次版本断言失败见保存前记录；完整回归没有通过。
- `results.tsv`：复制已有基线行并追加本轮 paired 行；实际 prompt 回答与真实工具执行分别记录。
- `verification.json`：工程检查、失败保留与清理结果；`result-card.html/png` 是基于项目已安装 Darwin 模板生成的本地成果卡，无网络字体。
- `artifact-index.json`：本轮归档内所有交付文件的字节数与 SHA-256（索引自身除外）；`cleanup.json` 记录已移除的本轮专用临时项。

仅一轮、每版每场一个回答样本；三个评委均判小幅可读性改善，不能由此宣称稳定行为增益。P2“全部未入库”的过度断言仍保留在原回答中，未改写成理想答案。

归档补丁使用零行上下文，避免上下文空白行触发归档文件的尾随空白检查；重放时使用 `git apply --unidiff-zero`。实际暂存使用等价的三行上下文版本；已提交的正式差异以 `git show 9f6e91c` 为准，完整前后快照均保留。
