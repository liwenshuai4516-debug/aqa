# UI 测试统一维护入口

## 文件归属

| 维护内容                                | 唯一位置                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| 技能名称、描述、调度入口                | `../SKILL.md`                                                                    |
| 原版工作流分发包                        | `../assets/pi-ui-testing-0.1.0.tgz`                                              |
| 原生测试 MCP 适配                       | `../assets/mcp-extension.mjs`                                                    |
| Chromium 执行配置                       | `../assets/playwright.config.mjs`                                                |
| 八个阶段技能、schema、runner 与评估规则 | 安装后的 `node_modules/pi-ui-testing/`，修改上游源码后重新分发，不直接改安装目录 |
| E2E 依赖与版本锁                        | 仓库 `tools/e2e/package.json`、`package-lock.json`                               |
| 项目/应用登记                           | 仓库 `scripts/enable-ui-testing.mjs`                                             |
| 管理页与快捷发现的公共逻辑              | `server/skill/`、`server/settings-service.ts`、`server/slash-commands.ts`        |
| 测试资产与执行证据                      | 被测工作区 `qa/ui/`，不写进技能目录                                              |

原版包来源提交：`44df50bb383a8e27185290e75c47095f176e764b`。
SHA-256：`3557ed20d2c81ba331981aa06668a0275a867f24c8da540f09c83eff6877e6ef`。本次仅迁移位置，不改写压缩包。

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
