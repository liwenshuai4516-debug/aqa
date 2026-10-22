# 工具上下文预算（tool context budget）

> 模型每轮都要吞下「全部活跃工具」的名字 + 完整参数 schema。工具一多，这是几万字符的
> **固定开销**（哪怕这轮只用 bash）。本文档记录压这块开销的三条手段、各自的取舍，以及
> **延迟加载为什么不会打坏供应商的前缀缓存**（这是实现里最容易踩坏的一条）。
>
> 相关代码：`server/load-tools-tool.ts`（按需加载入口）、`server/tool-manager.ts`（门控 +
> `lazyLoadingDisabledTools`）、`server/prompt/prompt-composer.ts`（提示词目录段）、
> `server/prompt/tool-prompt-overrides.ts`（逐工具文案覆盖）、`server/agent/agent-service.ts`
> 的 `applyToolGating` / `lazyToolCatalog` / `promptToolCatalog` / `loadLazyTools`。

## 1. 一块开销有多大

以 30 个目录/核心工具为例（设置页「查看工具 schema」能看到实时数字）：

| 组成                                           | 约            |
| ---------------------------------------------- | ------------- |
| 工具文字（description + snippet + guidelines） | 11.3k 字符    |
| 参数 schema（JSON，含参数说明/枚举/默认值）    | 18.6k 字符    |
| **下发工具 schema 合计**                       | **~33k 字符** |

参数 schema 是结构化的**契约**（枚举、默认值、范围、逐 action 语义），删了模型就会传错参数，
所以「抠字」这条路的下限很低（实测全量收敛后只能再降 ~11%）。

## 2. 三条手段

### 2.1 文案精简（已做）

见 `AGENTS.md` 的「工具提示词三处职责分离」。description = 做什么 + 副作用；snippet = 触发
条件（≤80c）；guidelines = 何时用/顺序/禁止。同一件事只说一遍，守卫
`tests/unit/tool-prompt-hygiene.test.ts` 机器把关。

### 2.2 逐工具文案可编辑（已做）

设置 → 工具区「编辑文案」：`description` / `promptSnippet` / `promptGuidelines` 都能覆盖，
留空 = 用出厂默认。存在 `ClientSettings.toolPromptOverrides`，打补丁落在 SDK 合并后的
`_toolRegistry` 上（核心内置 / 本项目工具 / 插件 / MCP 一网打尽）。见
`server/prompt/tool-prompt-overrides.ts`。

### 2.3 延迟加载（本机制，**默认关**，可开）

开：只有**核心工具**（`bash` / `read` / `edit` / `write`）与 `load_tools` 常驻；其余工具在
系统提示词的 `{{tools}}` 段里只有**名字 + 一行摘要**（目录），参数 schema 不进上下文。延迟加载目录不重复参数签名；缺少 `promptSnippet` 的
扩展使用 description 的精简摘要，避免工具从目录消失。模型
要用时先调 `load_tools(["patch","lsp"])`，那批工具被激活，schema 才随之下发。

- 开关：设置 → 工具区「工具按需加载」（`ClientSettings.toolLazyLoading`，**出厂默认关**）。
  默认关的理由：模型忘加载会先吃一次 `Tool <name> not found`（SDK 只认已声明集），开箱
  即用优先；需要省上下文的实例自己打开，部署级默认可用环境变量 `PI_WEB_TOOL_LAZY_LOADING=1`
  / `true` / `on` / `yes`（只作默认值，用户已存盘的设置优先）。
  关着 = 按开关/预设直接全部活跃（与 pi 命令行一致）。**只影响新会话与之后的门控重放**——
  不会把正在跑的对话里的工具反向清空。
- 门控实现：延迟加载**不引入第二条门控路径**。未加载 = 临时加进禁用名单
  （`lazyLoadingDisabledTools()`），走的还是 `applyAgentToolsGating` 那条链。加载只是把
  名字从名单里拿出来。插件/扩展名称也必须服从这份名单；插件注册和刷新后
  必须重放门控，不能在门控后注册并意外激活全部插件工具。
