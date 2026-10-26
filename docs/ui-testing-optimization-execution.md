# UI 测试优化执行记录

实施依据：[UI 测试优化计划](ui-testing-optimization-plan.md)。2026-10-23 开始；当前仍在执行，不代表 M1/M2 或整份计划通过。

## U00：基线冻结中

- 宿主起点：`b3de3207ae3289e6484a430a2d7f9c6665e5a356`。开始时已有 `.gitignore`、两个数据空间/UI 入口 Skill、API workflow Skill、数据空间集成文档、db-client 锁、原生草稿读取器及其测试差异；本任务不覆盖、不顺带提交这些差异。
- 原生维护源：`/Users/liyingjun/Desktop/SW-QA/13-pi/agent-client/packages/ui-testing`，基线提交 `44df50bb383a8e27185290e75c47095f176e764b`。分发基线 0.1.0，SHA-256 `3557ed20d2c81ba331981aa06668a0275a867f24c8da540f09c83eff6877e6ef`。基线包与旧安装目录保存在 `tests/scratch/ui-optimization-u00/original/`，未修改旧安装目录实现。
- 本机 Playwright Test/CLI 1.62.1、独立 playwright-core 1.63.0，原生包要求 Pi SDK 1.2.0。分别核对 MCP 与 runner 的实际解析路径，不能仅以清单版本证明兼容。
- 已核定契约：环境匹配不等于业务权限、用例入库或自动化绑定授权；草稿不可执行；通道初始化、import、bind、sync 分别受既有执行侧规则限制。现有未提交草稿读取改动仍为待验收。
- 冻结合成目标 `u00-1`：复用 `tests/fixtures/data-space/ui-fixture.mjs`，多功能声明在 `ui-optimization-page.mjs`，新增选项默认关闭，不改变旧 Names 夹具。tester/viewer、不同 origin 的正常/持久化故障副本；查询/重置、弹窗、标签/展开、分页、权限隐藏、loading/empty/error。动作预算 60、时间 120 秒；超预算保留缺口，不能删断言。
- 预期来自夹具声明，不从浏览器观测反推规则；副作用仅各自 origin 的 localStorage。每次独立 context、关闭自建服务并删除自有临时工作区；不访问个人认证或业务数据。
- 基准任务冻结：首次发现→获批设计候选；已有资产→正式 run 终态；旧失败批次→报告评审/显式失败重跑；另有 view 零浏览器路径。冷启动单列；同范围、同批准等级、同依赖、同角色/数据。计量阶段时间、确定性交接、浏览器启动/导航/快照、静态检查、目录扫描、评审和归档量。机械开销初始目标 20%，需在 U04/U03 开发前用基线样本确认并冻结；**尚未收齐性能基线，不声称提速**。
- 本轮夹具校准：16 项检查通过，1 次浏览器启动、0 模型、0 正式 runner；8,752ms 为夹具校准总耗时，不是 Agent 工作流基准。日志 `tests/scratch/ui-optimization-u00/fixture-calibration.log`。
- OperationContract：已授权测试环境 `http://192.168.90.224:8238/pms/OperationContract`，本轮仅 GET 可达性返回 HTTP 200；SPA 返回 200 不能证明登录、角色或功能就绪。真实身份、数据初态、预期依据、正常/错误业务副本尚未证实；不执行未知业务写入。
- 真实模型：当前桌面批准记录仍为 18/18 已使用；未发现本任务新额度或专用配置，未读取个人凭据、未新增付费调用。控制响应仅用于工程回归，不替代真实模型评审。真实模型/业务条件只阻塞对应验收，不阻断独立工程工作。

U00 未完成项：三类任务的完整基线计量与读取计数、真实目标正式准入条件核验。相关 A00 验收保留进行中。

## U01：原生修复，待桌面及状态对账

复现：原工作流在 trace 缺失后合法交付 partial 报告，但把任务标为 completed，无法沿原任务续跑。新增回归先失败（actual completed / expected blocked），日志 `tests/scratch/ui-optimization-u00/u01-before.log`。

修复从维护源码进行，提交 `6ccfac1120f4fdd8ba9077e36d8e75986849a0b9`：

1. partial 交付保存文件及引用，任务保持 blocked，result-review 不加入 completed_stages，保留具体完整性限制。
2. 原任务显式 resume 保留 ID、历史产物和评审预算；交付 Markdown 不再按 JSON 产物解析。
3. 完整证据且独立评审通过的真实产品失败报告仍可完成交付，不把产品失败改成初始化阻塞。

维护源全量 check 通过；workflow/result-review 8 项原生测试中 7 通过、1 实际模型测试 SKIP、0 失败。测试包括恢复原 trace 后沿同一任务交付完整失败报告，历史 partial 保留；仅查看和旧批次分析不增加浏览器请求。日志 `tests/scratch/ui-optimization-u00/u01-regression.log`。控制评审不计真实模型验收。

从源码编译并打包为 0.1.1，SHA-256 `817ac2028836476419f459c379c12fbc1dcea0833a9e43cdc393cb1ac57ea9bd`；更新 profile 清单/锁与维护入口。分发源码提交 `2e42b91379569dde4875447bb48333c0430b9aee`，保留原宿主 Node >=22.19.0 与 typebox 1.3.27 约束。原根 node_modules 有独立旧版本导致 profile 拒绝覆盖，已将该旧目录保留到基线证据，再建立标准 profile 链接；未修改全局/个人安装。旧运行进程未被重载或中断。

本仓库安装包回归 `tests/ui-workflow-partial-test.mjs`：1 项通过，覆盖 partial 阻塞、重启服务实例后的同任务恢复、历史 Markdown 保留及重复 checkpoint。首次夹具因成功批次默认不保留 trace 而失败，改用真实失败的持久化副本后复验通过；两份原始日志均保留。UI 宿主接入 15 项检查通过，相关单测 10 项通过，全量类型、lint、协议与差异检查通过。

真实隔离 Electron 回归 `tests/data-space-skill-desktop-test.mjs`：5 项检查通过，包括 /data 发现、禁用/重载持久性、插件与工具管理、环境初始化、原生用例导入及 Playwright 结果重启恢复。0 模型、0 业务请求。证据 `tests/scratch/data-space-skill-desktop/1792741925324`。这是管理及归档路径复验，不是新页面完整发现链或 partial 看板一致性验收。

A01-1 的全部前置零 runner 场景、A01-5 看板/桌面/数据空间含义一致，以及 U09 桌面验收仍待执行；不将 U01 标为全部完成。

## 本轮先行修复：宿主通信验证

登录脚本集成旧测试等待传输 ready，早于插件挂载；改为 snapshot 并隔离 agentDir 后，139 项断言通过。相关单测 42 项通过、全量类型/lint/协议检查通过；修复提交 `6466478` 已推送 origin/master 且远端 SHA 核对一致。详见 [通信检查](data-space-login-agent-check.md)。

## 恢复与后续

继续补齐 U00 计量及 U02 的私密引用执行链与完整环境准备回执，再依赖顺序推进 U05/U06。U04 已先行完成局部读取优化，仍待完整测量；U03/U07 未实施。U08 未启动，保留串行。当前工具集没有 plan_update，不能同步应用看板，以此执行记录如实跟踪，不伪造节点完成。

## U02：只读查询与刷新分类先行修复

0.12.1 复现：查询 `data_space_env` 即发出模拟登录请求；refresh/未知 action 未分类，计划/委派守卫未拒绝。先写回归，4 项失败，日志 `tests/scratch/ui-optimization-u00/u02-readonly-before.log`。

0.12.2 修复默认/显式 list 为纯查询，动态值过期只提示，不登录、不刷新、不写 store；refresh 仍须显式发起。宿主操作分类只允许 list/缺省作为 query，其余均为副作用，计划、委派、目标审查及只读权限不能借刷新绕过。网络仍走宿主原白名单和授权。没有新建另一套环境 runner。

本轮相关 4 个文件 97 项单测通过（含阻断时执行次数为 0、查询磁盘字节不变），全量 typecheck、build、lint、协议及差异检查通过；隔离 dataDir 的宿主插件集成 139 项断言通过。证据前缀 `tests/scratch/ui-optimization-u00/u02-`。

隔离 Electron 管理/归档路径本轮再次 5 项通过，证据 `tests/scratch/data-space-skill-desktop/1792742323129`，0 模型、0 业务请求；未重载用户正在运行的应用。

本次仅覆盖 A02-4 的查询/分类边界；动态明文仍会在显式 refresh 的旧回执中返回，A02-5 未完成，不能宣称凭据已隔离。有效期复用、私有引用消费、真实角色/初态和按模式环境准备仍需后续实现与验收。

版本同步状态：本轮重新查询远端，`origin/master` 与本地起点 `19e4666171c0729d08b1937bb7b238521a38ffa4` 一致，此前超时的提交现已确认同步。

### U02 续跑：工具输出边界与刷新有效期

0.12.2 的新泄露断言先失败，证据 `tests/scratch/ui-optimization-u00/u02-secret-before.log`。0.12.3 删除 refresh 敏感明文块，不再依靠提示词要求模型保密；错误消息中的已知秘密及其 URL/JSON 编码形式也在脚本诊断出口移除。合成秘密覆盖静态参数、刷新工具回执、环境备注及多步脚本部分成功后的错误反射。

刷新要求唯一环境，明确 ID 优先匹配；跨项目同名、多环境不运行任何脚本。默认复用有效值，`force=true` 才强制刷新；刷新失败后旧值不可再判为有效，保留原有 60 秒失败冷却及宿主授权。回执含项目/环境 ID、来源和有效期，不将配置可读或登录脚本成功写成浏览器身份/数据已就绪。

本轮 5 个文件 120 项单测通过，宿主隔离插件集成 139 项检查通过，全量类型、构建、lint、协议、差异检查通过。日志前缀 `tests/scratch/ui-optimization-u00/u02-secret-`。Electron 管理/归档 5 项检查通过，证据 `tests/scratch/data-space-skill-desktop/1792743461483`；0 模型、0 真实业务请求。未覆盖个人安装或重载用户服务。

**A02-5 仍未完成**：现有通道没有秘密执行适配器，HTTP token 无法直接作为 Playwright storage state；尚无截图、trace 和归档全链路隔离证据。工具明确提示私密参数执行链未接入，不能通过聊天复制秘密来绕过。移除明文仅是输出边界修复，不代表已实现私有引用消费，也不代表所有原生入口均已有私密前置执行守卫。A02-1/3 的本轮范围已回归，完整模式化环境准备、真实身份及初态仍待完成，U02/M1 不放行。

## U04：单次同步读取复用及独立工作区恢复

独立于未完成的私密执行链，先对现有原生合成 run 做局部测量。`tests/ui-sync-read-benchmark.mjs` 使用真实 Playwright、原生诊断和运行产物；评审为控制响应，0 真实模型、0 真实业务请求。每个版本取首次同步及 5 次重复同步，不重放业务。优化前每次完整读取同一 run 两次；新增单测还复现了前一个工作区目录不可访问会中断全部恢复。2 项失败、6 项原有检查通过，证据 `tests/scratch/ui-optimization-u00/u04-sync-unit-before.log`。

0.12.4 只在同一次 sync 内复用已读取的原生 run；下次请求仍重新读取和校验证据，不引入跨请求批准缓存或启动索引。工作区扫描错误独立记录，继续其他工作区；恢复过程中发生的错误不会被后续成功同步覆盖。原有单批次失败隔离、人工修改版本核验、父批次及原始结果保留。

局部样本对照（毫秒；冷进程首次调用与后续调用分开）：

| 指标                                            | 修改前 | 修改后 |
| ----------------------------------------------- | -----: | -----: |
| 每次 sync 的完整 run 读取次数（6 次调用均一致） |      2 |      1 |
| 后 5 次完整读取耗时中位数                       |  29.13 |  12.32 |
| 后 5 次 sync 耗时中位数                         |  34.10 |  16.51 |
| 首次 sync 耗时                                  |  41.12 |  17.73 |

原始结果 `u04-sync-before.json` / `u04-sync-after.json`、汇总 `u04-sync-comparison.json` 均在 `tests/scratch/ui-optimization-u00/`。每个版本使用独立合成环境、一个实际成功批次；这仅证明局部重复读取已消除，不是 U00 完整工作流基线、扩展历史集验收或 M2 整体提速结论。尚无证据要求跨请求增量索引，暂不新增。

本轮相关 4 文件 39 项单测通过；新增回归覆盖单次一读、下一请求重验、篡改拒绝及工作区故障后的独立恢复。真实 API/UI 原生集成 7 项通过（包含失败、重测父链、取消、篡改、跨工作区拒绝及重启补同步）；Electron 管理/归档 5 项通过，证据 `tests/scratch/data-space-skill-desktop/1792743837985`。全量类型、lint、协议、差异检查通过，沿用本轮已完成构建。日志前缀 `tests/scratch/ui-optimization-u00/u04-`。

A04-1、A04-4 的本轮路径已回归；A04-2/3/5 的目录测量及扩展历史集对照未完成，U04 保持实施中。U05/U06 依赖的完整环境契约及 U09 的真实端到端条件仍未放行，不将此局部优化填为最终完成。

## U02 续跑：录制 seed 执行前校验

确认目标 Playwright MCP 在 testDir、configDir、cwd 中找到第一个 seed 就执行，不拒绝多路径歧义。隔离 SDK/MCP 集成复现：预期拒绝，实际运行一个 seed 并打开合成页面，断言失败。证据 `tests/scratch/ui-optimization-u00/u02-seed-integration-before.log`。

在现有项目 MCP 适配入口增加 `tool_call` 前置校验，不修改原生 runner 或安装目录：要求明确 project/seedFile，使用当前目标 CLI/config 的 `--list` 收集，拒绝不存在的 project、缺失/多路径 seed、空/多测试 seed 和收集失败。每次 setup 都校验，不创建默认 seed；未额外启动浏览器，增加的收集成本尚未纳入完整 U00 计量。收集仍会加载已授权工作区的配置/测试模块，不宣称这是任意代码沙箱；登录、角色和数据准备仍是独立未确认项。

执行证据：

- seed/runtime 单测 5 项通过；合成 seed 测试体故意抛错，`--list` 路径不会执行它。日志 `u02-seed-unit.log`。
- 真实 SDK/MCP 集成 17 项通过，使用独立安装的 Playwright、自定义 `tests/` 和相对 baseURL/seed。歧义、缺失 seed、错误 project、多测试 seed 均被执行侧拒绝，seed 测试体的写入哨兵不存在；恢复唯一合法 seed 后实际启动 Chromium 并产生哨兵。日志 `u02-seed-integration-acceptance.log`。
- Electron 可见性/重载检查 6 项通过，包含入口与八阶段技能、`/ui`、MCP 连接、三次重载及显式重连；0 模型、0 真实业务请求。证据 `tests/scratch/ui-workflow-visibility/1792744634057`，日志 `u02-seed-desktop-check.log`。此项不是业务录制或私密参数全链路验收。
- 桌面首轮页面重载失联、后续退出超时及 SDK 夹具参数遗漏等失败日志均保留，未计通过。桌面夹具补齐目标依赖、bundled SDK、加载等待和退出异常结果记录后复验通过。`u02-seed-integration-after.log` 中的中间回归发现回调参数误传，已修正；不将这些实现/夹具失败归为产品测试通过。
- 全量类型、lint、协议及差异检查通过，复用本轮串行构建；日志均在 `tests/scratch/ui-optimization-u00/`。未修改用户个人配置，当前运行的旧应用仍需按原登记机制重载。

提交 `b87acb68b6a2e81001f9af6a0592fb2dc8e30b4b` 已与 origin/master 核对一致。此后工作区出现新的 data-space 0.13.0、通道、归档、相关测试差异，来源未判定；本阶段不覆盖、不暂存，不能将此前 0.12.x 的结果当作这些新差异的验收。U02/A02-5 和整份计划仍保持未完成。

后续衔接核对：数据空间 0.13.0 更新已单独提交为 `3435e6d`，seed 守卫提交为 `a4d7bc6`；后者已推送并核对远端 SHA。为兼容 0.13.0 的显式入库和单独绑定，局部计量脚本在测量前明确执行 import/bind；真实合成 run 的 6 次 sync 均完整读取 1 次，重复同步不增结果，证据 `u04-sync-explicit-archive.json`（同前述 scratch 目录）。该契约变化后的新样本与 0.12.x 首次同步含自动入库的旧样本分开，不覆盖旧对照数据或据此宣称整体提速。私密输出/刷新、seed 和宿主执行守卫相关回归另存 `u02-final-regression.log`。

## U05：生成用例后显式入库（0.13.0）

实现落在 data-space 0.13.0：`test-channel.mjs` 负责环境归属与目录复用，`automation.mjs` 去掉资产事件隐式入库并拒绝绑定未冻结草稿，`index.mjs` 暴露 `envId` / `featureId` / `moduleName` / `featureName`，`server/test-asset-reader.ts` 读取 UI cases 与 API draft。规则与验收口径见 `docs/data-space-integration.md` 末节。

隔离验证：`tests/unit/data-space-*.test.ts` 192 项通过，覆盖显式 `envId` 定项目、地址不一致与环境缺失阻塞、默认/自定义目录创建与复用、重命名后按目录 ID 继续写入、目录删除阻塞、跨项目 `featureId` 拒绝、重复导入去重不覆盖人工编辑、`channels.json` v1 兼容、入库不写 `automation` 以及 `bind` 拒绝草稿。

桌面接入：真实 Electron（隔离 agent/data 目录、真实原生 Playwright 合成运行，0 模型、0 业务请求）通过，证据 `tests/scratch/data-space-skill-desktop/1792744351487`：初始化后未获确认时用例数为 0，`import` 按 `envId` 落入“测试用例 → UI用例”草稿且无绑定，`bind` 后原生运行结果经重启恢复，重复导入不增行。

静态门禁：server/tests 类型检查、prettier、`node scripts/check-protocol-sync.mjs`、`git diff --check`、`node scripts/project-budget.mjs --check` 均通过；`oxlint plugins/data-space` 仅 3 条既有 `env-script.mjs` 警告、0 错误。

全量 `tests/unit` 有 7 个文件 10 项失败，均为 SDK 副本解析、插件链接、沙箱 cwd、非 Git 降级等与本改动无关的既有环境差异（`plugin-version-bump-guard` 由他人未提交的 `plugins/db-client/package-lock.json` 触发），未计为本次通过。

**未完成**：原 75 条用例补录与去重回查无法执行——`14-工作目录` 及其上层目录被 macOS 隐私授权拒绝（`Operation not permitted`），本应用仅获 `15-aqa`，该目录内的修复材料与用例清单均不可读；现有 data-space 存储中也没有这 75 条。此项需用户授权目录或提供清单后继续，不能据此声称已入库。

## U06：多功能显式映射与只读归档回执（0.14.0，部分实施）

本轮起点 `8b699ae6df4c6ade0ea9287a97e43e1547335d0e`；保留他人 `.gitignore`、`plugins/db-client/package-lock.json` 差异。U00/U02 完整放行仍缺，本次只独立推进不依赖秘密执行的合成资产归档路径，不宣布 M1 通过。当前工具未提供 plan_update，以本记录同步阶段。

宿主从原生 UI cases 投影模块/功能 ID；API 不猜归属。已有 `data_space_automation` 扩展 `featureMappings`，按原生模块/功能二元 ID 显式映射到所选环境项目内功能；未映射项保留默认目录并标记待归类。单个 featureId 作为默认整批归属，显式逐功能映射优先。跨项目、未知及重复映射在写入前拒绝。映射变化、目录失效或人工移动用例不静默迁移历史；重复导入不覆盖人工修改。

新增 archive-status 只读查询，用原 assetRef、环境及可选预期映射核对已有归档；包含项目、环境、工作区、资产修订、逐项引用和全量计数。new/existing/pending/stale 互斥，unclassified 独立计数；classificationComplete 与归档成功分开。逐项最多100条并明确截断；105条回归覆盖全量统计。旧行无映射元数据按未确认归类处理。归档查询不是正式 run 的同步回执，不据此声明执行结果已同步。

验证与证据（均为本轮执行）：

- 映射最初2项失败及中间回归日志保留在 `tests/scratch/ui-optimization-u00/u06-mapping-before.log` 等；新增提示词219字符超限也真实失败，`u06-unit.log` 保留；缩短后完整12文件205项单测通过，`u06-unit-final.log`。覆盖双项目同名、原生模块同名功能、部分映射、未知/重复映射、目录移动、映射变更、105条截断、只读磁盘不变和执行侧查询分类。
- 原生 API/UI 合成集成7项通过，含取消、失败重测父链、证据篡改、跨工作区拒绝、重启补同步；评审为控制响应，证据 `u06-native.log`。
- Electron实际界面5项检查通过，隔离 agentDir/dataDir，验证技能管理和 /data、映射导入、入库前/后只读查询、独立bind、真实原生Playwright结果及重启回执恢复。证据 `tests/scratch/data-space-skill-desktop/1792745734597`、`u06-desktop.log`。0模型、0真实业务请求，不改变个人安装或重载用户旧进程。
- 全量typecheck、串行build、lint、协议检查及size预算通过，证据前缀 `u06-`；差异检查通过。宿主插件协议面集成亦通过，日志 `u06-plugin.log`。插件只有源码模块，无受本轮影响的已跟踪 bundle。

使用 skill-creator 维护既有 data-space-testing，不创建重复 Skill。通读入口与结果约定并对照 tools/automation/channel 契约：环境查询不初始化或刷新；生成用例只在已有本批授权时入库；原生补同步使用旧run不重放；人工结果仍限公开三态且无幂等键；部分失败逐项保留，不把零新增当成功。以上五场景边界由本轮现有单测/集成覆盖对应路径，未做真实模型遵循度验收。去掉“私密引用已可直接执行”的误导，明确动态私密参数浏览器链仍未接通；补齐映射/截断/旧数据说明，避免复制 runner 和批准规则。

A06-1/2 的新增路径与 A06-8 文档契约核对已留证；A06-3/4/5 仅上述局部回归，不代表完整并发同步、逐例同步回执已交付。A06-6当前/历史版本界面、A06-7结构化输出校验仍未实施，U06继续实施中。U01桌面任务状态对账、U02私密链与完整环境准备、U05真正按功能探索、U03/U07及U09仍未完成；U08未启动、保留串行。

### U06 续跑：原生结果同步对账（0.14.1）

起点 `f72ea668f7f670fdca6ab2392211c496cac7eebe` 已核对远端一致；保留 `.gitignore`、db-client锁的他人差异。本轮补 A06-3/4/5 的同步回执，不扩大到已阻塞的秘密执行或真实模型调用。

