# 本项目 UI 环境与数据 fixture

只启动本仓库构建出的服务和界面，使用本机 loopback、临时工作区及合成文件数据。没有业务系统身份或真实模型凭据，不执行外部业务测试。

## 运行与维护

先按根项目说明安装核心依赖和 `npm run install:e2e`（已有运行中的桌面应用时不要重装依赖）。

```sh
npm run test:ui:guards   # 实际宿主 + 本地 SSE 模型替身，验证执行端门禁
npm run test:ui:fixture  # 重复执行、数据归属、启动失败、SIGTERM/SIGKILL 残留核对
npm run test:ui:project  # 真浏览器打开本项目，验证初态、草稿输入、合成数据清理
```

三个入口复用 `tests/lib/ensure-build.mjs` 串行准备构建；批量回归先构建一次，再设置 `PI_WEB_SMOKE_PREBUILT=1`。浏览器入口使用与项目 fixture 相同的 Playwright 安装，避免根依赖与可选 profile 的两份运行时混用。依赖缺失时直接失败，不下载替代版本、不把 SKIP 视为通过。

| 文件                       | 维护职责                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project-environment.mjs`  | 临时 dataDir/agentDir/workDir、随机空闲端口 >=8900、口令和 clientId、鉴权 WS 的工作区/空转录预检；复用 `ArtifactStore` / `UiDataScope` 记录数据生命周期 |
| `project.fixture.mjs`      | Playwright worker 服务及 page fixture；等 attach 完成后核对工作区和空消息，通过正常 UI 关闭预期的无模型配置提示                                         |
| `isolated-project.spec.ts` | 本项目的最小浏览器验收，不发送模型请求                                                                                                                  |
| `playwright.config.mjs`    | 单 worker、零重试、禁止 only、复用 Chrome 探测，失败 trace/截图及独立 JSON 报告                                                                         |
| `parent-watch.mjs`         | 所属父进程管道关闭时终止自身服务，防止强杀测试进程后遗留监听                                                                                            |

## 范围、身份与数据

- “身份”指本项目共享口令 + 隔离 clientId + 服务返回的 cwd，不宣称覆盖业务系统登录、角色和权限；`isolated-test-client` 仅为合成数据归属标签。
- 预检必须完成鉴权、工作区核对及空转录检查；公开 `/api/health` 成功本身不足以证明连接了正确实例。浏览器再等待 `ready`、`scheduler_tasks` attach 标记并核对快照，不能只等页面外壳出现。
- `createOwnedData(value)` 使用 `UiDataScope.prepare()`，先记录归属/版本/TTL，再写唯一业务键文件；`cleanupData()` 只清理本作用域登记的数据，其他归属文件保留。下一个数据准备会建立新的 scope。
- `dispose()` 幂等关闭自己创建的连接和子进程，检查数据残留后删除自己创建的整个临时运行根；不按进程名、占用端口或全局模式杀进程。数据清理失败时仍停止服务，保留目录和证据，不报告成功。
- 普通取消/SIGTERM 可执行清理；SIGKILL 无法运行 teardown，父进程管道监视器只负责停止服务，`owner.json` 和数据记录保留为“未核对”。确认 owner/server 已退出后，才可显式调用 `cleanupAbandonedEnvironment(root)` 删除该临时根；遇到存活进程、非 fixture 路径或错误归属即拒绝。不自动重放业务操作。
- 原始日志、trace、截图、JSON 报告放 `tests/scratch/` 独立批次，主仓保留验收结论及校验索引。不要把个人 auth/models/storage state、截图或运行目录提交进仓库。

宿主操作分类在 `server/extension-tool-policy.ts`，SDK 执行前检查在 `server/extension-tool-gate.ts`；更新原 UI 包时先核对工具和 operation 契约，再补齐分类与回归。具体结果见 [P0 验收](../../docs/ui-testing-p0-evidence.md)。
