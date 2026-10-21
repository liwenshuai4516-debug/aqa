# 接口测试插件：P0-2

当前仅用于手工审定的自包含 HTTP fixture。宿主内部绑定调用身份，`api_test_execute` 只接收一次性 `runRef`；真实目标仍因 P0-1 发现的文件、重定向与操作系统出口隔离缺口阻塞。没有导入、模型生成/评审、资产管理或调度入口。

## 实现与权限

- `index.mjs`：唯一可见工具 `api_test_execute`，权限 `tools`。底层 `runApprovedSuite` 不进入模型工具注册表或个人 MCP 配置。
- `runner.mjs`：专属 stdio MCP server，复用固定 Postman MCP 执行模块与 Newman，跳过云端获取/上传；每进程仅一次执行。`package-lock.json` 固定全部依赖，与 P0-1 版本相同。
- `network-guard.cjs`：只允许本次 loopback fixture 端口的诊断钩子，**不是沙箱**。不可用来批准真实网络目标或不受信任脚本。
- `server/api-testing-runner.ts`：受信宿主 API `approveFixture` 手工冻结集合与评审 hash、调用者和 runner 字节，再生成一次性引用。模型/插件没有签发批准的 API；P0 的重启会丢弃内存批准，不能恢复未知请求。
- 执行前保存 run 身份；HOME/TMPDIR/输入为 run 专属目录，清空继承环境。结果按 fixture 字段白名单投影；取消保留 unknown，不承诺业务回滚。
- 会话身份由 pi 的工具适配器注入第五个参数，跨会话/项目、失效上下文、计划/委派模式、工具关闭和插件停用均拒绝或取消。切换前台会话不会改变原 run 的归属。其他未提供该上下文的引擎明确拒绝。

插件为开发中的本地包，未上市场，未安装到个人目录；目前没有面向用户签发批准的产品入口。P1 补齐后才能形成业务工作流。

## 隔离验证

仓库根安装好开发依赖后，准备独立执行器依赖（不写入个人配置）：

```sh
mkdir -p tests/scratch/api-testing-p0-1/reproduce
cp tests/fixtures/api-testing-p0/package.json tests/fixtures/api-testing-p0/package-lock.json tests/scratch/api-testing-p0-1/reproduce/
npm ci --prefix tests/scratch/api-testing-p0-1/reproduce --ignore-scripts --no-audit --no-fund
node --import tsx tests/api-testing-controlled-test.mjs tests/scratch/api-testing-p0-1/reproduce
```

测试复制本插件到临时 data-dir，调用真实宿主适配器、私有 MCP 和 Newman；不调用模型或真实业务。验收与剩余范围见 [P0-2 证据](../../docs/api-testing-evidence/P0-2.md)。

## P1-1 导入与编译模块

`suite.mjs` 导出 `importContract`、`designCandidates`、`compileSuite`、`saveDraft`，供后续工作流组合。候选仅是待补输入的纲要；确定性编译保留契约/规则依据，固定模板拒绝任意 JS。输出为带文件 hash 的 draft，review 为 pending，不取得执行权限。当前 API 不作为模型可直接调用的产品工具；完整接线与独立评审另按任务验收。

支持矩阵、未覆盖关键字、源码净化限制、负向规则和复现见 [P1-1 验收](../../docs/api-testing-evidence/P1-1.md)。依赖新增固定 Swagger Parser 13.1.0 和 Ajv 8.17.1；均安装于隔离 runtime，未改项目根依赖或个人配置。

## P1-2 独立评审模块

`review.mjs` 在文件/hash 与确定性重编译检查后，通过传入的 `host.llm.complete` 做独立无工具评审；所有轮次共享调用/时间预算，批准绑定实际集合及包内内容 hash。模块返回评审结果，尚无面向模型的批准签发 API。

[工程验收](../../docs/api-testing-evidence/P1-2.md)使用明确模型替身验证控制分支；实际模型语义评审未执行。宿主没有模型 AbortSignal，超时只保证模块停止后续步骤，不承诺供应商调用已经结束。