先复现4项缺口：没有绑定时新增0但没有批次/逐项未匹配信息；缺少只读查询；并发回执缺少明确新/旧计数；一个环境错误中断其他关联。日志 `tests/scratch/ui-optimization-u00/u06-sync-before.log`（4失败、5既有通过）。

复用原同步及原生读取路径增加 `sync-status`，执行侧分类为 query；它不绑定、不入库、不写结果或同步错误状态，不启动runner。`sync` 仍串行去重，二者使用同一校验。每次重新核验原生引用，单次完整read仍为1，无跨请求批准缓存；即使无绑定也核验原批次，不用未读取的引用生成回执。未选中的用例不制造结果；原生批次内未绑定项明确 unmatched。单条环境错误隔离，其他有效绑定可继续同步；修复环境后原run补同步，已有流水ID保留。

回执有 workspace/engine/assetRef/runRef/runId/parentRunId、原生环境和逐项台账/原生用例/项目/环境/功能/资产修订/版本指纹/结果ID。new/existing/pending/unmatched/stale/failed互斥，`total`以用例关联计量（一个原生用例允许多条显式绑定），`nativeCaseCount`独立；逐项和错误最多100条并标记截断，计数覆盖全量。`complete`只表示当前关联同步完整，不等于测试通过、证据完整或报告获批；原生八态与历史证据保留。未知批次引用仍由原读取器拒绝，不伪造失败回执。修改公开schema及既有Skill说明，未新增重复工具或runner。

本轮验收：

- 12文件210项相关单测通过（`u06-sync-unit-final.log`）；覆盖查询零写入、并发新/旧回执、无绑定、过期、部分环境失败、105条截断、状态保留。追加同run修复后补同步及旧ID保留断言后，该文件10项再次通过（`u06-sync-recovery-final.log`），不将重复执行累加成220项。
- 原生API/UI合成集成7项通过（`u06-sync-native.log`），控制评审，包含取消、失败重测父链、跨工作区/证据篡改拒绝和重启恢复。原生退出和测试结论保持分开。
- Electron5项检查通过（`u06-sync-desktop-final.log`），证据 `tests/scratch/data-space-skill-desktop/1792746319873`；增加重启后按真实run_ref查询 sync-status、核对项目/结论/已存在数量及runs.json字节不变。0模型、0真实业务请求，不重载用户旧进程。
- 全量类型、构建、lint、协议、size预算与差异检查通过，日志前缀 `u06-sync-`；无受影响的已跟踪bundle。技能契约重新核对：查询不写入、sync不重放、归档和执行回执分离、关联分母不冒充实例分母、动态私密执行链仍未完成。

A06-3/4/5上述工程路径已回归。完整U06仍未放行：A06-6版本展示/历史筛选与A06-7结构化输出校验待实施；U00/U02以及真实目标/模型条件仍未放行。当前回执按现有绑定对账，不能为已删除且无现有绑定的历史版本推断完整映射。下一步先核对既有版本界面及交付格式校验，不以本轮局部通过关闭整计划。

### U06 续跑：结构化交付一致性校验（A06-7 工程路径）

起点 `ab9b8a7524784a67abee7c3aed9eb84eddbd4ba9`；本轮并行工具标签工作随后独立提交为 `3b7ff27`，不覆盖其改动。保留 `.gitignore` 与db-client锁的既有差异。复用原 data-space-testing，使用已读取的 skill-creator 维护规则；不新增同职责Skill、宿主工具、runner或结果库。

新增 Skill 内 `scripts/validate-result.mjs`：只读指定交付JSON或直接校验对象，返回诊断及CLI退出码。校验必需字段、原生引用/父批次、项目/环境、功能/用例版本、八态、重复case、计数算术、原生同步逐项回执及confirmed条件。增加featureId/caseVersion到原生结果交付约定，未知项允许null但必须有gap；未知原生批次或项目身份不能确认写回。全批关联计数与本次项目子集分开，实例计数只检查算术并明确仍需原生明细对账。人工登记缺少原生逐项核验能力，不由此补造证明。

校验通过仅说明输入内部一致，不证明证据字节、在线归属、独立评审、实际执行或模型遵循度；回执本身仍须来自原生工具。evidenceComplete与同步complete分开。脚本不联网、不写应用数据、不启动浏览器/runner、不读取环境凭据；CLI错误不回显输入正文。只复用交付字段，不将交付格式当作公开工具参数或底层存储格式。更新Skill入口、按需结果说明、地图/目录/文档导航；当前插件源码及bundle未变，不升级插件版本。

本轮发现及修正：

- 文档的“环境未确认”样例只有用例级gap，无法解释批次级未知；初次CLI真实拒绝（`u06-delivery-cli-valid.log`），补齐批次级gap后CLI通过（`u06-delivery-cli-valid-final.log`）。缺format的反例CLI退出1（`u06-delivery-cli-invalid.log`），符合预期，不计测试失败。
- 第一轮Electron退出超时，保留 `u06-delivery-desktop.log`、证据 `tests/scratch/data-space-skill-desktop/1792746747809`；确认自建进程已退出后重试，没有重启仍运行的句柄或中断用户服务。
- 第二轮Electron达到校验步骤，暴露夹具构造交付时使用/var别名而非宿主规范化/private/var路径，以及原生无父批次使用空字符串。保留失败 `u06-delivery-desktop-retry.log`、证据 `1792746881753`。交付改用宿主workspace，明确将“无父批次”的原生空串归一为null；原回执原样保留，不能把任意不同路径或不同父批次放宽为一致。

验收（本轮实际执行，日志均在 `tests/scratch/ui-optimization-u00/`）：

- 13文件221项相关单测通过（`u06-delivery-regression-final-all.log`）；新增11项覆盖合法、缺字段、跨项目/环境、资产/批次/父批次/版本冲突、计数/结论矛盾、八态、部分未知、截断、子集回执、无执行报告、嵌套错误输入及未知身份禁止confirmed。没有用全部工作区测试证明本轮结论。
- Electron实际界面6项检查通过（`u06-delivery-desktop-normalized.log`），证据 `tests/scratch/data-space-skill-desktop/1792747010283`。真实原生Playwright合成run、重启恢复、sync-status回执生成交付JSON后校验通过；改成错误项目时拒绝。最终校验器再通过CLI读取该轮 `delivery.json`，证据 `u06-delivery-desktop-cli-final.log`。0模型、0真实业务请求。`delivery-validation.json`保留实际诊断，未宣称独立模型评审或业务目标通过。
- 全量typecheck、lint、helper专门oxlint、协议、Skill quick_validate、size预算及差异检查通过（`u06-delivery-*`）。本轮只改Skill脚本/文档/验收脚本，沿用已有应用构建；不为了文档或离线脚本额外重建桌面，不将隔离验收说成用户旧进程已刷新。

A06-7格式及工程回执对账路径已有证据，真实模型生成遵循度未执行。A06-6当前/历史版本界面仍待实施；U06及M1/M2保持未完成。U01桌面状态对账、U02私密执行与完整环境准备、U05功能探索、U03/U07、U09及完整计量仍需继续；真实目标/模型门禁不因本校验通过而放行。U08未启动、保留串行。

### U06 续跑：最近入库修订与历史证据入口（0.15.0）

本轮起点 `dd680c6133a626968b84aa88d236c6bb62053a34`；过程中并行工作独立提交为 `17b5f5b`，不回退或纳入其差异。保留 `.gitignore`、db-client锁。先核对views/state/自动化弹窗：此前没有用例版本筛选；执行记录可按用例查看原生revision/parentRunId/evidence，但未绑定的归档来源未展示。

新归档仅保存宿主核验得到的元数据：workspace、engine、项目/环境、UI原生asset.id作为lineageId、修订及入库revision。API当前无可靠稳定资产关系，不猜同名；UI草稿与旧行也不回填关系。重复import不改首次元数据和顺序，新修订另存原行。客户端纯投影在相同项目/环境/工作区/资产/原生用例/目标功能内，默认显示最近入库版本，可切全部版本；编辑时间和v1/v2等标签不用于推断版本新旧。入库顺序相同则均保留；目录人工移动、关系不足则全部显示。筛选不改变存储、执行记录、原生门禁或工具查询，只让“引入对话”保持所见即所引。

**语义边界**：“最近入库”是数据空间展示顺序，不承诺原生最新、已批准或可执行；原生没有可据此推断的统一current指针。旧数据/API关系未确认时不隐藏、不以路径模式猜测。行内修订与自动化弹窗原生来源可查看原始引用；已有执行记录继续保留revision、父批次和证据。新标签提供zh/en并复用现有主题/表单，不建立第二套版本数据库或迁移历史。

本轮实际验证：

- 最小界面复现2项失败、2项原有边界通过（`tests/scratch/ui-optimization-u00/u06-versions-before.log`）。实现后14文件229项相关单测通过（`u06-versions-regression-release.log`），含默认/全部、跨项目/环境/工作区/资产隔离、手工/旧/API关系未知、搜索不提升旧版、相同顺序、移动目录、转义、英文标签和父批次/原证据保留。入库metadata与重复import不改顺序另有回归。初次typecheck发现测试夹具直接给JS推断的never[]赋值，改为与现有测试一致的Object.assign初始化；原失败日志保留，`u06-versions-typecheck-release.log`最终通过。
- 原生API/UI隔离集成7项通过（`u06-versions-native.log`），实际Newman/Playwright；评审使用控制响应。包含父链、取消、证据篡改、跨工作区拒绝及重启补同步，0真实模型/业务请求。
- Electron实际界面7项检查通过（`u06-versions-desktop-final.log`），证据 `tests/scratch/data-space-skill-desktop/1792747851689`。使用原生store/assetDigest创建同一UI资产第二修订，显式导入后默认1行、全部2行；打开旧用例可读原来源摘要及旧run，数据仍2行。`version-history.png`已人工检查；同轮还有技能/工具管理、重载、真实原生run恢复及交付校验。不是网页版替代桌面，也没有更新用户个人安装。
- 两次中间失败均保留：`u06-versions-desktop.log`中第二修订夹具未更新content_sha256，被原生完整性门禁拒绝；改用原生assetDigest计算，没有绕过校验。`u06-versions-desktop-retry.log`和截图显示503“正在更新”页；共享web/dist文件时间在同期发生变化，有并行构建替换线索，未对具体写入进程归因；确认文件已恢复、测试句柄终止后才重试，未重放未知业务动作或中断用户服务。证据目录分别为 `1792747615721`、`1792747732123`。
- 全量类型、串行build、lint、协议、size及差异检查通过，证据前缀 `u06-versions-`；插件专门oxlint为0错误、1条原有envOfCase未使用警告，未顺手修改。data-space版本0.14.1→0.15.0；无package/bundle要同步；市场描述改正旧“自动归档”表述。地图、目录、README和按需交付说明同步。

U06工程路径对账：A06-1/2映射/待归类与不迁移历史；A06-3去重/并发/修订保留；A06-4两类可查询回执；A06-5原run补同步与八态；A06-6本轮有界修订投影及历史；A06-7交付结构校验；A06-8既有Skill公开参数、只读/执行、秘密、幂等/版本五场景规则已通读并对照单测及原生/桌面工程证据。Skill仍只路由已有工具与原生引用，未复制runner/批准规则；界面版本筛选不改变工具原范围。没有真实模型生成遵循度证据，不把这些工程检查当M1/M2放行。

U06保持“工程回归通过、依赖放行待验”：U00全量基线、U02完整环境/秘密执行以及真实目标/模型条件仍未通过，整计划不完成。下一步回到U01桌面状态对账与U02环境契约的未完成项，再按真实依赖推进U05/U03/U07及U09；U08未启动，保留串行。

## U01 续跑：原生阶段自动同步任务看板

复现宿主接线缺口：原生 `ui_test_workflow` 已返回 blocked，但宿主只对 `plan_update` / `update_plan` 同步看板，原生阶段不会自动更新。新增工具结束事件回归先有 2 项失败、2 项通过，证据 `tests/scratch/ui-optimization-u00/u01-board-before.log`。

`server/test-execution-notice.ts` 将原生工具回执中的 task、sequence、completed_stages、stage 和具体 blocker 投影为既有 PlanStep；`agent-service.ts` 在工具开始保存参数、结束后复用 `updatePlan` 的持久化与广播。没有新增执行状态机或批准路径，不依据 runner 的用例失败推断工作流故障。阻塞/取消阶段保持 pending 并注明原因、停止活动节点；原生确认完成的阶段才记 done。看板说明工作流进度不代表用例全部通过。保留其他任务/人工步骤；仅显式 start/resume-task 可接入新任务，status 不接入其他任务；catalog/view、工具错误、超限或无法解析回执不推断完成。看板仍是展示投影，不能代替原生门禁或独立评审。

本轮验证：

- 23 项相关单测通过（3 文件），覆盖宿主工具结束事件、partial 未完成、原任务恢复、其他计划保留、异常输出及已有看板行为。`u01-board-unit-final.log`。
- 原生安装包恢复集成 1 项通过：真实失败 run 删除 trace 后生成 partial、阻塞交付、重复 checkpoint 保留历史；恢复原 trace、生成新的完整统计/报告，经控制评审后显式续跑原任务，交付仍如实包含 failed=1，旧 partial 不覆盖，分析恢复无新增浏览器请求。`u01-board-native-restored-final.log`。夹具增加实际 HTTP 请求计数并先断言已访问目标，避免用不存在的字段推断零重放。控制评审仅验协议路径，不是实际模型语义验收。
- 隔离 Electron + 实际 SDK/原生工作流工具 4 项检查通过：partial 后原生 blocked/看板 1/2、具体缺口及可读阶段报告；普通执行无实施按钮；刷新保留看板；显式同任务恢复活动阶段、未修复重新阻塞且历史报告只保留一份。最终原始证据 `tests/scratch/ui-workflow-board-desktop/1792748680151/`（`u01-board-desktop-evidence.log`），保存 blocked/resumed/reblocked 三份原生任务 JSON、阶段报告和截图；首次同路径证据 `1792748427199/partial-blocked.png` 已人工查看。提供器为本地控制响应（8 次），0 付费模型、0 真实业务请求，真实 Playwright 仅访问隔离合成目标。

本轮桌面证据覆盖刷新恢复，不宣称完整进程重启或新会话自动发现所有任务；完整失败报告交付的桌面/数据空间联合对账与 A01-1 全部前置零 runner 场景仍待补。U01、U00–U09 及 M1/M2 均未整体完成；U02 私密执行/证据隔离及其他原有缺口保持未放行，真实模型预算不因控制提供器通过而增加。

本轮全量类型、构建、lint、协议、体积和差异检查通过；日志前缀 `tests/scratch/ui-optimization-u00/u01-board-`。清理仅预览，可清理 0 项；保留既有 `.gitignore` 和 `plugins/db-client/package-lock.json` 差异。

### U01 续跑：完整失败报告的桌面与数据空间联合对账

在同一隔离 Electron 流程继续恢复原 trace，并通过原生 ResultReviewService 的控制评审生成可信登记（仅协议测试，不是实际模型验收）；显式 resume/checkpoint 原任务后，看板变为 2/2，原生任务 completed，但最终报告仍记录 failed=1。旧阶段报告继续保留；原生目标 HTTP 请求计数未增加。控制评审只使用本测试新建的 agentDir/sessions 目录，不读取个人配置或私有认证。

启用本仓库数据空间插件的隔离安装，通过桌面实际宿主 HTTP 路径 import/bind/sync/sync-status，确认同一原生 run 归档为“失败”，只读查询保留原结果 ID；打开数据空间的原生执行记录弹窗核对“失败”。工作流交付完成没有把业务失败改成通过，也没有重放浏览器动作。

本次扩展回归共 6 项桌面检查通过（涵盖前述 4 项及完整交付/数据空间 2 项），本地控制提供器 11 次请求、0 付费模型、0 真实业务请求。证据 `tests/scratch/ui-workflow-board-desktop/1792748911241/`：增加 completed-task.json、complete-failed-report.md、data-space-sync.json、completed-failed-report.png、data-space-failed.png；后者已人工查看。日志 `tests/scratch/ui-optimization-u00/u01-board-joint-desktop.log`。共用恢复夹具后的原生安装包回归 1 项通过，日志 `u01-joint-native.log`；本轮全量类型、lint、协议与差异检查通过。宿主实现沿用已验证构建，无新增生产代码，不重复构建。

A01-2/3/4 与 A01-5 的上述隔离工程路径已留证；A01-1 全部前置零 runner 场景、U00 全量计量及真实模型/业务验收未完成，不能据此关闭 U01、U09 或整计划。下一步继续这些前置场景及 U02 的完整环境/秘密执行链；U08 仍未启动。

### U01 续跑：四类前置门禁的零 runner 证据

新增 `tests/ui-workflow-admission-test.mjs`，通过实际创建一个 Node 子进程校准 `diagnostics_channel` 的 child_process 观测，再分别验证录制 partial、资产未批准/不能借另一修订批准、设计已批准但运行证明缺失、脚本证据文件缺失四类路径。四类均 child_processes=0、目标 HTTP 请求增量=0、formal_runs=0；下游阶段未完成。缺失证据在 start 登记前已拒绝，确认未产生新任务；其他执行拒绝沿原 task_ref 显式 block，保存原生真实错误原因。没有用“未访问页面”替代零 runner 证据，也没有通过改低门禁强行执行。

初版测试把 start 返回 running 误当成已启动执行、预期自动 blocked；缺失文件时还预期一定创建新任务。该验收假设与现有契约不符：start 是登记、目录提供信息，实际准入由 UiRunService 强制，失败后使用已有 block 交接。保留 `u01-admission-assumptions.log`（1 子场景通过，3 子场景失败；父测试也计失败），据真实契约明确区分登记、runner 拒绝和持久化阻塞，未修改生产门禁或忽略 runner 失败。最终 `u01-admission-native-release.log`：4 子场景及父测试共 5 项通过，0 失败/跳过；运行命令 `node --import tsx --test tests/ui-workflow-admission-test.mjs`。全量类型、lint、协议、差异检查通过，清理仅预览。

结合前述恢复及隔离桌面/数据空间对账，U01 更新为“工程回归通过，依赖待验”，不表示真实模型会自动正确执行所有交接，也不替代 U00/U09 的完整 Agent 流程基线和真实验收。下一步继续 U00 的计量及 U02 的完整环境/秘密执行链，再按依赖推进 U05/U03/U07；整计划保持进行中，U08 可选且未启动。

### U02 续跑：模式化环境准备与当前动态参数回执（0.16.0）

起点 `ff8acaf6a323360ac4954000d35559920d171aaf`。保留 `.gitignore` 与 db-client 锁的既有差异；没有 plan_update 工具，继续以本记录跟踪。沿用已读取的 skill-creator 维护现有两个入口，不增加重复工具或 runner。

最小复现：初始化仅返回静态参数，忽略有效动态 tenant，分析/查看/仅源码模式还要求匹配环境并建通道；初版新增测试3项失败、20项原测试通过（`u02-preparation-before.log`）。新增 `environment-preparation.mjs`，初始化接受 mode/discovery；analyze、view、new/record+source 返回 not-required，不读环境、不改通道、不发目标请求。其他模式保留唯一项目/环境匹配与原宿主写操作守卫。configured 仍仅表示匹配成功。

回执区分配置、参数及网络/身份/角色/数据，未检查保持 unknown。每次重新读取当前环境，有效动态公开值覆盖同名静态值；过期或脚本失败时返回 refresh-required，不退回同名静态值。刷新仍须显式调用原工具并遵守权限；不改变既有空有效期规则。parameterSources 保留来源和有效期，不把参数复制进 channels。秘密键按静态、脚本声明、动态三方合并分类，不能靠 dynamic.secret=false 降级；反射已知秘密的公共字段移除并标 not-ready，不能把脱敏占位值交给执行。

扩大回归发现新增 guideline 为213字符，违反200字符限制，已缩短。进一步构造动态秘密被降级后反射到公开 URL 的反例，先复现1失败/23通过（`u02-preparation-reflection-before.log`）；修复时按合并后的秘密分类复用原脱敏器，未改变原始环境或全局函数。

本轮实际验证（日志均在 `tests/scratch/ui-optimization-u00/`）：

- 最终15文件238项单测通过（`u02-preparation-regression-final.log`），含模式跳过、已有通道字节不变、实时重读、过期/失败无回退、秘密降级和反射拒绝、原归档/结果/工具提示规则。早期63项为同范围子集，不累加计数。
- 扩大版本守卫检查另外触发既有 `plugins/db-client/package-lock.json` 未递增版本；原日志 `u02-preparation-regression.log` 保留。该用户差异不改动、不暂存；本次 data-space 已从0.15.0升至0.16.0，没有独立package或已跟踪bundle。不能将整个工作区版本守卫写为通过。
- 原生API/UI集成7项通过（`u02-preparation-native.log`），使用实际Newman/Playwright及控制评审，覆盖失败父链、取消、证据篡改、跨工作区拒绝和重启补同步；0付费模型、0真实业务请求。
- 隔离Electron实际进程8项检查通过（`u02-preparation-desktop.log`），证据 `tests/scratch/data-space-skill-desktop/1792749824198/`。实际宿主调用确认三类跳过模式不创建channels；execute初始化返回当前动态tenant、unknown及私密未就绪，合成目标HTTP计数不变；技能/工具启停重载、真实原生run及重启归档仍通过。`version-history.png`已人工查看。后续匿名合成run不依赖私密参数，不能当作私密消费验证。
- 全量typecheck、build、lint、插件专门oxlint、协议、两个Skill quick_validate、size及差异检查已执行；相关日志 `u02-preparation-*`。清理仅预览，保留失败证据及用户数据。

边界：privateExecution 对含私密参数的环境明确 not-ready；尚未实现受控私密引用的浏览器消费、截图/trace/报告/归档全链路秘密隔离，不能把 HTTP token 猜测转换为 storageState。网络/身份/角色/数据的完整运行时预检仍须原生执行证据，本轮不授予就绪。A02-1/3/4/7 的上述工程子路径已有回归，A02-2沿用已留证的seed守卫，不冒充新开发。U02、U00、M1/M2与整计划仍未完成；U05/U03/U07/U09及完整计量继续待推进，U08未启动、保留串行。

最终秘密分类修复后，Electron同路径8项再次通过，证据 `tests/scratch/data-space-skill-desktop/1792750012288/`（`u02-preparation-desktop-release.log`）；不将重复执行累加为16项。最终全量类型及lint通过（`u02-preparation-typecheck-release.log` / `u02-preparation-lint-release.log`）。无客户端代码变化，桌面沿用本轮串行构建；隔离插件链接实际加载0.16.0新模块，用户旧进程未刷新。

### U02 续跑：当前运行条件及私有认证预检的实际证据

