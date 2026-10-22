# 代码备份与发布

### 本项目代码备份与自动推送（用户要求，2026-10-21）

- 本项目远端为 `https://github.com/liwenshuai4516-debug/aqa.git`（`origin`），当前主分支为 `master`。本节优先于下方原项目发布示例；日常更新不创建发布标签或发布软件包。
- 后续每次完成代码、测试、配置或文档更新，按本文件要求验证后创建清晰、可回滚的 Git 提交，并立即推送到当前分支的 `origin` 同名分支；首次推送设置 upstream。用户已持续授权此流程，无需每次再次确认。
- 只提交本次更新涉及的文件；既有未提交差异单独记录和处理，不使用无差别暂存。凭据、个人运行数据、依赖和构建产物仍遵守忽略规则。
- 推送后核对远端分支提交与本地 HEAD 一致，再报告提交号。推送失败时保留本地提交，明确报告原因和未同步状态；不得声称已备份。
- 保留提交历史，禁止为自动推送使用强制推送、重置远端或删除历史；回滚优先创建 `git revert` 提交并推送。

日常备份按以下流程执行；先完成 AGENTS.md 的提交前验证及相关回归。`<本次改动文件...>` 必须替换为明确文件列表，`<当前分支>` 通过 `git branch --show-current` 核实：

```bash
git status --short
git diff --check
git add -- <本次改动文件...>
git diff --cached --stat
git diff --cached
git commit -m "docs: 描述本次更新" # 按实际改动选择 docs/fix/feat/test 等，不带 Co-authored-by
git push -u origin <当前分支>
git rev-parse HEAD
git ls-remote origin refs/heads/<当前分支>
```

提交前检查暂存区仅包含本次文件，推送后核对两处提交号一致。日常备份不执行 `git add -A`、创建标签或 `npm publish`。

正式发布仅在用户另行授权后按 `docs/release.md` 执行：`npm run typecheck && npm run build`；UI 国际化文案有增减时运行 `npm run changelog:i18n`。版本须高于 registry；升级后 `pi-web-ui server restart`；发布前检查示例文件不泄密；Release 说明预览：`node scripts/release-notes.mjs X.Y.Z --base v<上版>`。
