# 项目体积维护

## 2026-10-22 体积审计

范围为当前仓库磁盘占用；检查文件元信息、Git 跟踪状态、源码和交付引用，不读取个人认证内容。macOS arm64，Node 23.10.0。`du` 的初始实际占用约 **3.38 GiB**，含依赖和忽略文件，不等于 Git 仓库体积。

| 目录/文件                                          | 初始占用 | 评估与处理                                                                                        |
| -------------------------------------------------- | -------: | ------------------------------------------------------------------------------------------------- |
| 根 `node_modules/`                                 | 1297 MiB | 当前开发/构建依赖，含 Electron；保留。只清理其中明确的工具缓存。                                  |
| `tests/scratch/`                                   |  977 MiB | 主要为重复依赖和基线归档。可回收有锁文件的闲置依赖，截图/报告/日志保留。                          |
| `release/`                                         |  830 MiB | 包含约 494 MiB 应用和 DMG/ZIP；当前交付产物及验收引用仍有效，保留。后续旧版本按交付用途单独评估。 |
| `.git/`                                            |  114 MiB | 版本历史及 worktree 信息，保留，不改写历史。                                                      |
| `docs/`                                            |   68 MiB | 主要为已跟踪的桌面验收证据，保留。                                                                |
| `assets/demo-video.mp4`                            | 19.1 MiB | 三份 README 仍引用，保留；不是缓存。                                                              |
| `plugins/mermaid/client/vendor/mermaid.bundle.mjs` |  5.1 MiB | 已跟踪且供插件离线运行，保留；不因是 bundle 就删除。其他插件 bundle 同理。                        |

`tests/scratch/api-testing-p0-2/baseline/` 约 128 MiB，是历史基线副本；不能仅凭名字认定无用，本轮保留。`api-testing-p0-1/runtime`、`reproduce`、`api-testing-p1-1/runtime` 是现有集成脚本默认运行环境，清理后必须先恢复依赖，本轮保留。另一份冻结运行时的依赖旁没有独立锁文件，不进入清理白名单。

## 清理机制

使用独立维护脚本，不新增运行时服务、插件、定时器或构建前删除钩子；任务收尾由 `AGENTS.md` 要求执行检查。默认保留 7 天，使用整个候选树的最新修改时间，避免只看父目录时间而清掉近期写入。没有过期项时不删除。

```bash
npm run clean                 # 只预览，零删除
npm run clean:apply           # 清理超过 7 天的合格候选
npm run clean:junk:preview    # 只预览执行期残留
npm run clean:junk            # 立即回收执行期残留（不受保留期约束）
```

白名单仅包括：

- `tests/scratch/` 内真实的 `node_modules` 目录，父目录须同时保留 `package.json`、`package-lock.json`。
- 根依赖下 `node_modules/.vite`、`.vite-temp`、`.cache`。
- 执行期残留（`--residue` 范围，由下次运行重建，因此不受 7 天保留期约束）：`.workbuddy/tmp/`、`.tmp-test-data/` 两个目录；`.DS_Store`、`Thumbs.db`、`*.orig`、`*.rej`、`*.tmp`、`*~`；仓库根下无扩展名且不超过 64 字节的短名文件（工具写入中断的残留）；超过 10 分钟未被释放的 `.git/{index,HEAD,config,packed-refs}.lock`。

残留扫描深度不超过 4 层，跳过 `node_modules`、`.git`、`dist`、`release`、`.watermate`、`tests`，不跟随符号链接，因此不会进入测试证据目录。跟踪文件和 `.cleanup-keep`、符号链接的保留规则对残留同样生效。

脚本跳过目录链接，删除目录内的链接时不跟随其目标；拒绝清理 Git 跟踪文件。候选树内或祖先目录存在 `.cleanup-keep` 时保留，执行前重新扫描。使用这些目录的进程必须先结束，时间阈值不是进程存活检测；不将清理挂到应用启动或并行测试中。

保留标记是一个空文件，例如：

```bash
touch tests/scratch/api-testing-p0-1/.cleanup-keep
```

定向清理刚结束且已确认冗余的副本，先预览，再执行：