起点 `72420efe332fecf266fe74237e6710ad2663fbcb`，继续保留 `.gitignore` 和 db-client 锁差异。前一目标轮已提交代码并推送核对，属于实际进展。本轮未新增执行器、宿主工具或认证转换：先核对现有原生入口，确认 storageState 私有引用已可由预检消费；数据空间的 HTTP token 到 storageState 尚无明确绑定/转换契约，不能猜测 cookie/localStorage。正式 runner/诊断仍保存失败trace/截图，且结果完整性规则要求失败trace，因此不能只关截图就声称 A02-5 完成。

新增 `tests/ui-environment-preflight-test.mjs`，在已有成功诊断和批准之后改变合成目标的实际响应，而不修改资产/批准摘要。身份文本变化、初态变化及503分别返回原生 preflight.check=identity/initial-state/site；真实子进程观察先校准，三类正式 CLI 启动数均0。原生冻结分母仍为1，blocked=1、failed=0，business_started=false；已有请求重查零新进程/目标请求，恢复后的新明确请求启动1次正式CLI并真实passed=1。夹具仅新增可控响应字段，默认保持原页面行为。

另用临时私有目录（0700）、合成 storageState 文件（0600）和本测试唯一环境变量引用，确认实际 Chromium 发出合成cookie后通过身份/初态检查；文件存在但cookie过期时身份检查阻塞；缺少引用、文件无效或已删除时 auth-reference 阶段阻塞且目标请求不增加。按用例声明期待 guest 时匿名新context正常通过且没有沿用先前cookie。普通预检回执无秘密值或私有路径，工作区未生成截图/trace/报告；测试结束删除自身私有文件及引用。不读取个人认证。该证据只覆盖 native preflight，不是数据空间私密桥接或正式执行证据隔离验收。

首次测试读取了错误的统计字段 denominator/statistics，导致3个子场景在检查后报错，末场景受未恢复503影响；原生未被修改、失败未跳过。核对实际 contracts 后改用 planned_count/counts，补充每个子场景清理响应状态；首次失败日志 `u02-runtime-preflight.log` 保留（1通过/5失败，包含父测试）。没有将此测试错误登记为产品缺陷。

本轮实际执行（日志位于 `tests/scratch/ui-optimization-u00/`）：

- 联合原生回归12项通过、0失败/跳过（`u02-runtime-native-final.log`）：本次4个运行条件子测试、2个父/独立测试共6项，加U01前置门禁5项及partial恢复1项。不把它们称为12条业务用例。子进程校准、原生run与统计引用保留在日志指出的临时合成工作区。
- 相关5文件95项单测通过（`u02-runtime-unit.log`）；全量typecheck、lint、协议通过（`u02-runtime-typecheck-final.log` / `u02-runtime-lint.log` / `u02-runtime-protocol.log`）。本轮只改测试和文档，沿用已验证应用及原生分发包，无需重复升级插件或重建bundle。
- Electron实际进程9项检查通过（`u02-runtime-desktop.log`），证据 `tests/scratch/data-space-skill-desktop/1792750643052/`。增加原生身份失效后的真实初始化阻塞，通过实际宿主sync保存“阻塞”，原“通过”行及ID保留；恢复目标后重查原请求不重放。`identity-blocked.json`保存原生preflight/runRef/同步回执，完整modal文本断言两条结论可查。首张截图只显示旧通过记录，后续调整证据滚动位置，不拿不可见文字当截图已展示阻塞。

A02-6/7 的上述合成运行时路径已有直接工程证据；A02-5 私密桥接和正式执行证据通道仍未实现。角色/初态的真实业务依据、当前OperationContract身份及诊断副本、真实模型条件、U00完整基线、U05/U03/U07及U09仍未放行，不因预检已有能力而关闭整计划；U08未启动。

最终桌面9项再次通过，证据 `tests/scratch/data-space-skill-desktop/1792750736696/`（`u02-runtime-desktop-evidence.log`），不累加两轮数量。已人工查看 `identity-blocked.png`，本次截图实际显示“阻塞”及对应原生runId。当前仍无plan_update工具，执行记录继续作为进度入口；未伪造应用看板节点。

### U05 续跑：按功能策略与原生 locator 生成接入（0.1.2）

起点 `7084b7b8e88323a9ae81f26768ebab43f3b94f89`。此前轮已修改源码并产出实际回归证据，属于进展；本轮检查原安装进程终态后继续，没有重复安装或启动未确认结束的任务。保留 `.gitignore`、db-client 锁的用户差异。沿用 skill-creator 维护原有发现 Skill，不新增定位器库、探索阶段或 runner。

先核对实际 Playwright 测试 MCP 的 `browser_generate_locator` 与 target 契约：target 可为快照 ref 或唯一 locator 字符串。原生 recordingTools 未允许生成工具，新回归先失败（invalid-input），日志 `tests/scratch/ui-optimization-u00/u05-locator-before.log`。维护源增加这一可选 action，最小7项必需 MCP 能力不变；不把 locator 生成成功当作唯一/可操作证明。新按需参考 `ui-discover-record/references/function-discovery.md` 说明概览、逐功能状态、同角色会话复用、早期 inventory.drafts、定位重验及范围/预算缺口，执行/分析/查看路径不读取该参考。

原生真实 Pi/嵌套 MCP/Chromium 回归：从快照生成 Name 和 Save locator，实际严格 fill/click 成功；最终写脚本前保存有 observation 来源的单功能草稿并确认最终文件尚不存在。随后同一会话内导航重载、快照核对持久化，再复用原 Name locator 严格填值，没有重新找 ref。计量1次setup、2次locator生成、1次显式导航，录制13个原生动作，关闭后归属清理成功；生成草稿实际重放通过，仍须独立设计批准。初轮测试错误地假设 navigate 直接返回完整快照，实际只返回快照文件引用；保留失败日志 `u05-source-recording-final.log`，增加显式 snapshot 后通过，未削弱持久化断言。

上游本地提交 `5c8c437d3b8ef1e121ee20a6cca80816c38a3771`；没有上游远端推送授权，未推送该仓库。从源码构建并打包0.1.2，SHA-256 `aef9f4544b31f7c4f312194e6db801a883fb5d76eb98a7456ab17dcccd6541fb`。同步项目 tgz、profile清单/锁、维护来源并通过原安装流程安装；没有改 node_modules 实现。原0.1.1可从Git及既有证据恢复。

本轮实际执行，日志均位于 `tests/scratch/ui-optimization-u00/`：

- 上游完整构建、类型检查、Skill quick_validate通过；构建后2文件15项原生回归通过、0失败/跳过（`u05-source-built-regression.log`），含来源、预算、去重、私密输入、旧会话拒绝及本轮定位复用，不是15条业务用例。
- 当前安装包实际SDK/MCP集成通过（`u05-installed-integration.log`）：安装schema包含可选locator action，实际MCP生成定位并由真实严格click消费；独立依赖/相对seed、取消和执行守卫继续通过。没有把单独MCP点击冒充完整多功能录制。
- 隔离Electron实际进程7项检查通过（`u05-desktop-visibility.log`），证据 `tests/scratch/ui-workflow-visibility/1792754754701/`。桌面管理页可见9技能；升级后的发现技能禁用/启用跨reload保持且联动 `/ui-discover`，MCP87工具可连接/重连。`discovery-restored.png`已人工查看，实际显示发现技能快捷项。没有操作用户正在使用的窗口、个人认证或模型。
- 宿主全量typecheck、lint、协议通过（`u05-typecheck.log` / `u05-lint.log` / `u05-protocol.log`），相关2文件10项单测通过（`u05-unit.log`），size检查通过（`u05-size.log`）；目录布局首轮发现数据空间Skill超过8KB（`u05-layout.log`），修复后结果见下文。宿主无生产代码变化，使用已有构建；新包由隔离安装实际加载。0付费模型、0真实业务请求。

本次覆盖A05-2/3/4/5的单功能工程子路径及按需策略，不关闭U05：冻结的六类多功能范围尚未通过完整Agent发现/状态/定位/候选链验证；重复按钮/frame、角色或部署变化重验、完整覆盖对照仍需补证。策略文字与控制协议回归不能证明真实模型遵循度；U00计量、U02私密执行/证据隔离、U03/U07和U09仍未完成。整goal保持进行中，U08未启动、保留串行。

目录布局回归进一步暴露 data-space-testing 入口11867字节，超过宿主 skill 工具8KB硬上限，SDK发现与桌面列名正常却无法按名加载正文。没有提高上限或复制规则：将入库/绑定/同步详细章节原样移到 `references/native-handoff.md`，入口按相关意图加载，保留核心授权和重复执行边界。此为U06相关能力交付修复，纯Skill文档不升级插件。首轮失败证据保留；最终目录回归3项通过（`u05-layout-final.log`），宿主按名称实际加载五个入口，两个项目Skill quick_validate通过。入口正文降为5107字节。额外数据空间Electron9项通过（`u05-data-space-desktop.log`），证据 `tests/scratch/data-space-skill-desktop/1792755411313/`，包括技能启停/快捷发现、原生归档、版本及身份阻塞；0模型、0真实业务请求。没有因此将U06或整计划记为完成。

### U05 续跑：六类功能草稿、同会话复用与预算缺口

从中断留下的 `tests/ui-function-discovery-test.mjs` 续接，复用冻结的 `u00-1` 页面、六类功能、tester/viewer 和原 60 动作 / 120 秒上限。原生包仍为 0.1.2，没有修改运行包、生产代码、个人安装或既有页面。使用真实 Pi SDK / 测试 MCP / Chromium，控制调用只验证工程路径，不计真实模型规划或正式业务回归。当前无 `plan_update` 工具，以本记录和计划放行表同步进度。

中断前失败是测试草稿把附件写到存储契约不允许的目录；本轮修正附件归属和 seed 文件摘要登记。后续运行暴露快照含 `[ref=...]`、Details 实际为 generic 而不是 button，以及原生 inventory 会追加草稿引用的事实；修正测试假设，未改产品来适配错误预期。失败日志和证据均保留，详见[本轮摘要](ui-testing-evidence/optimization-u05-multifunction.json)。全局技能 doctor 固定要求 0.1.0，因实际已升级 0.1.2 报版本不匹配；其余依赖与 Chromium 检查通过，本轮以实际安装版的 SDK/MCP 和 Electron 回归核验兼容性，不降级或覆盖个人技能。

最终多功能回归 **5 项工程检查通过**，包括：

- 查询首份草稿在其他五类功能探索和最终脚本生成前持久化；后续逐功能存稿累积引用，旧清单中的未完成 Reset 缺口不被新清单覆盖。
- 六类功能保留稳定 feature/scenario ID、角色、入口、声明摘要、实际状态及观察引用；未观察断言明确留 gap，草稿定位不含临时 ref。
- tester 同一次录制执行 49 个探索动作：setup 1、snapshot 15、locator 生成 13、type 4、click 15、navigate 1；另有 1 次归属清理。Query 定位跨同角色重载后实际严格交互成功，合成新增数据重载后可查到。
- viewer 使用独立角色范围与新 context，Add 确实隐藏但 permission 功能仍保留；错误角色清单被拒。预算压力分支配置为 2 动作，setup 与 snapshot 后的点击在 MCP 前拒绝；没有删除原六类范围，另外五类仍保存未探索缺口。预算耗尽后 browser_close 成功，finish 保留 `step-budget` 和 `partial`。
- tester 的 partial 录制 checkpoint 被原工作流拒绝，原任务仍在 discover-record、已完成阶段为空，没有启动额外 MCP 或正式 runner。viewer 结束也不覆盖 tester 原始 partial。

原始成功证据 `tests/scratch/ui-function-discovery/1792758448582/`，140 个文件引用逐一回读核对 SHA-256；包含 seed、配置、原生动作回执、逐功能草稿、历史清单及任务状态，不含认证、会话或 node_modules。已保存约 37KB 的[可迁移证据归档](ui-testing-evidence/optimization-u05-multifunction.tar.gz)，归档摘要登记在本轮 JSON；历史失败继续保留在本地 scratch，没有混入成功统计。

本轮隔离 Electron **7 项通过**，证据 `tests/scratch/ui-workflow-visibility/1792758121280/`：技能可见、发现技能禁用/启用跨 reload 保持、快捷发现、MCP 87 工具连接及重连。已查看 `discovery-restored.png`，实际显示发现技能快捷项。本轮没有操作个人应用窗口或重载用户服务；桌面管理接入与控制多功能探索分列，不宣称已在桌面完成真实模型端到端探索。

全量 typecheck、3 文件 **51 项单测**、lint 通过；协议结构检查通过，Git 历史版本启发式因无 tag 跳过。日志前缀 `tests/scratch/ui-optimization-u00/u05-multifunction-`。测试代码已格式化，提交前核对差异和体积预算；0 付费模型、0 正式 runner、0 真实业务请求。

验收边界：A05-1/2/3/5/8/9 的上述工程路径已有证据，A05-4 仅本页严格交互与重载复用；A05-6/7 未全量完成。加载瞬态、带查询条件的分页、取消的写副作用独立核验、重复按钮/frame、部署/依赖变化以及完整候选的断言—脚本映射仍待补齐。两角色分别保留权限缺口，不把对方观察写成本角色已验证。U05、M1/M2 和整计划继续进行中；U00完整计量、U02私密桥接/证据隔离、U03/U07、U09及真实模型/OperationContract条件仍未放行，U08继续未启动。后续先补可独立验证的工程缺口，再按原前置关系推进，不用这次阶段成果关闭最终交付。

### U05 状态补证：加载、条件分页与取消不落库

继续复用同一 `u00-1` 页面、初始数据、角色和 60 动作 / 120 秒预算。仅扩展工程回归，不修改运行包、业务页面或桌面实现。seed 中的只读 MutationObserver 记录真实 DOM 状态：Loading 时列表为空，随后 Ready 显示 Alpha/Beta；原生 setup 成功后回读并保存观察，不靠顺序 MCP 快照碰巧捕捉 80ms 瞬态。

取消分支先填写合成名称再取消，随后重新打开并保存同一名称，重载后精确查询只出现一条，核验取消没有额外持久化一条 Names 数据。为了验证分页保留的是有效过滤而非仅输入框文本，新增名称使用不含 a 的 `U05-owned-item`，保存后查询 a，再核对末页仅 Gamma、上页 Alpha/Beta、两个分页边界及查询文本。原测试输入和证据不覆盖；本轮是增加覆盖，不作为与原样本的成对性能比较。

真实 SDK/MCP/Chromium **6 项工程检查通过**，tester 52 个探索动作加 1 次清理，预算未提高；viewer 的 2 动作压力分支、错误角色拒绝、旧草稿不可变及 partial 不得交接设计继续通过。成功证据 `tests/scratch/ui-function-discovery/1792760822258/`，含两角色 loading 原始记录；[本轮摘要](ui-testing-evidence/optimization-u05-state-coverage.json)与[压缩归档](ui-testing-evidence/optimization-u05-state-coverage.tar.gz)保存完整引用及校验摘要，上一轮归档保留。

本轮全量 typecheck、51 项相关单测、lint、协议结构检查通过；协议历史版本检查因无 tag 跳过。日志前缀 `tests/scratch/ui-optimization-u00/u05-states-`。本轮没有应用或安装改动，前轮 7 项 Electron 管理接入证据只作为历史依据，不算本轮新执行；0 模型、0 正式 runner、0 业务请求。

上述三个状态缺口已补齐，但 U05 仍未完成：完整候选的断言—脚本映射、独立设计评审/诊断、重复按钮/frame 及部署/依赖变化仍待验证。角色观察不跨 scope 冒充通过，预算分支保留原缺口和 partial；U00/U02、真实模型/目标及 M1/M2 原门禁仍然有效。下一阶段继续工程候选与独立测量，不把本次状态覆盖当作最终验收。

### U04 扩展历史集：列举、完整读取与重复恢复

扩展现有 `tests/ui-sync-read-benchmark.mjs`，复用原生合成夹具和正式 runner 产生的 8 个真实批次，不复制 run manifest 伪造历史。设计评审仍为控制协议响应，0 真实模型、0 真实业务请求。每个历史规模（1 / 8 批）测量首次组件恢复及其后 5 次重复恢复；计量前创建批次，恢复期间断言目标请求数不变。使用同一进程重建 automation 组件，不能称为 Electron/进程重启、机器冷缓存或完整 Agent 基准。

最终样本：

| 历史批次 | 每次工作区列举 | 每次完整 run 读取 | 后5次耗时中位数 | 其中完整读取 | 其中列举 | 后5次结果写入 |
| -------- | -------------: | ----------------: | --------------: | -----------: | -------: | ------------: |
| 1        |              1 |                 1 |        10.713ms |     10.367ms |  0.174ms |             0 |
| 8        |              1 |                 8 |        84.469ms |     83.260ms |  0.616ms |             0 |

一个工作区同时有绑定与通道时只列举一次；8 批首次恢复补入未同步的 7 条结果，随后每次恢复新增行数和写入均为 0。8 个结果保留原生通过状态和唯一关联键，没有因为重复恢复重放浏览器。保留单批首次及重复 sync 的测量；全部逐次数据、8 个原生 manifest 摘要及[证据归档](ui-testing-evidence/optimization-u04-history.tar.gz)见[本轮摘要](ui-testing-evidence/optimization-u04-history.json)。归档约 73KB，不包含依赖或私有批准目录。

结论仅限这个局部样本：读取/核验证据占主要时间，但 8 批组件恢复约 84ms，尚不能认定它是完整 Agent 流程的主要瓶颈。按照 U04 的按需实施规则，本轮不新增跨请求缓存或启动索引；保留每批当前证据重验。U00 完整阶段计量、更多历史规模、catalog/status 路径和缓存/索引价值仍待核定，不声明全局 20% 提效或启动零扫描。A04-2 的当前工作区去重、A04-3 重复恢复零写入、A04-5 的 1/8 批比较已有直接证据，U04 仍进行中。

全量 typecheck、2 文件 26 项相关单测、lint、协议结构检查通过；无 tag 的历史版本检查跳过。日志前缀 `tests/scratch/ui-optimization-u00/u04-expanded-`。本轮仅修改测量脚本与记录，没有改生产代码、运行包、个人应用或既有 U00 基线；没有以本样本替代桌面冷启动和真实模型验收。

### U02 原生认证捕获隔离：工程修复与安装回归（2026-10-24）

本阶段继续处理 A02-5，复用合成 Names 页面和受控评审。原生 0.1.2 的真实正反诊断复现了 9 个公开文件/ZIP 条目包含合成秘密；原始失败日志 `tests/scratch/ui-optimization-u00/u02-private-capture-before.log` 保留，未把原始泄露内容归档进仓库。本轮不读取个人认证，0 付费模型、0 真实业务请求。此前询问的真实认证映射仍未取得，数据空间 `privateExecution:not-ready` 不变。

修复从上游源码完成并创建本地提交 `a4d69aae59fd451664f10e65e2f6ce769bbe3a24`，未推送未经授权的上游远端。重新构建分发 `pi-ui-testing` **0.1.3**，更新本项目依赖与锁，安装版 `private-evidence.js` 与源码构建逐字节一致；包摘要与位置见[维护入口](../.pi/skills/ui-testing-workflow/references/maintenance.md)。旧包仍可从 Git 恢复，没有覆盖个人安装、重载个人进程或发布应用。

实现范围：诊断/正式 runner 的原始 stdout/stderr、JSON reporter、截图和 trace 写入工作区外的宿主私有目录，捕获目录 0700，原始进程记录 0600；拒绝工作区内认证文件/私密目录、符号链接回流及公开权限目录。公开副本移除已知 storageState 值、认证路径及 URI/JSON/base64 形式；附件路径使用摘要，图片和 trace 二进制资源不公开。公开 trace 带隐私限制，真实失败仍计 failed；缺失原始附件时保留 R3/完整性缺口。脱敏与 reporter 字段/状态冲突时拒绝生成结果，不改写通过或失败。ZIP 读取增加实际字节核对，trace 解析绑定实际 CLI 的 Playwright core 1.62.1，避免误用工作区另装的 1.63.0。

本轮实际验证：

- 安装版合成认证 **6 项工程检查通过**：两次正反诊断实际消费 cookie；正式成功计 passed=1；注入持久化缺陷后计 failed=1 且 complete=false；公开 trace 仍可按原生归属读取；4 份原始捕获和正式失败的 1 张截图留在私有目录；逐一扫描公开文件、解码附件正文及解压 ZIP，没有发现测试秘密/认证路径的受测表示，也没有公开图片、视频或 trace resources。
- 上游原生 **36 项通过、1 项跳过**，覆盖诊断、正式执行、取消、结果对账、trace 查看及新增 5 项私密边界检查。最终异常处理调整后又执行这 5 项，全通过，不重复累计。跳过项为需额外模型授权的 live 独立评审，不算通过。
- 本项目当前环境预检 **6 项通过**，partial 交付恢复 **1 项通过**；SDK/MCP **19 项检查通过**，包括独立依赖、自定义 testDir、相对 seed、门禁与 locator 生成；相关 Vitest **3 文件14项通过**。
- 隔离 Electron 最终 **7 项检查通过**，证据 `tests/scratch/ui-workflow-visibility/1792771188126/`：技能发现、禁用/启用及重载持久性、/ui、MCP 87 工具和重连，退出清理成功。已查看 `discovery-restored.png`。这验证桌面管理接入；认证浏览器执行另由真实原生 runner 验证，未宣称桌面真实模型端到端完成。

失败历史保留：第一次源码修复遇到 core 版本解析不匹配；扩大截图检查时测试错误期待两张 PNG，核对原实现后改为正式失败 1 张，诊断原本仅捕获 trace。桌面首轮虽完成 7 项功能检查，但退出超时，整轮仍记 FAIL；第二轮 /reload 留在输入框而未送出，整轮 FAIL。针对已观察到的提交问题，测试改点实际“发送”按钮并保存应用日志，未放宽功能或清理断言；最后完整复查通过。退出超时根因仍未确认，不称产品缺陷已修复。全部日志在 `tests/scratch/ui-optimization-u00/u02-private-*`，没有删去失败样本。

[本轮摘要](ui-testing-evidence/optimization-u02-private-capture.json)与约 67KB 的[公开证据归档](ui-testing-evidence/optimization-u02-private-capture.tar.gz)包含 89 个公开文件、68 个逐一核对的原生引用；归档再次逐文件回读校验 SHA-256。原始私密目录、认证文件、依赖和泄露前的原始捕获没有归档。全量类型检查、格式、lint、协议结构、体积预算与差异检查完成；协议 Git 历史启发式因无 tag 跳过，清理只预览。

