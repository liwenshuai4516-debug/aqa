# 项目精简与体积预算

## 核心安装与可选工具

根 `npm ci` 仅安装服务端、前端构建和核心开发验证所需依赖。可选工具各有独立锁文件：

| 命令                        | 安装位置                           | 用途                                                      |
| --------------------------- | ---------------------------------- | --------------------------------------------------------- |
| `npm run install:desktop`   | `desktop/node_modules`             | Electron、electron-builder；桌面构建、运行和打包          |
| `npm run install:vendor`    | `tools/vendor/node_modules`        | mermaid、vis-timeline；重建离线 vendor                    |
| `npm run install:e2e`       | `tools/e2e/node_modules`           | Playwright 和原版 pi-ui-testing；浏览器测试与 UI 测试能力 |
| `npm run install:api-tests` | `plugins/api-testing/node_modules` | API 测试共享的锁定 MCP/Newman/编译依赖                    |

可选依赖通过受控目录链接兼容既有源码和测试的 import 路径；不复制依赖、不改模型/个人配置。
E2E 安装省略宿主 peer 副本，复用根 SDK/typebox，避免重复宿主运行时。
安装器遇到根目录已有真实同名依赖会停止，不擅自覆盖。升级旧安装时先结束相关开发/测试进程，
再运行根 `npm ci` 清理旧依赖，随后安装需要的 profile。**根 npm ci 后须重新运行所需 profile
命令**以恢复链接。`-- --link-only` 仅在该 profile 已完成安装时恢复链接，不下载包。

完整开发验证安装 desktop；浏览器测试再安装 e2e。`npm run typecheck:core` 无需桌面依赖，
完整 `npm run typecheck` 保留五配置检查，不会因依赖缺失静默跳过桌面。`electron-updater`
仍是根应用运行时依赖，因为现有桌面安装包以根应用为打包单元，避免改变更新器部署行为。

桌面运行与打包使用 `npm run desktop:dev`、`npm run desktop:package -- --mac --arm64 --publish never`。
命令直接运行本地 profile 的工具，不通过 npx 自动下载；builder 显式使用 profile 的 Electron
版本和二进制，仍打包根应用生产依赖。Windows/Linux 路径已按通用 Node 接口实现，未作为本机验收通过。

浏览器二进制不纳入根安装，也不另建每项目缓存。需要时执行
`node scripts/run-profile.mjs e2e playwright install chromium`，沿用 Playwright 的系统用户缓存。
CI 如缓存浏览器，键须包含平台、架构和 e2e 锁文件；不缓存跨平台的 node_modules。

## 分层构建与 CI

`npm run build` 只构建 Web、server 和 DSH。现有已入库 vendor 继续供离线运行。
只有修改 vendor 版本/生成器时安装 vendor profile 并执行 `npm run build:vendor`；CI 在
单独的新鲜度检查步骤构建并核对差异。迁移锁文件保留原已锁定的 vendor 传递依赖版本。

当前插件仍支持从仓库目录直接安装、复制和离线运行，因此没有直接删除 bundle，也没有把
插件分发改成尚未提供的远端下载地址。完整移出 Git 须先完成版本化插件归档、校验索引和安装器
接入；本轮通过独立构建和预算控制成本，后续迁移不得破坏现有离线能力。

## API 测试依赖共享

所有 API 集成脚本默认使用 `tests/lib/api-test-runtime.mjs`：共享插件目录的只读依赖，每次
在 `tests/scratch/api-testing-shared/run-*` 创建独立源码快照和依赖链接。已有显式 runtime
参数或环境变量仍可用。依赖缺失或版本不符时明确提示安装；不在测试中自动重装、不在并行测试
运行时执行 `npm ci`。更新锁文件后由操作者统一重装一次。

不同测试的 dataDir、输出和进程仍独立。真实模型脚本不会被普通工程验收自动调用。
旧 P0/P1 runtime 的证据和 `.cleanup-keep` 不自动删除；确认无进程或配置引用后再按
[白名单清理](project-cleanup.md) 回收旧依赖。共享机制消除后续重复安装，不等于已回收所有旧目录。

## 默认上下文与专题阅读

根 AGENTS.md 仅保留核心规则和任务索引；完整细则迁至 `development-constraints.md`、
`capability-delivery.md`、`backup-and-release.md`，规则继续有效。读取大型专题先查标题，
只读相关章节，不自动追随链接全文加载。`docs/` 本来就不会因链接自动注入每轮上下文。
本轮不改 UI/API 技能语义，不改变系统角色或工具缓存机制；实际模型 token 下降需按真实请求验证。

## 证据归档与防回涨

`npm run size:report` 报告逻辑文件大小（不跟随符号链接）；`size:check` 使用可重复的 Git
跟踪文件预算和根锁文件依赖数，不以操作系统磁盘占用作 CI 门槛。`project-budget.json` 明确
AGENTS、已有证据、视频及 vendor 的上限，超限需说明理由并审阅预算变更，不能自动放宽。

历史原始证据保留，新增大截图/视频先放仓库外的归档位置或 CI artifact，主仓只提交结论、
校验索引和可访问的归档引用。归档副本工具：

```bash
node scripts/archive-evidence.mjs tests/scratch/<本轮证据> /absolute/external/new-archive
```

仅复制、逐文件核验 SHA-256 并生成 `index.json`；不上传、不删除原件，不接受依赖目录和符号链接。
外部位置必须新建且在仓库之外，归档服务的权限、保留期限及长期地址仍由操作者指定；没有远端
存储时不伪造归档 URL。本轮生成历史桌面证据校验清单，原链接保持有效。CI artifact 有保留期，
不能直接宣称永久归档。

本轮测量与验收见 [执行记录](project-slimming-evidence.md)。
