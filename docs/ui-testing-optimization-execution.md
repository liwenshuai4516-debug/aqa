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
