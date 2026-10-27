---
name: agent-evaluation
description: 对明确选区的 Pi 任务做证据诊断、耗时与费用核对，查看或重评封存报告，包括人工导入的离线 ATIF 轨迹。可显式运行已登记的固定离线假 CLI；不会启动真实客户端、模型或原业务测试；人工复核仅在 Agent 评估中心界面完成。
metadata:
  display-name: Agent 评估中心
  description-zh: 对任务选区做只读证据诊断，保留来源、未知项和人工复核。
  description-en: Diagnose selected task evidence with provenance, unknowns and separate human reviews.
  plugin-id: agent-evaluation
---

# Agent 评估中心

使用 `agent_evaluation` 工具；不可用时说明需启用同名插件及其工具、刷新当前会话。不要读取私有 session 文件、直接改仓库记录，或用另一套脚本代替评分规则。

1. `describe` 获取当前宿主授权会话的 sessionId、消息 ID、预览与缺口；明确用户选择的起止消息和子任务范围，不能把整个会话自动当一个任务。后续请求带 sessionId，防止选区切换后误用旧状态。
2. 通过 `createContract` 保存 objective、scope、conditions、constraints、environmentRefs、provenance 和 evaluationSubject。模型提出的条件必须 `sourceType:"proposed", required:false`，来源说明用 sourceRef 保留；用户在评估中心“修订目标与条件”确认后，通过 `reviseContract` 产生新修订。修订后显式采集原选区并新封存；这与只复用旧快照的重评不同。未知预期不要写成硬性失败标准。createContract/reviseContract仅支持Pi选区。离线ATIF导入须用户在评估中心点击“导入离线轨迹”，选择UTF-8 JSON、预览并确认来源、文档及评估条件；工具不得代传上传、确认或读取未脱敏原包。离线报告可用既有list/get/readEvidence/export/evaluate查看、导出脱敏副本和重评；不得调用Pi采集/修订/观察流程。真实客户端执行仍未接入。
3. `createAttempt` 引用冻结契约，只附着现有任务观察，不执行任务。`collect` 可选择明确 artifactPaths 和 nativeRefs，二者最多各 20 项；不要扫描凭据或无关文件。`seal` 引用返回的 checkpointRef，得到不可变 snapshotRef。缺原文、缺工具结束、旧批次、临时会话等缺口须保留。
4. `evaluate` 引用封存快照，可带明确规则 configs；或引用既有 evaluation，精确复用其原快照、internal profile 和规则版本，此时不传 configs。旧配置缺失或规则版本不可用时停止，不用当前默认值替代。返回 jobId。刷新或重启后可用 `list(kind:"jobs")` 分页找回当前授权来源的评分作业，再用 `status(jobId)` 查询当前状态；此列表不以持久 queued 回执推断当前状态，也不重放评分。界面对应“查找评分作业”。`status` 查询结果，必要时 `cancel` 只取消评分。成功启动、保存报告和目标通过是不同状态。未完成或重启 unknown 不自动重试原任务。
5. `inspectNativeRun`只读核对授权原生证据对应原件，必须与封存摘要一致；分页返回执行状态与证据完整性，旧批次不证明本次执行。原件缺失/变化时保留封存证据，勿重跑原任务。`list/get/readEvidence/export` 查看记录和来源；`locateEvidence`只为当前授权会话的SDK消息证据返回精确界面消息目标，不执行界面跳转；用户可在评估界面点击“定位当前来源消息”。不可见、其他分支或会话变化时保留封存证据，不猜消息ID或改授权。大记录缩小 limit，正文和脱敏导出用 offset 分页，直到 nextOffset 为 null。导出保留 manifestDigest，分页时不得混接不同 manifest。原证据不可覆写；新材料要新采集/新封存/新报告。

所有请求必须提供唯一 requestId；同一操作失败重试保留原 requestId 和输入，避免重复写。明确重评使用新 requestId，不增加测试、CLI、模型或业务调用。持续观察只可在评估中心详情显式开启：固定原选区、明确子任务及原 F01 文件配置，启动和所选会话运行事件触发采集，不监听文件变更、不扩选新消息。页面可检查/停止并按最新持久检查点生成新报告；关闭视图请求停止，断连则最长60秒未续期停止。工具没有 watch 控制或 review 操作；不得传 human/owner 或冒充人工通过。

