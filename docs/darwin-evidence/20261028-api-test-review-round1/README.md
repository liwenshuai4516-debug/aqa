# api-test-review 首轮证据

用户授权只修评审回执后的分流。三位独立paired评委均判改后better/clear，保留3787-byte候选；没有新绝对总分。详见[主报告](../../darwin-api-test-review-round1-20261028.md)。本项等待交付确认，第四项未开始。

- `manifest.json`、`sources/`：开始HEAD、授权、当前契约原件与两版全文；2712→3787 bytes，139.64%，150%上限4068。
- `inputs/before-p*.json`、`inputs/after-p*.json`与`responses/`：六次新的独立回答，条件和三题相同，仅技能正文及输出路径不同；没有expected、修正提示或历史上下文。
- `inputs/judge-*.json`、`judges/`：三次独立匿名配对评估；`blinding-map.json`解盲，`decision.json`保留原始票与计数，`dimension-summary.json`汇总九维，`results.tsv`为九列paired日志。
- `change.patch`：零上下文差异，重放需`git apply --unidiff-zero`；勿对当前工作树重复应用。
- `sdk-discovery.json`、`review-controls.json`、`workflow-summary.json`、`desktop-result.json`：实际工程回归摘要。评审控制13次模型替身调用，fixture工作流9次模型替身调用与8个合成HTTP请求；无真实付费模型和业务请求。
- `integration-evidence.tar.gz`：326个原始工程证据文件；`integration-index.json`保存归档和逐文件SHA，三处隔离安装正文均绑定候选。保留预期失败、错误、unknown及清理失败；排除依赖、runner副本、私钥与个人配置。
- `test-environment.json`：历史临时目录与短路径元数据；目录已清理，绝对路径不再直接可用。`cleanup.json`登记清理计数。
- `verification.json`、`check-outputs.json`：检查与实际输出；`artifact-index.json`包含本目录除自身外全部文件摘要。
- `result-card.html`、`result-card.png`：本轮可视化结论及局限。

每版每题一个样本，三评委评分同一组六份回答，不能建立因果或统计置信度。原三题原生业务执行0/3，真实模型语义未验证。实际Electron原回归10项通过仅限隔离实例，不代表用户旧实例已重载。旧基线68.4仅作诊断；共有预算及停滞判据问题保留，不顺手扩大修订。