- `load_tools` 是**常驻脚手架工具**，不入 `AGENT_TOOL_CATALOG`（不能单独关掉它），
  由 `applyAgentToolsGating` 的 `forceActive` 保证在非 standard 预设下也在活跃集里
  （`ask` 预设本来就无工具，不强加）。
- 已加载集合按 **session 对象**存（`WeakMap`）：过户搬的就是 session 本体，集合跟着走；
  会话恢复时仅从转录中的工具调用结果及成功 `load_tools` 回执恢复已加载名单，
  不把 SDK 初始化的默认活跃全集作为种子。历史已被压缩掉的工具可再次按需加载。
- 加载会**拒绝**：未知名字 / 已被用户关闭 / 当前预设不允许 / 计划模式闸门拦截 / 已经加载过
  —— 原因写回工具结果，模型能自己纠正。
- **模型忘记加载、直接调用目录里的工具**（JIT 自动激活）：SDK 在解析工具之前就派发了
  `tool_execution_start`，随后因该工具不在活跃集回一条 `Tool <name> not found`；服务端在
  这个事件里把该工具补进已加载集**并立刻重放门控**，于是它从下一轮起真的活跃 —— 模型原样
  重试即成功，不必先绕道加载别的工具（issue #652）。
- 「已经加载过」按**活跃集**判断，不只看已加载集合：只标记不激活的半吊子状态会被当成
  重新加载并修正，而不是回一句「已经加载过了」把模型堵死（同 #652）。
- DSH 引擎没有 pi 工具注册面，不适用（设置行不显示，协议字段恒为 false 占位）。

## 3. 硬约束：不能打坏前缀缓存

供应商的 prompt cache（Anthropic `cache_control`、OpenAI/DeepSeek 自动前缀缓存）是按**前缀**
命中的：只要这一段和缓存过的完全一致就命中，哪怕后面追加了新内容。所以我们只允许**追加式**
变化，绝不允许「中间改一个字」。

延迟加载天然踩这个坑：直观实现会把「已加载」的工具从目录段挪到「活跃工具」段——目录段一
变，系统提示词就变，整段缓存报废。**本实现刻意规避**：

1. **系统提示词与已加载集合无关**。`{{tools}}` 永远列**完整目录**（
   `promptToolCatalog()`：全部可用工具，注册表顺序，**不过滤已加载**），末尾只有一段
   **恒定**说明「有一部分工具 schema 未附，先用 `load_tools`」。加载前后逐字节相同。
2. **guidelines 只取基线**。延迟加载下系统提示词的 Guidelines 段只含核心工具 +
   `load_tools` 的要点；被加载工具的要点**随 `load_tools` 的回执文字**进对话（追加，不是
   改前缀）。
3. **tools 数组只追加**。加载只产生 `toolsAdded` 增量（SDK 的 `getToolStateChanges`），
   不会出现 `toolsRemoved`/redefinition；支持中途工具变更的供应商（Anthropic
   `defer_loading`、OpenAI `additional_tools` / `tool_search`）会把新增工具**锚在初始声明
   上**流式注入（`resolveTranscriptTools` 的 `anchorsAdditions`），其余供应商把当前列表
   原样下发，也是「旧前缀 + 新尾巴」。
4. **顺序稳定**。目录与基线名单都按注册表顺序生成，同一设置下重复渲染结果一致。

回归：`tests/lazy-tools-test.mjs`（零 token，mock LLM）直接断言
「加载前后 system 文本**逐字节相同**」与「第二次的 tools 以第一次为**前缀**」，并覆盖
「模型直呼未加载工具 → 该工具自动激活 → 原样重试成功」这条 JIT 路径（#652）。

