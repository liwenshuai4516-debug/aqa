# 服务端能力目录

[项目地图](../docs/project-map.md) · [能力维护指南](../docs/capability-layout.md)

业务实现按职责分组；入口、协议和跨模块公共机制保留在根目录。目录迁移只改变导入与文件引用，不改变工具注册、模型选择、提示词、权限或执行行为。

| 目录     | 现有模块                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`  | `agent-service.ts`、`agent-service-daemon.ts`、`agent-formatters.ts`、`subagents.ts`、`subagent-handoff.ts`、`subagent-helpers.ts`、`subagent-templates.ts`、`subagent-templates-hant.ts` |
| `model`  | `model-admin.ts`、`model-resolver.ts`、`model-enrich.ts`、`provider-oauth-flow.ts`                                                                                                        |
| `prompt` | `prompt-assembler.ts`、`prompt-composer.ts`、`persona-chain.ts`、`tool-prompts.ts`、`tool-prompt-overrides.ts`                                                                            |
| `skill`  | `skill-tool.ts`、`skill-discovery.ts`、`skill-content-filler.ts`、`skill-presentation.ts`                                                                                                 |
| `mcp`    | `mcp-bridge.ts`、`mcp-manager.ts`、`mcp-hot-reload.ts`、`mcp-agent-tool.ts`、`plugin-mcp.ts`                                                                                              |

`index.ts` 继续作为服务入口，`protocol.ts` 继续作为跨端协议单源；`tool-manager.ts` 继续作为工具开关目录单源。`dsh/`、`durable/`、`universal/` 保持原有引擎边界；`plugins.ts` 与 `plugin-*` 仍负责宿主插件服务（MCP 门禁位于 `mcp/plugin-mcp.ts`）。跨目录依赖使用明确相对导入，不增设重导出兼容层或第二份实现。

构建目录相应为 `dist/server/<目录>/`，启动入口仍是 `dist/server/index.js`。修改引用时同步测试内源码读取路径、动态导入和文档链接；源码扫描守卫必须继续覆盖已移动的原文件。

EC06执行日志组件：`server/external-evaluation-log.ts`提供有界原始字节、UTF-8/JSONL解析与背压/缺口记录，`tests/agent-evaluation-execution-log-test.mjs`以可信合成进程验证；尚未接入产品执行器，见[证据](../docs/agent-evaluation-evidence/EC06-execution-log-diagnostics.json)。

EC06宿主环境生命周期：`server/external-evaluation-runtime.ts`为固定无网VZ环境提供持久启动/新鲜查询/取消超时/日志校验与cleanup；`tests/agent-evaluation-runtime-test.mjs`验证Node和Electron Node模式。guest CLI和产品执行入口未接通，见[证据](../docs/agent-evaluation-evidence/EC06-runtime-diagnostics.json)。

EC06 guest协议：`server/external-evaluation-guest.ts`提供有界argv/stdin编码及原字节分帧解析；`tests/agent-evaluation-guest-test.mjs`配合`guest-cli{,-runner}.sh`验证固定无网VZ假CLI。nonce不认证guest，尚未接通产品执行器，见[证据](../docs/agent-evaluation-evidence/EC06-guest-diagnostics.json)。

EC06 worker接线：`server/external-evaluation-guest-session.ts`将固定假CLI协议与独立原字节日志接入现有`external-evaluation-runtime.ts`，冻结输入/夹具摘要且恢复不重发；`tests/agent-evaluation-guest-worker-test.mjs`验证真实控制端SIGKILL、取消/超时/精确二进制回读。限可信假CLI，尚无统一store/产品入口，见[证据](../docs/agent-evaluation-evidence/EC06-guest-worker-diagnostics.json)。

EC06统一仓库接线：`server/external-evaluation-execution.ts`将固定离线假CLI的状态、脱敏日志和停止证明接入原EvaluationStore；`tests/agent-evaluation-execution-store-test.mjs`验证真实VM到统一attempt/evidence/snapshot与原评分器。限宿主私有工程入口，产物/verifier及产品执行登记待完成，见[证据](../docs/agent-evaluation-evidence/EC06-execution-store-diagnostics.json)。

EC07 固定离线核验：`external-evaluation-artifacts.ts` 提供有界产物清单，`external-evaluation-verifier.ts` 在独立 macOS 受限进程检查固定 JSON 数据，原 `external-evaluation-runtime.ts` 保存一次性核验意图与结果。不是任意脚本执行器；见 [EC07](../docs/agent-evaluation-evidence/EC07.md)。
