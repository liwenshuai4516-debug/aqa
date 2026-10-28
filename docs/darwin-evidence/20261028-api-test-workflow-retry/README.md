# api-test-workflow 重试证据

本目录记录用户“重试”授权后的单次新评估。三票 better/slight，保留 7151-byte 候选；没有新绝对分数。第三项尚未开始。详见 [主报告](../../darwin-api-test-workflow-retry-20261028.md)。

- `manifest.json`、`sources/`：冻结来源、改前／改后全文及原三题；摘要绑定实际版本。
- `inputs/before-p*.json`、`inputs/after-p*.json` 与 `responses/`：六次独立回答，环境和问题一致，仅技能正文及输出路径不同；没有真实业务执行。
- `inputs/judge-*.json`、`judges/`：三次独立匿名配对评估；`blinding-map.json` 解盲，`decision.json` 计票，`results.tsv` 为九列 paired 记录。
- `change.patch`：零上下文差异，重放使用 `git apply --unidiff-zero`，不得对当前工作树重复应用。
- `parameter-check.json`：八项真实进程内参数核对；`sdk-discovery.json`、`workflow-summary.json`、`desktop-result.json` 为真实工程回归摘要。
- `integration-evidence.tar.gz`：211 个工程证据文件；`integration-index.json` 保存归档及逐文件 SHA-256。保留失败、error、unknown 和清理失败原证据。排除依赖、runner 副本、私钥及鉴权配置。
- `test-environment.json`：历史临时路径元数据；`cleanup.json` 记录已移除本轮目录和短路径链接，归档内原绝对路径不再可直接访问。
- `verification.json`：检查命令、结果、范围和清理；`artifact-index.json`：本目录除自身外的逐文件摘要。
- `result-card.html`、`result-card.png`：展示配对结论与局限，不表示真实业务通过。

每版每题一份样本，三评委看同一组样本，不能视作三次独立行为复现。三条原问题原生业务执行 0/3；fixture 回归有 9 次明确模型替身调用和 8 个合成 HTTP 请求。Electron 为隔离的真实桌面回归，未验证用户已有实例已重载。历史回滚证据不变。
