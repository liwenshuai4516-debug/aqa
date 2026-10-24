# Agent 评估中心

当前版本0.4.4，已实现统一契约、受控源读取、证据采集、七条基础规则、两页诊断、人工复核、脱敏导出，以及原快照重评和目标/条件修订入口。EC04/M1仍在进行：采集性能门禁未过，持续观察、规则配置与原生结果导航等产品路径仍有缺口，不代表M1已交付。评估模块不调用模型、原业务执行器或真实外部CLI。

应用登记使用`scripts/enable-agent-evaluation.mjs --agent-dir <明确目录> --data-dir <明确目录>`，先隔离验证；不覆盖其他安装，不默认改个人目录。真实Electron阶段证据见[EC04](../../docs/agent-evaluation-evidence/EC04.md)。

## 文件与信任边界

- `schema.mjs`：schemaVersion 1、严格字段校验、资源限制、状态转换及脱敏。
- `store.mjs`：`EvaluationStore`，单写者锁、幂等写入、逐域/会话引用校验、分页读取、导出和索引重建。
- `durable.mjs`：临时文件写入、fsync、原子发布及父目录 fsync；故障残片保留。
- `collect.mjs` / `adapters/pi.mjs`：受控选区采集、来源去重/冲突、显式子任务、原生产物只读复核、checkpoint 与不可变封存。

构造器必须接收可信宿主注入的 `authorize(context)`；返回 `domain={principalId,workspaceId}`、授权 `sessionIds`、`allowWrite`，人工入口另有 `human`，执行事实对账另有 `reconciled`。请求体不能生成这些权限。当前单测用 WeakMap 模拟不可伪造上下文，EC02 已在隔离真实 PluginManager/SDK 中验证可信 sender 与逐会话接线；服务与产品入口在EC04接线，并已在独立目录的真实Electron验证；未覆盖项保留于逐项验收表。

所有写操作均使用 requestId。授权先于幂等查询；同域同请求/同脱敏输入返回原记录，改变输入返回 VERSION_CONFLICT。请求回执与对象在同一文件发布；回执丢失后原请求查询不会再次创建记录。write 不提供 CLI、网络、运行器或业务写入能力；恢复不会自动启动任何任务。

## 数据契约与读取

磁盘 envelope 为 `{schemaVersion,kind,id,revision,domain,createdAt,data,referenceDigests,redacted,request,digest}`；review 另含可信 reviewer，证据另含 contentRef。`id` 按 kind 分别表示设计中的 taskId/targetId/attemptId/evidenceId/snapshotId/evaluationId/reviewId；`contractRef={kind,id,revision}` 无损编码 taskId/taskRevision，其他对象引用同理。仅仓库内部表示，跨端类型统一在 server/protocol.ts，消息继续复用插件通道；协议 v33 未变。原始 requestId 和 domain 不进入导出。

数据路径 `<dataDir>/agent-evaluation/`：七类对象目录保存 `<UUID>.<revision>.json`，同域正文以 `blobs/<domain摘要>-<内容SHA256>.blob` 复用。blob 先发布，引用文件后发布，最后更新内存索引。正文没有嵌在每个元数据记录里；`readEvidence` 按字符游标最多 12,000 字符（最坏 UTF-8 48KB）读取，并在返回前验证整个 blob 的摘要与字节数。不同域不共享正文路径；每次读仍校验逐引用权限。

contract/target/attempt 可按 previousRef 新增 revision，陈旧 revision 拒绝写入；快照/报告/人审/证据不允许覆盖。重新执行另建 attempt；只读 get 不创建尝试。referenceDigests 固定每条依赖的摘要，旧引用变动不能被新摘要悄悄接受。哈希证明一致性，不证明第三方自报真实或抵抗全部宿主权限。

资源限制来自 EC00；构造器测试覆盖只能收紧默认限制。引用遍历分别限制1,000证据项与1,000授权元数据项，共用8MiB、2秒与64层；正文单项 1MiB，仓库 256MiB/10,000 元数据记录，导出 2MiB。大导出需选更小范围，不返回半份 manifest。记录/索引不承担任意大型归档。

脱敏识别 credential 字段、Bearer 与已知 token 前缀；原文和请求摘要均不保存识别出的凭据值。无法自动识别任意无标记秘密，调用侧必须遵守不读取个人凭据及最小采集边界。导出是派生包，保留 sourceDigest 并重算派生记录摘要和 manifestDigest，不能用原摘要冒充脱敏字节校验。

## 兼容、恢复与回滚

当前仅 schemaVersion 1，没有旧评估 schema；未来版本原件保留并阻止新写入，不自动迁移。未来规则版本可以产生新 evaluation，旧对象不修改。读模式不会新建仓库或获取写锁；锁竞争拒绝第二写者，不凭 PID 自动回收疑似过期锁。

