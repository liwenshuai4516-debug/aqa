# T27 实际安装包预设与技能界面

日期：2026-10-21。验收 A09/A11，来源为 SettingsModal.tsx 的 skills/presets 面板、settings-service.ts、client-state.ts 与原 Pi SDK 技能发现。生产代码和安装包不变；使用当前 T19/D06 的实际 DMG 安装应用，macOS arm64、Electron 44.4.2、包内 SDK 1.1.0。

新脚本 preset-skill-ui-run.mjs 使用独立中文工作区、独立 userData、空 auth/models 和本地 desktop-proof 技能，不导入个人配置。通过原设置按钮和页签完成实际点击，不注入设置回执或模拟 DOM。

最终 T27-preset-skill-ui-v3.json 的 12 项通过：

- 包内 SDK 发现测试技能，设置显示初始启用；实际开关禁用、全文偏好开启。
- 空名称禁止保存；中文预设保存成功。
- 手动重新启用技能，再应用原预设，恢复禁用状态。
- 完整退出应用后重新启动，技能禁用、全文偏好和中文预设保留。
- 实际删除按钮移除预设；退出后读取原 client-state.json，确认 settings.disabledSkills、settings.skillsFullText 保留，presets 已无目标条目。
- 测试技能文件字节未变。

重启后的预设截图为 T27-preset-skill-ui-v3-presets.png，已人工查看。界面显示中文预设名称、Skills 1 与 Apply/删除入口。测试不触发聊天、目标或模型请求，不读取真实模型凭据；DeepSeek 账本仍为累计 12/14。

首轮 FAIL 原因是脚本写入中文 localStorage 后，桌面偏好恢复使页面仍为英文，中文专属按钮定位超时；截图保留。最终按原按钮实际中文/英文可访问名称定位，不改生产语言逻辑。v2 的前 10 项通过，最后落盘断言错误地读取顶层 disabledSkills；原存储明确在 settings 内。修正嵌套读取并同时核对全文偏好后，v3 全部通过。v2/v3 证据独立保留，不把初始失败计作通过。

工程检查：定向 Prettier、全项目类型检查、preset-share/skill-settings-wire/pi-presets 共 3 文件/88 单测、只读原目录和受保护源码哈希门禁通过。先前 T27-related-unit.log 实际只匹配 1 文件/76 单测（其余两个筛选文件不存在），最终使用已核实文件名，不能声称首轮为三文件。见 T27-final-typecheck.log、T27-final-related-unit.log、T27-source.json、T27-protected.json。

本轮未验证技能市场联网安装、技能实际模型调用、预设分享/导入 UI 全链路、DSH 模型执行或所有其他设置组合。计划模式仍以已有协议与服务回归证据为准，本轮没有增加计划界面验收。项目目标仍未完成。
