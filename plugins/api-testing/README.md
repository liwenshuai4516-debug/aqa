# 接口测试插件：P3-2 / 手动 HTTP 目标接入

当前提供自包含 HTTP fixture 的导入、独立评审、受控执行、问题记录、复测与报告入口。macOS 已接入 OS 文件/端口限制及固定 HTTP IPv4 转发；默认只运行 fixture，可由宿主显式配置单个手动目标；用户业务验收仍缺鉴权/数据与成功/清理映射；已支持跨重启的整包持久化与重跑，已支持最小管理列表及仅限匿名 fixture 的宿主定时调度。

## 实现与权限

- `index.mjs`：唯一可见工具 `api_test_execute`，权限 `tools`、`llm`。底层 `runApprovedSuite` 不进入模型工具注册表或个人 MCP 配置。
- `runner.mjs`：专属 stdio MCP server，复用固定 Postman MCP 执行模块与 Newman，跳过云端获取/上传；每进程仅一次执行。`package-lock.json` 固定全部依赖，与 P0-1 版本相同。
- `network-guard.cjs`：只允许本次 loopback fixture 端口的诊断钩子，**不是沙箱**。不可用来批准真实网络目标或不受信任脚本。
- `server/api-testing-runner.ts`：受信宿主 API `approveFixture` 手工冻结集合与评审 hash、调用者和 runner 字节，再生成一次性引用。模型/插件没有签发批准的 API；P0 的重启会丢弃内存批准，不能恢复未知请求。
- 执行前保存 run 身份；HOME/TMPDIR/输入为 run 专属目录，清空继承环境。结果按 fixture 字段白名单投影；取消保留 unknown，不承诺业务回滚。
- 会话身份由 pi 的工具适配器注入第五个参数，跨会话/项目、失效上下文、计划/委派模式、工具关闭和插件停用均拒绝或取消。切换前台会话不会改变原 run 的归属。其他未提供该上下文的引擎明确拒绝。

插件为开发中的本地包，未上市场，不自动安装到个人通用配置目录；应用级接入见文末。工作流只有宿主独立评审通过后才能签发执行引用；模型不能导入 pass 标签绕过评审。

## 隔离验证

仓库根安装好开发依赖后，准备独立执行器依赖（不写入个人配置）：

```sh
mkdir -p tests/scratch/api-testing-p0-1/reproduce
cp tests/fixtures/api-testing-p0/package.json tests/fixtures/api-testing-p0/package-lock.json tests/scratch/api-testing-p0-1/reproduce/
npm ci --prefix tests/scratch/api-testing-p0-1/reproduce --ignore-scripts --no-audit --no-fund
node --import tsx tests/api-testing-controlled-test.mjs tests/scratch/api-testing-p0-1/reproduce
```

测试复制本插件到临时 data-dir，调用真实宿主适配器、私有 MCP 和 Newman；不调用模型或真实业务。验收与剩余范围见 [P0-2 证据](../../docs/api-testing-evidence/P0-2.md)。

## P1-1 导入与编译模块

`suite.mjs` 导出 `importContract`、`designCandidates`、`compileSuite`、`saveDraft`，供后续工作流组合。候选仅是待补输入的纲要；确定性编译保留契约/规则依据，固定模板拒绝任意 JS。输出为带文件 hash 的 draft，review 为 pending，不取得执行权限。模块经下述受控工作流接线；prepare 仍仅生成 draft。

支持矩阵、未覆盖关键字、源码净化限制、负向规则和复现见 [P1-1 验收](../../docs/api-testing-evidence/P1-1.md)。依赖新增固定 Swagger Parser 13.1.0 和 Ajv 8.17.1；均安装于隔离 runtime，未改项目根依赖或个人配置。

## P1-2 独立评审模块

`review.mjs` 在文件/hash 与确定性重编译检查后，通过传入的 `host.llm.complete` 做独立无工具评审；所有轮次共享调用/时间预算，批准绑定实际集合及包内内容 hash。模块返回评审结果，尚无面向模型的批准签发 API。

