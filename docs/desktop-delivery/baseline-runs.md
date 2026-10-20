# T01 原桌面基线实跑

平台 macOS arm64；开发 Node 24.19.0；Electron 44.4.2 / 内置 Node 24.21.0；包内 SDK 1.1.0。

- build + build:desktop：PASS，见 evidence/baseline-build.log。
- typecheck / lint：PASS，见 baseline-typecheck.log / baseline-lint.log。
- npm test：FAIL；452 文件中 451 通过，5,131 条通过、1 条超时、9 条 SKIP。超时为 bottombar-metrics-universal 的 ClaudeCodeDriver NDJSON 测试。原断言保留，定向复查待执行。
- 原版 Electron 真实窗口 / preload / 服务 / 原 React 页面：已运行，见 baseline-electron.json、baseline-electron.png。测试夹具为独立临时目录，无个人凭据。
- baseline-run 初次截图发生截图超时（baseline-electron.log）；已捕获的窗口与 JSON 记录不等于全部桌面验收通过。后续桌面测试改用 Electron 原生 capturePage 避免截图调度问题，并显式记录每次结果。
- 全量 smoke：执行中，结果留在 baseline-smoke.log；不修改原清单与断言。
- Electron 锁定版本下载使用 npmmirror 镜像；node-gyp 访问 nodejs.org 等待过久，使用相同 24.19.0 版本镜像校验 headers，不升级依赖。

原始差异：cwd 默认 homedir；未固定 SDK；Agent 与 CLI 可共享；Dock activate 无窗口退出；运行期 sidecar 退出无恢复；端口切换未恢复 UI 偏好。依据 desktop/main.ts / startup.ts。
