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