验收限制：本轮只证明已声明合成 cookie 及受测编码在原生诊断/正式捕获中的隔离。录制 MCP、运行中新生成的凭据、嵌套/自定义编码、业务敏感内容、脚本自行写文件及数据台账仍不在该修复覆盖内，不能宣称全链路秘密识别或认证环境就绪。数据空间私密桥接、真实环境与 U00 完整计量仍未完成，U02 保持实施中。U05 完整候选/独立设计评审、U03/U07/U09、M1/M2 与原真实模型/OperationContract门禁继续保留；U08 未启动。

### U05 完整源码候选与断言映射（2026-10-24）

继续复用冻结 `u00-1` 源码和已归档的多功能探索证据。先校验历史归档 SHA-256，并逐字节确认其中的页面声明仍与当前冻结文件一致；不重新录制 52 个既有动作，也不覆盖旧草稿、原任务或预算记录。原浏览器 partial 用于证明阻塞交接，因此本轮没有把它当作 complete；按原生已有源码发现路径另存**同一完整六功能、两角色的源码候选**，明确不作为浏览器链完成。

新增 `tests/fixtures/data-space/ui-multifunction-candidate.ts`，对应查询/重置、取消与持久化、标签与展开、条件分页边界、权限隐藏、加载/空/错误六个 case，共 **13 个具名 test.step 断言**。预期来自冻结 declaration、固定初始数据和预登记合成输入，不将旧观察直接升级为需求。权限 case 分别确认 tester/viewer 身份且使用独立 context；取消后重载查询为空，保存后重载只出现一条；分页先加不匹配 a 的合成名称以区分实际过滤；加载顺序使用只读观察，与前轮状态证据的方法相同。上述是待审候选设计，**本轮没有执行脚本**。

`tests/ui-multifunction-candidate-test.mjs` 使用安装版原生 ArtifactStore/checkDesign/UiWorkflowService 完成 **4 项工程检查**：六功能与13声明断言全部有来源及脚本绑定，TypeScript 静态问题为空；源码发现/候选交接停在 design-review，缺评审时不能完成、目录 runtime_ready=false；缺失断言绑定命中 D6，依赖版本变化命中 D3；两个旧 partial 录制及原 `u05-tester` 任务摘要完全不变。只在已核对的归档解包后观察候选阶段子进程，确认没有启动进程；0 浏览器、0 模型、0 正式 runner。此工程脚本直接调用原生服务，不宣称新增 SDK/MCP 或 Electron 端到端证据。

候选 `u05-full-declaration/v1` 与阻塞任务 `u05-source-candidate` 的真实引用见[本轮摘要](ui-testing-evidence/optimization-u05-source-candidate.json)。约50KB的[归档](ui-testing-evidence/optimization-u05-source-candidate.tar.gz)含188个公开文件、158个逐一核对的来源引用，归档回读摘要一致；包含历史公开证据及两个明确命名的负向静态变体，不包含依赖、认证或任何批准记录。成功原始目录 `tests/scratch/ui-multifunction-candidate/1792774806866/`，日志前缀 `tests/scratch/ui-optimization-u00/u05-candidate-`。

全量 typecheck、2文件 **20项 Vitest**、lint、协议结构、差异检查通过；协议历史启发式因无 tag 跳过。源码候选自身还由原生 TypeScript 检查器编译，不能用宿主 typecheck 代替。没有修改运行包或桌面生产实现，本轮不重复计前轮7项桌面通过。同期修正计划放行表 U02 行误填为任务分解表内容的问题，恢复与已保存证据一致的“实施中/0.1.3”，不改变原验收状态。

剩余门禁：独立评审必须经原生工具调用当前模型，既有测试模型额度已耗尽，本轮没有代填评审或借新任务重置费用限制。全部断言的合理负向诊断副本、候选实际运行、完整浏览器候选交接仍待准备/放行；重复按钮/frame、部署变化与真实模型/OperationContract 条件仍未完成。源码候选补充 A05-6/7 的可审查材料，不等于独立设计批准、运行就绪或 U05 完成；U00/U02/U03/U07/U09、M1/M2 继续未完成，U08未启动。

候选模板使用 `.ts` 而非 `.spec.ts` 文件名，避免普通 Playwright 发现误执行未获批候选；生成到原生产物内时才使用 candidate.spec.ts。模板更名后的同4项检查再次通过（`u05-candidate-template-check.log`），不重复累计检查数，归档内候选字节未变。

### U05 定位补证：重复按钮、iframe 与变化重验（2026-10-24）

新增独立 wrapper 包裹冻结 `u00-1` 页面：Toolbar/Backup 各有一个 Search，Names iframe 内的页面按原始字节返回。版本2仅改变 iframe 属性、路径、标题并增加干扰 frame；没有修改冻结页面。三条工程分支在浏览器动作前登记范围、预期与各60动作/120秒预算，不以新分支重置原任务预算。

真实 Pi SDK → 原生0.1.3 → 测试 MCP → Chromium **4 项检查通过**：未限定范围的 Search 因严格匹配两个按钮被拒绝，录制停止后普通动作在进入 MCP 前被阻止，但允许清理；限定 Toolbar 的实际生成定位器只增加该区域计数；iframe 实际生成的 Query/Search 定位器完成 Gamma 查询；wrapper 变化后旧定位器明确无匹配而停止，独立预登记 v2 分支重新观察、生成不同定位器并成功填写。三个分支分别2/14/5动作，另各1次关闭。全部 frame 响应摘要与冻结页面一致。

三个录制 manifest 均保留 **partial**，没有生成完整脚本、设计批准或正式 run，也不覆盖原六功能的 partial 任务。受控 wrapper 变化不是实际业务部署认证；上一阶段的依赖静态拒绝也不算本轮浏览器依赖变化验证。0模型、0正式runner、0真实业务请求。

成功证据 `tests/scratch/ui-locator-revalidation/1792775765630/`；[摘要与索引](ui-testing-evidence/optimization-u05-locator-revalidation.json)及约23KB的[归档](ui-testing-evidence/optimization-u05-locator-revalidation.tar.gz)包含90个公开文件、75组逐一校验的引用，归档再回读校验，不含SDK会话、认证和依赖。首轮成功历史保留，最终轮加强严格错误、分区计数、原页面摘要和证据复制检查后仍通过。

全量typecheck、3文件14项单测、lint、协议结构通过；协议历史启发式无tag跳过。日志前缀 `tests/scratch/ui-optimization-u00/u05-locator-`，清理仅预览。本轮仅测试/文档更新，前轮Electron7项仅作历史接入证据，不算本轮执行。A05-4/5上述工程缺口已有证据；完整浏览器候选、独立评审、13断言正反诊断、实际依赖/部署与真实模型验收仍待完成，U05及M1/M2保持未完成。

### U05 诊断输入准备：13 个错误副本（2026-10-24）

按原生诊断契约，负向探针必须使目标 assertion 的 expect 失败，并让全部非目标 case 通过。因此没有用全局隐藏 Add 一类会连带破坏编辑/分页的错误副本。新增 `ui-multifunction-probes.mjs`，逐条声明13个源码替换：忽略查询、重置保留过滤、取消误持久化、保存丢持久化、标签选中错误、默认展开、每页行数错误、下一页丢过滤、viewer显示Add、tester禁用Add、加载/空/错误状态文本错误。

新修订 `u05-full-declaration/v2-probes` 仅在候选增加 `x-u05-case` 用例标识（含独立viewer context），用于受控副本按case注入；它不是认证机制。删除这两处新增后，脚本字节与原v1一致，全部原断言/预期不变。冻结正副本不修改；每个负副本只在目标case收到标识时替换唯一源码片段，预检和非目标case得到原始HTML。13个探针、14份环境/配置、变异来源及诊断计划均纳入新修订files，原v1、原阻塞任务和浏览器partial不覆盖。

`tests/ui-multifunction-probes-test.mjs` **3 项准备检查通过**：14个不同本地origin、98次HTTP页面内容检查核对目标/非目标隔离和返回摘要，非法路径404；所有变异脚本语法可解析；原生环境/诊断schema及候选静态检查通过，13条断言全部映射。未启动浏览器、模型、诊断或正式runner。**这些检查没有证明浏览器确实检出13种故障，也没有授予设计批准或runtime_ready。**

本轮所有夹具服务已关闭，保存确切origin和状态；后续恢复相同地址/源码并重新验证身份/初态，若端口、配置或源码变化则生成新修订。当前仍引用仅允许准备的source-only scope，进入执行前还须对齐明确执行范围与环境后独立审查。原生模型评审既有18/18额度耗尽，不能用控制协议或生成者结论代替；诊断依赖评审批准，继续未执行。

成功证据 `tests/scratch/ui-multifunction-probes/1792776816807/`；[摘要](ui-testing-evidence/optimization-u05-probes.json)与约55KB的[归档](ui-testing-evidence/optimization-u05-probes.tar.gz)保存228个文件、193组已回读核对引用及HTTP返回摘要。继承的file-index.json引用旧catalog，保留在原历史归档中，本轮归档不重复纳入它，改用当前逐文件索引；没有改写旧摘要。全量typecheck、3文件14单测、lint、协议结构通过；无tag的协议历史检查跳过。日志前缀 `tests/scratch/ui-optimization-u00/u05-probes-`。本轮仅候选准备和测试/文档，未重跑Electron，历史桌面结果不计入本轮。

U05继续实施中：诊断输入已准备，独立评审、实际正反诊断、完整浏览器候选交接和真实环境验收未完成。原U00/U02前置、U03/U07/U09与M1/M2门禁仍保留，整目标没有标完成；U08未启动。

### U04 目录与任务状态路径计量（2026-10-24）

新增 `tests/ui-catalog-read-benchmark.mjs`，从已校验的8个真实原生run历史归档建立1/8批隔离样本，原批次摘要保持不变。测量 catalog、view/analyze/execute 的 status，每条路径1次首次查询+5次重复查询，共48次。查询任务通过原生workflow登记，未启动执行；私有批准目录故意缺失，catalog全部runtime_ready=false，独立gate明确以“评估没有经独立评估调用路径登记”拒绝。历史控制评审不是本轮真实模型批准。

| 历史run数 | 查询路径       | 后5次中位数(ms) | 每次readFile调用 | 每次readdir调用 | 每次catalog替换 |
| --------: | -------------- | --------------: | ---------------: | --------------: | --------------: |
|         1 | catalog        |          14.976 |               45 |              38 |               1 |
|         1 | status-view    |           0.138 |                1 |               0 |               0 |
|         1 | status-analyze |           0.458 |                4 |               0 |               0 |
|         1 | status-execute |          15.600 |               56 |              38 |               1 |
|         8 | catalog        |          16.108 |               52 |              59 |               1 |
|         8 | status-view    |           0.140 |                1 |               0 |               0 |
|         8 | status-analyze |           0.398 |                4 |               0 |               0 |
|         8 | status-execute |          16.712 |               63 |              59 |               1 |

计数来自本轮进程内对实际fs/promises读文件/目录及原子替换的观察，调用保留原实现；时间包含观察开销。首次查询不是桌面冷启动，后续查询共享进程/文件系统缓存，不是完整Agent基线或20%优化结论。catalog/execute-status仍全量重建目录；两个规模均发现同一候选脚本在一次catalog中读取16次。追溯到原生引用验证及批准检查的重复读取，后续可评估单次核验内去重；本轮没有修改生产实现或增加跨请求缓存，也不能据此宣称整体主要瓶颈已确定。

**3项工程检查通过**：上述读取/扫描计量；损坏一个run时准确列为invalid并保留另外7个、删除后不再列出、原字节恢复后重现8个、损坏catalog可重建；任务及run文件不被查询改写且0子进程/0浏览器/0模型/0正式runner。catalog缓存自身会原子替换，如实计入，不写成零磁盘写入。

测试失败保留：首轮误认为execute-status必返回未批准blocker，而原契约只在status检查能力/活动run、在执行gate强制批准；调整为单独断言gate的确切拒绝，不把空status blocker视为运行就绪。随后错误使用WorkflowError.code而非category造成测试失败，修正字段后复验通过，均未计入通过次数。日志 `u04-catalog-first.log`、`u04-catalog-gate-final.log` 与最终 `u04-catalog-verified.log` 保留。

最终证据 `tests/scratch/ui-catalog-read/1792777795663/`，见[汇总](ui-testing-evidence/optimization-u04-catalog.json)和约5KB的[计数及查询任务归档](ui-testing-evidence/optimization-u04-catalog.tar.gz)；原生run/资产继续引用不可变历史归档，8个run摘要重新核对，不重复复制依赖或批准。全量typecheck、4项工作流单测、lint、协议结构检查通过；无tag历史检查跳过。仅测量代码改动，未重跑Electron，未将历史桌面结果记成本轮。U04仍实施中，完整U00计量及是否值得跨请求索引仍待核定。

### U04 单次引用核验去重与安装/桌面回归（2026-10-24）

依据前轮catalog中同脚本读取16次的实测，从上游原生 `verifyReferences` 入手，仅增加一次调用内的成功引用集合。键包含path和sha256，只有路径边界与文件摘要均通过后才登记；同路径不同摘要不能复用，下一次调用/并发调用各自重新读取。未增加跨请求缓存、全局索引或新的批准路径；不承诺对外部并发文件修改提供原子快照。

先加回归复现3项失败/1项通过（相同引用实际3次读取，两个并发调用共4次读取）；修复后4项通过，覆盖嵌套重复引用、冲突摘要拒绝、下一次调用的文件变更/删除/越界链接拒绝和并发核验独立性。上游源码本地提交 `b31dd3c5dae980bcffe6708ece1145defedbe855`，未推未经授权的上游远端。包升级 **0.1.4**，本项目清单/锁及当前分发包同步，安装版validation.js与源码编译结果逐字节一致；旧0.1.3可从Git恢复。来源及摘要见[维护入口](../.pi/skills/ui-testing-workflow/references/maintenance.md)。

复用完全相同的8个历史run摘要和1/8批样本，48次查询与前轮逐次对比：

| 历史run数 | 路径           | 每次readFile：修改前→后 | 同脚本读取：前→后 | 目录扫描 |
| --------: | -------------- | ----------------------- | ----------------- | -------- |
|         1 | catalog        | 45→29                   | 16→2              | 38，不变 |
|         1 | execute-status | 56→40                   | 16→2              | 38，不变 |
|         8 | catalog        | 52→36                   | 16→2              | 59，不变 |
|         8 | execute-status | 63→47                   | 16→2              | 59，不变 |

view/analyze的status仍分别1/4次文件读取、0目录扫描。catalog仍每次原子替换一次，同一脚本还需在两个独立核验调用各读一次，不能声称目录全局只读一次。篡改/删除/恢复、损坏catalog重建、未登记批准拒绝、查询不改写task/run及零浏览器均复验通过。当前计时**没有显示稳定提速**：新样本伴随其他隔离回归，不能用于成对耗时优化结论；仅报告确定性的读取次数减少，不宣称20%整体提效。

本轮验证：上游10个测试文件合计**61通过、2跳过**，两项跳过为需额外模型授权的真实设计/结果评审，不能算通过；上游全量类型检查通过。宿主SDK/MCP **19项通过**、相关Vitest **14项通过**、全量typecheck/lint/协议结构通过，协议历史启发式因无tag跳过。隔离Electron **7项通过**，包含技能及快捷项发现、禁用/启用和重载持久性、MCP87工具连接/重连；使用已构建宿主和新安装原生包，未更改宿主生产代码。已查看本轮 `discovery-restored.png`，可见“UI 场景发现与录制”快捷项。没有读取个人凭据、操作个人窗口或新增模型调用；原生runner仅在隔离合成工程回归中执行。

[本轮摘要](ui-testing-evidence/optimization-u04-reference-reuse.json)及约476KB[归档](ui-testing-evidence/optimization-u04-reference-reuse.tar.gz)保存前后逐路径计数、红绿回归日志、上游测试源码、桌面回执/截图及校验索引；原生历史资产仍引用已归档原文件，不复制依赖或私有批准。原始日志前缀 `tests/scratch/ui-optimization-u00/u04-reference-`，桌面证据 `tests/scratch/ui-workflow-visibility/1792778701560/`。

此修改完成已实测的单次引用重复读取子项；U04仍实施中，U00完整基线与跨请求索引价值未核定。U05独立评审/实际诊断、U02私密桥接及U03/U07/U09、M1/M2原门禁保留，整计划没有标完成。

### U05 续跑：确切地址恢复与原生评审阻塞（2026-10-24）

在已冻结 v1 与 v2 归档上新增 v3-replay，六功能/13断言保持原预期，只增加用例隔离请求头。范围、清单、用例及诊断环境对齐为合成 loopback；纳入14个确切地址的恢复入口、来源和 shared review lineage，不以新任务重置历史额度。旧 partial 浏览器任务与原候选摘要不变。

`tests/ui-multifunction-probes-test.mjs` **5项工程检查通过**：14环境/13探针静态契约、98次初始HTTP核对及98次恢复后字节核对、端口冲突拒绝并仅关闭自有服务、交接停在评审、旧证据不变。补验保存修订中的CLI入口实际启动14服务并正常关闭，浏览器就绪仍为unchecked。首次恢复测试因旧连接池读取失败的记录保留；改为每次独立HTTP连接后通过，没有放宽断言。

用户对“最多3次额外原生独立评审”的问题答复“授权”；未给出具体模型/输出/金额数值。本轮沿用Pi当前模型 `deepseek/deepseek-v4-pro`，自行采用8192输出tokens、总费用1美元保守上限及请求前预留账本；这是实施限制，不写成用户指定数值。认证由原生ModelRuntime使用配置的注册表，未输出或归档凭据正文。新增 `tests/ui-multifunction-native-review.mjs` 直接调用安装版 `ui_design_review` 工具，由原生工具建立全新空工具Agent；没有自填批准或控制响应。

实际结果：**3个原生评审轮次，2次供应商调用，0个有效设计决定**。第1轮被本测试入口200000-byte输入上限拒绝，未发出模型请求；实际输入223740 bytes，后改为300000-byte上限。期间同一request_id的重复调用只取回已保存错误，没有新增原生轮次或请求。第2轮模型错误（未捕获供应商具体错误类别，原因未知）；第3轮捕获HTTP **402 / quota**。原生raw/input/static与3轮错误记录保留，最后一次本地续跑由共享3轮预算守卫拒绝，未成为第4轮原生调用。后续修订使用同一授权账本，不借目录变化重置。

两次失败调用均报告0 tokens，但各保留0.32777712美元预留，共 **0.65555424美元**；零用量元数据不当作供应商免费证明，不是账单。原历史18/18不改写。原生任务显式block并保存当前引用，catalog `runtime_ready=false`；**13项浏览器正反诊断、正式执行均未执行**，不把依赖阻塞计成测试失败或通过。

验证：全量typecheck、3文件**31项Vitest**、lint、协议结构及差异检查通过；协议历史因无tag跳过。CLI恢复检查通过。本轮仅测试/证据/文档更新，未重跑Electron，不宣称桌面端到端或真实环境验收。日志前缀 `tests/scratch/ui-optimization-u00/u05-continuation-`，本轮证据目录 `tests/scratch/ui-multifunction-probes/1792807869667/`。

公开[续跑证据索引](ui-testing-evidence/optimization-u05-native-continuation.json)与归档保留257文件，逐项核对207组不同path+sha256引用；2组已过期可变任务引用单列为历史，其中运行中快照保留，准备时任务快照未保存、不补造。当前block任务摘要另行验证。归档不含node_modules、认证/模型缓存、私有批准目录或过时继承索引。

U05保持实施中。恢复供应商可用性及后续评审预算需明确处理，现有3轮历史不清零；当前没有可用批准，诊断与正式执行继续阻塞。U00全量计量、U02私密桥接/真实环境、U03/U07/U09及M1/M2仍未完成，U08未启动；此阶段成果不关闭最终交付。

### U05 续跑：完整浏览器草稿与候选交接（2026-10-24）

上一轮完成确切地址恢复及真实原生评审错误留证，属于进展；本轮没有重复付费请求。供应商HTTP402及3轮评审授权耗尽仍阻塞设计批准/诊断，但不阻塞补齐原未完成的浏览器录制草稿。原安装包保持0.1.4，未修改生产代码或运行包。

扩展现有 `tests/ui-function-discovery-test.mjs --complete-candidate`：复用冻结u00-1六功能/13声明断言和60动作/120秒预算，在逐功能草稿后增加分页首页边界、详情收起的真实观察，通过MCP保存native log和参数化脚本，再走原生finish/checkpoint/candidate。输入值保存在同修订helper，生成脚本和归档recording draft旁均保存helper；未把常量隐藏当作数据独立性证明，角色/新context/初态/本地归属仍有单独依据。原默认partial/预算压力分支保留。

完整录制 **5项工程检查通过**：58个动作（setup1、snapshot17、locator生成13、type6、click17、显式navigate1、read-log1、write-test1、close1），没有扩大60动作预算。首次查询草稿仍在其余五功能及最终脚本前落盘，历史草稿的Reset缺口不被覆盖；Query仍在同会话重载后严格复用。实际seed中检查Loading→Ready；viewer在独立beforeAll context确认身份及Add DOM存在/可访问匹配为0/隐藏，然后关闭；tester context随后新建并完成六功能MCP交互。内部seed步骤与viewer检查没有算成MCP动作，也不宣称viewer通过MCP录制。

新的原生recording状态为complete，原生浏览器发现交接进入case-design；用冻结声明及既有源码候选生成的六case/13断言脚本通过静态检查，再交接到design-review。脚本包含对已观察流程的补充显式断言，并非逐字导出native log，**13条回放断言仍未执行**。可信批准缺失时checkpoint拒绝，任务显式blocked，catalog runtime_ready=false；新录制任务不重置评审额度。前轮共享账本与公开快照逐字段相等，新增模型/评审/诊断/正式runner/真实业务请求均为0，测试入口还对模型调用增加拒绝守卫。

原默认分支另跑 **6项工程检查通过**：tester仍partial且不可进入case-design；viewer两动作预算耗尽在MCP前拒绝额外点击，允许close并保留step-budget/五功能未探索缺口；错误角色清单继续拒绝。历史归档摘要保持不变，没有将新的complete记录覆盖到旧partial或原评审修订。

失败保留：前两次在seed内新建再关闭viewer context使Playwright测试MCP选择已关闭context；改为在beforeAll检查viewer、再创建tester context后恢复。随后两次write-test失败，定位到macOS临时工作区 `/var` 与配置规范化后的 `/private/var` 不同，生成文件根匹配失败；测试入口统一realpath后成功。临时更改进程cwd未解决，已撤去。未改node_modules或放宽MCP的写入范围守卫。前两次退出依赖SDK shutdown，没有补造partial/清理回执；后两次已有显式close和失败partial。所有失败分区归档，不计通过数。

