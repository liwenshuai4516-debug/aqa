---
name: ui-testing-workflow
description: UI 自动化测试工作流入口：发现录制、用例设计与独立评估、执行已有资产、分析旧批次和查看证据。用于「录制这个页面并出用例」「只录制，先别执行」「跑一批已有用例」「上一批为什么失败」「把证据调出来」「有哪些资产能跑」等场景。复用已安装的 pi-ui-testing 阶段技能与工具。
---

## 步骤（按序执行，不跳步）

1. **定模式** · 入：用户意图 → 出：new / record / execute / analyze / view 之一，及所需 `scope_ref` / `asset_ref` / `run_ref`
2. **核环境** · 入：该模式的 `mode`、`envId` 或目标 URL → 出：`initialize` 返回的地址与非敏感参数、`preparation`
3. **询资产** · 入：当前工作区 → 出：`catalog` 的资产修订、可信 review_refs、runtime_ready 与最小 Skill 目录
4. **开任务** · 入：最小 Skill 目录 + 该模式引用 → 出：`start` 的 `task_ref` 与当前阶段
5. **跑当前阶段** · 入：当前阶段 SKILL.md + 工作区 Playwright 配置与依赖 → 出：该阶段产物与 manifest 引用
6. **交阶段** · 入：`task_ref`、`stage`、`output_refs` → 出：程序核对通过后的新 stage，或 `block` 的具体缺口
7. **🛑 入库闸门** · 入：原生 `save-cases` 的 cases ref → 出：用户选择；未明确同意前不入库

仅 analyze / view 跳过第 2 步的环境初始化与第 5 步的浏览器动作。🔴 = 该动作前必须先满足紧随其后的前提；🛑 = 越权不可逆，须用户明确同意。下文各段是对应步骤的详解。

## 路径判定（第 1 步展开：按用户原话选 mode）

| 用户说的                    | mode                | 必带入参                                          | 是否动浏览器        |
| --------------------------- | ------------------- | ------------------------------------------------- | ------------------- |
| 新建/设计这套用例、录制一遍 | `new`               | `scope_ref`；`discovery=source/browser/both` 可选 | 是（`source` 为否） |
| 录完存起来，先不要执行      | `record`            | 同 `new`                                          | 是（`source` 为否） |
| 设计批过了，跑一批          | `execute`           | `asset_ref`                                       | 是                  |
| 上一批为什么失败、帮我看看  | `analyze`           | `run_ref`                                         | 否                  |
| 把上次的证据/报告调出来     | `view`              | `run_ref`                                         | 否                  |
| 有哪些资产、能不能跑        | 不开任务（非 mode） | 只调 `catalog` operation                          | 否                  |

拿不准时按「有没有获批 `asset_ref`」判：有走 `execute`，只有目标走 `new`，只有旧批次走 `analyze`。

---

## 初始化与入口

用户要求新建或执行测试，且数据空间工具可用时，先读 [数据空间测试数据规范](../data-space-testing/SKILL.md)，用 `data_space_automation.initialize` 传当前 `mode`，按目标 URL 或所选 `envId` 核对环境；仅源码设计传 `new/record` 和 `discovery=source`，不创建通道；沿用返回的地址和非敏感参数，读取 `preparation`，动态参数过期时显式刷新再初始化；实际访问、身份和数据仍由原生浏览器预检验证。初始化不授权用例入库。工具未安装或停用时明确无法录入用例库，不虚构关联。仅分析历史结果时按原批次引用处理，不重新初始化或执行。

然后调用 `ui_test_workflow`：`{"request":{"operation":"catalog"}}`，核对当前工作区的资产、阶段技能和运行能力；然后读取原包的 [ui-test-workflow](../../../node_modules/pi-ui-testing/skills/ui-test-workflow/SKILL.md)，按用户意图选择路径并按需加载当前阶段说明。

这是原包的同名入口，不另定义阶段、批准或执行规则。后续优先使用工具返回的原包技能路径。应用级安装只使能力在不同工作区可发现；正式测试仍以当前工作区为目标，须满足原包的依赖、来源、环境和数据门禁。缺少项目依赖时明确报告阻塞，不向个人目录自动安装依赖或执行业务测试。

## 录制

🔴 **录制启动前**：确认目标工作区的 Playwright 配置、依赖、浏览器 project 和相对 seed 路径；先用该工作区的 CLI / 配置收集 seed，确认匹配一个种子测试后再启动录制。MCP 优先使用工作区配置；无配置才使用 `qa/ui` 后备配置（不提供业务 baseURL）。不要把 seed 改成绝对路径绕过录制绑定。初始化阻塞不是产品用例失败。