F01 仅验证存在/格式/明确 schema/摘要，不能证明全部语义正确；F02 必须有同 attempt 原生执行关联，旧 run 与 SKIP 不计本次通过；F04 只核必要依赖；F05 自由文本留人工；F06 工具失败统计不等于 Agent 责任；F07 仅重复候选，合理轮询与修复后复验不扣分；F08 不把未知费用补零，不把工具区间当全任务时长，不把未观测时间当模型思考。

已绑定规则可在详情“调整规则并生成新报告”用表单修改，复用原snapshot而不采集；用户须确认核验仍代表原条件。新增绑定走“修订目标与条件”：未绑定条件/约束及新增条件可选择已安装的F01/F02/F04/F05/F08，追加新contract revision和观察attempt；多行新增条件共用所选方式。绑定后无具体检查仍无法判断，再从新报告配置检查；不替换既有绑定，不把文字相似当作通过。validateConfiguration仅UI预检，工具不可调用；价格配置不触发模型调用，缺usage仍未知。字段、固定规则配置与可信边界按需阅读 [插件说明](../../README.md)。交付时分列目标状态、行为状态、交付门禁、覆盖率、错误/未知、人工复核及证据；工程夹具通过不得写成真实模型或 Electron 产品验收通过。

## 固定离线诊断（EC06，非真实客户端）

仅在用户明确要求离线执行时使用。`offlineDescribe` 检查管理员已登记的固定后端及有限诊断mode；未登记/宿主缺接口/权限受限即停止，不自行编译、下载或改安装。以已确认的Pi契约为授权锚点，`offlinePrepare(ref:contractRef,data:{argv:[mode,...literalArgs],stdin,timeoutMs,graceMs})` 返回preparing尝试但不启动；argv首项由offlineDescribe列出的固定场景选择，含echo/binary/chunks/waiting/empty/failure和artifacts-*数据核验反例，字符串原样传入、不是shell命令；stdin是UTF-8文本，最多64KiB；argv最多16项/合计8192字节；timeoutMs 1000–30000、graceMs 50–2000。不要传后端路径、env、human、owner、allowExecution或reconciled。准备与启动分别需要显式请求；`offlineStart(ref:attemptRef)` 才启动固定无网VM。

`list(kind:"offlineAttempts")` 查询当前授权来源的持久尝试修订，列表状态是保存时的值；`offlineStatus(ref)`才查询当前状态并追加实际观察修订。重启/刷新后只查询原尝试，不重放start；unknown/interrupted要显式`offlineReconcile`，仍未知则保留句柄及占用门禁。`offlineCancel` 请求取消，stopConfirmed:false不当停止成功；waiting-input仅目标自报，无交互答复通道，按原超时或显式取消收尾，不自动补输入。`offlineSeal`仅在停止确认后冻结完整约定产物（含新增、删除、未跟踪和.ignored），并在独立受限进程执行固定可信数据核验，封存原日志、清单、摘要与核验结果；`offlineCleanup`先封存再释放占用，失败保留证据。之后可用原`evaluate`对snapshot评分，F09消费匹配冻结产物的offline-json@1结果；产物fail与verifier error分别记录，错误时未知。拒绝链接、特殊文件与超限产物；只检查固定JSON数据，不执行产物代码。旧登记无产物能力时保留缺口与目标未知。核验启动后控制端崩溃不自动重发。评分cancel/status与offlineCancel/offlineStatus不是同一作业。

产品页在Pi报告详情点击“固定离线诊断”；记录页“查找离线尝试”可回到已保存尝试。只读、计划/委派/目标审查、受限预设、插件/工具禁用会拒绝执行控制；禁用/重载会保存取消请求，不自动恢复启动。环境停止、exit0、最终文本都不代表业务成功；当前无产物采集/独立验证器，不宣称EC06完整验收或支持任意CLI。
