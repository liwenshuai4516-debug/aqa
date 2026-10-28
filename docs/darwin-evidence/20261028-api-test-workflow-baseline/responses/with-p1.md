目前只能整理两条用例草稿，尚未完成 `prepare` 或执行：当前没有可调用的 `api_test_execute`，也未读取 `openapi.json` 内容，无法确认真实 `operationId`、成功状态码、响应结构和必需参数。

你指定的 `http://127.0.0.1:8901` 符合本地 fixture 的地址及端口要求；服务是否可用尚未验证。

以下为待补齐草稿，`null` 表示未知，不能直接提交给 `prepare`；空 `checks` 不代表无需断言。

```json
{
  "cases": [
    {
      "id": "users-list-normal",
      "operationId": null,
      "request": {
        "method": "GET",
        "path": "/users"
      },
      "status": null,
      "checks": []
    },
    {
      "id": "users-detail-normal",
      "operationId": null,
      "request": {
        "method": "GET",
        "path": "/users/{id}"
      },
      "status": null,
      "checks": []
    }
  ]
}
```

待补充项：

- 读取实际契约，确认 OpenAPI 版本、内部引用、两个接口的 `operationId`、必需参数、成功状态及 JSON 响应定义，再生成有依据的字段存在性和类型断言。
- 确认详情接口可用的 fixture 用户 ID，以及列表接口是否需要其他必需参数。
- 确认契约是否要求鉴权；如要求，由宿主配置专用且有效的测试令牌，无需提供令牌值。
- 在宿主启用 API 测试插件及 `api_test_execute` 能力。

前置条件补齐后，下一步是调用 `prepare`，传入真实的 `sourcePath`、`operationIds`、补齐后的 `cases`、`rules`、上述 `baseUrl` 和项目内新的 `outputPath`。此步骤尚未执行，因此没有 `workflowRef`、`runRef` 或生成的套件证据路径。准备完成后仍须评审批准，才能使用同一 `runRef` 执行一次 `run`。

本轮状态：已执行 0，通过 0，失败 0，阻塞 2，未执行 2（即上述两条阻塞草稿）；清理状态：未发送接口请求，无本轮测试数据需要清理。
