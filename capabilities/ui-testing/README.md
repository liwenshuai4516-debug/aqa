# Pi UI 测试能力

复用用户提供的 `ui-testing-workflow` 中的原版 `pi-ui-testing` 包，适用于本仓库的 Pi agent。安装、使用与本轮验收见 [接入记录](../../docs/ui-testing-integration.md)。

- `pi-ui-testing-0.1.0.tgz`：原始分发包，未改写内部工作流；来源提交 `44df50bb383a8e27185290e75c47095f176e764b`。
- 原包 SHA-256：`3557ed20d2c81ba331981aa06668a0275a867f24c8da540f09c83eff6877e6ef`。
- `mcp-extension.mjs`：调用 SDK 原生 MCP 扩展，只加载本能力的 Playwright 测试服务；保留命名空间、父调用、事件和取消，不读取其他 MCP 配置。
- `playwright.config.mjs`：测试 MCP 使用的 Chromium 配置，单 worker、零重试，资产位置 `qa/ui`。

包中的 8 个阶段 Skills、评估规则、schema、执行与报告实现直接由安装包提供。现有 Vitest、WS/Playwright 冒烟及接口测试继续使用原入口。

```sh
npm ci
npm run ui-testing:enable
node node_modules/playwright/cli.js install chromium
npm run test:ui:integration
```

`ui-testing:enable` 合并项目 `.pi/settings.json`，不写个人配置，也不自动信任项目。安装后重启使用旧 SDK 的项目服务，再新建会话或 `/reload`；在标准预设中启用本包扩展、8 个阶段技能及 `read`。它是项目开发能力，不随全局 npm 安装或 Electron 安装包自动启用。
