# UI 测试维护入口归并验收

日期：2026-10-22。范围：将可维护的 UI 测试技能、分发包与 MCP/Playwright 配置归入 `.pi/skills/ui-testing-workflow/`，保留已有项目/应用登记路径可用；不改包内业务逻辑、不读取凭据、不调用模型或业务服务。

## 验收依据与结果

- 唯一维护入口：[UI 技能维护说明](../.pi/skills/ui-testing-workflow/references/maintenance.md)，并已从 `AGENTS.md`、能力地图、目录参考及文档索引链接。
- 原包 SHA-256 迁移前后相同：`3557ed20d2c81ba331981aa06668a0275a867f24c8da540f09c83eff6877e6ef`。
- `node --import tsx tests/capability-layout-test.mjs`：通过。Pi SDK 发现四个项目入口及原包八个阶段技能，所有技能引用可解析。
- `npm run test:ui:integration`：通过，10 项真实 SDK/MCP/Chromium 隔离检查，包括应用级切换工作区发现、10 个工具、测试 MCP、真实合成页面、嵌套调用身份与取消。
- `npm ci --prefix tools/e2e --ignore-scripts`：通过，独立 profile 锁文件可从新资源路径安装。`npm run install:e2e` 的安装步骤成功，但恢复根兼容链接时按设计检测到根目录已有非 profile 管理的 `@playwright/test` 并停止；未覆盖或移除现有依赖。隔离 SDK/MCP 集成回归仍通过。
- `npx vitest run tests/unit/ui-testing-registration.test.ts tests/unit/skill-capability-settings.test.ts`：10 项通过，覆盖新登记幂等、应用/项目级旧路径兼容、扩展归属识别与禁用联动。
- `python3 /Users/liyingjun/.codex/skills/.system/skill-creator/scripts/quick_validate.py .pi/skills/ui-testing-workflow`：通过。
- `npm run typecheck`、`npm run lint`、`npm run check:protocol`、`npm run size:check`、`git diff --check`：通过。协议检查因仓库无可用 tag 跳过 git 启发式版本比较。

实际模型调用：0。业务请求：0。没有修改个人应用设置或重启服务；已有旧应用路径由兼容转接继续支持，当前运行窗口仍需 `/reload` 才会读取新布局。签名桌面包与其他平台未在本次范围内验证。