[工程验收](../../docs/api-testing-evidence/P1-2.md)使用明确模型替身验证控制分支；该早期记录没有执行实际模型；后续 P1-4 已补实际 GPT 验收。宿主没有模型 AbortSignal，超时只保证模块停止后续步骤，不承诺供应商调用已经结束。

## P1-3 受控工作流

同一工具 `api_test_execute` 接受 `action`：

- `prepare`：提供项目内 `sourcePath`、1–3 条 `cases`、`operationIds`、显式 loopback `baseUrl` 和新 `outputPath`，返回工作流 `runRef` 与证据目录。
- `review`：使用 `runRef`，可指定获准模型；通过宿主 `llm.complete` 权限及模型范围校验。
- `revise`：仅修改用例到新 `outputPath`，必须重新评审；最多两次。
- `run` / `retest`：仅批准后执行；复测指定 `priorRunId`。未知写入阻塞继续发送请求。
- `report`：回看结果，可选 `runId`；不请求接口或调用模型。

所有 action 绑定项目/原会话与总体预算（180 秒、3 次评审调用）；重启不恢复内存工作流。不要通过重建工作流规避预算。不可变草稿及批准副本、每次运行身份、结果、问题与 Markdown/JSON 报告保存在项目目录。修改套件版本不自动关闭旧版本问题，分类是确定性线索，不等于已确认业务根因。响应原文和断言实际值不落盘。

复现：[P1-1](../../docs/api-testing-evidence/P1-1.md) 准备隔离依赖，然后运行 `node --import tsx tests/api-testing-workflow-test.mjs tests/scratch/api-testing-p1-1/runtime`。17 项工程验收及限制见 [P1-3](../../docs/api-testing-evidence/P1-3.md)。后续 P1-4 已补实际模型工程验收；真实业务未验收。

## P1-4 技能分发与接入条件

功能包内 `skills/` 包含 `api-test-workflow`、`api-test-review`、`api-test-analyze` 三个独立按需技能。仅安装插件不会自动扫描它的 skills 目录；在目标项目明确选择这三项目录，复制到该项目 `.pi/skills/`（保留同名目录结构，已有同名技能先核对，不覆盖），再刷新技能/会话目录。也可由 SDK 的显式 skillPaths 指向包内 skills 目录。不安装到个人全局目录。

`node --import tsx tests/api-testing-skills-test.mjs` 将分发目录复制到临时项目，使用空 agentDir 验证真实 SDK 默认发现、宿主 skill 工具加载及禁用过滤。技能均小于 8192 bytes；它们不能替代宿主权限、评审与执行硬门禁。

已复用系统配置的 GPT 完成实际生成/独立评审及真实 MCP fixture 验收，不要求额外专用配置。可写测试环境已登记，已接入 macOS fixture OS 隔离，固定 HTTP IPv4 转发已验收，业务数据/鉴权及成功/清理映射尚未接入。完整清单及恢复条件见 [P1-4](../../docs/api-testing-evidence/P1-4.md)；不得把技能发现通过算成主流程业务验收。

## P2-1 持久化与零模型复用

独立评审批准时自动发布完整不可变套件到 `<dataDir>/api-testing/assets/<projectHash>/suites/<assetRef>/`，并返回 `assetRef`。P1 运行的报告与证据会复制到该根的 runs；保留项目内原件。持久目录位于可卸载插件目录之外，不删除历史。

同一工具新增 `asset_inspect`（assetRef）、`asset_run`（assetRef，可选同版本 priorRunId）、`asset_report`（runId）、`asset_import`（项目内 sourcePath）。回看/成功重跑不依赖原会话内存，也不调用模型；每次重跑新建 run 身份。项目绑定服务端真实路径，不能通过外来 assetRef 跨项目执行。

`asset_import` 只复用已由宿主真实发布的精确 P1 包；未登记的历史包或外部 pass 标签须先用 prepare/review 重新独立评审，原件不覆盖。版本变化、编译/评审/执行器或依赖锁变化会使旧批准失效。半写包和文件 hash 不符拒绝执行；索引仅派生，损坏可重建。