验证：全量typecheck、相关3文件 **31项Vitest**、lint、协议结构通过，协议历史无tag跳过。本轮仅扩展测试入口并保存证据，未重新执行Electron；这是实际SDK/MCP浏览器交接工程证据，不是桌面真实模型端到端或正式业务验收。日志 `tests/scratch/ui-optimization-u00/u05-browser-*`，成功目录 `tests/scratch/ui-browser-candidate/1792809587795/`，默认分支 `tests/scratch/ui-function-discovery/1792809547031/`。

[浏览器候选索引](ui-testing-evidence/optimization-u05-browser-candidate.json)与约166KB归档保存646个文件，596组分区内path+sha256引用回读一致；另1组来源候选引用从已核对的旧归档验证，不复制历史依赖。归档回读逐文件核对，不含认证/模型配置、agent会话、私有批准目录或node_modules。

本轮补齐完整浏览器录制草稿及原生设计交接工程缺口；U05继续实施中，独立评审、13诊断、真实环境及Electron端到端未放行。U00/U02与U03/U07/U09、M1/M2未完成，U08未启动；plan_update工具不可用，继续以本记录和第8节放行表登记，不创建虚假完成看板。

### U04 五组成对目录/状态测量（2026-10-24）

新增 `tests/ui-catalog-paired-benchmark.mjs`，复用目录计量入口并支持 `--runtime` 指定归档原生包。冻结计划后，0.1.3/0.1.4按前后、后前交替顺序串行运行5组，共10个进程、480次查询；每进程以相同真实历史引用建立1/8批样本，四条路径各首次查询和5次重复。0.1.3从固定Git提交提取并核对包摘要，0.1.4包摘要及实际validation摘要与已安装证据一致。准备工作已暖缓存，首次测量不称为冷启动；重复样本按每进程中位数组成5对，不把25次重复当独立进程对照。

| 历史批次 | 查询           | 前/后中位数 ms  | 成对变化中位数 | 成对变化范围     | 前/后最大值 ms  |
| -------- | -------------- | --------------- | -------------- | ---------------- | --------------- |
| 1        | catalog        | 15.051 / 13.079 | -14.0%         | -18.0% ～ -10.0% | 20.388 / 27.309 |
| 1        | status-view    | 0.158 / 0.158   | -9.5%          | -26.2% ～ +23.4% | 0.329 / 0.334   |
| 1        | status-analyze | 0.462 / 0.423   | -5.6%          | -15.2% ～ +9.9%  | 0.758 / 0.661   |
| 1        | status-execute | 16.667 / 13.962 | -15.6%         | -19.2% ～ -12.2% | 19.018 / 16.705 |
| 8        | catalog        | 16.065 / 14.564 | -8.1%          | -17.7% ～ +14.8% | 19.619 / 24.513 |
| 8        | status-view    | 0.142 / 0.139   | -4.2%          | -14.5% ～ +12.4% | 0.421 / 0.335   |
| 8        | status-analyze | 0.405 / 0.404   | -5.9%          | -25.0% ～ -0.2%  | 0.822 / 0.941   |
| 8        | status-execute | 17.506 / 16.624 | -5.0%          | -23.7% ～ -0.4%  | 21.892 / 41.567 |

变化为后版本/前版本减1，负值表示缩短；中位数比与成对变化中位数是不同统计量。所有首次值、重复值和进程耗时/背景负载均保留。catalog/execute同脚本每次读取16→2、总读取减少16、扫描次数不变，view/analyze读取不变；损坏/删除/恢复及缺失批准拒绝检查均通过。局部中位数有下降，但8批catalog存在反向样本，若干最大值升高，波动超过部分所报收益；**整体性能收益未证实，不声明20%提效或M2通过**。不因本轮毫秒级局部结果引入跨请求索引。

首次完整测量的10个worker均通过，但汇总把历史脚本名错写为candidate.spec.ts，导致16次读取断言得到0而失败；失败480样本及错误完整保留，不计入最终5对。同次发现after包摘要字段层级错误，修正为package.sha256，并在最终计划前核对包内容。随后重新冻结计划并运行最终5对，通过8条路径对照。单独0.1.3兼容性pilot不计入成对样本。无模型、浏览器或正式执行；历史控制批准不恢复为可信批准。

[成对测量索引](ui-testing-evidence/optimization-u04-paired.json)及约237KB归档保存174文件，包含最终/失败计划、所有worker原始输出、查询任务、两项测试源码和日志，逐文件摘要及归档回读一致。原始历史继续引用已验证的不可变历史归档，不复制运行依赖、认证或私有批准目录。最终目录 `tests/scratch/ui-catalog-paired/1792810321087/`；失败目录 `tests/scratch/ui-catalog-paired/1792810182378/`。

U04仍实施中，本轮补齐局部查询5组成对证据，未补齐完整U00流程或冷启动/Electron验收。U05独立评审、13诊断与正式执行仍受HTTP402/授权轮次耗尽阻塞，U02/U03/U07/U09及M1/M2不因局部测量放行。

本轮验证：全量typecheck、3文件11项Vitest、lint、协议结构、差异及体积检查通过；协议历史无可用tag，明确跳过。开始/交付前clean仅预览，可清理0项，未删除文件。本轮未重跑Electron，不把既有桌面结果计入本轮通过。

### U05 新增授权后的原生评审续跑（2026-10-24）

用户确认评审服务额度已恢复，并明确授权沿用deepseek/deepseek-v4-pro追加最多3次、总费用不超过1美元、最多8192输出tokens。共享账本保留此前3轮/2供应商错误和0.65555424美元预留，追加授权历史而非清零；总原生尝试上限6，总预留上限1.65555424美元，本次增量最多1美元。

实际追加3次原生工具尝试、1次供应商请求、0个有效评审决定：

1. 请求4仍绑定原u05-diagnostic-prepared任务与v3-replay修订，但其冻结scope的max_review_rounds=3已用尽，原生门禁本地拒绝，未调用供应商。未改原生schema、范围或私有批准记录强行增加轮次。
2. 请求5改为后来完整录制的u05-tester/v1候选：六功能/13断言、58动作的新证据已有独立任务，不新建空任务规避门禁；跨修订仍共享追加额度。完整原生输入582352 bytes超过入口原300000-byte限制，模型流在本地拒绝，原生保存空raw/error，未发出供应商请求。该候选尚无完整诊断计划，不能借v3-replay的计划或批准直接诊断。
3. 请求6前置加载遇到上一步resume已更新的任务摘要，保存preflight错误，没有进入原生工具或消费额外轮次。入口改为store.snapshot取得当前任务身份，再由workflow.find及resume核验本轮引用；不把旧摘要改写为当前。重试前核对无模型请求，保留独立preflight文件。最后一次原生尝试保留完整证据，将本地输入限制调为650000 bytes并继续执行费用守卫；实际供应商context580390 bytes，HTTP **402/quota**，0 tokens元数据，未生成有效决定。

因此用户报告的额度恢复尚未在本次Pi当前注册表调用路径验证成功，不能推测为输出格式或用例设计问题。新供应商失败请求保留 **0.79855512美元**费用预留，低于本次1美元上限；不是账单金额，0用量不当作免费证明。本次3次追加原生尝试已耗尽，不重复调用或更换目录重置额度。两个原任务都显式block在design-review；discover-record/case-design历史保留，13项诊断及正式执行继续未执行。

测试入口仅增加完整浏览器候选目录识别、当前任务快照读取、授权模型固定和追加结果后缀，原生评审仍由独立空工具Agent执行，无自填批准。公开[追加授权证据](ui-testing-evidence/optimization-u05-authorization2.json)和约116KB归档保存26文件：原生input/static/raw、全部新增错误、当前任务、共享预算、测试源码及验证日志；逐文件摘要与归档回读一致。旧两份归档未改动；不含模型/认证缓存、私有authority或依赖。

全量typecheck、3文件11项Vitest、lint、协议结构、体积检查通过；协议历史无tag跳过。clean仅预览、0项可清理；未重跑浏览器或Electron，不把旧录制/桌面结果当本轮执行。U05仍实施中，服务调用路径仍需排除402且未来评审需新预算；U02真实认证映射、U00全量计量及其他原门禁保留，整计划未完成。

### U05 官方额度路径根因核对与第三批授权（2026-10-24）

用户要求解决当前Pi调用路径额度问题并追加评审授权；明确告知沿用上轮最多3次、追加总费用不超过1美元。共享账本保留前6次原生尝试及3次供应商记录，新上限9次；新增费用上限按此前保留预留加1美元，本批尚未消耗任何评审次数或模型费用。未修改个人settings、models或认证配置。

通过同一个原生ModelRuntime.getAuth(model)解析认证，仅对DeepSeek官方 `/user/balance` 与 `/models` 发起只读请求，均HTTP200；有效服务地址为 `https://api.deepseek.com/`，所选 `deepseek-v4-pro` 在官方模型列表中。余额接口实际返回is_available=false，余额低于零。因此持续402已定位到本调用路径的API账户额度，不能因别处额度恢复就判本账户可用；无证据需要更换endpoint或模型。初始化未刷新的getProviderAuthStatus缓存不作为认证失败依据，真实HTTP200才是本次请求事实。

公开[额度路径诊断](ui-testing-evidence/optimization-u05-quota-path.json)只保存布尔余额结论、非秘密地址和状态码，精确账户余额仅留本机scratch，不提交个人财务明细、密钥或认证配置。未输出密钥，也未直接读取个人认证文件；没有模型请求、付款、充值或新的浏览器动作。用户需在该API账户完成充值，或说明已恢复额度的其他平台，以便继续核对；不会擅自购买额度或切换未授权服务。当前三次追加授权保留未用，充值确认后先重新核对官方余额，再续原生评审。U05及整计划仍未完成。

### U05 切换用户配置的 gpt-6.1-sol 并取得独立评审（2026-10-24）

用户要求改用已配置的ChatGPT模型，默认gpt-6.1-sol。通过原生ModelRuntime确认实际配置为gpt/gpt-6.1-sol，经用户配置的转发服务调用，不将其称为OpenAI官方直连。Pi settings仅修改defaultProvider/defaultModel，先保留本机0600权限备份；不改密钥、其他配置或运行中个人进程。新默认适用于后续读取配置的任务，不能宣称既有Pi会话已重新选择模型。

用户提供Standard四个价格0.40/2.00/0.50/0.02元每百万tokens但未附列名；不猜映射，将所有输入/输出均按最大2元估算。汇率公开接口2026-10-24返回1美元兑6.684864元，预算采用更保守的6元；每输入UTF-8字节预留1 token并计最多8192输出。注册表零价格不当作免费。第三批授权1美元中本次预留0.196194美元，仍保留预留而非以零cost元数据扣为免费；本批仅调用1次，剩余全局授权2次。

实际调用ui_design_review建立全新空工具Agent，模型返回stop，164211输入/2247输出tokens，耗时62656ms；原生校验引用与D1–D10结构后登记**revise**，这是有效独立决定，既非批准也非工具故障。旧HTTP402、两个本地输入拒绝及3轮预算历史均保留。评审指出两个阻塞问题：D4取消检查先reload会漏掉仅写入内存的错误；D8所有测试共用origin，未实现冻结声明的逐测试新origin。

新增tests/ui-browser-review-revision.mjs仅按该评审生成不可变v2，保留v1及原评审。取消检查在reload前通过UI搜索取消名称并等待Empty/0行，再保留原reload后检查；新origin.fixture.ts从明确配置的loopback合成部署读取HTML（包含未来诊断变异），为每个测试分配自有监听origin，记录本worker用过端口并拒绝复用，finally关闭自有服务；不改变源服务。helper、fixture、数据规则、来源和评审lineage进入新修订，六case/13断言映射保留。原生TypeScript/来源/映射静态检查及再次回读通过；**v2未执行、未重评、未批准**。

原任务u05-tester的原生scope最多3轮，前两次本地失败加本次有效revise已用尽；新增全局授权剩余2次并不能覆盖该原生冻结门禁。未新建任务/改scope/修改私有authority逃避限制，原任务仍blocked/design-review。后续需明确处理原生评审预算续授机制才能在同任务重评；本轮不擅改原生包或将新修订写成获批。正常/错误诊断、正式执行、真实环境及Electron端到端仍未执行。

[GPT评审与v2索引](ui-testing-evidence/optimization-u05-gpt-review.json)及约75KB归档保留27文件：真实评审input/raw/static/manifest、v2全部文件及新cases、当前任务、共享预算、汇率来源、两个测试源码和检查日志，逐文件SHA与归档回读一致。个人settings备份、认证、模型cache、私有批准目录及依赖不归档。全量typecheck、3文件11项单测、lint、协议结构、size通过；无tag协议历史跳过，clean仅预览未删除。U05及整计划仍实施中，本轮已验证模型路径可用并落实修订，未宣称设计获批或正式通过。

### U05 同任务预算续授与评审登记修复（2026-10-25）

按用户已授的第三批最多3次/追加1美元继续，未增加授权。原生0.1.7增加仅供受信任宿主调用的 `DesignReviewService.renewBudget`：续授1–3轮、原task/scope及所有历史保留，授权幂等，pending及跨范围拒绝，锁内重验当前引用；不登记为Agent工具，不产生批准。浏览器原任务冻结3轮加本批余下2轮，总原生上限5。宿主共享账本仍累计9次，未新建任务或重置额度。

本次实际新增2次GPT供应商请求，均正常stop，但**均未登记有效评审**：请求8使用0.1.5，原始模型approved被遗留round<=3 schema拒绝；修复累计round契约并保留scope每批1–3约束后发布0.1.6。请求9原始模型approved/improved，被“评估改善状态与历史不一致”拒绝，原因是程序只看紧邻错误尝试，丢掉更早有效revise。0.1.7改为取最近已完成且有review_ref的尝试，补充revise→错误→改进的回归。两处遗漏发生在本次实现/集成中，原始失败完整保留；不追认原始approved、不补造manifest或可信批准，也不因错误自动追加付费调用。

第三批GPT共3次（请求7/8/9），保守费用预留合计 **0.6079693333美元 < 1美元**；这是预留而非平台账单。沿用所有token类别最高2元/百万、预算汇率6元/美元、每次8192输出上限。原注册表零价格仍不代表免费。全局原生尝试 **9/9用完**，剩余授权0次；Pi默认gpt/gpt-6.1-sol的路径已能返回结果，服务账户充值并非当前阻塞。

从上游可维护源码本地提交b3e7ada、9ab792b、09216e08ca31825d856c6227d017eab2abb23394构建，最终分发0.1.7并更新宿主锁文件；按授权未推送上游。安装目录95个文件与分发包逐字节一致。原生契约/预算/校准回归 **12通过、1真实模型检查跳过**；此前未实现方法、错误消息断言及0.1.5锁文件未更新造成的失败日志保留。宿主全量typecheck、3文件14项Vitest、19集成检查、构建、lint和协议结构通过；协议无历史tag的检查跳过。

最终0.1.7在隔离Electron完成 **7项**接入检查：设置中技能发现及禁用/启用、重载持久性、/ui快捷发现、测试MCP连接及87工具重连。0模型/0业务请求，这是桌面接入检查，不是浏览器业务端到端；0.1.6旧桌面日志另存，不重复计入。未覆盖个人安装或打包发布。

原u05-tester显式blocked/design-review，discover-record/case-design历史与六case/13断言保留；无可信批准，浏览器v2未登记诊断计划，**13项诊断和正式执行均未执行**。下一次评审需要新调用授权，诊断计划须在候选审查前纳入，不能借源码候选的计划或批准。U00/U02真实环境与其余U03/U07/U09、M1/M2仍未放行，整计划未完成；plan_update工具不可用，继续复用本记录及第8节放行表。

[续授及登记修复索引](ui-testing-evidence/optimization-u05-review-renewal.json)和约706KiB归档保存71个文件：请求8/9真实input/static/raw及摘要核验、公开续授回执、当前任务、共享账本、上游源码/补丁、失败及成功日志、最终安装一致性和桌面结果；归档逐文件回读一致。私有authority、认证、模型cache、个人配置及node_modules不归档。开始与交付clean仅预览、可清理0项，未删除数据。

### U05 浏览器候选诊断输入补齐（2026-10-25）

上一轮完成0.1.7登记修复及桌面接入验证。本轮继续可独立推进的准备工作，未追加模型调用、修改授权或启动浏览器。新增 `tests/ui-browser-diagnostic-prepare.mjs`，复用原u05-tester任务、scope、inventory、完整录制及v2脚本，保存不可变v4-diagnostics候选。六case、13条断言正文及预期与v2逐字节一致，保留逐测试新origin和reload前取消检查。fixture只增加按静态test标题发送x-u05-case的源码请求头，用于隔离错误副本；该请求头不是认证，viewer/tester仍使用各自context。

原13探针复用冻结u00-1变异源码，额外加入“A-edit-1-memory”：取消误写仅当前内存而不持久化，覆盖真实独立评审指出的reload掩盖问题。共14错误探针覆盖13断言，正目标严格保留scope原地址，另14个错误origin互异；环境、原生Playwright配置、冻结源、变异、可恢复launcher及diagnostic-plan均纳入候选files。通过原生ui_design_diagnose的schema操作获取结构，不执行diagnose。

准备检查：15origin×7case路由（含无case的前置请求）共105响应，非目标case及前置收到冻结HTML；错误case收到预期变异且内嵌脚本可解析。关闭后恢复全部确切origin，105响应摘要相同。占用一个声明端口时拒绝恢复、保留冲突监听并关闭本次已启动服务，不改用随机新地址或中断其他进程。所有自建服务最后关闭。HTTP源码核对不是浏览器检错证明，14探针尚无正反对照观察。

首次v3-diagnostics的HTTP检查通过，但静态TypeScript检查失败：原13探针对象未声明id，新内存探针才含id，形成联合类型的TS2339。失败文件及日志完整保留；v4统一设置探针id后，原生schema及两次静态回读通过，不覆盖v3。共享授权账本与上一轮归档摘要一致，原task仍blocked/design-review；原生catalog回读新修订review_refs为空、runtime_ready=false（无可核验设计批准或诊断证明），13项诊断和正式执行均未执行。未来须对包含诊断输入的v4申请新评审授权，不能继承v2未登记的原始approved或另一份源码候选的批准。

同时修正上一轮计划文档将第3节U05原计划行误当状态行的问题：恢复原交付阶段/工作/前置/交付物，第8节才记录当前放行情况。诊断续跑入口按明确选中的修订读取launcher、部署和spec，批准门禁保留；无批准不会启动服务或浏览器。新增入口同步模块地图、目录及文档导航。

本轮全量typecheck、3文件14项Vitest、lint和协议结构通过；无历史tag的协议检查跳过。只改准备入口和文档，未重跑Electron或模型，0.1.7旧桌面结果不计为本轮通过。开始及交付clean仅预览、不删除数据。[诊断输入索引](ui-testing-evidence/optimization-u05-browser-diagnostics.json)和约47KiB归档保存105文件，90个新/历史引用摘要核对、归档逐文件回读一致；包含v3失败、v4候选/计划、当前任务、入口和验证日志，不含私有authority/认证或依赖。U05及整计划仍未完成，下一依赖门禁是新的付费评审授权与有效设计批准。

### U05 第四批授权：独立批准、诊断、正式执行与报告交付（2026-10-25）

用户明确授权v4追加最多3次独立评审、新增总费用不超过1美元、每次最多8192输出tokens；随后明确允许将剩余次数中的1次转用于R1–R6报告评审，未增加次数或费用。继续使用用户配置的gpt/gpt-6.1-sol转发路径。共享账本保留全部历史，本批实际2/3次（设计请求10、结果请求11），全局原生尝试11/12；余下1次仅保留原设计授权，本轮不再调用。按此前保守价格/汇率，本批预留0.4128986667美元，小于1美元；这是预算预留而非账单，注册表零cost不解释为免费。两次模型分别209601输入/2273输出、135937输入/1834输出tokens，耗时50192ms、52302ms。

付费调用前先做零供应商请求的离线输入预检：完整原生输入753463 bytes、供应商context738214 bytes，将宿主本地输入限制650000提升至原生1MiB上限，费用守卫保留。受信宿主对同一原任务续授3轮，保留原scope及所有失败，不新建任务规避预算。请求10通过原生D1–D10校验并登记approved（累计第6轮），此前revise和未登记原始approved均保留。候选v4摘要4035c2e18a883293b9846177cb861583918e180a85f5ad9c495c48747877563a。

ui_design_diagnose对正目标和14错误副本执行15轮、共90个用例attempt：正目标6/6通过，14个变异均在指定目标断言失败（另76个attempt通过），13条断言全部覆盖；problems及integrity为空、unknown_effects=false、runtime_ready=true。14个故意注错失败属于检错证据，不计正式产品失败。全部自建服务关闭。新增tests/ui-browser-approved-run.mjs先核对可信设计批准和原生runtime准入，再恢复确切冻结origin并正式执行；不创建批准，不重放录制或历史失败。

原u05-tester发现任务原生checkpoint完成；另建明确execute意图的u05-browser-v4-execute任务，不重置评审预算。正式批次run-09346f68358a862ad2ccb7533c644ad7完成：6passed，failed/blocked/skipped/cancelled/not-run/flaky/unknown均0，13断言全部到达，完整对账，无未计划实例或证据缺口。原生分析/报告候选随后生成；请求11以新的无工具独立上下文校验R1–R6，登记approved。result-review checkpoint调用原生deliver，报告完整且独立批准，执行任务completed，交付文件摘要e2f575c267224517753c779b566fecf4c840acaabe9f74c1574a2a3605411aff。交付后初次回读误用JSON loader读取Markdown导致解析异常；改为只读文本核验真实交付，未重复checkpoint、模型或浏览器。

不可变候选/用例仍保留准备时“未评审/未诊断”的历史gap注记，原生报告按原材料带出这些文字；当前可信批准及诊断证明后续状态，不能改历史原件或将旧注记当本轮阻塞。报告范围只限六个冻结合成功能，不推断全产品覆盖。

本轮全量typecheck通过；前段3文件14项Vitest、最终3文件51项注册/执行守卫/任务计划单测均通过；19项原生集成、lint、协议结构通过；无tag的协议历史检查跳过。隔离Electron0.1.7新执行7项技能/设置/重载/MCP接入检查，0模型/0业务调用，不算完整Electron业务链路。size预算及差异检查通过，协议历史无tag明确跳过；开始与交付clean仅预览、不删除数据。公开[本轮证据索引](ui-testing-evidence/optimization-u05-approved-run.json)及归档保留真实输入、响应、原生批准、诊断、正式run、报告及交付；逐文件摘要与归档回读核验，不含私有authority、认证、模型cache或依赖。

