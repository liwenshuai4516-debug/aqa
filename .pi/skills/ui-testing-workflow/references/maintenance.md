# UI 测试统一维护入口

## 文件归属

| 维护内容                                | 唯一位置                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 技能名称、描述、调度入口                | `../SKILL.md`                                                                                                   |
| 原版工作流分发包                        | `../assets/pi-ui-testing-0.1.27.tgz`                                                                            |
| 原生测试 MCP 适配                       | `../assets/mcp-extension.mjs`                                                                                   |
| 产品私密连接、采集消费与发布            | `../assets/private-recording-connection.mjs`（显式受管协议；原生过滤复用、私有原文及writer独占发布）            |
| 私密动作的SDK调用归属                   | `../assets/private-recording-actions.mjs`（真实父子ID、单次授权与固定helper；不绕过宿主门禁）                   |
| 显式协议seed准入                        | `../assets/private-recording-preflight.mjs`（直接fixture/环境/归属、同物理运行时及trace:off；非代码沙箱）       |
| Chromium 执行配置                       | `../assets/playwright.config.mjs`                                                                               |
| 录制 seed 前置校验                      | `../assets/recording-preflight.mjs`（由 MCP 执行钩子调用，不另建 runner）                                       |
| 私有录制输入副本及受管身份派生          | `../assets/private-recording-workspace.mjs`（仅明确摘要输入、子进程引用、请求取消及发布前复验；不开放录制入口） |
| 私密录制连接/请求守卫                   | `../assets/private-recording-transport.mjs`（产品握手及内部SDK/MCP原型复用；过滤与原生writer由调用方负责）      |
| 八个阶段技能、schema、runner 与评估规则 | 安装后的 `node_modules/pi-ui-testing/`，修改上游源码后重新分发，不直接改安装目录                                |
| E2E 依赖与版本锁                        | 仓库 `tools/e2e/package.json`、`package-lock.json`                                                              |
| 项目/应用登记                           | 仓库 `scripts/enable-ui-testing.mjs`                                                                            |
| 管理页与快捷发现的公共逻辑              | `server/skill/`、`server/settings-service.ts`、`server/slash-commands.ts`                                       |
| 测试资产与执行证据                      | 被测工作区 `qa/ui/`，不写进技能目录                                                                             |

原版包来源提交：`3a566ce`（上游本地提交；未推送上游远端）。
SHA-256：`df698d90fb9200e7f7b6e66d9e1bb3b54516c8eee81eef80ec5baaafa89cba60`。0.1.27 只替换五个阶段技能的 `SKILL.md`（`ui-discover-record`/`ui-case-design`/`ui-design-review`/`ui-test-run`/`ui-result-analysis`，经 darwin 九维评审优化），`dist`、其余三个技能与 104 个安装文件路径逐文件与 0.1.26 一致；不改产物 schema、冻结与门禁规则，旧批次结论不变，旧会话需 `/reload`。0.1.26 修正同批次 `native.json` 与 `report.json` 的引用核验、私有 trace 文件权限，以及未公开截图的完整性判断。已封存 trace 可参与完整性判断；缺封存、错误归属、权限不符或未公开截图仍保留缺口。0.1.25 之前的历史批次不会自动获得封存，私有原文和路径不进入工作区、报告或模型输入。

保留 0.1.3：将认证诊断/正式执行的原始捕获保存在工作区外的宿主私有目录，公开副本脱敏已知值并隐藏图片/二进制资源；真实失败保留，缺失原始附件时不声明完整证据。trace 读取绑定实际 Playwright 1.62.1，避免误用独立安装的 core 1.63.0。0.1.3当时未覆盖录制、运行中新凭据、任意编码和脚本自行写文件；数据空间私密桥接继续 not-ready，不因该版本放行真实环境。

保留 0.1.2 的按功能探索、locator 复用和逐功能草稿，以及 0.1.1 的 partial 交付恢复修复。未改变产物 schema 或批准门禁；旧包及摘要可从 Git 和既有基线证据恢复。原始私密目录不得纳入工作区归档、文档或提交。

## 安装与发现

在仓库根执行：

```sh
npm ci
npm run install:e2e
npm run ui-testing:enable
node scripts/run-profile.mjs e2e playwright install chromium
```

项目登记仅作用于该工作区。应用切换工作区仍需可见时，显式执行：

```sh
npm run ui-testing:enable -- --agent-dir "<应用专用 agent 目录>"
```

脚本合并配置并保留其他字段；新登记使用本技能目录。已有旧路径登记保持有效，重跑不会再增加同名入口；旧 `capabilities/ui-testing/` 仅提供转接，不再维护实现。不自动改个人配置。移动仓库后，应用绝对路径需重新登记。

