# T02 复用与变更门禁

server、web/src、themes、web/public、plugins、plugin-sdk、extensions 默认逐字复用，协议/SDK业务/界面未重写。原 LICENSE、测试和锁文件保留。

执行 `node scripts/check-desktop-baseline.mjs` 校验受保护区域新增/修改/缺失；`--source` 复核只读原目录。源基线及补充资源哈希保存在两个 manifest JSON。

允许变更：desktop 宿主、定向桌面测试、桌面发布 workflow、交付文档。原测试不删减、不降低预期。build 中 vendor 生成脚本保持原样；产物差异必须登记。
