# AGENTS.md — pi-web-ui 核心规则

本文件默认进入项目上下文，保持简短。专题文档仅在相关任务中读取，不全文预加载；先搜索标题，再读取对应章节。修改后在 Pi 执行 `/reload`。精简前全文本地备份为 `AGENTS.md.bak`，历史原文也可从 Git 追溯。

## 项目与入口

- pi-web-ui：Node/Express + WebSocket 后端，React/Vite 前端，pi SDK 智能体，Electron 可选桌面壳。Node >=22.19.0。
- 当前远端 `origin`：`https://github.com/liwenshuai4516-debug/aqa.git`，主分支 `master`。版本变更同步根 `package.json` 与 `package-lock.json`。
- 职责：`server/agent/`、`server/model/`、`server/prompt/`、`server/skill/`、`server/mcp/`；前端 `web/`、插件 `plugins/`、项目技能 `.pi/skills/`、桌面 `desktop/`。
- 先按任务定位：[模块地图](docs/project-map.md)、[目录参考](docs/directory-reference.md)、[文档导航](docs/README.md)。不要为定位单个模块读完整文档树。

## 协作与测试

- 后续所有更新默认以 Electron 桌面版为优先适配、安装登记和验收对象；除非用户明确要求，网页版不单独适配或安排专项验收。桌面版仍复用 `web/` 与 `server/` 的共享实现，共享代码的必要检查与相关回归照常执行；不得将网页版或隔离实例验证代替桌面版接入验证。
- 编码前明确目标、范围、依据、环境与验收标准，说明关键假设和权衡；优先最小修改，不顺手重构或更改既有功能。新增功能先读 [模块开发规范](docs/module-development.md)。
- 区分事实、假设、待确认与实际验证。测试覆盖核心流程、异常、边界、状态、权限和数据一致性；预期须有依据，未定义行为标为待确认。复用现有框架和隔离数据。
- 缺陷先复现再修复、回归并留证；不削弱断言、不跳过失败、不伪造日志、截图或通过率。历史结果、SKIP、阻塞和部分通过不得算本轮通过。
- 写入、删除、压测、生产及外部提交限用户授权范围；不读取个人凭据、不污染个人数据、不中断用户服务。不调用未授权付费模型。
- 默认简体中文，保留字段与代码原名。交付说明范围、环境、依据、已设计/已执行/通过/失败/阻塞/未执行项、证据和剩余风险。

## 长任务与能力交付

- 完整 UI/API 测试、多阶段或需持续等待验证的长任务，自动用 `plan_update` 创建任务链及验收标准；节点开始/完成即时更新，失败保留原因与证据，续跑复用看板。不因展示进度开启只规划模式。简单问答或少量明确修改不建看板。
- 工具缺失或关闭时说明无法同步看板，用阶段进度继续；不擅自开启工具，不用虚假完成状态填满进度。
- 前置阶段失败或门禁未通过时，停止依赖它的后续阶段；未执行节点保留待执行并注明阻塞原因，不标为测试失败或完成。允许保存证据与提交明确标识的阻塞/阶段报告，但不得因此将原「最终交付」节点标为完成；修复前置条件后显式续跑。
- 新增/扩展 Agent 能力须同任务补齐技能加载、设置页管理、`/` 快捷发现及适用的插件/工具登记，验证禁用、启用和重载持久性。先读 [能力交付规则](docs/capability-delivery.md)、[能力维护](docs/capability-layout.md)。不覆盖个人安装，不把隔离发现通过当成实际应用已接入。
- API/UI 技能入口仅引用原实现：API 在 `plugins/api-testing/skills/`，UI 在 `.pi/skills/ui-testing-workflow/`（含资源与按需维护说明；旧 `capabilities/ui-testing/` 仅兼容）；不复制 runner 或业务规则。API 任务按 [实施计划](docs/api-testing-implementation-plan.md) 指定任务编号执行，设计不等于已实现。

## 必守架构边界

