# Agent 评估中心 — EC01 仓库基础

当前版本 0.1.0，仅实现统一契约、不可变仓库和工程测试。尚未提供插件运行入口、工具、技能或页面，不要将此目录登记到实际应用；这些入口由 EC02–EC04 接入后统一验收。未调用任何模型或业务执行器。

## 文件与信任边界

- `schema.mjs`：schemaVersion 1、严格字段校验、资源限制、状态转换及脱敏。
- `store.mjs`：`EvaluationStore`，单写者锁、幂等写入、逐域/会话引用校验、分页读取、导出和索引重建。
- `durable.mjs`：临时文件写入、fsync、原子发布及父目录 fsync；故障残片保留。

构造器必须接收可信宿主注入的 `authorize(context)`；返回 `domain={principalId,workspaceId}`、授权 `sessionIds`、`allowWrite`，人工入口另有 `human`，执行事实对账另有 `reconciled`。请求体不能生成这些权限。当前单测用 WeakMap 模拟不可伪造上下文，真实宿主接线仍待 EC02/EC04，不以此宣称实际身份边界已验收。

所有写操作均使用 requestId。授权先于幂等查询；同域同请求/同脱敏输入返回原记录，改变输入返回 VERSION_CONFLICT。请求回执与对象在同一文件发布；回执丢失后原请求查询不会再次创建记录。write 不提供 CLI、网络、运行器或业务写入能力；恢复不会自动启动任何任务。

## 数据契约与读取

磁盘 envelope 为 `{schemaVersion,kind,id,revision,domain,createdAt,data,referenceDigests,redacted,request,digest}`；review 另含可信 reviewer，证据另含 contentRef。`id` 按 kind 分别表示设计中的 taskId/targetId/attemptId/evidenceId/snapshotId/evaluationId/reviewId；`contractRef={kind,id,revision}` 无损编码 taskId/taskRevision，其他对象引用同理。仅仓库内部表示，当前没有新增跨端协议。原始 requestId 和 domain 不进入导出。

数据路径 `<dataDir>/agent-evaluation/`：七类对象目录保存 `<UUID>.<revision>.json`，同域正文以 `blobs/<domain摘要>-<内容SHA256>.blob` 复用。blob 先发布，引用文件后发布，最后更新内存索引。正文没有嵌在每个元数据记录里；`readEvidence` 按字符游标最多 12,000 字符（最坏 UTF-8 48KB）读取，并在返回前验证整个 blob 的摘要与字节数。不同域不共享正文路径；每次读仍校验逐引用权限。

contract/target/attempt 可按 previousRef 新增 revision，陈旧 revision 拒绝写入；快照/报告/人审/证据不允许覆盖。重新执行另建 attempt；只读 get 不创建尝试。referenceDigests 固定每条依赖的摘要，旧引用变动不能被新摘要悄悄接受。哈希证明一致性，不证明第三方自报真实或抵抗全部宿主权限。

资源限制来自 EC00；构造器测试覆盖只能收紧默认限制。引用遍历同时限制 8MiB、1,000 项、2 秒与 64 层；正文单项 1MiB，仓库 256MiB/10,000 元数据记录，导出 2MiB。大导出需选更小范围，不返回半份 manifest。记录/索引不承担任意大型归档。

脱敏识别 credential 字段、Bearer 与已知 token 前缀；原文和请求摘要均不保存识别出的凭据值。无法自动识别任意无标记秘密，调用侧必须遵守不读取个人凭据及最小采集边界。导出是派生包，保留 sourceDigest 并重算派生记录摘要和 manifestDigest，不能用原摘要冒充脱敏字节校验。

## 兼容、恢复与回滚

当前仅 schemaVersion 1，没有旧评估 schema；未来版本原件保留并阻止新写入，不自动迁移。未来规则版本可以产生新 evaluation，旧对象不修改。读模式不会新建仓库或获取写锁；锁竞争拒绝第二写者，不凭 PID 自动回收疑似过期锁。

正常关闭调用 close，仅移除 nonce 仍匹配的本实例锁。异常关闭后，先确认对应宿主/写者已结束，完整备份目录；在新隔离 dataDir 中复制已提交 JSON 与 blobs，保留原备份、锁、临时/损坏文件的审计索引。仅在新副本排除已审计的残片及旧锁，重新打开后只从已提交记录重建索引。遇到损坏/未来版本、未确认写者或不明残片，不继续写入。不得通过按 PID 杀进程、删除旧证据或业务重跑“修复”仓库。

恢复不安装插件、不调用模型、不执行外部任务。无自动历史清理和破坏性迁移；回滚代码用 git revert，数据保留。完整阶段记录见 [EC01](../../docs/agent-evaluation-evidence/EC01.md)。