Pi 中 `/reload` 后，在“设置 → 技能”管理入口与八个阶段技能，输入 `/ui` 选择 `/skill:ui-testing-workflow`；配套扩展在插件/能力管理中显示。禁用扩展时 UI 技能应联动停用，原单技能禁用偏好保留。仅加载成功不代表正式测试通过。

依赖安装在 `tools/e2e/node_modules`，根 `node_modules` 是兼容入口，技能目录内不放依赖副本。根 `npm ci` 后须重新执行 `install:e2e` 恢复链接。当前能力不会自动随 npm 全局包或桌面安装包分发。

## 修改与验证

- 只改入口文案：编辑 `SKILL.md`，保持技能名和原工具调用规则；不要把八个阶段说明复制到项目。
- 改 MCP/浏览器参数：编辑 `assets/` 对应文件，保持当前工作区为测试目标，检查不同安装位置与被测工作区。
- 升级工作流：从上游重新出包，更新文件名、来源摘要和 `tools/e2e` 包清单/锁文件；重新安装并验证兼容 SDK、阶段技能、工具与 schema，保留旧业务资产。
- 改登记或管理：回归项目/应用登记幂等性、旧路径兼容、技能发现、`/ui`、禁用/启用与重载，不读取认证文件。

仓库回归入口：

```sh
node --import tsx tests/capability-layout-test.mjs
npm run test:ui:integration
npx vitest run tests/unit/skill-capability-settings.test.ts tests/unit/ui-testing-registration.test.ts
```

真实界面回归另见仓库 [接入记录](../../../../docs/ui-testing-integration.md) 中的 visibility 命令；本次迁移结果见 [目录归并验收](../../../../docs/ui-testing-maintenance-evidence.md)。全局能力导航见 [能力维护](../../../../docs/capability-layout.md)。

MCP 运行时选择由 `assets/playwright-runtime.mjs` 负责：CLI 与配置均基于当前工作区；无配置才用后备配置，缺依赖或多个配置阻塞。`tests/ui-testing-integration-test.mjs` 使用独立复制的 Playwright、`tests/` seed 与相对 baseURL 检查跨工作区启动；不以共享依赖链接替代此项回归。

录制前置校验在现有 `generator_setup_page` 的执行钩子中生效：要求明确 project/seedFile，通过目标 CLI 的 `--list` 校验唯一文件和单个测试；缺失、路径歧义、多测试、错误 project 或收集不兼容时拒绝，不创建默认 seed。只收集，不执行 seed 测试体；每次 setup 重新检查。配置模块与测试模块仍会被 Playwright 收集器加载，必须使用已授权工作区；该检查不证明登录、角色或数据初态就绪。只查看、分析和已有资产正式回归不触发此录制检查。

0.1.7 增加受信任宿主的 DesignReviewService.renewBudget：明确用户续授后一次追加1–3轮，保留原task/scope及全部尝试，授权幂等、pending拒绝；不登记为模型工具，不授予批准。累计评审round允许超过3，实际次数仍由冻结scope加私有续授及宿主总预算限制。0.1.5试装的第四轮响应因旧round上限被拒绝，不能当作批准；已留原始失败并补有效第四轮登记回归。

0.1.7 修复连续错误后改善依据的选择：回溯最近已登记的有效评审，不以紧邻的错误尝试覆盖 revise。已保存的原始响应不能因此追认为批准，须另行取得授权后重新评审。

0.1.9 在公开进程输出前，从私有 trace 的标准 Cookie/Set-Cookie/Authorization 头收集运行时轮换值；认证成功/失败都保留私有 trace，匿名路径保持 retain-on-failure。公开文本统一脱敏，无法解析已有 trace 时拒绝发布并保留原始捕获。公开成功报告也如实保留 trace 资源缺口，passed 不等于公开证据完整。仅覆盖这些头中可观察到的值，不覆盖录制 MCP、无 trace 的未知值、任意业务秘密或编码。0.1.8 为隔离中间尝试，成功路径未留 trace 的泄露已留证，不作为当前分发。

0.1.10 补收集 cookie/localStorage 每个存储值经一层 JSON 解码后的字符串叶值，覆盖嵌套对象、数组和 JSON 字符串；复用既有脱敏及编码处理。原始私有证据仍保留。未覆盖字符串内部再次编码的 JSON、数字/布尔认证值、任意业务秘密或录制 MCP；数据空间通用私密桥接继续 not-ready。