```bash
npm run clean -- --days 0 --only tests/scratch/example/data/plugins/api-testing/node_modules
npm run clean -- --days 0 --only tests/scratch/example/data/plugins/api-testing/node_modules --apply
```

示例路径必须替换为预览中存在的精确候选；可重复传入 `--only`。不支持任意目录删除，不无选择地执行 `--days 0`。默认不删除测试报告、截图、日志、数据库、冻结测试资产、源码、构建输出、安装包或系统临时目录。`.gitignore` 只控制入库，不负责磁盘回收。

依赖复原：进入对应的 `node_modules` 父目录运行 `npm ci`，保留原锁文件。网络、安装脚本和本机原生依赖要求仍适用；缓存由相应工具下次运行重建。测试正式结果不需要重新生成，不把复原依赖等同于重跑验证。

## 本轮执行与验证

- 定向删除历史证据中四份冗余 `node_modules`：P0-2 的 `01-path-alias-failure`、`02-intermediate-passed`、`03-final-passed` 下 `data/plugins/api-testing/node_modules`，以及 P1-3 的 `evidence/data/plugins/api-testing/node_modules`。保留各自的包清单、锁文件及全部测试产物；需要恢复时在相应父目录执行 `npm ci`。
- 清理前核对进程参数引用和打开文件，四个目标未被使用。三个现有默认测试运行目录写入 `.cleanup-keep`，避免超过保留期后影响后续直接复跑。
- 四个目标 `du` 占用合计 **390.8 MiB**（文件逻辑大小 **265.3 MiB**；小文件分配开销导致两者不同）。项目从 **3,626,991,616 bytes** 降为 **3,217,223,680 bytes**，约 **3.38 → 3.00 GiB**。这是项目占用变化，不代表 APFS 克隆/快照存在时系统可用空间必然等量增长。
- 清理前后比较 `tests/scratch/` 内除依赖及本轮审计目录外 **6,341 个普通文件**的路径、大小和修改时间，完全一致。没有读取凭据内容，没有删除报告、截图、日志或正式资产，也没有中断应用进程。
- 原始预览、执行日志和元信息核对结果：`tests/scratch/project-cleanup/{preview.log,apply.log,result.json,preserved-before.json}`，按原规则忽略，不提交原始临时数据。
- 11 项隔离单测通过：预览不删除、保留期/最近写入、锁文件门槛、祖先/子树保留标记、Git 跟踪保护、符号链接边界、定向删除、重复执行、预览后状态重校验及非法参数。首次检查发现 JS 参数类型推断和零天时间边界问题，修正后复验通过。
- 全部五个类型检查、lint、改动文件格式和差异检查通过；协议单源检查通过，因仓库没有可用 tag，版本启发式子项按原工具行为跳过。实际运行默认 `clean:apply` 再次删除 0 项，三个保留运行环境仍在。未重跑全量业务冒烟或构建，宿主运行代码和依赖版本没有变更。
- 支持范围为项目本地维护命令；本轮在 macOS arm64 实测，未验证 Windows/Linux。未运行模型或业务接口请求，不修改生产配置或桌面安装包。

## 2026-10-27 执行期残留回收

此前脚本只覆盖依赖缓存，工具写入中断留下的文件、运行时目录和 Git 锁不在范围内，`git status` 会被污染，残留的 `.git/index.lock` 还会阻塞提交。

- 新增 `--residue` / `--quiet` 两个参数和 `npm run clean:junk(:preview)` 入口；残留类别无保留期门槛，其余安全规则不变（跟踪文件、`.cleanup-keep`、符号链接、仓库边界、删除前重扫）。
- 本轮实际删除：仓库根 9 个 4 字节 `blat` 残留文件、`.workbuddy/tmp/` 内 10 个临时脚本与索引副本、根与 `plugins/` 各 1 个 `.DS_Store`、`AGENTS.md.bak`（`*.bak` 已忽略，原文可从 Git 追溯）、空的 `.tmp-test-data/`。保留 `tests/scratch/` 全部证据、`.workbuddy/{memory,reports}`。
- 单测由 11 项扩到 14 项，新增「残留不受保留期约束且不动证据」「跟踪文件与保留标记保护残留」「只清超过宽限期的 Git 锁」；`npm run clean` 预览结果与改动前一致（依赖候选仍全部为保留态）。
