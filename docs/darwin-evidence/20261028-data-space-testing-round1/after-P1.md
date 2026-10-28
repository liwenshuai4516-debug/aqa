选定候选环境后，遇到 `refresh-required`，下一步是在本次已授权的环境准备范围内刷新该环境，无需为刷新再次确认：

1. 从所选候选的真实回执取得 `systemId` 和 `envId`，调用 `data_space_env`：`action=refresh`，`project` 传所选 `systemId`，`env` 传所选 `envId`。
2. 刷新成功后，对同一测试目标、同一环境重新调用 `data_space_automation.initialize`，沿用 `engine=ui` 和本次模式，复核新回执中的 `preparation`、`parameterSources` 及动态值有效期。有效动态值优先于同名静态值。
3. 若刷新能力缺失、刷新失败或 `preparation.parameters.state=not-ready`，停止后续录制、诊断和执行，报告阻塞；不自动 `force` 重试，不回退旧值，也不使用脱敏占位执行。

准备通过后才能继续 UI 原生预检：录制前核对 Playwright 依赖、配置、project 与相对 seed，再由浏览器验证前置条件。`configured` 只说明配置匹配，网络、身份、角色和数据仍为 `unknown`，不能据此认定测试已就绪。

本轮没有可调用的原生工具，也没有真实目标地址、所选 ID 或原生回执，因此以上是可确定的处理顺序，尚未刷新、重新初始化或启动 UI 测试。当前阻塞在环境刷新；需恢复原生工具能力，并取得所选环境及目标的真实回执后继续。
