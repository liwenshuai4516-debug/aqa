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
