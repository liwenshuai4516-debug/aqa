目前生成和运行均被阻塞：当前没有可调用的 `api_test_execute`，且本次尚未读取 `openapi.json`，无法确定真实的 `operationId`、成功状态码和响应字段断言。因此未调用 `prepare`，也未执行请求。

目标地址 `http://127.0.0.1:8901` 符合本地 fixture 的地址与端口要求。先保留两个待契约确认的用例草稿：

| 用例 ID | 接口 | 待确认内容 |
| --- | --- | --- |
| users-list-success | GET /users 正常查询 | operationId、必需参数、成功状态和响应结构 |
| users-detail-success | GET /users/{id} 正常查询 | operationId、可用的用户 ID、成功状态和响应结构 |

当前可提交给 `prepare` 的完整用例为：

```json
{"cases": []}
```

待补充：契约内容、详情接口的有效测试 ID，以及契约要求的其他必需数据。若需要鉴权，应由宿主配置专用凭据，不要在聊天或用例中提供令牌值。

后续步骤（均未执行）：启用插件并提供 `api_test_execute` → 读取契约补齐两条用例 → 用 `sourcePath`、真实 `operationIds`、`cases`、`rules`、上述 `baseUrl` 和项目内新 `outputPath` 调用 `prepare` → 保存返回的 `workflowRef` 为 `runRef` → 评审批准后，用同一 `runRef` 执行 `run`。`prepare` 成功本身不代表获准执行。

当前没有 `runRef`、`runId` 或工具证据路径。已执行 0， 通过 0，失败 0；两个接口均阻塞、未执行。清理状态：未产生测试请求或运行数据。