本轮完成U05冻结合成范围的发现→设计→独立评审→诊断→正式执行→分析→独立结果评审→交付链路。U05整体、U00完整基线、U02私密执行映射和OperationContract真实准入、U03/U07/U09及M1/M2仍未放行，U08为后置可选；不将上述工程通过写为整计划完成。plan_update工具不可用，续跑仍以本记录和计划第8节为准。

### U00 续跑：获批六功能资产的现行基准计量（2026-10-25）

承接U05已获独立批准的不可变v4，新增tests/ui-approved-baseline-measure.mjs，不修改原scope、角色、origin、脚本、断言、批准或诊断。运行前先保存plan.json，明确本轮测量只覆盖“已有资产到run终态”、同request查询、只读view/status及旧报告确定性对账；首次生成和旧失败完整分析/重跑仍是缺项，不把现有通过批次替代失败样本。源码摘要固定于计划，不依据结果降标。

本轮在原工作区/原私有authority核对真实设计批准和当前runtime_ready，恢复原15个声明合成origin，新建明确的execute基准任务并运行一次正式六功能批次：6passed，其余终态0，13条断言到达，complete=true。没有新增模型请求，也不使用控制响应制造新批准。正式终态后关闭自建服务；同request只读status返回replayed=true、同run_ref、0子进程。测量以run终态为终点，新任务在analyze显式保留“尚未分析/评审/交付”的阻塞，不能将该新基准批次借原报告标为已批准交付。

观测器只包装当前Node进程的fs/promises readFile/readdir/writeFile/rename命名导出，并经1次真实读取校准；记录操作次数，不读取或输出私有文件正文，私有authority路径合并脱敏。diagnostics_channel观察当前宿主直接启动的子进程，仅输出类型及PID。观察器不修改安装目录/原生runner。原生preflight和runner直接子进程共2个；嵌套runner中的浏览器启动、导航/快照和文件读取不在本观测范围，记未测，不从测试数推算浏览器启动数。模型等待未发生，注册表/个人认证未读取。

实测单样本：设计门禁1314.43ms/759宿主readFile/2 readdir；诊断状态787.79ms/760读取/3目录读取；execute-task-start1666.38ms/1789读取/678目录读取；既有资产到run终态8164.60ms/2538读取/694目录读取；原生结果对账93.31ms/191读取/352目录读取；同request状态27.63ms/45读取/176目录读取。以上是各阶段包含其内部工作的时间，不将子阶段重复相加为端到端耗时，也不把含浏览器执行的阶段整体算框架开销。

旧获批run的view/status与报告对账各1次首样本加5次重复样本：每次view读取1文件、0目录、0子进程（约0.16–0.24ms）；每次报告对账读取284文件、0目录、0子进程（约44.68–50.44ms），R1–R6确定性issues为空，旧run、报告、结果批准和交付四项摘要前后不变。这里是旧成功报告对账，不是新的独立语义分析或结果评审。样本已被setup/文件缓存预热，不称为冷启动；观测器额外开销保留，不做20%收益或优化前后比较结论。

[现行基准索引](ui-testing-evidence/optimization-u00-approved-baseline.json)保留冻结计划、逐阶段计数/耗时、真实run/结果及测试源码，归档摘要逐项核验；原U05批准/诊断/模型输入以此前获批归档关联，不复制私有authority。全量类型、51项相关单测、lint/协议结构、差异与体积检查见同批日志；无tag协议历史明确跳过。开始与结束clean仅预览，无删除。本轮只新增测量入口，未修改桌面共享应用、未重跑Electron，前轮桌面接入不计本轮通过。

U00继续进行中：三类完整基线尚未齐备，首次生成/旧失败分析重跑、嵌套浏览器计数及真实准入缺口保留；U03/U07等依赖节点不因此放行。下一步应先补缺失的同范围采集条件，再决定重复目录扫描是否值得优化；不能只因看到678次目录读取便引入跨请求缓存或改变门禁。

### U00 续跑：runner 子进程与浏览器启动实测（2026-10-25）

前一轮f57fe3a已推送且远端摘要一致，是新增权威计量证据的实际进展。本轮补齐其明确未覆盖的Node子进程观察；原先34文件归档保持不变。不声称完整U00/M1/M2通过，也不启动依赖尚未放行的U03/U07实现。

在现有tests/ui-approved-baseline-measure.mjs增加可选--observe-children，只在这次原生runner调用期间为子进程设置NODE_OPTIONS预载tests/lib/ui-baseline-child-observer.mjs，finally恢复；若已有NODE_OPTIONS/其他观察器则拒绝覆盖。观察器只统计各Node进程fs/promises的readFile/readdir/writeFile/rename调用与其直接子进程启动，不保存路径、URL、参数、环境值或文件正文，不修改原生安装目录、候选、配置或目标业务。CLI/worker各自退出时写摘要，通过PID父链核对顶层runner及每个观察到的Node worker均有终态记录；缺失不能填零。

首次真实校准失败：Node child_process诊断事件早于spawnargs/PID填充，立即分类将Node/Chromium记成other；两个真实进程记录及失败日志保留，不当作浏览器未启动。改在spawn确认事件后分类并记录PID；再次校准用真实嵌套Node读取1个归属文件、真实Chromium启动关闭，2份进程终态、worker恰好1次readFile、1次browser启动全部符合。宿主直接子进程分类也同步改为启动确认后读取，原归档中的历史类别不追写。

观测启用后的第一次完整样本通过；随后增加“宿主所见顶层CLI的PID必须也有终态记录”校验并再次执行，避免只收到worker文件也误判完整。两个实际样本均6/6通过、13条断言到达；完整原生报告、不同run及所有计数保留，不合并为同一批次。最终样本8.420秒，宿主2570次readFile/766次readdir；第一样本10.120秒。历史量随新run增加，观察器也有成本，两样本不是优化前后配对，不能推出提速/回退百分比。

两个样本都直接观察到宿主预检启动1个浏览器、宿主启动1个原生Playwright CLI，CLI再启动1个Node worker，worker启动1个浏览器：本次原生执行共2次已确认浏览器启动，不由6个用例数推算。最终CLI进程4796.61ms、worker4278.84ms均正常exit0，两者区间重叠，不能相加作为CPU或总耗时。CLI异步FS为readFile=1/writeFile=2，worker为readFile=1/writeFile=82；未出现的这四类API计为该观察范围内0，不代表同步FS、其他API或操作系统I/O为0。导航、快照及浏览器内部计数仍未测量。

同request只查询、view和旧报告对账各6次仍未启动子进程；原获批run/报告/结果评审/交付摘要前后不变，预算账本与前次获批归档一致，新增付费调用0。自建15个合成源监听均关闭；新基准任务止于原生run终态，在analyze保留尚未分析/评审/交付的阻塞，不借旧报告填新批次完成。

[子进程观察索引](ui-testing-evidence/optimization-u00-child-observer.json)关联此前批准及基准归档，保留首轮校准失败/修复后原始进程记录、两次正式run、冻结计划、源码与检查日志，逐文件摘要和归档回读一致；私有authority、认证和依赖不归档。全量typecheck、51项单测、lint、协议结构、size和差异检查通过；协议历史无tag明确跳过。开始与交付clean仅预览、不删除。测试观察器不改桌面/共享应用，本轮未重跑Electron，旧接入结果不计本轮通过。

U00尚缺首次生成、旧失败完整分析/重跑的同范围计量，导航/快照与优化前后完整配对；U02真实认证/初态、OperationContract预期及正常/错误副本仍未确认。此前已发出测试角色/数据依据位置的文本询问，尚无新答复；不重复询问或擅读个人认证。继续保留原目标及依赖门禁，不将合成实测或本轮计数器交付等同于整计划完成。

### U00 续跑：实际导航及显式快照API计数（2026-10-25）

承接已推送且远端一致的b2aef80，补上轮尚未覆盖的API计量。复用Playwright Test自身使用的playwright._instrumentation监听器，只读取channel.type/method及开始/结束/失败事件，不改调用结果、不保存params、apiName、用户标题、URL、定位文本、堆栈或页面内容。依当前工作区的playwright包解析其实际playwright-core并限制1.62.1，避免误观测根目录独立安装的1.63.0。监听接口是版本限定的测试实现细节，不新增对外能力或修改node_modules。

tests/lib/ui-baseline-child-observer.mjs导出可停用的observePlaywrightApi；子进程沿既有显式--observe-children加载，宿主仅在本次原生runner调用期间安装/移除监听。计数键为协议API类型/方法，逐键保存started/completed/failed；WeakMap关联同一事件，不占用Playwright自己的userData，不干扰测试步骤/trace。仅外部API有本口径计数，不覆盖浏览器自动重定向、子frame自动跳转或trace内部快照。

真实校准使用1个Chromium页面：Frame.goto=1、Page.reload=1、Frame.ariaSnapshot=1；故意点击不存在目标并捕获超时，Frame.click completed=1且failed=1。所有开始事件有对应结束；已知嵌套Node仍恰好1次readFile。逐记录检索确认Owned/Missing/data:text未进入输出。这是验证观察器的失败计数，不是合成业务失败。原始校准与源码保留。

不修改冻结六功能候选、scope、origin、配置、角色或诊断；在原可信私有authority上核验批准/当前诊断并执行一次新正式批次。6/6通过、13条断言到达、complete=true。宿主预检：1次BrowserType.launch、1个context/page、1次Frame.goto、2次Frame.expect、1次Browser.close，均完成/0失败。runner CLI记录本身无浏览器API，实际worker记录：1次launch、7个context/page、7次goto、3次reload、9次fill、19次click、52次Frame.expect、7次context.close及1次browser.close，均完成/0失败。7个context包含viewer独立context，不能用六case数推算context数；52次底层expect也不等于52条独立业务断言，冻结业务断言仍为13条。

原生正式回放没有调用Frame.ariaSnapshot/Page.ariaSnapshot，因此本范围“显式可访问性快照API=0”有监听证据；不把trace内部快照或原发现录制阶段算0。宿主和worker的明确导航调用共11次（8goto、3reload），分阶段保存，不与之前MCP发现动作统计混合。实际子进程仍验证预检/worker各1次浏览器启动、2个Node终态完整。正式阶段7913.81ms是单个有观察器且已预热样本，不代表提速；API监听及提前加载核心库会影响启动/FS开销，不能与上一轮作为优化前后配对。

同request查询及旧report/view的零子进程、旧获批四项摘要不变继续通过；新基准任务仍在analyze保留“未分析/评审/交付”，不继承旧报告批准。模型预算账本未变、0付费调用，自建源服务关闭。全量typecheck、51单测、lint、协议结构、size与差异检查通过；协议历史无tag跳过。clean仅预览，无删除；本轮仅测试观测器，未重跑Electron。

[API观测证据](ui-testing-evidence/optimization-u00-api-observer.json)保留本轮校准、实际进程API聚合、冻结计划、完整新run与原生对账、来源摘要和验证日志；与先前原始归档分别校验，不含私有authority/认证或依赖。U00仍缺首次生成及旧失败分析/重跑的完整同范围基线、完整优化前后配对、真实目标/Electron业务准入。尚未收到此前角色/测试数据/预期依据位置的答复，不擅读个人凭据或从HTTP200推断身份。U03/U07和最终验收继续保留原前置门禁，整体目标未完成。

### U06/U09 续跑：真实独立批准六功能产物的 Electron 归档与恢复（2026-10-25）

承接d47ad4b的API计量证据，转向原计划的桌面交付。新增tests/ui-approved-archive-desktop-test.mjs，先在原工作区通过DesignReviewService.gate和ResultReviewService.gate核对真实私有登记，逐项核验原asset/run/report/结果评审/交付5个摘要。复用原正式6passed、13断言批次run-09346f68358a862ad2ccb7533c644ad7，0新模型/0目标执行，不生成控制批准或新候选，不把既有历史通过称为本轮浏览器业务执行。

隔离project/agent/data目录，空auth和models，剔除继承的模型/云认证环境变量。只复制公开qa材料，排除原任务/目录缓存，并仅保留选定正式run，避免本轮归档操作卷入其他历史批次；原工作区及所有旧run不删除、不移动。私有authority及个人配置不复制。公开投影中的同一review无法通过空authority执行门禁，实测review-rejected，明确这份投影只用于旧证据归档，不能冒充已迁移执行授权；独立批准事实仅由原私有登记和既有原件证明。

真实Electron（macOS arm64，未打包开发壳，使用已有验证构建/ensureBuild预建模式，不自行构建）完成两次宿主启动。data-space0.16.0，六功能search/edit/details/paging/permission/states各有明确映射；另设同名模块/功能及同名环境的第二项目，显式envId锁定本项目。initialize只返回configured，network/authentication/role/data仍unknown，不将源地址配置当业务就绪。

5项桌面检查实际通过：

- 明确导入6条草稿，原生case/feature一一映射，第二项目无用例，初始automation为空；archive-status不写store，重复import新增0/重复6。
- 分别绑定六case后，仅同步原正式run，产生6条通过结果；不重新启动目标浏览器或执行脚本。
- 真实关闭并重启Electron，仍只有6条唯一结果；sync-status对账complete、existing=6、项目与结论正确，查询前后runs.json字节一致。
- 实际桌面用例库展示6条，自动化窗口可见原asset摘要/runId；点击“同步已有批次（不重跑）”显示“已同步0条，重复6条”，结果仍6条；截图实际核看通过。
- 结构化六例交付与回执、caseVersion、feature、原run/报告评审引用一致；跨项目矛盾交付反例校验拒绝。格式校验器仅证明一致性，完整证据及独立批准另由前述原生gate和摘要核验支持，未将格式检查当新批准。

第一次执行已通过前4项，但交付校验报writeback.receipt.workspace不一致：macOS /var临时路径被回执规范为/private/var；保留真实失败、全部回执、隔离store/runs和截图。测试创建临时目录后统一realpath，再从头执行的新隔离桌面样本5/5通过，不放松校验器。最终测试在启动前保存实际harness源码；首次失败未另存完整源码，不补造历史源码。两轮原始证据和各自原生引用分别保留。

[桌面获批产物归档索引](ui-testing-evidence/optimization-u09-approved-archive.json)及归档保留失败/成功两轮真实桌面截图、日志、回执、数据快照、结构化交付、源码及检查日志；逐文件与原始5个引用摘要核验，预算账本与U05获批归档一致。typecheck、5文件72项单测、lint、协议结构、size和差异检查通过；初次单测文件通配符无匹配、未启动测试，原日志保留，按真实文件名运行后的结果另记，不将空执行计为通过；协议历史无tag跳过。开始与结束clean仅预览、无删除，关闭自建Electron，不修改个人安装或上游。

本轮补齐U06/U09的六功能真实获批产物→桌面归档/重启恢复子链。原发现、设计、独立评审和正式执行来自此前原生测试入口，不能写成已在Electron完成整条链路。M1/M2、U00完整基线、U02私密映射和OperationContract真实准入、U03/U07等门禁继续保留；此前真实角色/数据/预期依据位置询问尚无答复，整计划不关闭。

### U00 续跑：首次发现至静态候选的机械开销（2026-10-25）

承接395f7b4已推送的桌面归档证据，本轮补首次生成的可独立测量段。原tests/ui-function-discovery-test.mjs增加显式--complete-candidate --measure，运行前保存范围、起止点、成功标准、未测项、实际harness/observer源码及摘要。仍使用冻结u00-1声明、60动作/120秒预算、六功能、tester/viewer独立context和真实SDK/MCP；工程步骤由固定程序驱动，无模型生成决策。新生成v1合成候选不等于既有获批v4，本轮没有重用批准、诊断或正式run，未重置原预算。更新入口中已过时的“3轮/402额度耗尽”阻塞文案，改为此候选没有独立批准与诊断的实际原因；原历史证据不改。

tests/lib/ui-discovery-measure.mjs只保存宿主异步fs/promises四类API计数、工具名/operation/状态/耗时及直接子进程启动类型，不保存参数、路径、工具正文、环境值或异常正文。真实1次文件读取校准计数=1，故意抛错保留threw状态且不包含正文，stop后原函数恢复。观察器不修改工具结果或安装目录。同步/原生FS和嵌套MCP进程内部未计量，不把未测项写成0；注册监听和读取包装本身有成本。

实际样本tests/scratch/ui-browser-candidate/1792924718830通过：58次录制动作，包括setup1、snapshot17、generate_locator13、type6、click17、navigate1、read_log1、write_test1、close1。六功能草稿保留各自来源/状态和历史缺口；参数化脚本、六case/13条来源断言保存；候选静态issues为空。空目录到SDK/MCP就绪467.31ms；至静态候选返回总16035.06ms，其中发现至候选15567.75ms，宿主readFile4786/readdir811/writeFile2/rename309。原子写入会体现为rename，不能只用writeFile解释全部写入量。至候选74次宿主调用；随后checkpoint/门禁/只读catalog共4次，完整入口78次，不把后处理计入候选端点。candidate调用902.99ms，是含原生静态校验与存储的工具总时长，不等于纯静态检查CPU时间。

真实SDK嵌套hook记录58个对应MCP调用。宿主直接观察到1个browser及3个other进程启动，未观察嵌套进程，不据此宣称总浏览器启动=1。17次快照和1次显式导航是MCP动作口径，不覆盖seed内部goto或浏览器内部事件。单样本依赖/操作系统缓存未清空；不是冷启动、优化前后配对或提效结论。

新任务留在blocked/design-review，原生catalog runtime_ready=false；0模型、0诊断、0正式run、0外部业务请求。共享费用账本与已获批U05归档摘要一致。旧批准和剩余授权没有用于新候选；未执行任何新的独立评审。首次归档校验发现lineage引用的是旧归档中源码候选，不能假定新目录含全部历史；改为从原摘要核验的源码归档读取并验证该引用，不复制或伪造历史材料。

[首次候选计量索引](ui-testing-evidence/optimization-u00-discovery-measure.json)保存186个文件、149个本地引用及原归档历史引用核验，归档逐文件回读一致，不含私有authority/认证/依赖。全量typecheck、3文件51单测、lint、协议结构通过；协议历史无tag明确跳过。开始/交付clean只预览、无删除。本轮只改测试计量入口，未重跑Electron或共享应用，前轮桌面结果不计本轮通过。

U00首次发现→静态候选段有了可复用原始样本，但首次至获批v4的完整同端点计量、旧失败分析/重跑、五组成对和真实目标准入仍缺；U03/U07依赖不放行，M1/M2和整计划继续未完成。此前真实角色、测试数据及预期依据位置询问未获答复，继续保留该阻塞，不读取个人凭据或猜测私密映射。plan_update不可用，继续维护第8节和本记录。

### U02 续跑：运行时轮换认证头的证据隔离（2026-10-25）

本轮没有重复已完成的U05链路，补A02-5已登记的运行中新凭据边界。现有tests/ui-private-evidence-test.mjs增加--rotated-cookie；合成HTTP响应在浏览器初次访问后用Set-Cookie签发随机新值，新值不在初始storageState或候选脚本中。夹具仅增加可控responseHeaders，默认行为不变。不使用个人凭据、真实目标或付费模型，工程设计评审仍为明确标识的受控fixture。

安装版0.1.7真实复现公开trace包含轮换值；首次检查在原生trace回读的秘密断言失败，保留1792925188263及原日志，不归档其泄露内容。中间0.1.8先从已有私有trace收集标准认证头，失败路径已脱敏，但正诊断/正式成功路径原先retain-on-failure不留trace，仍有6个公开文件泄露；1792925390901及实际安装代码快照保留。没有将中间版本当交付。随后认证诊断/正式执行成功和失败都保留私有trace，匿名路径仍retain-on-failure；0.1.9初轮因旧测试期待成功批次complete=true而失败（1792925555157）。核对原生结果对账后，新增私有trace资源确实不公开，故按实际资源缺口更新预期为complete=false，passed=1仍严格要求；未放松产品断言或修改原始结果。

最终修复来自上游可维护源码本地提交5bd52eb63245519a21f0304bd415021fed6a6436，按已有边界未推送上游。PrivateEvidence.process先保存原始记录，再完整扫描私有trace的Cookie/Set-Cookie/Authorization/Proxy-Authorization头，收集可观察轮换值及已有支持的编码形式，之后才生成公开进程输出。跨trace条目/文件顺序先收集后发布，统一作用于公开日志、trace、error-context、JSON报告及文本附件。已有trace无法解析或符号链接回流时拒绝发布，不自动重放；原始记录仍在私有目录。只读取标准认证头，不将响应正文当通用秘密词典。

分发pi-ui-testing0.1.9，宿主e2e包清单/锁与维护入口同步，安装目录95文件和分发包逐字节一致；分发SHA256为194cecaf4530debb1832529db045a15f0b766309686aa1d24ab2eea37de7d23e。原0.1.7包、批准、模型账本和基准保留。0.1.8为隔离中间尝试，未作为当前版本登记；中间安装代码及失败保留，不补造其最初分发包。未直接修改node_modules或个人安装。

最终两个真实认证场景分别6项检查通过：1792926220108轮换新Cookie，正向诊断和两个正式捕获均实际消费新值（3份原始stdout中核实）；1792926220103回归初始已知Cookie。两者均保留正式passed=1、注错failed=1，公开complete=false，未公开图片/视频/trace resources；4份私有捕获0700、正式失败截图仍私有。逐文件、解码文本附件和解压ZIP扫描均未检出初始值/轮换值/认证路径的受测形式，原生trace回读仍有动作证据。通过结果不等于公开视觉证据完整，不能将缺口藏为通过。

最终源码原生3文件13项全部通过，覆盖私有目录边界、状态碰撞拒绝、轮换头跨条目顺序、文本附件和坏ZIP拒绝，以及环境/trace查看。另保留较早10文件59通过、2项live评审跳过的原始日志；该长跑期间源码发生修订，因此不当作最终版本完整套件证明。宿主全量typecheck、3文件51项Vitest、SDK/MCP19项、lint及协议结构通过；无tag协议历史检查明确跳过。匿名行为由现有原生环境/trace回归覆盖，不沿用旧轮通过数。

隔离真实Electron使用已有验证构建完成7项设置/技能/快捷项/禁用启用/重载持久性/MCP87工具及重连接入检查，证据1792925606628；实际查看discovery-restored.png可见“UI场景发现与录制”。0模型/0真实业务请求，不声称桌面业务端到端。未重建或发布应用，测试创建的宿主退出，个人进程不操作。开始与交付clean仅预览，无删除。

[轮换凭据隔离索引](ui-testing-evidence/optimization-u02-rotated-credentials.json)及归档保存最终公开产物、两次成功场景、六次失败摘要、实际中间安装代码、上游补丁、桌面截图及检查日志；408次公开引用核验、逐文件归档回读一致。失败的泄露工作区和所有原始私有捕获/认证/依赖均不归档，原始失败不删除。共享费用账本与U05获批归档摘要一致，新增付费调用0。

