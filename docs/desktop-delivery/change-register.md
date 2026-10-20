# 变更登记

| 任务 | 文件 | 原因 | 受保护区 | 验证 |
| --- | --- | --- | --- | --- |
| T00/T02 | 完整原目录结构、两个 manifest、交付文档 | 冻结本地基线与完整资源 | 原样 | 1,481 文件 SHA-256；补充 47 文件 |
| T02 | scripts/check-desktop-baseline.mjs | 检查受保护目录及原目录未漂移 | 否 | node scripts/check-desktop-baseline.mjs [--source] |
| T03 | desktop/main.ts、workspace.ts、tsconfig.json | 首次/最近工作区；禁止家目录；独立 agent；固定 bundled SDK；独立 userData | 否 | T03-typecheck.log；T03-unit.log 8 PASS |
| T03 | tests/unit/desktop-workspace.test.ts | 中文路径、无效选择和 symlink 拒绝 | 否 | 同上 |
| T01 | tests/desktop/baseline-run.mjs | 未改宿主真实窗口基线 | 否 | baseline-electron.json/png/log |

正式身份/更新 feed 未定；仅使用临时内部测试身份。未批准任何受保护业务层差异。
