# Darwin 技能项目级安装

## 来源与范围

- 来源：[alchaincyf/darwin-skill](https://github.com/alchaincyf/darwin-skill)。
- 上游提交：`8a8b66258e3c45d6ae4aea39719468c6428fcb0a`（`master`）；技能正文标注 v2.1。
- 安装位置：`.pi/skills/darwin-skill/`，技能 ID：`darwin-skill`。
- 保留上游正文、参考资料、脚本、模板、说明及 MIT 许可证；不复制上游 `.git` 与 `.gitignore`。不修改其他技能、个人全局安装或应用配置。
- 本次仅安装，不启动技能评分、优化、独立评委或模型调用。

## 发现与使用

Pi SDK 默认发现当前项目 `.pi/skills/`。在桌面版选择本项目后执行 `/reload`，然后到“设置 → 技能”查看 `darwin-skill`，输入 `/darwin` 可补全为 `/skill:darwin-skill`。也可输入“用 Darwin 检查指定 skill”。这是项目级安装，切换到其他工作区不会自动登记为全局技能。

上游示例包含 `.claude/skills/` 路径。在本项目使用时，应明确指定待评估技能的 `.pi/skills/<name>/SKILL.md`，并将 Darwin 自身资源路径解析到 `.pi/skills/darwin-skill/`。本项目的权限、审批、Git 和模型费用规则优先于上游示例。

普通评分流程无需新增软件包；可选成果卡片脚本使用 Playwright/Chromium，本机可解析项目现有 `playwright-core`；其默认 Chromium 可执行文件未安装，成果卡片截图若使用默认配置仍需补装浏览器。本次未执行优化及成果卡片生成，不宣称相关业务流程已验收。

## 重装与回滚

使用 skill-installer 的 `install-skill-from-github.py`，指定 `--repo alchaincyf/darwin-skill --ref 8a8b66258e3c45d6ae4aea39719468c6428fcb0a --path . --name darwin-skill --dest <项目>/.pi/skills`。目标目录已存在时安装器拒绝覆盖，先检查本地差异。Git 下载模式应补齐 sparse checkout 的全部目录后再复制，避免根路径 `.` 只取得入口文件。

更新时核对完整上游文件、来源提交和许可证，保留本地改动；不要覆盖其他技能或个人设置。回滚本次提交使用 `git revert`，然后在 Pi 执行 `/reload`。

## 本次验证

- macOS arm64，项目现有 Pi SDK：唯一发现 `darwin-skill`，无该技能的校验警告。
- 截图辅助脚本语法、项目 `playwright-core` 解析通过。
- 隔离 Electron 桌面验证 4 项通过：安装前缺失、安装后技能页及补全、禁用重载持久性、重新启用恢复。使用项目现有桌面构建，未修改宿主代码；模型和业务请求均为零。
- 完整 typecheck、lint、协议同步检查通过；协议版本 Git 启发式因仓库无 tag 跳过。37 个安装文件与上游逐字节一致。技能相关既有单测 3 文件、21 项通过；`git diff --check` 通过；开始和交付前 clean 均仅预览、无删除。
- 原始桌面日志、截图与结果保存在 `tests/scratch/darwin-install/`；该目录不进入 Git。