私密录制仅支持显式受管协议：配置 `private_recording.capture:"chromium-single-page-v1"`，使用同一物理 Playwright 实例的 `pi-ui-testing/recording-fixtures`，直接声明与会话一致的环境/归属及 `trace:off`。受信工作区的明确输入须全部登记；收集配置仍会执行模块代码，不是任意代码安全沙箱或依赖闭包证明。限新建单页面/单frame Chromium，最多8个非清理动作，预算至少 `2 * max_steps + 1`。实际动作必须经本会话 `ui_discover_record`，固定采集仍经过宿主权限门禁；普通嵌套调用不授予私密浏览器权限。准备回执不表示采集或浏览器就绪，也不表示异步 MCP 已连接或业务身份/数据就绪。

省略采集声明的旧私密路径仍只准备/握手，浏览器动作阻塞。坏证据、取消、失效或预算耗尽保留 partial 和真实缺口，关闭自有 context 后显式 finish；禁止匿名回退、覆盖已有草稿或换任务重放。数据空间 `prepare-private` 的显式录制引用使用 `mode=record` 和 `recordingCapture:"chromium-single-page-v1"`，把返回的 `auth` 引用交本次原生环境，此处回执同样不代表采集或浏览器就绪。未声明协议的通用 `record` 准备仍拒绝；本协议的合成产品验证不代表真实 PMS 或 Electron 业务全链已通过。

录制期间重载 Agent 后，原生只允许查询旧记录，不从点击中间续跑；MCP 重连也不能复用已撤销的私密快照。先核对原日志和数据归属，再保存 partial；原生关闭动作被拒绝时保留 `browser-cleanup-not-confirmed`，不能把连接退出当作浏览器关闭成功。未知副作用仍须核对，不换任务重放。

## 阶段交接

按任务 ID 的最小交接、诊断查询复用和分析候选请按运行包内 `ui-test-workflow`、`ui-design-review`、`ui-result-analysis` 当前阶段说明执行；仍保留完整资产执行授权与独立结果评审，不复制运行规则。版本与验收见[维护入口](references/maintenance.md)。

## 用例入库

🛑 **CHECKPOINT**：生成 UI 用例后，保留 `save-cases` 等原生工具返回的 cases ref，并提供以下实际内联选项；未明确同意前不导入，用户已明确要求本批入库则直接办理，不重复询问：

[[action:suggest:录入用例库,prompt=将本批生成的测试用例录入所选测试环境所属项目的用例库]]
[[action:suggest:暂不录入,prompt=本批生成的测试用例暂不录入用例库]]

选择录入后，按数据空间规范显式调用 `import`，以原生 cases ref 为 `assetRef`，按所选 `envId` 匹配所属 `systemId`。保留显式或既有通道 `featureId`；无目录时默认使用“测试用例 → UI用例”，不存在则建、存在则复用，用户重命名后跟随目录 ID。可选 `moduleName` / `featureName` / `envId` / `featureId` 以实际工具 schema 为准；缺少扩展能力时报告阻塞。不要为了入库提前创建 candidate、绑定或执行测试，不生成执行结果。入库不替代设计批准、诊断或正式执行门禁；正式批次仍按原 run 的 `sync` 路径核对结果。

## 维护

维护安装、资源归属与升级时，查阅 [维护入口](references/maintenance.md)。

## 失败分支索引（触发 → 一线 → 兜底；规则以正文为准）

- **数据空间工具未安装或停用** → 明确报告无法录入用例库 → 不虚构关联，停在此步
- **Playwright 配置 / 依赖 / seed 不匹配** → 报具体缺项，停在录制前 → 不向个人目录装依赖、不把 seed 改成绝对路径
- **工作区无 MCP 配置** → 用 `qa/ui` 后备配置 → 仍无业务 baseURL 则回工作区补齐，不猜地址
- **私密录制未声明 `capture:"chromium-single-page-v1"`** → 只准备/握手，浏览器动作阻塞 → 不匿名回退、不覆盖已有草稿
- **录制中断 / 预算耗尽 / 证据坏** → 存 partial 与真实缺口，关闭自有 context 后显式 finish → 不换任务重放、不从点击中间续跑
- **原生关闭动作被拒** → 保留 `browser-cleanup-not-confirmed` → 不把连接退出当作浏览器关闭成功
- **入库缺 `featureId` 或扩展能力** → 报阻塞并回工作区 → 不提前建 candidate、绑定或执行