资产根只允许一个写入者。正常服务退出释放所有权；非正常中断留下的所有权需操作人员确认旧进程和请求已结束后处理，期间只读历史仍可查，不自动恢复写请求。unknown 写入即使重启也阻止项目后续请求，不能通过新建 run 清除。未证明断电 fsync 或跨平台可靠性；只在 macOS fixture 验证。详见 [P2-1](../../docs/api-testing-evidence/P2-1.md)。

## P2-2 最小管理

同一工具增加 `asset_list`（offset，固定每页 20 项）、`asset_clone`（assetRef、项目内新 outputPath、可选 cases）、`asset_archive`（assetRef、显式 archived 布尔）、`asset_delete`（仅归档且无运行/计划引用）、`asset_export`（项目内新 outputPath）、`asset_restore`（项目内备份 sourcePath）。列表复用现有工具卡片的 Markdown 与 bounded details，提供空状态与不可用标识，不新建独立工作台或浏览器入口。

克隆只生成待评审文件，后续 prepare 指向其 source.json 并独立评审；不能继承批准。归档同时阻止 P1 会话入口和持久重跑。已有运行或计划引用的版本拒绝删除。

备份为整包套件/运行/归档状态与 hash，最后发布 backup.json。宿主私有 HMAC key 不导出，恢复必须同宿主、同项目真实路径和同执行策略；同 ID 异内容拒绝覆盖。原件/重复恢复均保留；异宿主或整个宿主密钥丢失时重新导入草稿并独立评审，不把 pass 标签当可移植授权。备份上限 600 文件/16 MiB，敏感原始响应和凭据不进入备份。详见 [P2-2](../../docs/api-testing-evidence/P2-2.md)。

## P3-1 宿主定时执行

`api_test_execute` 增加 `schedule_create`（assetRef、intervalMs ≥60000、authorizationExpiresAt 为未来七天内）、`schedule_list`、`schedule_stop`（scheduleId）。仅固定宿主项目、已批准且人工同版本通过的匿名 loopback fixture；不接受真实目标、凭据参数或真实无人值守授权。服务必须持续运行，不承诺桌面关闭后继续执行。

授权绑定版本、环境与本地时区，独立于聊天；宿主直接调用同一 asset_run 入口。业务定义先原子保存，宿主声明严格落盘后才启用。计划 UTC 时间先登记 claim；重复、重叠和漏跑跳过，运行中撤权/过期会取消该次请求。后台 Stop 同步持久暂停，重启不复活；正常反激活保留启用声明，重启不补跑。声明不符、时区变化、授权过期、未知运行/写入或残留 claim 均阻止继续自动发送。

单实例所有权残留仍须人工核对，不自动抢锁或重放。仅提供毫秒间隔；复用宿主五字段 cron 的到点修复与分片，不扩展计划级 cron/时区配置。本期没有真实凭据接入，因此没有声称完成真实凭据过期验收。证据见 [P3-1](../../docs/api-testing-evidence/P3-1.md)。

## P3-2 持续问题跟踪

持久 asset_run 默认关联最新同版本报告，也可显式 priorRunId；问题 ID、首次失败和每次新证据保留，不自动跨版本关闭问题。每次请求均有新原始报告。人工重跑默认只做确定性统计；`asset_analyze`（runId，可选 model）只追加分析修订，每次最多一调用/20秒、每 run 最多三尝试；`asset_report` 同时回看原始报告和分析修订，无请求或模型调用。

定时新/变化异常最多自动分析一次；已知重复失败不重调模型、不重复提示，恢复时给站内提示。模型只收到裁剪后的问题 ID、类别、断言名、状态码与 JSON 有效性，没有正文、凭据或任意请求权限。分析失败不重跑接口；假设不能确认根因或改写测试结论，不自动生成新套件。无外部消息或缺陷平台写入。

分析保存 pending 预算认领、不可变 JSON/Markdown 修订及完成 hash manifest；原始结果不修改。中断尝试占额度，显式重分析不能无限重试。备份包含关联分析和 followup，恢复仍受同宿主签名/冲突规则限制。宿主模型接口未提供底层取消，20 秒本地退出不承诺供应商已停止计算。详见 [P3-2](../../docs/api-testing-evidence/P3-2.md)。