- 协议只改 `server/protocol.ts`；`web/src/types.ts` 为 re-export shim。服务端持有业务事实，高频快照不得放入 `app-globals.ts`。
- 工具目录事实源 `server/tool-manager.ts`；新增工具联动注册和守卫。工具描述用精简英文，description/snippet/guidelines 分工，不重复。工具加载仅追加，系统目录不随已加载状态变化，保持前缀缓存。
- 服务端 URL 使用 `appUrl()`；复用国际化、主题令牌、`appSend` 和浮层机制。新增 UI 文案同步 zh/en 与语言包。权限、审批、计划/委派门禁在执行侧生效。
- 修改核心、安全、工具、提示词或 UI 前，读取 [开发约束](docs/development-constraints.md) 的相关章节；不因本文件精简忽略既有守卫与限制。
- 插件代码/资源变更须同步版本号、已跟踪 bundle，并在隔离 dataDir 验证新代码；纯文档不要求升级插件。新增/移动模块同步地图、目录及文档导航。
- 桌面任务先读 [当前范围决定](docs/desktop-delivery/scope-decisions.md)、完成审计和批准记录；不把内部安装包当作全平台完成，不擅自发布或修改签名/更新身份。

## 开发、验证与依赖

```bash
npm ci                     # 核心开发/构建依赖
npm run dev                # 后端 8788 + 前端 5173
npm run build              # Web + server + DSH；不重建已入库 vendor
npm run typecheck:core     # 核心 4 个配置
npm run install:desktop    # 需要桌面开发/完整类型检查时安装
npm run typecheck          # 全部 5 个配置，需桌面 profile
npm run install:e2e        # 需要 Playwright 测试时安装
npm run install:vendor     # 仅修改 vendor 依赖/生成器时需要
npm run build:vendor       # 重建并检查已入库 vendor
npm run install:api-tests  # 共享锁定 API 测试依赖
npm run size:check         # 上下文、证据、vendor 与依赖预算
npm run clean              # 仅预览可重建缓存
```

- 提交前依次执行：`npx prettier --write <本次文件>` → `npm run typecheck` → 相关 `vitest` 单测；并跑 `npm run lint`、`npm run check:protocol`、`git diff --check` 和相关集成回归。缺少可选依赖时先安装，不能把未执行写成通过。
- 测试端口 >=8900，临时 dataDir/agentDir 隔离，只清理自己进程；禁止 `pkill -f`。冒烟不得自行构建，使用 `tests/lib/ensure-build.mjs`；已串行构建后跑器可用 `--no-build`。Chrome 路径走 `tests/lib/chrome.mjs`。
- 任务开始和交付前运行 `npm run clean` 预览；确认无进程使用后仅清理超过 7 天的白名单缓存/可重装依赖。`.cleanup-keep`、Git 跟踪文件、符号链接、证据、个人数据和当前可运行版本均须保留。禁止 `git clean -fdx`；详见 [体积维护](docs/project-cleanup.md)。
- 体积与构建策略见 [项目精简](docs/project-slimming.md)。共享 API 依赖、浏览器缓存，不复制整份依赖进运行证据；失败证据不自动删除。新增大型原始证据先归档并保留校验索引，不继续堆入主仓。

## 提交与备份（持续授权）

每次完成代码、测试、配置或文档更新并通过验证后，创建清晰、可回滚的提交，立即推送当前分支的 `origin` 同名分支，首次设 upstream；无需再次询问。仅暂存本次明确文件/差异，保留既有未提交修改，不使用 `git add -A`。推送后核对远端提交号与本地 HEAD 一致；失败如实报告未同步。

禁止强推、重置远端或删除历史，回滚用 `git revert`。日常不建发布标签、不发布 npm 包；正式发布需另行授权。流程见 [备份与发布](docs/backup-and-release.md)、[正式发布](docs/release.md)。

## 按任务读取

| 任务                   | 入口                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| 协议、状态、安全、快照 | `docs/architecture-core.md`                                            |
| 插件、MCP、工作区      | `docs/architecture-plugins.md`，先查相关标题                           |
| 提示词、工具按需加载   | `docs/architecture-system-prompt.md`、`docs/tool-context-budget.md`    |
| 目标审查与 DSH         | `docs/goal-conversation-design.md`、`docs/dsh-engine.md`，仅读相关章节 |
| 终端、附件             | `docs/architecture-terminal.md`、`docs/architecture-attachments.md`    |
| 设置、预设、部署       | `docs/preset-sharing.md`、`docs/env-vars.md`、`docs/deployment.md`     |
