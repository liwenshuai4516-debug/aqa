# T38 官方 DSH 本地工具执行与会话落盘

日期：2026-10-21。对应 T06/T07、A09。源依据 server/dsh/dsh-client.ts、runtime/launcher.mjs、preset-clones.ts 以及官方运行时的标准预设。使用 T19/D06 实际 DMG 应用的 Electron 内置 Node、包内原适配器和 launcher，外部官方 DSH 0.1.5-rc.3 安装树 /tmp/pi-T14-runtimes.JdW099。无生产、依赖或安装包变化。

## 隔离与范围

新增 dsh-local-execution-run.mjs。独立 workspace/data/agent/sessions/DSH_HOME，清除常见供应商凭据，PATH 无全局 Node；显式向回环 HTTP 模型端点提供 local-only 测试凭据。模型回复由本地脚本构造，不是 DeepSeek 供应商回复，也不宣称真实模型会自主选择工具。原官方 DSH、本地模型传输、标准预设、工具执行与会话存储实际运行，没有替换 DSH 内核或模拟工具结果。

本轮通过包内 Electron 的 ELECTRON_RUN_AS_NODE 直接运行适配器，不是 Electron 窗口内切换 DSH 的 UI 验收。此前 T14/T21 的窗口与协议证据保留自身范围。

## 最终结果

T38-dsh-local-final.json/log 为 PASS：

- 官方运行时实际访问本地 /chat/completions，默认标准预设提供原 write 工具及 schema。
- 脚本模型发出 write(file_path=中文 DSH结果.txt, content=DSH_FILE_OK)。原 DSH 执行后，独立宿主读取文件，精确 11 字节、无换行，hex=4453485f46494c455f4f4b。
- 原工具结果作为 role=tool 返回给下一次本地模型请求；最终 assistant/message 包含 DSH_LOCAL_EXECUTION_OK，turn/end reason.kind=completed，状态回到 idle。
- 实际 3 次本地请求（包括运行时自动生成标题的请求），输出上限依次为 128/64/128；输入 JSON 总计 86234 字节。不能把一次用户 prompt 误算为一次供应商请求。
- 正常关闭后，完整读取会话 .jsonl.zstd 的全部 10 个串联压缩帧，共 24 条记录，write 调用、工具结果、最终回复和 completed 均落盘。压缩会话副本已归档 T38-dsh-session.v3.jsonl.zstd；不宣称已通过进程重开历史的 UI 验收。
- runtimeStopped=true；没有真实供应商请求，18/18 的付费额度及旧账本不变。

独立字节、摘要、输入量和会话记录复核见 T38-dsh-independent.json。

## 失败与检查

首轮探测 T38-dsh-local-probe FAIL：等待条件错误地在用户消息中遇到预期标记即结束，实际尚无模型请求。请求数断言保住失败，未计通过。随后改为等待真实 turn/end，并只匹配 assistant/message；v2 的本地文本回复 PASS 单独保留，不作为工具执行证据。之后 write 专项及最终增加持久化检查的运行均 PASS。

首次独立解码检查只处理第一个 Zstandard 帧（会话头），因而找不到工具事件；失败说明见 T38-dsh-independent-first.json，该文件是事后诊断说明，原断言输出在聊天工具记录中。完整消费每帧后验证事件，不改变原记录或放宽事件断言。不能把部分解码误判为 DSH 丢失历史。

定向 Prettier、全项目类型检查、3 文件/31 相关单测，以及源目录与受保护源码哈希门禁通过，见 T38-final-*、T38-source.json 和 T38-protected.json。未知 bottombar 单测差异不变且未提交。

真实供应商驱动 DSH 的执行/目标仍未验证，需新的明确请求额度授权；本轮只能补齐官方引擎的本地工具执行与落盘。正式签名、更新安装、OAuth、通知和原生取消等剩余项保持未完成。
