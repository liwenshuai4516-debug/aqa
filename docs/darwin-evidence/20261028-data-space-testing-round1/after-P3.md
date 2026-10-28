本次仅整理旧批次，不回写。当前只有状态描述，没有真实 runRef、逐项结果或原生证据，不能确认各用例结论、数量和通过率。

pending、stale 属于同步缺口，不是测试失败；stale 需核对原关联及版本，保留旧记录。报告中的 failed、skipped、unknown 分别对应失败、跳过、未知，均不能计为通过；实际归属和数量仍待核验。证据不足不能推断失败根因，也不能把同步完整性当作证据完整性或报告获批。

```json
{
  "format": "data-space-result/v1",
  "context": {"workspace": null, "project": null, "environment": null},
  "origin": null,
  "native": null,
  "results": [],
  "evidence": [],
  "evidenceComplete": null,
  "reportReview": null,
  "writeback": {"method": "none", "status": "not-requested", "receipt": null},
  "gaps": [
    {"case": null, "reason": "缺少真实 engine、runRef、资产及批次引用、工作区、项目和环境，无法核对旧批次身份。"},
    {"case": null, "reason": "仅获知 pending、stale 与 failed、skipped、unknown；缺逐项 ID、关联版本、原始明细、完整计数及真实查询回执，不生成执行记录或统计。"},
    {"case": null, "reason": "用户说明证据不完整，但未提供原生核验值、证据引用及独立报告评审；完整性与批准状态未核验。"}
  ]
}
```

下一步需取得真实引擎、原 runRef 和原生报告／证据引用；随后只读原批次明细，并按该 engine/runRef 查询 sync-status，核对逐项归属、版本和宿主结论，按实际范围保留全部状态及分母。本轮无可用原生工具，未执行查询、初始化、补同步、入库、绑定或重跑。

交付结构已通过离线一致性校验；该校验不证明证据真实或结果已核验。