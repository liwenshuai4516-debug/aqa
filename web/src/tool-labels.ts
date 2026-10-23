/**
 * 工具卡展示名（tool-labels）。
 *
 * 工具卡、思考卡、审批弹窗抬头显示的是**机器名**（`read` / `bash` / `grep` …），
 * 中文界面里读起来像命令而不是动作。这里给出一层纯展示映射：
 *
 *   · 中文界面（`zh` 及 `zh-*`）→ 表中的中文动作名；
 *   · 其它语言 → 原名（英文界面原本就可读，多一层英文表反而两处维护）；
 *   · 表里没有的名字（插件工具、MCP 工具、`mcp__srv__tool`）→ 原名回退，
 *     不会出现空标题。
 *
 * 为什么是独立模块而不是 i18n 字典：`tests/unit/locales.test.ts` 要求 zh 字典
 * 与 12 个语言包键一一对应且无空值，`tests/unit/i18n-dead-keys.test.ts` 要求
 * 每个键真的被 `t()` 读到；把几十个工具名塞进字典等于要求 12 份翻译同步维护。
 *
 * 只改**展示**：协议里的 `UiToolCallBlock.name`、审批判定 `approval.toolName`、
 * 工具详情请求 `openToolInfo(name)`、右键菜单 target.label 全部继续使用机器名，
 * 因此模型调用、权限/审批匹配、插件工具登记与快照都不受影响。
 */
import { isZhLocale } from "./pick-locale.js";

/**
 * 中文展示名表。键必须是工具的真实机器名（大小写敏感）。
 *
 * 覆盖范围：SDK 核心内置工具 + `server/tool-manager.ts` 登记的可开关工具 +
 * 常见内置插件工具。未列出的名字自动回退原名。
 */
export const ZH_TOOL_LABELS: Readonly<Record<string, string>> = {
	// —— SDK 核心内置工具（文件与终端） ——
	read: "读取文件",
	write: "写入文件",
	edit: "编辑文件",
	edit_soft: "编辑文件（忽略缩进）",
	patch: "应用补丁",
	ls: "列出目录",
	grep: "搜索内容",
	find: "查找文件",
	bash: "执行命令",
	powershell: "执行命令（PowerShell）",

	// —— 子智能体与计划 ——
	subagent: "子智能体",
	delegate_task: "派发子任务",
	plan_update: "更新计划",

	// —— 上下文与工具自身 ——
	compact_context: "压缩上下文",
	tool_search: "查找工具",
	load_tools: "加载工具",
	skill: "调用技能",
	codemode: "代码模式",
	eval: "执行脚本",
	lsp: "代码分析",

	// —— 对话与文件交互 ——
	ask_user_question: "询问用户",
	conversation_read: "读取对话",
	present_files: "展示文件",
	claim_files: "认领文件",

	// —— 系统与外部连接 ——
	browser_page: "浏览网页",
	schedule: "定时任务",
	mcp_manage: "管理 MCP",
	sandbox: "沙箱",
	worktree: "工作树",
	sftp: "远程文件",
	mail: "收发邮件",
	obs_recall: "检索记忆",
};

/**
 * 卡头展示名：中文界面取表内中文名，其余情况（非中文界面、表内没有、空名）
 * 一律回退原名。
 */
export function toolDisplayName(name: string, locale: string | null | undefined): string {
	const raw = name ?? "";
	const zh = ZH_TOOL_LABELS[raw];
	return zh && isZhLocale(locale) ? zh : raw;
}
