# D03 / T07：原内置编辑器 SSH 写文件失败

状态：用户已明确批准最小修复及真实 SSH/SFTP 验证；已实施。

原需求：保留远程文件读写、创建、重命名和上传能力，不能以基线缺陷冒充功能验收通过。

事实：原 `plugins/vscode-editor/index.mjs` 中七处调用 `mkdirpRemote`，但没有定义。基线和最终原始 ssh-plugin-test 均出现 `mkdirpRemote is not defined`，真实本地 SSH/SFTP 夹具无法写入新目录。证据：evidence/baseline-smoke.log、evidence/final-smoke.log。

冲突：插件属于受保护区，需用户批准例外才能修复；原样复用与远程写操作通过不能同时满足。

推荐最小方案：仅补回一个递归建目录函数，沿用现有 `safeRemotePath` 与 `sftpCall`；对已存在且确为目录的路径容忍 mkdir 错误，权限/非目录错误保持失败。`plugins/vscode-editor/manifest.json` 版本 0.5.1 → 0.5.2，以使原有插件同步机制生效。逐行差异见 D03-proposed.patch。

替代方案：保留原缺陷并将相关功能持续标 FAIL；不建议为此重写远程编辑器，也不将旧同步协议重新添加到该插件。

验收：隔离安装最新插件，通过真实本地 SSH/SFTP 验证新建嵌套目录、写读一致、已有目录、非目录/无权限报错、分片上传；确认其他插件及业务哈希不变。旧 ssh-plugin-test 还包含已迁移到独立 sftp 插件的 sync_* 断言，必须单独记录，不通过删除断言伪造全测通过。

用户决定：批准最小修复并验证真实 SSH/SFTP（2026-10-20）。
