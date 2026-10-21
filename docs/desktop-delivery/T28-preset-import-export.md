# T28 实际包预设导入导出

日期：2026-10-21。验收 A09/A11 与任务书 §10 的预设白名单/dryRun 约束。源码依据 PresetShareModal.tsx、preset-share.ts 的 applyImport/toSettingsPreset 和原 client-state 持久化。当前 T19/D06 DMG 安装应用，macOS arm64、Electron 44.4.2、SDK 1.1.0，未改生产代码或安装包。

脚本 preset-share-ui-run.mjs 使用独立 userData、中文工作区、空 auth/models 和本地测试技能。PI_WEB_PRESET_CATALOG_URL=off 禁止共享目录自动联网；未点击社区发布按钮，不发送 GitHub Issue。实际界面点击、JSON 文件 input 和原服务往返，无注入回执或 DOM。

最终 T28-preset-share-ui-v4.json 12 项通过：

- 原界面导出有效 pi-web-ui-preset v1 JSON。
- 错误 JSON 显示原服务错误，预设列表未变。
- 中文 JSON 文件加载后显示中文名称预览，提示未知字段 desktopUnexpectedField 被忽略，磁盘预设仍为空。
- 全不选时确认按钮禁用；只勾选 customSystemPrompt 后，磁盘预设只包含名称和选中提示词，未选 promptMode 与未知字段均不存在。
- 未勾选立即应用，原当前设置保持；点击列表原应用按钮后，磁盘当前提示词改变。
- 再次导出原预设，名称/提示词保持且无未知字段；完整退出重启后预设及已应用提示词保留。
- 本地技能文件字节不变。

保存最终导出 JSON 为 T28-preset-share-ui-v4-roundtrip.json，截图 T28-preset-share-ui-v4-export.png 已查看。文件输入使用浏览器 input.setInputFiles，不能计为原生文件选择器人工验收。没有聊天/目标/模型调用，DeepSeek 仍 12/14。

失败分别保留：首轮在五项通过后，脚本错用英文 Select none（原文案 None）超时；v2 在六项通过后，错误期待未选 promptMode 自动填 append，原 toSettingsPreset 明确缺省字段不写入，已改为更严格检查字段不存在；v3 在九项通过后，再导出等待只检查 textarea 已存在，读到共享状态暂存的前一份导出。最终等待本次中文名称的实际回执，再核对内容。没有改写服务结果或删除数据断言，各轮 JSON/log/失败截图独立保留。

工程验证：定向 Prettier、全项目 typecheck、preset-share/pi-presets 两文件 84 单测，以及原源目录与受保护哈希门禁通过，见 T28-verified-typecheck.log、T28-verified-related-unit.log、T28-source.json、T28-protected.json。未知 bottombar 测试差异未改、未提交。

尚未覆盖 URL 导入、共享目录联网、社区发布、真实下载落地和原生文件选择器；这些不能由本地往返或单测替代。完整项目目标仍未完成，T26 的真实严格目标扩额仍待用户答复，未改变预算守卫。
