# T30 实际安装包 Git 与终端操作

日期：2026-10-21。验收 A06：SCMPanel 的差异、暂存/取消暂存、提交和历史路径，以及 runGitCommand 的真实终端执行。当前 T19/D06 实际 DMG 安装应用，macOS arm64、Electron 44.4.2、包内 SDK 1.1.0，无生产或安装包变化。

新脚本 git-ui-run.mjs 建立独立中文临时仓库，初始一条提交、一个已修改中文文件、一个未跟踪中文文件。只在该仓库配置测试身份、关闭提交签名和 hooks；测试/应用环境关闭系统/全局 Git 配置，不修改用户配置。空 agent auth/models，不调用模型或远程 Git，不访问用户工作仓库。

T30-git-ui-v4.json 13 项通过：

- 原 Git 页签识别两个中文文件，差异显示 BEFORE 删除与 AFTER_UI_COMMIT 添加。
- 点击暂存后实际 index 只含选中文件，并按原产品行为自动切换至真实终端。
- 返回 Git、悬停文件行，点击取消暂存，实际 index 为空且工作区文件保持。
- 再次暂存并从原提交按钮提交，真实 HEAD 改变，提交标题精确为 desktop UI 中文提交。
- 新提交只含选中文件、index 为空；git show 读取提交 blob，字节精确等于 AFTER_UI_COMMIT 加换行。
- 未跟踪文件保持原内容且仍未提交。
- 原提交树显示新提交，选择后加载真实差异；不匹配过滤清空候选，中文标题过滤恢复唯一匹配。

最终实际初始/新提交哈希与 status 保存在 JSON，最终状态仅 ?? 未跟踪.txt。最终历史与差异截图已保存，T30-git-ui-v4-history.png 已查看，显示中文标题、测试身份、真实提交哈希及变更。测试命令仅独立核对 Git 状态，不替代 UI 暂存/取消/提交动作。

失败记录全部保留：首轮错误按 button 查找原 role=tab 的 Git 入口；v2 实际暂存成功后，原 runGitCommand 自动跳到终端，脚本继续找 Git 中取消按钮超时；v3 加回 Git 但未悬停，原 styles.css 的 .scm-file-actions 只有 hover 才显示，继续超时。最终沿原交互返回 Git、悬停再点击，并同时检查终端切换。提交树入口也按原 role=tab 定位。验证命令通过临时 -c core.quotepath=false 保持中文文件名直出，不更改产品路径处理。

工程检查：定向 Prettier、全项目 typecheck、scm-quote/scm-history-filter/scm-commit-history 三文件 21 单测、只读原目录和受保护哈希门禁通过，见 T30-verified-typecheck.log、T30-verified-related-unit.log、T30-source.json、T30-protected.json。未知 bottombar 差异保留，未提交。

本轮没有验证远程 push/pull、分支切换、AI 提交信息或全部 Git 组合，不能把本地检查扩大为完整 Git 支持声明。没有新增真实供应商请求，DeepSeek 仍 12/14；真实严格目标与正式发布等缺口仍保留，项目目标未关闭。
