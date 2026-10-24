---
name: agent-evaluation
description: 选择 Pi 任务范围，读取证据并生成内部诊断，查看评分、耗时费用和人工复核记录；不运行外部客户端或模型。
metadata:
  display-name: Agent 评估中心
  description-zh: 对任务选区做只读证据诊断，保留来源、未知项和人工复核。
  description-en: Diagnose selected task evidence with provenance, unknowns and separate human reviews.
  plugin-id: agent-evaluation
---

读取并遵循唯一原实现：[Agent 评估中心](../../../plugins/agent-evaluation/skills/agent-evaluation/SKILL.md)。此入口只负责发现，不复制规则、runner 或判定逻辑。