⚠️ 会破坏缓存的操作（都在我们的控制面内）：改 `toolPromptOverrides`（工具定义变了 →
redefinition）、关掉某个工具（`toolsRemoved` → 该对话之后只能走非锚定路径）。这些是用户
主动操作，一次性代价可接受；但**不要**在自动化路径里改这些。

## 4. 换来的收益与代价

（都是**开启**这个开关之后的口径；出厂默认关，所以下面是「想省上下文时才付的代价」）

- 收益：常驻 schema 33k → **~7k**（核心工具 + load_tools）。用不到的工具体永远不进上下文；
  系统提示词本身也从 ~8.6k 降到 ~6.7k（guidelines 只剩基线）。
- 代价：模型多一步「先加载再用」。目录（名字 + 一行摘要）仍常驻，发现性不丢；加载失败会
  写明原因。弱模型可能忘记加载——所以这个开关**出厂默认是关的**（见 §2.3）。

## 5. 2026-10-22 排查与验收

已修复三个泄漏路径：门控原先仅遍历内置目录、忽略未加载的扩展/插件名称；恢复会话误用
SDK 默认活跃全集；插件在门控后注册或刷新时未重放门控。另外补齐无 snippet 工具的目录
摘要，去掉延迟目录重复的参数签名，完整 Schema 契约保留。

使用真实宿主与 SDK，将模型请求发送到本地 mock，捕获实际出站 JSON；fixture 注册三个
大型 UI/API/MCP 代表工具（每个 80 个字段），不是生产工具规模或真实模型 tokenizer 统计。

| 相同 fixture 的请求阶段 | 修复前工具数 / Schema 字节 | 修复后工具数 / Schema 字节 |
| ----------------------- | -------------------------- | -------------------------- |
| 关闭按需加载            | 30 / 97,266                | 30 / 97,266                |
| 开启后新会话首轮        | 8 / 66,781                 | 5 / 4,253                  |
| 按需加载一个扩展后      | 8 / 66,781                 | 6 / 25,096                 |
| 插件重新扫描后          | 8 / 66,781                 | 6 / 25,096                 |
| 恢复加载过扩展的会话    | 25 / 91,116                | 6 / 25,096                 |
| 恢复仅有普通对话的会话  | 25 / 91,116                | 5 / 4,253                  |

首轮 Schema 字节下降 **93.6%**；系统提示词从 19,219 降至 17,035 字节（**11.4%**）。
这些数字不能直接换算为用户原有的 31,983 tokens；界面的 token 数为估算，实际值依模型
分词及已加载工具而变。稳定会话中加载工具前后的 system 文本逐字节一致，旧工具声明保持
前缀不变。显式禁用或改变设置会改变可见目录，不属于同设置下的缓存稳定保证。

复跑：`node tests/tool-context-budget-test.mjs`（由 `ensureBuild` 保证构建；已有构建可设
`PI_WEB_SMOKE_PREBUILT=1`），以及 `tests/lazy-tools-test.mjs`。隔离端口 19340、临时
agent/data-dir，仅调用本地 mock，不使用个人凭据、不调用业务接口。详细结构化证据见
[本次验收记录](tool-context-budget-evidence.md)。

启用方式仍为设置 → 工具 → 工具按需加载。部署新构建后需重启应用，再新建或重新打开会话；
无需删除会话历史。运行中的旧进程不会自动获得源码修复。此机制适用 pi 引擎，DSH 不适用。

## 6. 2026-10-22 首轮响应等待排查：延后注册的 MCP 工具

用户截图对应的新会话已启用按需加载，但首个 system 记录仍声明 94 个工具，其中 87 个为
UI 测试 MCP 工具；模型回报首轮输入 17,873 tokens，未命中输入缓存。该轮从请求对象创建到
回复定稿约 23.6 秒，输出 79 tokens；这是完整响应耗时，不能当作首字耗时。记录中用户消息
创建到请求对象创建约 85ms，**不包含**用户消息创建前的 SDK 前置处理，也不等于完整发送耗时。
当前会话思考强度为 medium，存在没有公开思考文字的 thinking 块；空回复显示的“正在思考”
只是界面占位，不能据此判断全部等待都用于推理。此次未发起真实模型或业务请求，不将历史
模型用量算成本次测试结果，也不能从现有记录拆分网关排队、网络和模型计算各自的耗时。

