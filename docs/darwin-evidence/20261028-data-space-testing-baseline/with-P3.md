当前只能形成待核验整理稿。题述的 failed 对应“失败”、skipped 对应“跳过”、unknown 对应“未知”，三者分别保留；pending、stale 属于同步对账缺口，不与测试结论混算。没有逐项数量与完整范围，暂不计算总数或通过率，也不推断失败根因。

```json
{
  "format": "data-space-result/v1",
  "context": {
    "workspace": null,
    "project": null,
    "environment": null
  },
  "origin": null,
  "native": null,
  "results": [],
  "evidence": [],
  "evidenceComplete": null,
  "reportReview": null,
  "writeback": {
    "method": "none",
    "status": "not-requested",
    "receipt": null
  },
  "gaps": [
    {
      "case": null,
      "reason": "未提供实际 engine/runRef、批次身份、工作区、项目、环境及用例关联版本，无法核验批次归属。"
    },
    {
      "case": null,
      "reason": "题述同步状态含 pending、stale；缺少真实逐项回执，作为对账缺口保留，不判为测试失败。"
    },
    {
      "case": null,
      "reason": "题述报告含 failed、skipped、unknown；缺少逐项用例、原生结果和数量，不能生成执行记录或统计。"
    },
    {
      "case": null,
      "reason": "题述证据不完整；未提供证据引用、摘要、原生完整性核验值及独立报告评审。"
    }
  ]
}
```

下一步需取得实际 engine/runRef、原生报告与证据索引，并核对批次归属、用例版本及全部八态分母；工具可用后仅按原引用读取原生证据、查询 sync-status。同步 complete 不能证明证据完整；若发现声明通过但缺证据，沿用宿主投影，不自行判通过。

本次未调用原生工具，未执行初始化、补同步、入库、绑定、回写或重跑。上方 JSON 已通过离线结构一致性校验；该检查不证明证据真实或报告获批。