范围仍有限：无trace的未知值、录制MCP、任意业务秘密/嵌套编码/脚本自行写文件及数据空间私密执行桥接仍未覆盖；不宣称通用秘密识别或U02完成。认证成功留trace会增加开销，未做0.1.9性能对照，旧U00样本继续标0.1.7。OperationContract角色/测试数据/预期依据仍缺，完整Electron/M1/M2、U03/U07等原依赖保留；整计划未完成，plan_update不可用，继续复用第8节。

本阶段收尾又补强成功用例：业务断言到达=1、missing/unplanned为空，issues必须精确等于私有资源R3及其汇总R3，不允许其他缺口借complete=false混入。补强时错用issue字段名、随后漏计汇总R3，造成三次测试断言失败，均保留摘要/日志；核对原生真实结构后按两条明确预期修正，最终两个场景重新全部通过，不归因为产品错误或隐去失败。

### U00/U02 续跑：真实数据空间定位与部署源码准入（2026-10-26）

用户新授权：项目资料从数据空间的“项目管理系统”读取，允许操作本项目数据，预期文档归入数据空间。原角色／数据位置完全未知的阻塞已有新线索，本轮继续独立准入工作；未扩大已有模型调用授权。plan_update不可用，继续维护第8节；目标工具仍显示旧blocked状态，其接口不支持主动恢复，不将该状态当作停止独立工作的理由。

按data-space-testing规范，通过现有createDataSpaceTools对内存快照做只读脱敏查询，不激活插件、不迁移或改写原库。实际发现Electron和旧Web两套同名项目：桌面项目e2f5d42d-2781-4e68-a452-4c87c7d1d346、环境f46a32da-2eac-43ca-86b8-2fa5eca5385c，revision=8、模块/功能/用例均0；旧版sys-pms、环境6cb8715f-0ced-4acc-89a1-032e8105369e，revision=51、有7条本项目用例，其中4条经营合同。环境地址均为192.168.90.224:8238，但ID和登录提取路径不同，未混用。已询问以哪套为准，等待答复期间仅继续公开源码工作，未执行任何数据空间写入。

四条经营合同PMS-001至PMS-004逐字段对比plugins/data-space/seed.mjs：featureId、code、title、priority、status、preconditions、note及全部steps.action/expect与内置示例相同。三条UI用例PMS-001、002及004仅type由UI变为“功能”；PMS-003仍为接口。忽略生成时间和步骤UUID进行语义比较，不把这些字段差异伪装成业务需求变化。示例的已评审状态不等于原生批准，金额上限、错误文案、审批后状态等不能直接作为真实业务oracle。

真实OperationContract公开HTML及5个部署JS资源读取成功。最小摘录保存完整资源SHA256、字节数、字符偏移、行号和原文；完整大bundle只留本地scratch，不堆入主仓。源码表明axios前缀/api、登录POST/base-service/login、响应读取data.token；token/account/x-client等storage key不加pms_前缀，其他键按X3映射。桌面提取路径data.token与该声明一致，旧版data.access_token不一致；尚未刷新、登录或改写配置。登录后还涉及租户选择与permission初始化，authorized-resource影响权限隐藏；源码包含按username/业务实体划分的草稿键和DRAFT/SIGNED状态映射。这些都是declaration，不是浏览器观察、产品需求或已验证状态。

使用安装版原生ArtifactStore及schema保存独立source-only scope和3项inventory（登录/权限、草稿、合同状态），回读并递归核对引用摘要通过；source research项目/环境标签明确不冒充选定数据空间ID。discovery=source、coverage=discovered，真实定位器、浏览器交互、角色与数据清理、正常/错误诊断副本仍为缺口，未生成recording或设计批准。当前数据空间schema仅有项目/模块/功能/用例/环境及备注，没有独立需求文档字段；在已查两套项目中未定位到真实需求文档，未杜撰需求或擅自开发文档库。

[真实目标准入索引](ui-testing-evidence/optimization-real-target-source-admission.json)及其归档保存原生清单、公开源码摘录、示例来源对比和生成脚本，逐文件归档回读一致；不包含原store、凭据、私有storageState或完整大bundle。本轮0模型、0浏览器会话、0正式业务测试、0数据空间写入，不复用合成链路的批准作为真实业务验收。私密执行桥接仍未支持，不绕过执行/评审门禁。待项目选择确认后，再办理该项目的环境准备、预期/用例归档和真实浏览器准入；M1/M2、U03/U07及整计划保持未完成。

本轮仅更新证据与文档；全量typecheck、2文件8项Vitest、lint、协议结构及差异检查通过。无tag协议历史启发式检查明确跳过。未改业务代码，不把既有Electron验收算本轮执行；未运行新的桌面业务链。开始与结束clean均仅预览、无删除。

### U02 续跑：锁定桌面项目、私有认证准备及预期草稿存储（2026-10-26）

用户已明确两次确认：以Electron桌面数据空间为准，后续预期与用例保存到该项目。锁定systemId=e2f5d42d-2781-4e68-a452-4c87c7d1d346、envId=f46a32da-2eac-43ca-86b8-2fa5eca5385c，重新读取revision=8、用例0；旧版示例不迁入、不充当需求。先前“项目选择待确认”解除；真实业务规则、角色和录制隐私的独立缺口保留。plan_update仍不可用。

新增tests/lib/pms-private-session.mjs与显式--refresh测试入口tests/ui-pms-private-preparation.mjs。这是项目专用测试适配器，不新增Agent工具/技能，不声称个人安装或Electron能力已接入。复用现有runEnvScript执行所选环境的单步POST登录配置，严格限定同源/api/base-service/login及声明data.token；不允许外站、重定向或扩大到任意脚本。检查登录返回账号与配置账号一致、无附加验证且恰好一个租户，再读取同源permission；缺少PMS客户端或权限结构不支持则阻塞，不猜租户/角色、不调用切租户或业务写入接口。512KiB响应上限、超时、公共错误仅固定代码，原始响应/凭据不输出。

根据已保存的部署源码映射token/account/tenant/client/menu/authorized-resource等storageState字段。部署读取器支持原始token字符串，因此该字段使用原始值，使现有原生PrivateEvidence能直接识别认证头中的同值；此处不是通用JSON嵌套秘密识别修复。认证状态位于工作区外临时目录，文件0600；仅以环境变量名引用交给原生authState，不返回明文或路径。dispose删除引用及自己目录。只做显式临时新登录，不刷新数据空间持久动态缓存，不替代A02-3缓存复用或插件通用privateExecution能力，原插件仍保留not-ready。

真实环境准备共两次：第一份临时入口回执保留在desktop-selection/private-preparation.json；其后补账号一致性和最终测试入口，再执行最终源码1792978288836。两次均登录及权限请求成功、一个租户/两个客户端，原生authState可读取私有引用，随后文件、目录和环境引用均清理；store.json前后摘要相同。首轮未另存当时适配器源码，明确不作为最终版本证明。最终轮先保存harness/adapter及摘要再执行，保留configuration matched、authentication browser-not-checked、role/data unknown。0浏览器会话、0模型、0业务写入；这些请求不计正式用例通过。未读取桌面宿主访问令牌。

合成单测10项覆盖原生引用读取与0600、清理、原store不变、显式刷新、跨项目/外站零请求、错误账号、验证码、零/多租户、token截断拒绝、PMS权限缺失和上游错误不回显秘密。与环境Agent及工作流计划单测合计3文件18项通过。首次全量typecheck发现测试fetch mock参数类型比原接口窄；修正mock为接口推断类型后全量typecheck通过，不归因为产品缺陷。未重跑无关旧合成/桌面批次。

预期依据草稿已通过新增文件写入所选数据空间project-documents/<systemId>/OperationContract-expectations-source-draft-2026-10-26.md，0600、写后逐字回读并保存SHA256；没有覆盖原文件。仅登记登录/权限、草稿命名空间、合同状态三项declaration及真实缺口，明确未评审/未执行；不把示例金额边界和错误副本补造为真实需求。当前应用没有独立文档索引/编辑入口，因此文件虽存入数据空间目录，尚未在应用界面登记，也未录入原生用例库。该写入与store.json/runs.json写入分别统计：文档1、原库0、用例0、执行结果0。

实际桌面服务8790的数据空间接口返回401；当前Codex会话没有可调用的数据空间原生工具。另两个无认证服务均为其他工作区/数据源，已只读辨认，未用作所选桌面服务的替代。没有读取个人宿主访问令牌、绕过鉴权、启动第二个实例争写同一原库或离线直接修改store。应用内initialize/import及完整Electron录制/评审/执行链仍未完成，需由可访问所选桌面会话的原生工具继续。已保存数据文件不等于应用界面已接入。

[项目私有准备证据](ui-testing-evidence/optimization-u02-pms-private-preparation.json)保留最终源码、清理回执、文档副本及存储回执；私有认证与原始响应不入归档。原U05设计/结果授权账本未使用，不新增付费调用。整计划、M1/M2及依赖门禁仍未完成。

最终验证：全量typecheck、3文件18项Vitest、lint、协议结构、size及差异检查通过；协议历史因无tag跳过。7个归档成员逐文件回读和最终适配器源码摘要一致，数据空间文档回读摘要与回执一致；开始/交付clean只预览、无删除。本轮未改产品运行代码或插件资源，不升级插件、不构建或替换个人应用，不声称桌面浏览器业务链已验收。

### U00 续跑：失败批次、独立结果评审与仅失败项重跑（2026-10-26）

本阶段复用原 U05 v4 六功能资产及原私有批准，不修改获批脚本、断言、配置、scope 或原6/6正式批次。新增 `tests/ui-failed-batch-baseline.mjs`，原生0.1.9设计门禁仍认可旧独立设计批准，但完整门禁发现诊断规则已变化；按原冻结spec用新请求执行15轮90次诊断，正例6/6、14反例检出，runtime_ready恢复。旧诊断及历史结果保留，不新增设计评审、不伪造批准。

测试入口计划在原loopback origin使用A-edit-2响应变体，再恢复冻结正例；仅操作自有监听，不占用或终止用户服务。实际原生父批次run-6983d5c677e957541457c01e6f6cb9c8完整对账：6例启动、5通过/1失败、13断言步骤到达（不等于13通过），C-edit的A-edit-2失败；原生trace、错误文本及附件可追溯。现有原生响应内容没有证明实际取回的变体身份，所以最终报告只确认保存/重载/查询后getByRole(listitem)预期[U05-owned-item]、实际[]、5000ms超时；classification=insufficient-evidence、certainty=unknown，不推断真实产品、服务端或数据库根因。

初次入口在analyze交接同时传入results/analysis/report，被原生契约拒绝；保存FAIL回执后改为仅交接report。`--continue-from`核验并复用原父run/results/report，不重复父浏览器执行或诊断，不覆盖原报告。恢复任务只选择C-edit，排除其余5例；子批次run-ca2082d7a85657107ca2dd0f0cc505ba为1通过、2断言到达、完整对账。父批次失败不被替换，u00-1只是合成环境族标签，不把两种响应状态描述成相同部署或真实产品修复。原U05获批资产/正式run/report/delivery摘要均核对未变。

收到用户对这两个U00报告“最多3次、总费用不超过1美元”的新增授权后，在原共享账本保留全部旧调用和授权，登记新grant；评审入口增加精确报告ref绑定及每grant次数/费用预留门禁，模型仅gpt/gpt-6.1-sol、每次最多8192输出tokens。旧剩余设计额度未转用。真实原生ui_result_review创建无工具独立Agent：父报告首轮R4退回，要求不将变体意图写成已证事实；按上述事实和unknown归因生成新analysis/report-r2，保留旧报告、原响应和引文，第二轮R1–R6通过；子报告首轮R1–R6通过。修订时曾误用classification=unknown而被schema拒绝，随后按原生枚举改为insufficient-evidence，certainty仍unknown；该错误未发起模型调用或改写旧报告。新增3/3调用已用完，保守费用预留总上界0.627938美元，低于1美元；平台账单实付金额未核实，不把预留值说成账单。

两份获批报告分别在自己的原任务恢复并通过result-review交接，原生deliver均independently_approved，两个任务completed仅指这两个合成批次的报告交付。全计划仍active，U00仍进行中。初始和续跑的宿主FS计数、逐服务耗时及直接子进程记录保留；此次发生中断，没有连续发现到交付总耗时，不拼接两段冒充连续测量，不给出完整配对或性能收益结论；嵌套worker浏览器数量仍未测，服务调用数量不等于Agent编排调用数量。

[失败及重跑证据索引](ui-testing-evidence/optimization-u00-failed-rerun.json)保留两次入口源码/回执、trace、逐阶段计量、旧及新报告、三次独立原始评审、交付及追加授权历史；不包含私有authority、模型缓存或认证密钥。526个本地冻结引用校验通过；2个历史任务ref是状态变化前的摘要，明确标为瞬态而非伪称仍有效；1个更早跨工作区lineage已按摘要找到并保存单文件快照，不宣称展开其传递引用。归档逐文件解包回读一致。当前真实Electron数据空间仍缺受支持认证连接，文档未在应用索引、原生用例尚未入库，未将合成结果写为真实项目通过。首次发现到获批终点、5组成对完整基线、真实浏览器准入和后续原依赖门禁继续保留。

验证：全量typecheck、3文件51项Vitest、lint、协议结构通过；协议历史因仓库无tag跳过。实际原生诊断、失败与重跑集成以及独立评审/交付如上留证。本轮只改测试入口和文档，不修改产品或插件运行资源，不构建、替换或发布个人应用。

### U00/U02 续跑：PMS真实浏览器身份与部署来源核验（2026-10-26）

上一轮有实质进展：两个合成批次报告已独立获批并交付。本轮沿原计划补真实环境准备，未把原报告或历史私有引用当成本轮有效会话。任务链工具plan_update仍不可用，继续更新第8节。新增测试入口`tests/ui-pms-browser-preparation.mjs --refresh`，复用原PMS专用临时适配器与数据空间配置，仍非插件通用能力或Electron工具接入。仅使用用户确认的Electron数据空间项目/环境，配置revision8；不读取宿主访问令牌、不启动另一同库写实例、不替换或停止桌面服务。

浏览器仅允许同源GET/HEAD，禁用service worker和下载接收；其他方法及外站在发送前拒绝。认证context访问/pms/OperationContract停留原路由，“查询”固定控件出现；在同一浏览器通过本地私有token请求account-profile，仅返回账号是否与所选配置一致的布尔结论，实际matched。独立匿名context访问相同目标后跳转登录页，“查询”未出现。两组均pageerror=0、HTTP错误=0；未观察到非读方法或外站请求，因此不将零拒绝次数当作守卫反例测试通过。允许的GET也只证明本次读取观察，不扩张为全部业务接口无副作用保证。

未保存DOM、截图、trace、身份响应、业务记录或请求正文，仅保存固定公开控件计数和汇总；实际token及其临时文件路径的原文、URL编码和Base64均未出现在公开result。此检查只覆盖这些已知值，不声称通用隐私过滤已完成。私有state文件/目录、环境变量、context和自有浏览器均清理，store摘要前后一致；配置认证账号没有进入公开报告。账户匹配不证明业务角色或数据满足测试前置，role/data继续unknown，不创建虚假的运行就绪environment或录制批准。

第1轮1792981072928仅做浏览器账号/匿名对照；第2轮1792981232039增加实际公开脚本摘要对照；最终验证轮另保存其实际目录和源码，新增终态断言后复验，三轮回执和当时源码全部保留。每轮各1次浏览器启动、2个独立context，正式用例0、模型调用0、业务修改请求0、原生用例入库0。后两轮实际响应中的app/auth/permission/login/tenant五份公开脚本全部与已登记声明摘要匹配，分别跨认证/匿名页面加载，不声称每个context都加载全部五份；匹配证明这些响应字节一致，不证明后端部署、所有动态分包或业务正确性。未将控件出现升级为需求或执行通过。

准备记录写入所选项目project-documents/OperationContract-browser-preparation-2026-10-26.md（0600、逐字回读、保存摘要），正文对应第2轮观测和源码；最终新增终态断言的验证不倒写旧证据。应用没有独立文档索引，本轮Codex工具目录仍无原生数据空间工具；重新探测8790接口已不可达，与上轮历史401分别登记。最初撰写文档时沿用历史401，立即按本轮真实探测更正后核对回读；未对外提交错误接口状态。文件保存不等于应用文档登记或用例入库，后续仍需受支持的桌面会话连接。

[浏览器准备证据](ui-testing-evidence/optimization-u02-pms-browser-preparation.json)包含三轮公开准备回执与当时源码、五份来源声明、数据目录文档副本/回执及校验日志，排除原库、真实身份响应、认证文件与模型缓存。旧源码only清单和旧预期草稿保留，不冒充已录制；真实正常/错误诊断副本、业务角色、独立可清理测试数据、录制隐私、通用私密桥接、原生入库和完整Electron链路仍待完成。U00首次发现到获批连续基线及完整配对未完成，M1/M2和U03/U07依赖不放行，整计划active。

最终验证轮目录1792981439071，源码摘要与当前入口一致；已验证14项相关单测（含10项PMS私有引用边界/清理）、全量typecheck、lint、协议结构和size，协议历史无tag跳过；归档逐成员回读一致。任务开始/交付clean仅预览，无删除。只读进程/监听核对未发现Pi桌面进程或8790监听，其他8788/8940服务未停止或借作所选桌面实例。未构建/替换/发布应用，也未修改插件资源。

### U00/U06 续跑：Electron实际原库连接、源码草稿入库及重开核对（2026-10-26）

浏览器准备后继续处理应用连接，未把“8790不可达”永久当作用户必须处理的阻塞。只读进程/端口核实无Pi桌面进程；所选真实数据目录无scheduler-tasks.json，已安装5插件没有需要随包升级的版本（sol-savings已安装0.2.2高于仓库0.2.1，保持不变；既有data-space/api-testing源码软链接保持不变）。新增入口`tests/ui-pms-desktop-connection.mjs`复用现有prebuilt Electron主进程与server、原安装插件及实际data目录，不构建/替换/发布应用。UI及agent配置单独临时存放，删除继承的模型凭据环境变量，不恢复个人会话；没有读取旧宿主token，鉴权由新启动Electron正常引导和renderer同源fetch完成。不是复制原库到隔离替代数据源，也不声称原用户agent设置或完整桌面业务链已验收。

初次读取404，随后等待.app和额外renderer检查遇到启动导航中断；逐次结果和当时源码保留。检查确认“Execution context was destroyed/navigation”发生在启动导航期间，最终将只读state请求放在宿主侧有界等待循环，正常导航后复读，不强制刷新页面、不重放写入。1792982717737首次HTTP200，项目名/项目ID及环境ID均匹配用户选定Electron项目，revision8且0用例，原库摘要未变。这里只修正测试入口的读取时机，不把正常启动导航描述为已修复产品缺陷。

按data-space-testing与ui-case-design契约，未用/save直接伪造用例或绑定。`tests/ui-pms-source-cases.mjs`从既有公开源码声明构造三条带来源、preconditions、steps、assertions、data_rules和gaps的原生cases：成功登录后的私有认证状态、账号/业务类型的草稿命名空间、无冲突DRAFT/SIGNED输入的状态显示。新scope使用真实项目/环境ID和配置baseUrl，具体入口仍为/pms/OperationContract；业务角色、数据、清理、定位器、录制及诊断缺口明确保留。仅save-cases结构/引用校验，未生成Playwright候选或通过TypeScript候选检查，不称设计获批或业务已执行。

首份cases原生登记后，入口误调用不存在的loadFile作为后置检查而失败；原份已登记产物保留，改用原生ArtifactStore.load核验依赖，保存新v2，不覆盖旧scope/cases，也没有模型评审或换ID重置评审预算。实际入库只使用v2，case摘要031a0574bd22758fdb0e96919e7aba6f716337b262ee1f14e8569b3f39a1e3e9。首次入库入口又在导航前读取中断，后一次请求漏传/automation必需的workspace而被原门禁拒绝；两次均在任何库写入前停止，原库摘要不变。补齐真实workspace后才继续，不绕过项目/环境/引用门禁。

1792983729528通过正常Electron界面API的/save建立“经营合同”模块及三个源码功能（baseRevision乐观并发，case数组保持原值，动态秘密沿服务端原规则保留），随后inspect确认executable=false，带原生module/feature二元ID和已存在目标featureId调用import。回执新增3、逐功能归类完整；archive-status为existing3/pending0/stale0/unclassified0。明确完成后的相同import再次返回新增0、复用3，未覆盖人工字段、未绑定或执行。真实store由revision8到10，仅增加目录及草稿；环境完整序列化摘要不变。3行status=草稿、automation=null、nativeSource绑定所选项目/环境及实际casesRef，执行记录仍0。台账预期由原生assertion导入，不手填通过结果。

随后1792983935600和最终1792984383821分别重新启动Electron并从正常界面读取实际原库，1模块/3功能/3用例、revision10；打开数据空间用例页，实际3条“源码草稿：”行及3个“草稿”状态标签可见，无截图/DOM正文或个人会话内容入证据。该显示计数来自本轮Electron，非隔离库或历史记录。读取入口早期以直接systemId计算feature/case数量的问题按真实module→feature→case层级改正；早期读取时原库均为0，因此未将错误层级计数用于入库后结论。

原生来源工作区保留.cleanup-keep；其8个公开引用文件逐一核对摘要、复制到所选项目project-documents/source-drafts-031a0574bd22，保留原nativeSource路径/修订不迁移历史。新增OperationContract-native-case-drafts-2026-10-26.md，含实际台账ID、步骤、源码预期、引用、未评审/未执行及剩余前置，0600且回读摘要一致。应用没有独立文档索引实体，因此Markdown仍是数据目录文件；三条用例已经在实际用例库显示，这两种状态分开记录。旧预期与浏览器准备文档作为历史保留，不改成已执行。

临时UI/agent配置最初在各入口输出目录中；最终改到工作区外的专用临时目录，关自有app后清理。此前9轮自有配置的18个目录，在确认对应app已退出、18979无监听后按本轮fixture清理；不是常规缓存清理，不触碰真实data目录，所有公开失败源码/计划/结果和错误日志保留，认证/缓存不归档。最终原库只读重开未改store，临时配置删除可核验。共10次桌面启动：6次入口失败/部分就绪、4次完整达到各自目标；不写成10次通过。三条原生草稿不计正式用例执行，主动模型调用0，真实合同修改0；旧付费评审账本与上一归档逐字核对不变。

