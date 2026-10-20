# T17：真实原生目录选择与恢复

需求：T03 / A13。使用 T14 最新实际 DMG 安装包、独立 userData，不替换 dialog.showOpenDialog，不导入旧认证。无模型请求。

用户确认已在实际原生目录选择器中选择并打开。原计划选择临时“中文 workspace”目录，但应用实际保存的目录是 /Users/liyingjun/Downloads。测试精确路径断言失败，完整保留 T17-native-picker.json/log；不能将该次操作解释为中文路径选择通过。

以该次真正保存的 Downloads 为明确预期，使用同一独立 userData 连续重启实际安装包两次。两次原界面均加载，startup.json 中目录与上述路径一致，未再需要选择器交互，见 T17-native-picker-restore.json/log。该结果证明实际选择记录与后续恢复；不替代中文路径原生选择、原生取消或家目录拒绝的人工交互证据。

先前 first-run.json 对取消、家目录拒绝与中文路径使用对话框返回夹具，其证据范围保持不变。T17 未修改生产逻辑；新增测试支持单独恢复已记录的选择，恢复证据另存，原失败不覆盖。

验证：定向 Prettier、全项目 typecheck、工作区/启动相关 2 文件 / 8 单测通过。系统辅助功能自动操作权限为 false，真实选择由用户完成。
