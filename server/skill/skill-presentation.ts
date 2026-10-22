/** Skill display metadata and capability ownership; canonical SDK names never change. */
import { readFileSync, statSync } from "node:fs";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { ClientSettings } from "../client-state.js";

const labels: Record<string, [string, string]> = {
	"api-test-workflow": ["接口自动化测试", "依据接口契约准备、评审和执行测试，支持修订及定向复测。"],
	"api-test-review": ["接口测试评审", "独立评审冻结的接口测试套件及其依据，登记批准结果。"],
	"api-test-analyze": ["接口测试结果分析", "分析测试报告、问题与清理结果，核对定向复测证据。"],
	"ui-testing-workflow": ["UI 自动化测试", "复用 UI 测试能力，完成录制、设计评审、执行、分析和结果评估。"],
	"ui-test-workflow": ["UI 测试任务编排", "查询可复用资产，按需选择测试阶段并保存交接记录。"],
	"ui-discover-record": ["UI 场景发现与录制", "按模块发现测试场景，录制有证据的脚本草稿。"],
	"ui-case-design": ["UI 用例设计", "依据需求与录制证据生成用例、断言及脚本候选，进行静态检查。"],
	"ui-design-review": ["UI 测试设计评审", "独立审查测试设计、来源和断言，获批后进行对照诊断。"],
	"ui-test-run": ["UI 测试执行", "执行已获批的 Playwright 测试资产，保存原生结果与证据。"],
	"ui-result-analysis": ["UI 测试结果分析", "分析已有正式批次的统计和失败证据，生成报告候选。"],
	"ui-result-review": ["UI 测试结果评审", "独立核验测试统计、归因和报告，登记批准或阶段交付。"],
	"ui-artifact-check": ["UI 测试产物校验", "检查测试产物结构、步骤和来源引用，不替代真实测试。"],
	"dingtalk-aicard": ["钉钉 AI 卡片", "创建、编辑与校验钉钉 AI 卡片；按需预览。"],
	"dingtalk-aisearch": ["钉钉智能搜索", "按姓名、主题或行为搜索人员与跨来源内容。"],
	"dingtalk-aitable": ["钉钉 AI 表格", "管理多维表、字段、记录、导入导出和数据同步。"],
	"dingtalk-calendar": ["钉钉日历", "查询和管理日程、参会人、闲忙与会议室。"],
	"dingtalk-chat": ["钉钉群聊与消息", "查询和发送消息，管理群聊、机器人及群文件。"],
	"dingtalk-contact": ["钉钉通讯录", "查询人员详情、部门、角色，按完整手机号精确查找。"],
	"dingtalk-doc": ["钉钉文档", "查找、读取和编辑在线文字文档及其评论、附件与权限。"],
	"dingtalk-drive": ["钉钉文件管理", "管理钉盘与文档空间中的文件、文件夹及同步。"],
	"dingtalk-event": ["钉钉事件监听", "监听消息、审批、通话邀请、待办和卡片回调事件。"],
	"dingtalk-mail": ["钉钉邮箱", "搜索、阅读、发送、回复和转发邮件及附件。"],
	"dingtalk-minutes": ["钉钉 AI 听记", "管理听记摘要、逐字稿、行动项、录音与分享。"],
	"dingtalk-misc": ["钉钉扩展业务", "处理审批、考勤、日志、开放平台及其他钉钉业务。"],
	"dingtalk-shared": ["钉钉能力导航", "为跨产品钉钉任务确定执行规则与技能入口。"],
	"dingtalk-tag": ["钉钉数字员工", "创建、管理、发布数字员工并配置能力资源。"],
	"dingtalk-todo": ["钉钉待办", "创建、查询、指派和更新待办及循环任务。"],
	"dingtalk-wiki": ["钉钉知识库", "管理知识库空间、节点、成员与知识组织。"],
};

type SkillRef = { name: string; description?: string; filePath?: string };
type SkillMetadata = { displayName?: string; descriptionZh?: string; descriptionEn?: string; pluginId?: string };
const cache = new Map<string, { stamp: string; metadata: SkillMetadata }>();
const stringValue = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() ? value.trim() : undefined;

/** Optional standard frontmatter metadata, also usable by third-party skills. */
function metadataFor(filePath?: string): SkillMetadata {
	if (!filePath) return {};
	try {
		const stat = statSync(filePath);
		const stamp = `${stat.mtimeMs}:${stat.size}`;
		const cached = cache.get(filePath);
		if (cached?.stamp === stamp) return cached.metadata;
		const { frontmatter } = parseFrontmatter(readFileSync(filePath, "utf8"));
		const raw = frontmatter.metadata;
		const fields = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
		const metadata = {
			displayName: stringValue(fields["display-name"]),
			descriptionZh: stringValue(fields["description-zh"]),
			descriptionEn: stringValue(fields["description-en"]),
			pluginId: stringValue(fields["plugin-id"]),
		};
		cache.set(filePath, { stamp, metadata });
		return metadata;
	} catch {
		return {};
	}
}

export function presentSkill(skill: SkillRef) {
	const metadata = metadataFor(skill.filePath);
	const label = labels[skill.name];
	return {
		displayName: metadata.displayName ?? label?.[0],
		description: metadata.descriptionZh ?? label?.[1] ?? skill.description ?? "",
		descriptionEn: metadata.descriptionEn ?? skill.description ?? "",
	};
}

export function isUiTestingExtension(extension: { path: string; sourceInfo?: { source?: string } }): boolean {
	const path = extension.path.replace(/\\/g, "/");
	return (
		extension.sourceInfo?.source === "npm:pi-ui-testing" ||
		path === "npm:pi-ui-testing" ||
		path.includes("/node_modules/pi-ui-testing/") ||
		path.endsWith("/node_modules/pi-ui-testing") ||
		path.endsWith("/capabilities/ui-testing/mcp-extension.mjs") ||
		path.endsWith("/.pi/skills/ui-testing-workflow/assets/mcp-extension.mjs")
	);
}

export function isUiTestingDisabled(settings: Pick<ClientSettings, "disabledExtensions">): boolean {
	return settings.disabledExtensions.some((path) => isUiTestingExtension({ path }));
}

/** Ownership gates are independent of the user's individual skill preference. */
export function skillBlock(skill: SkillRef, settings: Pick<ClientSettings, "disabledPlugins" | "disabledExtensions">) {
	const pluginId =
		metadataFor(skill.filePath).pluginId ??
		(skill.name.startsWith("api-test-") ? "api-testing" : skill.name.startsWith("dingtalk-") ? "dingtalk" : undefined);
	if (pluginId && settings.disabledPlugins?.includes(pluginId)) {
		return { blockedBy: pluginId, blockedByEn: pluginId };
	}
	if (labels[skill.name] && skill.name.startsWith("ui-") && isUiTestingDisabled(settings)) {
		return { blockedBy: "UI 自动化测试", blockedByEn: "UI testing" };
	}
	return undefined;
}