0.1.12 导出受管认证消费契约1：消费数据空间生成的私有引用前核对引用名、私有文件/目录权限、工作区、目标origin及base URL路径边界、有效期；诊断、私密证据捕获及Playwright fixture均传入实际项目根。数据空间0.17.0的prepare-private只显式映射当前有效参数到localStorage，逻辑引用可续准备而不改冻结资产，失效引用初始化阻塞。0.1.11为本机中间包、未交付。录制MCP仍未支持私密认证输出。

0.1.13仅从包主入口导出已有`PrivateEvidence`，供受信任录制宿主复用初始storageState的一层JSON字符串叶值及既有编码过滤；规则仍在原实现。内部原型在原生过滤器的私有目录中派生录制副本，响应在SDK转换前过滤并隐藏媒体，保留原始私有协议及原生writer校验。嵌套JSON原型泄露已复现、复用过滤后正常/取消对照留证；运行中新增HttpOnly cookie仍可反射泄露，未完成实时收集，不据此开放产品record入口或宣称通用隐私安全。

后续内部合成原型通过原生SDK固定嵌套trace采集，在公开父响应前复用PrivateEvidence.process，拦截运行中新cookie及立即清除的历史cookie；损坏trace/采集中取消保持partial且阻止公开草稿。真实SDK事件记录额外4次helper归属，不能与5个原生steps混计。一次writer超时未finish保留，新localStorage反例仍泄露；该路径仅串行已知mirror布局、使用固定unsafe工具，不开放产品record。详见[本轮证据](../../../../docs/ui-testing-evidence/optimization-u02-recording-runtime-headers.json)。

0.1.14在原生PrivateEvidence新增宿主observeStorageState(state)：完整核验cookie/localStorage结构后累积现有JSON字符串叶值和编码，删除/轮换不遗忘已观察值，create复用此路径。内部固定SDK采集增加Playwright原生context.storageState私有文件，原始内容不进入SDK结果；新localStorage与嵌套JSON对照已拦截，坏结构和采集中取消阻止公开草稿。方法不启动采集、不开放模型工具；采集前已删除的未知存储值仍是缺口，产品record继续unsupported。

历史内部`assets/private-recording-storage-events.mjs`由受控seed在导航前安装Chromium CDP DOMStorage监听，使用工作区外0700/0600文件保存实际历史事件；固定page私有flush函数提供屏障，宿主验证事件后仅为原生过滤归一化oldValue/newValue，不伪称浏览器storageState。单page/origin，128事件/2MiB、断连/关闭/坏证据/第二页面拒绝；不改页面Storage方法、不复制过滤器，产品mcp-extension尚未导入。真实SDK瞬态JSON正向及坏日志/取消/第二页面partial留证，跨frame/其他target与完整重连续录未证明。见[存储事件证据](../../../../docs/ui-testing-evidence/optimization-u02-recording-storage-events.json)。

存储事件内部观察器现于创建文件/CDP前校验当前blank、单frame/单page，记录frameattached历史并在读取时拒绝，即使随后移除也不放行；dispose解除该监听。真实浏览器前后及实际SDK旧版放行/修正版partial、CDP解除partial/正向留证，见[边界证据](../../../../docs/ui-testing-evidence/optimization-u02-recording-storage-boundaries.json)。blank检查不是过去导航历史证明，依赖受控fixture的新context事实；仅拒绝未覆盖frame，不代表支持多frame，产品record仍unsupported。

录制配置检查补充：`recording-preflight-reporter.mjs`通过目标Playwright公开Reporter API只返回项目名、testDir、测试文件及storageState配置布尔值，不序列化use原值、metadata或收集错误。所选project的storageState（含继承配置及contextOptions）暂时阻塞；其他project不连带阻塞。该检查在实际SDK setup钩子生效，不读取状态文件，不执行seed；数据空间execute引用仍可用于原正式执行入口。只覆盖配置层，不能检测seed/test.use或自定义fixture运行时自行注入认证，也不解决配置收集与MCP执行间的修改竞态，不作为通用隐私保证。产品私密record继续unsupported。

0.1.15为原生录制启动契约增加可选`private_recording:{environment_ref,input_refs}`，校验同范围环境ID/角色/入口、受管独立context、唯一输入集合及seed摘要；每次新动作前再验认证，过期保留status/finish和已初始化context的close。`RecordingService.privateContext`从已核验会话返回公开环境/输入引用。宿主内部`private-recording-session.mjs`据此复用原生PrivateEvidence及既有私有工作区模块，将环境文件和session本身一并冻结到副本输入，回执不含认证内容/私有路径。真实SDK已验证该绑定、宿主准备和未启浏览器时partial结束；产品MCP仍未接入捕获/过滤，不因启动契约可用而开放私密record。输入集合仍需显式登记依赖，不证明任意依赖闭包。