## 宿主 OS 边界补验（2026-10-22）

受控执行仅支持已验证的 macOS sandbox-exec，缺少该能力或其他平台均拒绝执行，无非隔离降级。读取限系统/依赖白名单和本 run，写入限本 run（及 /dev/null），网络限批准的 localhost 端口；仍非任意恶意原生代码沙箱。限制策略纳入资产指纹，旧批准须重新评审。真实业务和无人值守任务未开放；[接入证据](../../docs/api-testing-evidence/isolation-host.md)。

## 手动配置目标（0.4.0）

启动宿主前设置 `PI_API_TEST_HTTP_TARGET` 为一个不带路径、用户名、密码或尾部斜杠的 HTTP 数值 IPv4 origin（例如 `http://192.0.2.1:8238`）。这是占位示例地址，不是本机实际配置。目标绑定启动时的项目根，模型只能选择该目标或原有本机 fixture，不能配置新目标；默认空值继续阻塞远端。无 DNS/TLS 或真实无人值守授权；未修改个人配置或持久启用真实业务目标。专用测试 token 引用见下节。

原获批集合不改写；宿主为每个 run 建立固定目标 TCP relay，将执行副本映射到唯一的本机端口，保留原 Host。`transport.json` 记录逻辑目标、有效地址、原集合及执行副本 hash；配置/策略进入持久资产指纹。取消/撤权关闭本 run 的 relay、上下游连接与专属进程；未知请求不重发。配置目标即使指向 loopback 也不能创建或恢复定时任务。见 [接线验收](../../docs/api-testing-evidence/target-host.md)。

## 专用测试凭据引用（0.4.1）

可在启动宿主时配置 `PI_API_TEST_TOKEN_FILE`，其文件权限、绑定字段和到期规则见 [环境变量](../../docs/env-vars.md)。仅支持当前业务的 `token` 请求头：宿主通过私有 MCP 管道交付，在执行内存添加，原批准集合及文件证据不包含值。过期、文件改变或撤销会停止当前执行；显式下次执行才能读取轮换后的 token。不要把凭据传给模型或工具参数。

19 项合成验证通过；未取得真实专用凭据。实际测试环境已执行一次无凭据的只读列表诊断，HTTP 200/JSON，4 条断言失败 2 条，不能记为业务验收通过。见 [凭据记录](../../docs/api-testing-evidence/credential-host.md) 和 [只读诊断](../../docs/api-testing-evidence/business-readonly-summary.json)。

## 在应用中管理和快捷调用

先安装固定依赖：`npm ci --ignore-scripts --prefix plugins/api-testing`。仅项目技能目录不足以让其他工作区中的桌面应用可见；需要向实际运行的 Pi agent 配置登记技能，并向宿主 dataDir 安装插件：

```sh
npm run api-testing:enable -- --agent-dir "$HOME/Library/Application Support/Pi Agent Desktop/agent" --data-dir "$HOME/Library/Application Support/Pi Agent Desktop/data"
```

上例是 macOS 源码桌面默认目录；使用其他实例/覆盖环境变量时应传其实际目录。仅当前项目技能登记可省略 `--agent-dir`，`--data-dir` 始终显式传入。脚本保留已有设置与禁用状态，重复运行不重复登记；遇到不同安装拒绝覆盖。原插件使用本仓库路径链接，移动仓库后需重新处理链接。依赖安装不等于对目标环境的测试授权。

本次包含宿主代码修复，已经运行的旧桌面实例需重启一次以加载新代码；后续仅新增登记时，在已有 Pi 会话执行 `/reload`，在“界面插件 → 插件列表”点击“重新扫描”。设置 → 技能可管理 `api-test-workflow`、`api-test-review`、`api-test-analyze`；设置 → 插件可管理“接口自动化测试”，工具页可管理 `api_test_execute`。输入 `/api` 可选择和补全 `/skill:api-test-workflow` 等命令，不会仅因补全启动模型或发送接口请求。阶段规则和执行门禁保持原样。见 [接入验收](../../docs/api-testing-visibility.md)。