[真实原库草稿证据](ui-testing-evidence/optimization-u06-pms-native-drafts.json)保存全部10次公开入口证据、两份原生草稿/来源、生成失败与修订、实际原生导入及去重回执、重开界面计数、私有临时配置清理回执和持久文档回执，不含原库环境参数、私有profile、个人认证或模型缓存。只证明原库连接/草稿入库子链；Codex仍没有直接数据空间工具、用户原agent配置未改。U02通用私密执行/录制、真实业务角色/数据/诊断、U00首次获批连续链/配对、M1/M2及U03/U07未放行，整计划保持active。

本阶段最终验证：全量typecheck、4文件54项Vitest、lint、协议结构、size、脚本语法及差异检查通过；协议历史因无tag跳过。归档逐成员回读一致，原库文档及8份持久源码快照摘要与回执一致。开始/交付clean仅预览、无常规缓存删除；仅上述自有临时fixture按生命周期清理。原有.gitignore和db-client锁文件修改保留，不纳入提交。

### U02 续跑：JSON 私密存储字符串叶值隔离（2026-10-26）

本轮先将前轮已验证提交0c418ac推送，远端master与本地完整摘要一致；保留原有.gitignore和plugins/db-client/package-lock.json差异。继续A02-5已知私密执行边界，不重复U05已完成合成链路，不新增模型调用或改变授权范围。plan_update仍不可用，以本记录及第8节维护进度。

0.1.9缺陷先复现：新增原生测试将token置于localStorage JSON对象/数组字符串中，单独反射其叶值，原6项通过、新增1项失败；宿主--json-storage真实浏览器正反诊断均执行后，公开trace回读检出该合成秘密并失败，保存1792985759460回执。该场景没有Cookie认证，不能借标准Cookie头收集掩盖问题。仅归档失败摘要/日志，不归档已知泄露的合成工作区；原始失败保留。

最小修复在原生维护源PrivateEvidence.create：每个cookie/localStorage存储值保留原串，并对该值做一层JSON解码，遍历嵌套对象/数组收集字符串叶值，再复用既有编码变体及统一脱敏。原始process记录仍私有；未改runner、原生结果、批准门禁或报告完整性规则。新增测试覆盖嵌套对象、数组、JSON字符串、转义引号/反斜线及非JSON原串，核对stdout、error-context和解码文本附件，failed状态保留。没有递归解码叶字符串内再次包装的JSON，不承诺数字/布尔认证值、任意业务秘密或任意编码。

上游本地提交00ed830（未推送上游），运行包升级0.1.10，宿主e2e清单/锁及维护入口同步；导出包95文件与实际安装逐字节一致。没有直接编辑安装目录，没有覆盖个人配置，旧0.1.9包和历史证据保留。原生类型检查、3文件14项测试通过；宿主全量typecheck、3文件20项Vitest、SDK/MCP19项、lint、协议结构、体积检查及差异检查通过；协议历史无tag明确跳过。开始与交付clean只预览，无删除。

最终1792986016140（JSON存储）和1792986016109（轮换Cookie）各6项检查通过。两场景均由原生执行正反诊断及成功/受控失败各1批，成功保持passed=1，注错保持failed=1；每场景4份0700私有捕获和实际失败截图位于工作区外。轮换值在3份原始stdout出现，JSON叶值亦在私有原始记录中实际反射。公开文件、解码文本附件、解压ZIP及原生trace分析均未检出受测秘密/认证路径形式。公开媒体资源缺失如实保留complete=false，非其他证据问题被掩盖；missing/unplanned为空且成功issues精确等于既定两条R3。这里的工程评审为受控fixture，不是新的真实模型批准或项目管理系统业务测试。

隔离真实Electron1792986015590完成7项接入检查：技能/快捷发现、禁用启用、重载持久性、MCP87工具及重连通过；实际查看discovery-restored.png核对UI场景发现与录制入口。复用已验证构建，不自行重建/发布应用，关闭自己创建的宿主，未操作个人服务；不将此结果称为真实业务桌面全链。

[JSON私密存储证据](ui-testing-evidence/optimization-u02-json-storage.json)归档218文件，408次公开引用摘要核验和归档逐文件回读一致，含修复前后源码/补丁、原生测试、成功场景公开产物、失败摘要、Electron截图及检查日志；排除原始私有捕获/认证、模型缓存、依赖和失败泄露工作区。共享评审账本与前轮原库草稿索引摘要一致，新增付费调用0、真实业务请求0。

U02仍实施中：通用数据空间私密执行桥接及录制MCP隐私未接入，真实PMS业务角色/数据/诊断未就绪；本修复只闭合执行层一个可复现泄露边界。U00连续首次获批基线及完整配对、U03/U07、M1/M2和整计划未放行；既有3条源码草稿仍未录制/评审/执行，未修改实际数据空间内容。下一步继续私密引用的受控执行消费与录制衔接，不沿用旧设计授权或把本轮工程fixture当真实业务批准。

### U02 续跑：受管私密执行引用与撤销（2026-10-26）

继续A02-5执行侧私密消费，未重复已完成U05合成评审。plan_update仍不可用，进度同步本记录及计划第8节。无新增付费调用，共享账本与前轮原库草稿索引摘要一致；原有.gitignore及db-client锁文件差异保留。当前U02及整计划继续实施中。

data-space升级0.17.0，在既有data_space_automation增加prepare-private：显式engine=ui、mode=execute、systemId/envId/targetUrl及参数名到localStorage键名的privateBindings。只消费所选环境当前有效参数，不登录、不刷新、不请求目标；失效动态值不回退同名静态值。不提供模板执行、Cookie或业务身份结构转换。值写入工作区外0700目录/0600文件，工具只返回逻辑引用和有效期；引用按工作区、项目/环境、URL及名称映射固定，显式续准备可复用原冻结资产。最多5分钟且受动态参数到期限制；环境变化、断开通道、插件停用及到期撤销引用并清理自有文件，清理失败仅通用日志及计数。旧会话需/reload，不宣称个人现有进程已热更新。

原生先增加作用域测试，在旧代码6项通过/新增1项失败。维护源本地提交fe84c79及8ff42f0（不推送上游），最终0.1.12导出managedAuthStateVersion=1；诊断、证据捕获及fixture传入项目根，消费前校验私有权限、引用/元数据版本、工作区、origin、base URL路径和有效期。无兼容契约的运行包准备时阻塞。0.1.11为本机中间包、未交付；最终0.1.12包95文件与实际安装逐字节一致，未直接修改安装目录。

真实浏览器工程场景首轮1792988087234在公开扫描检出路径：测试辅助仍打印未使用的旧dummy认证路径，实际受管引用使用另一变量。保留失败回执和日志，不归档该泄露工作区；辅助改为打印当前原生配置实际使用的引用路径，同时扫描旧dummy和全部受管路径。最终1792988776986的6项检查通过：原生正反诊断、正式成功1/受控失败1保持原结果，续准备不改资产，环境变化后新批次在runner前auth-reference预检阻塞。4份私有捕获及失败截图位于工作区外，公开文件、解码附件和解压ZIP无受测秘密/路径形式。公开媒体缺口仍complete=false，工程受控评审不当作真实模型批准或PMS业务验收。

Electron隔离数据空间1792988098121完成10项检查，新增私密动态值准备、原库零写入/目标零请求和disconnect删除状态验证；原生authState兼容性检查在测试进程执行，不称为桌面Agent业务运行。UI接入1792988400700完成7项技能/快捷入口/启停/重载/MCP检查，87工具连接。实际所选原库1792988526143加载0.17.0，三个源码草稿仍可见，revision10及环境不变；通过真实界面插件入口确认mode=record返回400拒绝。此检查只证明实际安装和录制边界，不证明真实PMS已认证或角色/数据就绪。

最终全量typecheck、宿主6文件90项Vitest、原生2文件14项测试、上游类型检查、SDK/MCP19项、lint、协议结构及size通过；协议历史无tag跳过，clean仅预览、可清理0项。相关脚本实际运行通过，不构建/发布新桌面包。证据见[执行私密引用索引](ui-testing-evidence/optimization-u02-private-execution.json)：163文件、218次公开引用摘要核验、归档逐文件回读一致；包含源码/补丁、失败摘要、最终公开产物、桌面及原库只读回执和验证日志，排除私有状态/捕获、原库、认证/模型缓存、依赖及泄露工作区。

U02剩余为录制MCP隐私、真实PMS身份结构转换和角色/测试数据/诊断；简单参数映射不能证明真实身份。U00连续首次发现到获批完整基线及配对、U03/U07、M1/M2与桌面发现到交付仍未放行，3条源码草稿仍未录制/评审/执行。下一步可先补匿名PMS录制证据，登录私密录制待隐私边界修复，不复用仅限U05的剩余付费授权。

### U00/U02 续跑：真实 PMS 匿名跳转录制与静态候选（2026-10-26）

私密执行桥接提交f1d2f88已推送origin/master，并核对远端完整摘要一致。继续不依赖登录私密录制的匿名子链：明确所选Electron项目/环境，使用全新空上下文，禁止输入、登录、业务写入及外域请求，只允许同源GET/HEAD。原有三条源码草稿保持不变；本轮未入库新用例、未绑定、未正式执行。plan_update仍不可用，按本记录与第8节续跑。

使用实际已安装pi-ui-testing0.1.12、Pi SDK和Playwright1.62.1 MCP的ui_discover_record；scope、历史baseline、初态、数据规则及seed摘要在浏览器前冻结。历史观察明确标baseline，不冒充需求；当前原生导航、快照及日志独立保留。录制以匿名访问/pms/OperationContract后URL同origin且pathname=/login为唯一主目标，登录表单内容只记观察，不新增候选预期。未使用私人认证、个人模型配置或PMS登录请求。

四次失败均保留：1792989256617的seed辅助将afterAll放在test函数内；1792989301610缺少原生navigate/close输入intent；1792989342123误给禁止额外属性的snapshot传intent；1792989399713辅助URL正则作用于整个多行快照，真实/login被错误拒绝。前三类按原生契约修正，第四类改为提取Page URL并分别核对origin/pathname，不削弱真实页面预期。失败不记为通过；第二至第四轮保留partial交接，首轮setup未就绪，清理拒绝如实保留，宿主shutdown关闭自有会话。

最终1792989450785原生录制完成，包含setup、真实导航、snapshot、read_log、write_test和close。seed确认空Cookie及无token，关闭后请求回执为同源只读79、写请求0、外域0，原库逐字节未变；录制后复制原生.playwright-mcp快照/日志，核验公开响应中的文件链接存在。用户名/密码/“登 录”按钮在匿名快照可见，未输入或点击。录制complete只指该匿名范围，未给登录后业务放行。

按ui-case-design生成独立v1候选，显式空storageState及同源GET/HEAD网络约束，1用例/1条test.step断言，URL预期来自历史baseline。候选并非原生动作日志逐字节导出，lineage说明其综合和新增保护。初次静态辅助读取details.output失败，改为读取原生content中的完整输出后，candidate返回issues=[]、planned/covered各1、missing=[]、@playwright/test锁定1.62.1、ready_for_review=true、design_approved=false。未运行候选脚本，未做正反诊断或正式runner。设计门禁继续保留。

用户要求的预期文档已写入实际Electron所选项目project-documents，OperationContract-anonymous-redirect-baseline-2026-10-26.md（0600），同时保存anonymous-redirect-e51599c8d324下46份公开产物，逐文件回读与摘要一致。应用仍无文档索引实体，因此不称已在文档列表显示；台账原有3条草稿没有增加。文档明确baseline/未评审/未诊断/未执行，包含范围、角色、初态、步骤、预期、清理及资产引用。

[匿名录制与候选证据](ui-testing-evidence/optimization-pms-anonymous-recording.json)归档153文件、74次公开引用摘要核验、原生快照链接和归档逐文件回读一致，保留失败历史及辅助脚本，不含agent配置/认证、依赖或个人模型缓存。新增付费调用0，账本摘要与原库草稿索引一致。独立设计评审待新范围授权：旧U00额度3/3用完，剩余旧调用仅限U05 v4，不能挪用。已就本匿名候选提出最多3次/每次8192输出tokens/总1美元的新授权问题，未以等待代替批准。

该证据只补真实匿名发现/录制与静态设计，不算U00连续首次获批基线、真实PMS角色/数据或Electron Agent端到端。U02录制隐私、登录身份转换，U03/U07及M1/M2仍待推进，整计划保持active。

### U00/U02 续跑：匿名候选 v2 诊断输入与录制隐私边界审计（2026-10-26）

上一目标轮已提交并同步私密执行桥接及匿名录制，属于实际进展。本轮先核对工作区仅保留原有.gitignore/db-client锁差异，计划及候选仍未获最终放行，评审授权问题尚无答复。没有重复申请同一授权、挪用U05额度或调用付费模型；plan_update仍不可用。

先核查MCP录制隐私的实际源码路径。SDK1.2.0在createMcpToolDefinition.execute中先callTool再convertMcpResult；limitMcpContent会将较长原文保存临时文件，structuredContent和模型文本为独立数据通路。仅tool_result钩子脱敏不能覆盖先行落盘；StdioTransport.onMessage和McpExtensionOptions.createTransport是可用的更早接入点。Playwright1.62.1测试browserBackend构造固定capabilities配置，未转发outputDir；coreBundle默认输出目录依赖clientInfo.cwd/.playwright-mcp。证据保存对应源码完整快照/摘要和核心片段行号。以上为静态审计，不是新的泄露复现或已修复声明；没有改SDK/Playwright安装文件，也不开放通用私密录制。后续需要同时处理协议结果/进度/错误、媒体、structuredContent及公开路径所指原始文件，并通过实际SDK/MCP与Electron验证。

同时推进可独立完成的匿名评审准备。按ui-case-design/ui-design-review，调用原生ui_design_diagnose.schema取得契约，在同一范围/1场景/1断言下建立v2。目标仍为原Electron所选PMS环境；公开app包本次GET的SHA-256与既有部署声明2888c0b0…一致。错误副本源码冻结于独立http://127.0.0.1:18982：保留匿名页面“密码认证”及“登 录”标记，但在/pms/OperationContract返回原地页面、不做/login跳转。它仅提供合成HTML，不读取或修改真实PMS业务数据。未来正反诊断必须使用同一脚本和断言，本轮不执行候选来提前绕过独立批准。

准备期两次静态阻断均保留：1792990292894同时选入v1及复制的v2脚本，导致重复测试映射；仅移除v2 files中的旧脚本项，原v1资产/源码仍留磁盘且可追溯。1792990345137的新配置JSON.parse(readFileSync(...))缺少utf8，原生静态编译按Buffer类型拒绝；只修正两份配置的读取编码。未减少用例、断言、覆盖范围或改变期望。

最终1792990404494原生candidate静态检查issues=[]、planned/covered各1、missing=[]、design_approved=false。v2候选脚本摘要53a09d31…与v1逐字节相同，新增诊断计划、正反environment/config、变异源码/来源和部署/预检回执均纳入修订files供独立审查。诊断计划按工具返回schema验证；probe明确只针对A-anonymous-redirect，错误origin与真实站点不同，角色均anonymous，隔离均context。目标及错误副本各自调用原生preflightEnvironment，站点、匿名页面标记及初态检查完成。该预检不是正反诊断，不授予runtime_ready；真实目标的原生预检不提供请求方法计数，因此未声明真实目标请求为零。本地错误副本只读请求1/写请求0，所有自有服务在finally关闭；恢复诊断前需从冻结源码启动并核对端口归属。

另以独立自有子进程直接导入冻结negative-server.mjs，不复用内联准备服务：核对源码摘要，等待源码加载及监听就绪，GET经营合同路径确认HTTP200且Location为空，原生匿名预检完成，SIGTERM后自有进程正常code0退出。保存exact-negative-preflight回执；未运行候选或改写断言。

v2资产36386b98…及诊断计划d8d021b1…已冻结。新增模型调用0、候选回放0、正式执行0；原三条草稿不变。旧的匿名评审问题继续适用同一范围，但获授权后必须审查最新v2的完整原始材料，不能拿v1批准覆盖新增诊断依赖。

预期/恢复文档已写入实际Electron项目project-documents的OperationContract-anonymous-diagnostic-inputs-2026-10-26.md（0600），并保存anonymous-diagnostics-36386b98265b下63份公开产物；逐文件回读摘要一致，store.json保存前后摘要一致。原v1文档/快照保留，不把文件保存称为应用文档列表已显示或用例台账已入库。

[匿名诊断准备与隐私审计证据](ui-testing-evidence/optimization-pms-anonymous-diagnostics.json)包含205文件、105次原生公开引用摘要核验、两个失败准备工作区及最终静态/环境结果，归档逐成员回读一致；共享付费账本与前轮索引相同。仅文档和证据进入本轮提交，没有运行时源码变更；验证采用原生schema、静态候选、真实/错误环境预检及持久文档回读，不重跑无关全量单测。clean仅预览，交付前另核对size及差异。

独立设计评审授权仍待答复，依赖它的正反诊断及正式执行未开始。U02通用私密录制、PMS登录身份转换/业务角色/数据、U00连续首次获批基线及成对对照、U03/U07、M1/M2和Electron Agent全链仍未完成；整目标保持active。

### U02 续跑：真实受管 token-only 与完整状态对照（2026-10-26）

复用前轮已经实际执行的1792991555884，不重复登录或回放来制造新结果。三组独立新context使用同一次配置登录的token：匿名跳转/login；生产createPrivateBrowserStates只映射token→token，原生authState验证引用/工作区/有效期后成功到达经营合同；完整helper状态对照同样到达。两组认证context各自通过同浏览器account-profile与配置账号比对，结果均matched，公开证据只保留布尔状态。模型调用0、正式运行0、业务写入0。

匿名/受管/完整分别观察到41/30/30次同源GET/HEAD（认证组含profile）；配置准备另有login POST1次、permission GET1次。浏览器阻止其他方法及外域，本次没有触发拒绝，因此不声称完成守卫反例测试。三组页面错误和HTTP错误均0。token-only只有token及页面生成的menu项，account/tenant不存在；完整状态四类项均存在。“查询”两组均1，“经营合同”分别2/3，“搜索”“新增”“保存草稿”均0。这些固定公开标记不能升级为需求、权限结论或业务测试通过。

据此修正上一轮未被验证的假设：尚无证据证明必须先做PMS完整身份结构转换才能到达目标并匹配账号，不继续将它列为硬前置。完整状态仍可能对角色/租户/业务流程有影响，未从本次观察推断其无需使用。manager准备回执的authentication/role/data仍unknown；账号匹配是后续浏览器观察，不能倒写准备回执。

本次动态快照由真实登录token在内存派生，未执行实际Electron环境刷新工具或修改原动态缓存；是测试进程直接调用生产manager/原生authState，不是Electron Agent业务链。没有截图、trace、DOM或响应正文落盘，未公开账号/token/私有状态路径。所有context、浏览器、受管状态、完整状态和临时根已清理，原库逐字节不变。

[真实私密状态对照证据](ui-testing-evidence/optimization-pms-private-comparison.json)归档10份公开文件及当时辅助/生产源码快照，逐成员回读一致。共享评审账本SHA与匿名诊断索引一致。本轮授权回复指向U00两份结果报告，不扩展为PMS匿名候选设计评审授权，也没有新增模型调用。预期及限制文档已保存实际Electron项目project-documents/OperationContract-private-state-comparison-2026-10-26.md，附5份公开快照，0600文件/0700目录并回读摘要；应用无文档索引，未宣称列表显示或新增正式用例。

plan_update仍不可用，以第8节和本记录维护状态。下一步优先验证隔离私有副本中实际Electron环境刷新→受管准备→原生消费，再补角色/租户/隔离数据与录制隐私。匿名v2未获独立设计批准，正反诊断及正式运行继续待执行；U00连续基线/完整配对、U03/U07、M1/M2及整计划保持未完成。

### U02 续跑：实际 Electron 刷新与受管引用消费（2026-10-26）

前一对照证据提交e1b5175已成功推送origin/master；独立ls-remote查询超时，未把本地远端跟踪引用冒充独立核对。继续执行不依赖付费评审的实际插件环境准备；plan_update仍不可用。所选Electron项目/环境复制到工作区外0700私有根，仅保留该项目与环境，原参数/脚本/旧动态缓存不改；未复制个人模型配置或凭据，agent的auth/models为空。仅为该隔离profile写入已授权目标主机的网络许可，未覆盖个人授权配置。使用现有prebuilt真实Electron主进程/后端及原data-space0.17.0登记入口，不构建、不替换应用，不启动其他插件/调度任务。

1792992083192通过正常鉴权renderer请求实际/plugins-api/data-space/env/refresh，force=true，ok=true/cached=false/scriptRun.ok=true。读取自有私有副本核验新token已持久化且有效、静态params/script不变、内容revision保持。再调用实际/automation prepare-private，只映射token→token，受管文件值与刷新缓存相同且仅有一个localStorage项；公开刷新及准备回执均不含token。

按既有桌面回归做法，测试进程临时设置自己受管引用对应的私有路径，原生authState消费并校验工作区及origin/base URL/有效期，随后立即删除该环境变量。这个跨进程桥接属于验证辅助，未让公开接口返回私有路径，也不宣称Agent业务链已经运行。准备回执authentication/role/data仍unknown、recording仍unsupported，不拿后续账号观察改写该回执。

真实浏览器两组新context仅允许同源GET/HEAD，不输入或提交表单，不保存DOM/截图/trace/响应正文。匿名41次读取，跳转/login、查询标记0；桌面刷新token组30次读取（含profile），停留经营合同目标、查询标记1、同浏览器账号比对matched。两组页面错误/HTTP错误/被阻止写入/外域均0；没有触发拒绝，不算守卫反例验证。后端刷新请求次数未单独计量，不据浏览器计数声称登录请求为零。模型调用0、正式批次0、业务写入0。

实际插件disconnect后受管文件不存在；所有context、浏览器、自有Electron及整个私有根已结束/删除，验证进程code0，无残留自有监听进程。原store逐字节不变，原3条草稿和原动态缓存未改。结果文本对已知配置值、本轮token及URL编码/Base64检查未发现；不是通用录制隐私修复证明。

[实际桌面刷新证据](ui-testing-evidence/optimization-pms-desktop-refresh.json)保存14份公开文件及相关生产源码快照，归档逐成员回读一致；评审账本摘要保持不变。实际项目project-documents新增OperationContract-desktop-private-refresh-2026-10-26.md及4份公开快照，0600/0700并回读校验；不宣称应用文档列表已显示或正式结果入库。

本轮闭合“所选环境隔离副本的实际Electron插件刷新→缓存→准备→测试进程原生消费→路由/账号观察”子链，不替代原库动态刷新、个人Agent会话或完整发现到交付验收。业务角色/租户/隔离测试数据和私密录制仍未核验，匿名独立设计评审授权仍待答复，依赖它的正反诊断/正式执行保持待执行；U00连续基线/完整配对、U03/U07、M1/M2及整计划继续active。
