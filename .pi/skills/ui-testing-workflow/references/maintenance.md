# UI 测试统一维护入口

## 文件归属

| 维护内容                                     | 唯一位置                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 技能名称、描述、调度入口                     | `../SKILL.md`                                                                                                   |
| 原版工作流分发包                             | `../assets/pi-ui-testing-0.1.12.tgz`                                                                            |
| 原生测试 MCP 适配                            | `../assets/mcp-extension.mjs`                                                                                   |
| Chromium 执行配置                            | `../assets/playwright.config.mjs`                                                                               |
| 录制 seed 前置校验                           | `../assets/recording-preflight.mjs`（由 MCP 执行钩子调用，不另建 runner）                                       |
| 私有录制输入副本及受管身份派生（内部未接入） | `../assets/private-recording-workspace.mjs`（仅明确摘要输入、子进程引用、请求取消及发布前复验；不开放录制入口） |
| 私密录制连接/请求守卫（内部未接入）          | `../assets/private-recording-transport.mjs`（真实SDK/MCP使用的生命周期薄适配；过滤与原生writer由调用方负责）    |
| 八个阶段技能、schema、runner 与评估规则      | 安装后的 `node_modules/pi-ui-testing/`，修改上游源码后重新分发，不直接改安装目录                                |
| E2E 依赖与版本锁                             | 仓库 `tools/e2e/package.json`、`package-lock.json`                                                              |
| 项目/应用登记                                | 仓库 `scripts/enable-ui-testing.mjs`                                                                            |
| 管理页与快捷发现的公共逻辑                   | `server/skill/`、`server/settings-service.ts`、`server/slash-commands.ts`                                       |
| 测试资产与执行证据                           | 被测工作区 `qa/ui/`，不写进技能目录                                                                             |

原版包来源提交：`8ff42f0eee7c3d9dd6e16d967b229b6c0006d9ed`（上游本地提交；未推送上游远端）。
SHA-256：`72e6949acc02d7474419f7cd521d0858dd739cfa1ddde5109472b7456aaea0bf`。0.1.4 仅在一次引用核验内按 path+sha256 复用成功读取；不同摘要、后续调用及并发调用仍独立核验，不增加跨请求缓存，不改变批准或产物协议。

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