产品连接阶段现已接入：原生私密start成功后，`mcp-extension.mjs`自动准备并同名替换`ui-playwright-test`，仅在私有副本中启动MCP握手；`private-recording-connection.mjs`将原始协议保存在私有目录，交SDK前复用原生`PrivateEvidence.process`过滤已知初始值。连接仅允许initialize、initialized/cancelled通知、ping及tools/list，浏览器/资源调用继续阻塞；该回执表示准备完成，不承诺异步连接已就绪。准备失败保留原生session供partial结束，不退回匿名；finish撤销身份并异步恢复匿名连接。shutdown、旧连接和迟到准备不得接入新会话；重新连接不复用已撤销快照，不声称完整续录。握手/协议请求也绑定取消并在SDK正常完成前解绑。

无关MCP注册复用锁定SDK 1.2.0的`extensions/mcp/runtime.js`导出`createDefaultTransport`（从其ESM入口定位；升级SDK时须核对该内部模块路径与接口），避免另写配置/认证解析。SDK与隔离Electron已验证加载、87工具、启停/重载及重连；真实私密浏览器捕获、动态值收集和原生草稿安全发布仍未接入，数据空间record继续unsupported。证据见[产品连接阶段](../../../../docs/ui-testing-evidence/optimization-u02-recording-product-connection.json)。

0.1.16把上述CDP观察/读取迁入原生包作为单一实现，宿主旧模块仅re-export；事件解除改用Playwright公开的CDPSession close事件。新增 `pi-ui-testing/recording-fixtures`：复用原uiData/auth fixture，在自动导航前安装观察器并启动原生trace；需要受管独立context、私有目录环境引用及trace:off。宿主固定代码只传1–8顺序编号给 `page.__pi_private_recording_capture`，私有output/recording/capture-N内保存storage.json/trace.zip及最后写入的complete.json，不依赖seed手工拷贝观察器或猜相对目录。重复/并发/越界编号、认证失效、目录不安全、未覆盖frame/page历史及采集失败阻止后续采集。消费端仍须核对完成标记、原始事件/状态/trace并在SDK处理前过滤和隐藏媒体，writer仍须独占发布。此包不自动开放产品浏览器动作；产品连接目前仍仅握手，完整重连续录、通用依赖闭包及真实PMS/Electron业务全链待完成。

0.1.17允许宿主私有证据根包含隔离mirror，但每个实际捕获目录仍须在mirror外且满足0700/canonical/非symlink校验；不将根的包含关系误判为秘密写入副本。初始化拒绝仅附固定阶段名供诊断，不输出原始异常。宿主必须在runner启动前创建0700的output目录；fixture与CLI须解析到同一个Playwright实例，不能仅核对版本号。0.1.16是本轮未交付中间包，私有祖先根误拒及重复运行时的失败证据均保留。

0.1.18为私密会话增加可选固定声明`private_recording.capture:"chromium-single-page-v1"`。从原生已核验会话返回seed/project/outputFile与采集预算事实；要求受管后端、最多8个非清理动作、范围预算至少`2 * max_steps + 1`（逐步动作/采集各1次，另留1次关闭）。预算不足在创建session前拒绝；初始化失败仍允许一次自有context清理，close已请求后不追加或重复分派，原operation_id仍返回缓存。预算耗尽及初始化失败保留partial缺口。

宿主准备只在显式capture时预建0700的私有output并向子进程交原生私有证据环境引用；普通回执只含协议及数量，不含私有路径。未声明采集的旧私密/匿名配置兼容。此阶段未核验seed是否使用受管fixture、未连接采集helper或writer发布，不据此开放产品浏览器动作；产品仍仅握手并保留`blocked-capture-not-connected`。实际SDK验证预算不足零session/零seed、有效声明回执及私有目录权限，随后仍按partial结束。详见[证据](../../../../docs/ui-testing-evidence/optimization-u02-recording-capture-contract.json)。

显式产品接线阶段（2026-10-27）：宿主在准备和setup前校验直接受管fixture、literal环境/归属、同物理Playwright和Chromium/trace:off；新协议才允许原生动作的真实SDK子调用。每个非清理响应在SDK转换前，以真实MCP父ID派发一次固定helper，核验原生完成标记、存储历史/state及trace，复用原生过滤并隐藏媒体。原生writer只能写声明目标，公开副本须在最终生命周期核验后同步、字节一致、wx/0600发布；不覆盖、不跟随符号链接。未声明协议的旧路径仍只握手。

