# Pi UI 测试能力

复用用户提供的 `ui-testing-workflow` 中的原版 `pi-ui-testing` 包，适用于本仓库的 Pi agent。安装、使用与本轮验收见 [接入记录](../../docs/ui-testing-integration.md)。

- `pi-ui-testing-0.1.0.tgz`：原始分发包，未改写内部工作流；来源提交 `44df50bb383a8e27185290e75c47095f176e764b`。
- 原包 SHA-256：`3557ed20d2c81ba331981aa06668a0275a867f24c8da540f09c83eff6877e6ef`。
- `mcp-extension.mjs`：调用 SDK 原生 MCP 扩展，只加载本能力的 Playwright 测试服务；保留命名空间、父调用、事件和取消，不读取其他 MCP 配置。
- `playwright.config.mjs`：测试 MCP 使用的 Chromium 配置，单 worker、零重试，资产位置 `qa/ui`。
- `ui-testing-workflow/SKILL.md`：同名发现入口，仅转入原包阶段说明，不复制工作流实现。

包中的 8 个阶段 Skills、评估规则、schema、执行与报告实现直接由安装包提供。现有 Vitest、WS/Playwright 冒烟及接口测试继续使用原入口。

```sh
npm ci
npm run ui-testing:enable
node node_modules/playwright/cli.js install chromium
npm run test:ui:integration
```

`ui-testing:enable` 默认合并项目 `.pi/settings.json`，只对该工作区生效。需要让现有桌面应用在切换工作区后仍可发现能力时，显式指定该应用专用 agent 目录：

```sh
npm run ui-testing:enable -- --agent-dir "$HOME/Library/Application Support/Pi Agent Desktop/agent"
```

两种模式都保留原配置且可重复执行；不改认证、不自动信任项目。应用级登记引用本仓库的绝对路径，移动/删除仓库后需重新登记。MCP 启动程序和配置跟随能力安装位置，测试目录仍为当前工作区 `qa/ui`，不会指向安装仓库。

登记后在 Pi 当前对话执行 `/reload`，标准预设的技能页应出现 `ui-testing-workflow` 和原包 8 个阶段技能。输入 `/ui` 可选中入口，实际快捷指令为 `/skill:ui-testing-workflow`。它通过 SDK 包/扩展机制加载，无需在 Web UI 插件市场重复安装。使用旧 SDK 的服务仍须先重启。

应用级可发现不代表任意目录满足正式测试条件；目标项目仍须具备原包要求的 Playwright 依赖、来源和环境数据。此接入不随全局 npm 安装或 Electron 安装包自动分发。

当前项目技能入口统一在 `.pi/skills/`，项目模式登记指向该目录；应用级原入口保留兼容。详见 [能力维护指南](../../docs/capability-layout.md)。
