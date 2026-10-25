# ATIF 格式依据

`schema.json`是Harbor固定提交`6099b8cf2bfbbb3e7ff1eb2163bfc4524dbd9ba5`的`src/harbor/models/trajectories/*.py`经Pydantic 2.13.4生成的JSON Schema，来源与原文件摘要见[EC05证据](../../../../docs/agent-evaluation-evidence/EC05-upstream-baseline.json)。生成模型为Apache-2.0，许可保留于`LICENSE.txt`。此文件为静态可信格式依据，不接收用户提供的schema，也不包含执行器。

`../atif.mjs`使用它检查结构，再独立执行原模型中的跨字段约束。生产解析器不需要Python或Harbor运行依赖；产品仅接受显式ATIF-v1.8，不能直接沿用schema中的旧版本枚举/缺省值来放行。

首批为有界、严格JSON profile：512KiB原文、32层结构、25000节点、500步骤及20份内嵌轨迹（均含根），全包计数。仅UTF-8、不解压、不追随引用。拒绝重复JSON属性、重复同step工具ID、非有限数值及不安全整数，避免含义不明/精度损失。时间采用ISO日历日期`YYYY-MM-DD`，可带T/空格时间、可选秒/小数与时区；年份从1开始，拒绝无效日期和24点滚动。周日期、紧凑日期及非规范媒体MIME别名未支持，不宣称支持全部上游便利转换。

输出包含原文和原字节SHA256、外部run/document ID、事件原始step、JSON Pointer及转换缺口。导入事件始终target-reported，文本中的命令、测试通过声明、模型费用都不是独立事实。所有外部媒体/续篇/子轨迹路径仅记录，媒体不下载，未知内嵌引用保留缺口；相同session不作为子文档匹配键。reasoning/extra/metrics等未独立核验字段明确列出。

解析器已由`../../import.mjs`接入可恢复存储事务和既有快照评分，原包私有归档、派生证据脱敏；offline scope与originalRef迁移边界见EC05记录。尚未接入用户可调用service/UI或实际桌面离线报告，不能宣称EC05完成；不能伪装成Pi数据或绕过宿主授权。