根因是生命周期顺序：工厂阶段执行 `applyToolGating()` 后，SDK 的 `session_start` / 较早的
`before_agent_start` 处理器仍可注册工具，SDK 会默认激活这些新工具。原有静态注册 fixture
没有覆盖这一窗口。现在在已有末尾 persona 处理器中重放同一门控，并同步本次
`systemPromptOptions.selectedTools`，随后再组装提示词；不修改 SDK，不新增加载框架。
按需加载关闭时仍按原设置提供工具，显式关闭、已加载和从历史恢复的工具继续走原规则。
此处修复的是进入 run 前已完成的延后注册；run 已开始后才注册的工具仍属于 SDK 动态注册
生命周期，本轮未宣称覆盖这类竞态。

在原 `tests/tool-context-budget-test.mjs` 中将一个大型工具改为发送前注册，修复前复现
5 个失败检查（首轮泄漏、追加顺序与恢复），修复后 16 项检查全部通过（含显式加载延后注册的
工具、下一轮继续保持加载）。同一延后注册 fixture
首轮从 6 个工具 / 25,097 schema 字节变为 5 个 / 4,253 字节（减少 83.1%）；system 文本
保持 17,035 字节，加载后的 system 逐字节相同，原工具声明保持前缀。完整工具模式仍有
30 个工具。此 fixture 数字不能换算成用户实际等待缩短秒数或生产 tokenizer 用量。

前后证据：`tests/scratch/tool-context-budget/late-registration-before/` 和
`late-registration-after/`。只使用临时 agent/data-dir、本地模拟模型和合成工具，未读取凭据、
修改个人会话或调整用户模型/思考设置。重启客户端服务后修复才生效，新会话适合比较首轮
负担；已有历史不用删除。

本地 Chrome 探针复用原文件链接浏览器回归，记录实际发送、模拟模型收到请求、写出内容和
DOM 出现内容四个时间点：即时响应为 69ms 本地准备 + 42ms 返回/上屏（总 113ms）；
模拟模型延后 1500ms 时为 118ms + 1500ms + 31ms（总 1649ms）。使用合成请求、
openai-completions SSE，不代表用户 openai-responses 网关的性能。证据分别位于
`tests/scratch/file-link-preview/1792654542403-browser/` 和 `1792654587466-browser/` 的
`timing.json`；诊断脚本仅在已忽略的 `tests/scratch/response-latency/` 中保留，不增加产品代码。
隔离原生 Electron 同一探针为 105ms 本地准备 + 232ms 返回/上屏（总 338ms），证据位于
`tests/scratch/file-link-preview/1792654907417-desktop/`。这些本地样本均未出现数秒的客户端
固定等待，但不能据此给生产模型承诺相同首字时间。

本次 7 文件、92 项相关单测，五个类型配置、lint、完整构建和协议单源检查通过（无 tag，协议
版本 git 启发式按原逻辑跳过）。核心冒烟首次 20/22 通过，quiesce 与 plugin-scaffold 单独复测
均通过，首次失败仍记录为不稳定，不能写成一次全绿。原 `lazy-tools-test.mjs` 的“关闭按需加载
后 snapshot.tools 不含 load_tools”检查失败，其他检查通过；使用 `b27216a` 原实现、隔离模块加载
钩子复跑同一脚本也出现相同失败，属于本次修改前已有的状态同步问题。本次没有跳过或修改
该断言。对照日志见 `tests/scratch/response-latency/lazy-baseline.log`、`lazy-recheck.log`，
核心复测见 `core-recheck.log`。生产网关的修复后首字耗时未测，Windows/Linux 客户端未测。