此准入适用于受信工作区，不证明任意配置/依赖代码安全，不支持多frame/其他target或中断后完整续录；数据空间通用record仍unsupported。取消、坏证据、宿主门禁拒绝、预算和路径冲突保留partial及清理入口。实际产品SDK/Chromium回归入口：`PI_WEB_SMOKE_PREBUILT=1 node tests/ui-private-recording-product-test.mjs --mode=normal`；其他模式及桌面证据见[阶段索引](../../../../docs/ui-testing-evidence/optimization-u02-recording-product-actions.json)。

重载/重连补证（2026-10-27）：同一测试入口的 `--mode=reload` 调用真实 SDK `session.reload()`，`--mode=reconnect` 调用已登记的 `/mcp reconnect ui-playwright-test` 处理器。原生重载门禁本已拒绝旧会话动作，无需新增宿主守卫；重连撤销旧私密快照。两类均保留原3步、无新增目标请求/公开writer，最终partial；重连另留2条失败尝试，重载不追加MCP动作。原生close未成功，保留清理未知，不把物理连接关闭冒称业务清理成功。见[生命周期证据](../../../../docs/ui-testing-evidence/optimization-u02-recording-product-lifecycle.json)。完整中断续录不属于现有恢复契约，后续应验证安全停止/查询及显式重新准备，不据历史“待验”文字增加自动恢复功能。

数据空间0.17.1补齐显式录制的参数准备入口：`prepare-private` 使用 `mode=record`、`recordingCapture:"chromium-single-page-v1"`，只返回原生可消费的短期auth引用及`explicit-capture-required`。宿主按原生`recordingStartSchema`中精确capture literal核验兼容，未声明/旧包拒绝，不从版本号推测支持。该入口不安装/启动录制器，不替代上述seed/范围/预算/权限与私密采集校验；通用录制仍未开放。

0.1.20 增加 task ID 的 `stage_inputs`/`handoff` 与显式 `continue-execute`、只读诊断 `reuse`、按任务 `analyze-task` 及逐实例失败分组；沿用原 checkpoint/诊断/报告评审门禁。仅返回当前技能目录，不预载正文。0.1.19 为未交付中间包。0.1.18 的旧运行证明会因现行诊断规则摘要改变而失效，须按原规则重新诊断；不得为复用而降级门禁。现有任务/原始 run 仍可读取，实际应用链接已核对，旧会话需 `/reload`。工程、Electron、性能及未通过项见[U03/U07 实施记录](../../../../docs/ui-testing-u03-u07-implementation.md)。

0.1.21 仅调整 `ui-test-workflow` 的文档结构：7 步编号主链与每步输入/输出、mode 表增加「用户说的」列与拿不准时的分流判据、阶段 Skill 一览（7 个名称与包内目录逐字对齐，并显式排除 `ui-run-analyze` 等臆造名）、跨阶段失败分支索引 12 条。正文原有条款、参数、拒绝条件与门禁零删改；`dist` 代码及另外七个阶段技能逐文件与 0.1.20 一致。

0.1.21 修复报告时点：冻结 case/asset gaps 原文保留，以历史声明前缀及 coverage.gap_basis 与当前批准、原生执行结果区分；不放宽评审或运行门禁。原生提交 c295a26，匿名旧失败及新正式通过报告均获独立结果批准并在 Electron 完整交付，见[匿名未结项续跑](../../../../docs/ui-testing-anonymous-closure.md)。逐文件核对运行代码一致；安装目录 README 与 ui-test-workflow/SKILL.md 两份说明存在未归因的并行差异，已保留摘要和快照，未覆盖。旧会话需 /reload。

0.1.22 合并并行的 0.1.21 工作流说明优化与 c295a26 报告时点修复，避免同名分发包互相覆盖。冻结 case/asset gaps 以历史声明及 coverage.gap_basis 与当前状态区分；不改评审或运行门禁。匿名旧失败与新正式通过报告均获独立批准并在 Electron 完整交付，最终 104 个安装文件与 0.1.22 分发包一致，见[匿名未结项续跑](../../../../docs/ui-testing-anonymous-closure.md)。原生维护仅本地提交，旧会话需 /reload。

0.1.23 仅在 `analyze-task` 单次调用内复用刚完成的结果对账输入，避免分析保存和报告组合重复完整读取；公开 `save-analysis`、`draft-report`、结果评审入口仍逐次校验。原生回归、版本一致的五组成对对照和隔离 Electron 均通过；该局部路径不代表真实模型或完整端到端性能达标，旧会话需 /reload。