正常关闭调用 close，仅移除 nonce 仍匹配的本实例锁。异常关闭后，先确认对应宿主/写者已结束，完整备份目录；在新隔离 dataDir 中复制已提交 JSON 与 blobs，保留原备份、锁、临时/损坏文件的审计索引。仅在新副本排除已审计的残片及旧锁，重新打开后只从已提交记录重建索引。遇到损坏/未来版本、未确认写者或不明残片，不继续写入。不得通过按 PID 杀进程、删除旧证据或业务重跑“修复”仓库。

恢复不安装插件、不调用模型、不执行外部任务。无自动历史清理和破坏性迁移；回滚代码用 git revert，数据保留。完整阶段记录见 [EC01](../../docs/agent-evaluation-evidence/EC01.md)。

## EC02 采集边界

宿主 `readEvaluationEvidence(clientId, query)` 只能由可信 sender/tool context 给出 clientId；拒绝未知客户端/会话，无全局快照回退。固定 SDK entry ID 选区，不打开调用方任意路径。`describe` 只给当前分支最近窗口及明确缺口，`collect` 在完整验证边界后分页，单次上限 1,000 条/8MiB/2秒；超大单项标不可用，不用预览冒充正文。隐藏思考、签名、图片和私有内容不采集。

`EvidenceCollector.collect` 的 `liveEvents` 仅由可信宿主 watch 注入，产品入口不得透传请求体里的事件。事件只接纳已选 SDK 工具调用的元数据，不保存实时参数/结果预览；sourceEventId 与 sourceRevision 去重，冲突双方保留。旧 duration 保留墙钟来源和不确定性；新宿主事件额外记录进程 clockEpoch 与 performance.now 单调时刻，F08 只在同 epoch 配对计时，负值/缺失为未知；不推算思考时长、不补造单调计时。实时观察没有历史回填保证，中途启用缺少开始事件会标 gap。显式子任务按独立 attempt 关联，可读取嵌套 subagent；普通派生会话不自动纳入。

证据落盘后才发布 checkpoint，失败重试复用已持久记录；seal 只接受 durable checkpoint。watch 仅显式开启、队列最多 1,000，故障回调与业务隔离，停止/取消后的迟到回调不发布结果。`readEvaluationNative` 从已授权会话取得真实工作区，复用 TestAssetReader，保留原 run 时间/哈希与读时点；不执行测试，不因此证明原 run 属于本次任务。该判断由 EC03 的快照规则完成。

工程结果与源覆盖见 [EC02](../../docs/agent-evaluation-evidence/EC02.md)。

## EC03 评分与基础规则

`registry.mjs` 仅注册可信发布代码中的 adapter/evaluator/profile，版本精确引用，批量注册原子校验重复、依赖环、任务类型和配置。配置 schema 支持明确的有界 JSON Schema 子集；拒绝外部引用和未知关键字，不执行上传代码。profile 的 `required` 表示必须成功处理的评分器；不把它当作额外业务验收条件，缺失只使交付待核验。

`evaluate.mjs` 只消费授权封存快照，规则收到冻结契约/视图/配置及 AbortSignal，不收到 host/store/runner。队列与运行/取消请求有持久事件；同请求不重复评分，中断后状态未知且不自动重跑。显式新请求可以对同快照重评，新报告保留 profile 配置和版本；不增加 attempt，不触发采集或业务执行。取消代次隔离迟到返回，单规则异常/超时为 inconclusive，独立规则继续。全局读取或报告落盘失败不能成为 completed。

同进程可信 JavaScript 不是恶意代码沙箱：异步超时可中止等待，同步代码不能被计时器抢占；同步迟到结果会被拒绝，不能宣称 CPU 硬隔离。`aggregate.mjs` 分别计算目标、约束和交付门禁，保留已知失败与未知，建议项不成为硬性目标条件。报告附判定覆盖率和确定项通过率，零分母为 null。schemaVersion 1 仅增加可选字段，旧报告仍可读取。

`profiles/internal.mjs` 注册 F01/F02/F04/F05/F06/F07/F08 的固定 v1 规则。`internalProfile(configs, {id, version})` 显式冻结每条规则配置；checks 默认为空，不能从 Agent 输出自动创造用户要求。新增纯规则只需实现 manifest/evaluate、注册并测试，无须修改评分引擎。

