# T22 最新安装包生命周期与真实写入不重放

日期：2026-10-20。仍使用 T19/D06 的 0.109.0 arm64 实际 DMG 安装应用，位于源码外的中文/空格路径；没有重建或修改生产代码。

## 产物身份

`T22-artifact-verification.json` 通过 6 项核对：实际安装的 main、agent-service、agent-service-daemon、mcp-bridge 编译文件与当前构建逐字节哈希相同，release 中 DMG/ZIP 的 SHA256 与清单一致。可执行文件和安装文件哈希另见 `T22-artifact-identity.json`。新结果不能与 T14 的旧包证据混为一谈。

## 最新包完整生命周期

`T22-native-lifecycle.json/log/png`：原完整生命周期测试的 8 条结果全部 PASS。实际应用正常启动后接入 inspector/CDP，不使用 Playwright Electron loader；启动环境移除供应商凭据环境变量、PATH 不含 Node，应用数据独立。

验证真实窗口与 sandbox/contextIsolation/nodeIntegration、包内 SDK、未授权 401/授权 200、最小化/恢复、全屏进出及 preload 事件、关窗口后 Dock activate 重建并保持原 sidecar PID、杀死本应用 sidecar 后故障恢复与新 PID、正常退出回收、端口被无关服务占用后回退与偏好白名单恢复、释放端口后重启返回首选端口，以及持久日志无启动 token。

故障恢复测试仅将原生恢复提示的用户选择设为“重启”，记录实际提示参数；实际子进程由 SIGKILL 终止、实际重建，不能解释为人工点击过恢复弹窗。Dock 恢复由原 app activate 事件触发，不等同于人工点击 Dock。

随后新增真实重复启动断言，再运行同一套完整测试：`T22-single-instance-lifecycle.json/log/png` 的 9 条结果全部 PASS。第二个可执行文件进程以同一独立数据启动并正常退出；原窗口由最小化恢复、获得焦点且只剩一个 BrowserWindow，原 sidecar PID 不变。首次完整运行和增加断言后的运行分别保存，没有覆盖。

## 真实文件写入后中断

`no-replay-run.mjs` 保留原历史保存/中断/重开断言，新增实际安装包正常启动、独立证据路径和可选 `--write-before-interrupt`。`T22-no-replay-write.json/log` 的 3 条结果全部 PASS：

1. 包内真实 SDK 完成第一轮并保存历史。
2. 本地脚本供应商返回原 bash 工具调用，实际执行 `printf` 向独立工作区的 replay-proof.txt 追加 `APPEND_ONCE\n`；下一个模型请求保持流式未结束，此时正常退出应用。断言真实文件恰好为该一行、中断记录及历史文件确实落盘。
3. 同一客户端重连收到中断提示，静置后手动打开原历史，再次静置。文件精确字节未变，供应商请求总数仍为 3，没有自动“继续”或重复追加。

这证明实际本地工具副作用经过应用退出/重开不重放。供应商响应为本机脚本，不是真实模型自主决定工具；不会抵消 T20 的严格目标 FAIL。没有新增 DeepSeek 请求，累计仍为 12/14。

重开后的原文件字节另存为 `T22-write-proof.txt`；`T22-write-proof.json` 保存长度、十六进制、SHA256 与真实会话文件哈希，并从原落盘会话记录确认 bash 工具调用总计恰好一次，避免只依赖请求计数推断副作用。

## 验证与边界

修改限于两条桌面验收脚本与本轮文档。格式化、全项目类型检查、3 文件/6 相关单测通过；源目录及受保护哈希检查通过，见本轮日志。来源未明的 bottombar 差异继续保留，未归入提交。

T05 最新产物的正常生命周期与实际写入不重放缺口已补齐。正式更新退出/升级/中断恢复、签名公证、干净用户/Gatekeeper、原生中文目录选择、真实 OAuth、DSH 模型目标和真实严格目标等仍未完成；系统通知/听感继续按用户决定保留待验收。
