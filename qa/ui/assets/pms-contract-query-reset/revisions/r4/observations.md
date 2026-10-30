# r4 当前部署与验证边界

原任务 pms-operation-contract-new-20261029 与原 scope、评审预算保持不变。旧请求 pms-contract-query-reset-review-r3-01 在宿主 authority 的 attempt-1.json 为 error / runner-error，无 pending；不重放。项目原生扩展物理路径登记修复后，新桌面子会话及当前父会话对 r3 的原生静态 check 均 completed、issues=[]；这仅证明静态运行时恢复，不是 PMS 用例通过。

2026-10-30 公开 GET 页面当前引用 index-ByeuxnbH.js，完整 bundle SHA256=92a453a7b9b5d3aa58da23c1fe9335d78f75759808e6cf838d2800f2e72fb2c8。完整 gzip、入口、AST 原文摘录与摘要索引保存在 qa/ui/scopes/pms-contract-deployment-20261030/，评审仅传入精确小摘录，避免 UTF8 解码 gzip 超过 1MiB。当前源码是 declaration，不据此宣布产品缺陷。

v14 完整受管录制来自前一部署，证明历史名称输入/查询/重置动作；初始列表实际4条，合成名称查询后0条（纠正旧 finish 文本）。六项全部设值路径没有真实录制证明。本次 v15/v16 私密准备均失败并保留 partial；没有新的浏览器身份/DOM实测。

r4 两条 P0 撤销了草稿额外引入的“至少第二页”和“独立部门ID文件”前置，保留原有源码用例语义。两条从默认第一页检查 GET pageNum=1；非首页回1转换留为未覆盖。009 要先设置六项非默认并保存准备状态，再严格校验全部/空控件及 bizName,bizCode,departmentId,contractStatus,signedAtStart,signedAtEnd 全部省略。部门从页面首个可见非全部项选取，只作可替换动作输入，不据此验证部门ID映射或生成重置预期。001 仅以独立数据 trim 后的 GET 参数为预期，失焦 DOM 显示行为待确认。

受管 fixture 每例新 context；身份按照 v14 token/client headers 协议仅返回账号匹配布尔。角色名称未核实，不推断权限矩阵。无合同创建、修改、删除，业务写入0；销毁context清理浏览器状态。前置失败保留 ui-preflight blocked，不 skip、不算产品失败。

原9条源码草稿仍在数据空间。当前原生已交接 inventory 只含001/009，workflow无评审阶段追加清单入口；002–008仍待登记可执行修订/评审/执行，完整草稿另留，不能用两条结果覆盖9条分母。

诊断使用获批同一脚本与预期：正对照为当前真实PMS；负对照为不同origin的只读合成错误副本，其身份marker与账号只作用于隔离fixture，不代表PMS身份。诊断不计正式run。任何前置/评审/诊断门禁未满足则不启动正式执行。