| 规则 | 配置与证据                                                                                | 判断边界                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| F01  | `checks[{conditionId,path,format?,sha256?,jsonSchema?}]`；artifact-snapshot               | 存在/格式/明确 schema/摘要，不等于语义正确；不完整正文不能验证格式或摘要                                         |
| F02  | `checks[{conditionId,runId,caseIds?}]`；原生 run + 同 attempt 宿主派生执行引用            | 旧批次、查询、取消、SKIP 或缺关联均不能冒充本轮通过                                                              |
| F04  | `checks[{conditionId,prerequisiteToolCallId,dependentToolCallId}]`                        | 仅核必要依赖；失败后停止可通过，独立诊断不受阻；成功先后用 SDK parent 链                                         |
| F05  | `checks[{conditionId,claimEvidenceId,claimPath,basisEvidenceId,basisPath,expectedValue}]` | 仅结构化 boolean 声明与独立事实比较；自由文本留人工；路径使用 JSON Pointer                                       |
| F06  | `{}`                                                                                      | 去重调用状态分布，不将工具失败自动归咎 Agent                                                                     |
| F07  | `{pollingToolNames,repairToolNames}`                                                      | 重复候选；已知轮询/成功修复边界排除，不硬扣分，未知意图待人审                                                    |
| F08  | `{prices,childWaitToolNames,checks}`                                                      | 同 epoch 区间并集与累计工作量分列；缺整段 span 不能证明总耗时上限通过；usage 按调用去重，真实/估算/币种/阶段分账 |

`readEvaluationArtifact(clientId,{conversationId,sessionId,path})` 在宿主端绑定所属工作区，仅允许显式相对路径和普通文件，最多 1MiB；拒绝符号链接、越界与已知凭据文件，读取前后核对文件身份。JSON secret 字段与既有凭据模式脱敏，派生摘要不得冒充原字节。collector 最多选 20 个文件；文件快照注明读取时点，不反推历史存在。元数据完整与文件正文完整分开记录。API 使用现有 tools 权限与严格会话身份；不是任意文件读取入口，也不是对恶意宿主进程的 OS 沙箱。

F08 的 SDK usage 只有明确版本价格表才能估算；SDK 自报 cost 没价格版本时单独保留且不计价，不假定币种或补零。模型思考时长始终不从未观测时间推断。当前评分作业自身的单调耗时单列在 `report.job.elapsedMs`，原任务与评分阶段不混计。

插件版本 0.4.0；基础规则验证见 [EC03](../../docs/agent-evaluation-evidence/EC03.md)。EC04 页面/接入工程进行中，性能门禁尚未通过，不声明 M1 完成。

## EC04 产品入口（阶段实现）

`index.mjs` 通过原 plugin_message / 宿主工具上下文接 `service.mjs`，提供有界诊断操作；`client/{entry,transport,i18n,style}.mjs` 为记录/详情两页。当前明确选取最近窗口内的消息，支持文件存在/JSON 检查、证据分页、追加人审和脱敏导出。普通文字条件保留人工待判，原任务执行状态未知不补结束。

唯一技能位于 `skills/agent-evaluation/SKILL.md`；项目 `.pi/skills/agent-evaluation/` 仅引用原实现。使用 `npm run agent-evaluation:enable -- --agent-dir <明确 agentDir> --data-dir <明确 dataDir>` 登记，不覆盖其他安装，不改变既有禁用选择。没有打包 bundle，不引入客户端构建依赖；正式共享目录未发布新版本，不能靠旧 marketplace 源声称可安装。

人工 review 仅可信 UI 通道；工具定义受执行侧门禁约束。分页投影使用 sourceDigest，导出附可验证派生 digest/manifestDigest，包含报告关联的独立 reviews。写超时重试保持请求身份；关闭视图不终止原任务，卸载插件清理监听并收尾评分。详细通过项、失败原件与剩余门禁见 [EC04](../../docs/agent-evaluation-evidence/EC04.md)。

## EC04：修订与重评

详情页“按原快照重新评分”调用`evaluate(ref=evaluation)`，恢复该报告的internal profile标识、精确规则版本和配置，不采集新证据、不创建attempt；旧报告与人工复核保持原记录。只支持能无损恢复的完整internal v1 profile；缺配置、配置摘要不符、profile冲突或旧规则未安装时拒绝，不猜测默认值。原`evaluate(ref=snapshot, configs=...)`仍可用，表示明确选择配置的新评分。

“修订目标与条件”先读齐分页契约，再追加同一契约的新revision并附着新观察attempt；保持原消息/子任务边界和环境引用，重新采集指定文件，生成新snapshot/evaluation。绑定核验规则的条件文字只读，核验方式不会因改写文字改变；可确认必须项、修改文字条件和新增需人工复核的文字条件。已有profile配置继续用于新诊断；额外手工原生引用没有自动重放，源内可验证的原生关联仍由collector发现，缺证据按规则保留未知。

保存中途失败时保留表单和已确认步骤，同输入重试复用requestId；原选区变更或契约revision陈旧由服务端拒绝。当前表单不能删除/重排既有条件或编辑绑定规则配置，相关配置产品入口仍待后续EC04接线。
