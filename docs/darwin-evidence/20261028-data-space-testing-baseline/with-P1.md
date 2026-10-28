下一步应刷新你已选定的环境，刷新后重新初始化并检查准备状态。

1. 从真实候选回执取得所选 `envId` 及其所属 `systemId`，保持你的选择，不套用默认环境或切换目标。
2. 在本次环境准备授权范围内调用 `data_space_env`：`action=refresh`、`project=所选 systemId`、`env=所选 envId`。
3. 刷新成功后，对同一目标重新调用 `data_space_automation.initialize`，使用 `engine=ui`、当前 `mode` 及原测试地址与所选环境，复核新回执的 `preparation`、`parameterSources`。有效动态值优先于同名静态值，并检查有效期。
4. 缺少刷新能力、刷新失败或 `preparation.parameters.state=not-ready` 时，停止后续录制、诊断和执行，报告阻塞；不自动 `force` 重试，不回退旧值，不使用脱敏占位执行。

即使返回 `configured`，也只代表配置匹配；网络、身份、角色和数据仍待原生预检。进入 UI 录制前还须核对 Playwright 依赖、配置、project 与相对 seed，再由浏览器验证前置条件。

本轮没有可调用的原生工具，也没有实际测试地址、所选 ID 或完整回执，因此当前阻塞于刷新能力和真实输入缺失。以上为可确定的处理顺序；刷新、重新初始化、预检、录制及执行均未进行，也没有生成用例或写入业务数据。
