# 固定离线工程资源

`guest-cli.sh`、`guest-cli-runner.sh` 和 `vm-supervisor.swift` 为唯一资源实现；测试与后续产品登记均从此目录读取。不含内核、initrd 或预签名二进制；它们须另行显式登记并核对摘要，不自动下载或调用模型。

仅固定可信假 CLI，非任意外部客户端执行能力。宿主检查资源摘要和 supervisor 的签名/虚拟化权限，`--describe` 输出配置须满足冻结政策：2 CPU、512MiB RAM、零网络/磁盘/共享/vsock、45 秒 watchdog。等待输入仅以该假 CLI 的精确 stderr 声明标记为 target-reported；不提供交互输入，不延长原任务超时，取消仍须原生整机停止确认。

实际安装登记、完整执行入口与产物核验尚未完成；详见 `docs/agent-evaluation-evidence/EC06.md`。
