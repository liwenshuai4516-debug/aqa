import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SettingsService, type SettingsHost } from "../../server/settings-service.js";
import { ClientStateStore } from "../../server/client-state.js";
import { SubagentTemplatesStore } from "../../server/agent/subagent-templates.js";
import { presentSkill, skillBlock } from "../../server/skill/skill-presentation.js";
import { SlashCommandsService } from "../../server/slash-commands.js";
import { createSkillToolHost } from "../../server/tool-host-factories.js";
import { makeSkillTool } from "../../server/skill/skill-tool.js";
import { mapSkillHits } from "../../web/src/at-mention.js";
import type { UiSettingsState } from "../../server/protocol.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "skill-capability-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function fixture() {
	const store = new ClientStateStore(join(dir, "client-state.json"));
	let snapshot: UiSettingsState;
	const reload = vi.fn(async () => {});
	const skills = ["api-test-workflow", "api-test-review", "ui-test-run", "ui-testing-workflow", "dingtalk-chat"].map(
		(name) => {
			const path = join(dir, ".pi", "skills", name);
			mkdirSync(path, { recursive: true });
			writeFileSync(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: Original English\n---\nInstructions`);
			return { name, description: "Original English", filePath: join(path, "SKILL.md") };
		},
	);
	const extensions = [
		join(dir, "node_modules/pi-ui-testing/dist/extension.js"),
		join(dir, "capabilities/ui-testing/mcp-extension.mjs"),
	].map((path) => ({ path }));
	const host: SettingsHost = {
		clientId: "test",
		stateStore: store,
		emit: (m) => {
			if (m.type === "settings_state") snapshot = m.settings;
		},
		getSession: () =>
			({
				resourceLoader: { getSkills: () => ({ skills: [] }), getExtensions: () => ({ extensions: [], errors: [] }) },
			}) as never,
		cwd: () => dir,
		agentDir: () => join(dir, "agent"),
		flushSnapshot() {},
		isDisposed: () => false,
		isStreaming: () => false,
		reloadSession: reload,
		applyRetryOverrides() {},
		applyCompactionOverrides() {},
		applyToolGating() {},
		promptSnapshot: () => ({ full: "", texts: {}, toolsSchema: "" }),
	};
	const templates = new SubagentTemplatesStore(join(dir, "templates.json"));
	const create = () => {
		const service = new SettingsService(host, templates);
		service.rememberSkills(dir, skills);
		service.rememberExtensions(dir, { extensions, errors: [] });
		return service;
	};
	return { store, create, reload, extensions, skills, snapshot: () => snapshot! };
}

describe("capability-owned skills", () => {
	it("等待重载时 skill 工具也不能加载已关闭插件的技能正文", async () => {
		const f = fixture();
		const service = f.create();
		const host = createSkillToolHost({
			resolveTarget: () => ({ session: { resourceLoader: { getSkills: () => ({ skills: f.skills }) } } }) as never,
			getDisabledSkills: () => service.current.disabledSkills,
			isSkillBlocked: (skill) => service.isSkillBlocked(skill.name),
		});
		expect(host.listSkills()).toHaveLength(5);
		await service.set({ disabledPlugins: ["api-testing"] });
		const tool = makeSkillTool(host, () => "zh");
		const result = await (tool.execute as any)("check", { name: "api-test-workflow" });
		expect(JSON.stringify(result.content)).not.toContain("Instructions");
		expect(host.listSkills().some((skill) => skill.name.startsWith("api-test-"))).toBe(false);
	});

	it("关闭插件连带停用技能并排序，重启后仍可见，重新开启恢复原单独偏好", async () => {
		const f = fixture();
		f.store.saveSettings("test", { disabledSkills: ["api-test-review"] });
		const service = f.create();
		await service.set({ disabledPlugins: ["api-testing", "dingtalk"] });
		expect(f.reload).toHaveBeenCalledOnce();
		const rows = f.snapshot().skills;
		expect(rows.filter((s) => s.enabled).map((s) => s.name)).toEqual(["ui-test-run", "ui-testing-workflow"]);
		expect(rows.find((s) => s.name === "api-test-workflow")).toMatchObject({
			enabled: false,
			blockedBy: "api-testing",
			displayName: "接口自动化测试",
		});
		expect(f.store.getSettings("test").disabledSkills).toEqual(["api-test-review"]);
		const restarted = f.create();
		restarted.push();
		expect(f.snapshot().skills).toHaveLength(5);
		await restarted.set({ disabledPlugins: [] });
		expect(f.snapshot().skills.find((s) => s.name === "api-test-workflow")?.enabled).toBe(true);
		expect(f.snapshot().skills.find((s) => s.name === "api-test-review")?.enabled).toBe(false);
	});

	it("关闭任一 UI 配套扩展均禁用所有 UI 入口，并展示真实扩展加载失败", async () => {
		const f = fixture();
		const service = f.create();
		await service.set({ disabledExtensions: [f.extensions[1].path] });
		expect(
			f
				.snapshot()
				.skills.filter((s) => s.name.startsWith("ui-"))
				.every((s) => !s.enabled && s.blockedBy),
		).toBe(true);
		expect(f.snapshot().agentCapabilities?.[0]).toMatchObject({ id: "ui-testing", enabled: false, loaded: false });
		service.rememberExtensions(dir, {
			extensions: [f.extensions[0]],
			errors: [{ path: f.extensions[1].path, error: "MCP module failed" }],
		});
		service.push();
		expect(f.snapshot().agentCapabilities?.[0]?.error).toBe("MCP module failed");
	});

	it("第三方技能可以提供中文别名、双语说明和插件依赖，不修改规范技能 ID", () => {
		const path = join(dir, "SKILL.md");
		writeFileSync(
			path,
			"---\nname: third-party\ndescription: English\nmetadata:\n  display-name: 自定义测试\n  description-zh: 中文说明\n  description-en: English description\n  plugin-id: custom-plugin\n---\nBody",
		);
		const skill = { name: "third-party", description: "English", filePath: path };
		expect(presentSkill(skill)).toEqual({
			displayName: "自定义测试",
			description: "中文说明",
			descriptionEn: "English description",
		});
		expect(skillBlock(skill, { disabledPlugins: ["custom-plugin"], disabledExtensions: [] })?.blockedBy).toBe(
			"custom-plugin",
		);
		expect(skill.name).toBe("third-party");
	});

	it("重载等待期间隐藏快捷入口，并拦截手工输入的旧技能命令", async () => {
		const emit = vi.fn();
		const service = new SlashCommandsService({
			emit,
			cwd: () => dir,
			newChat: async () => {},
			setModel: async () => {},
			setCwd: async () => {},
			setThinking() {},
			refreshSessions: async () => {},
			getSkills: () => [{ name: "api-test-workflow", description: "English" }],
			isSkillEnabled: () => false,
		});
		await service.push();
		expect(emit.mock.calls[0][0]).toMatchObject({
			type: "slash_commands",
			commands: expect.not.arrayContaining([expect.objectContaining({ source: "skill" })]),
		});
		expect(await service.exec("skill:api-test-workflow", "")).toBe(true);
		expect(emit.mock.calls.at(-1)?.[0]).toMatchObject({ type: "notice", level: "warning" });
	});

	it("@中文别名补全保持原始技能引用", () => {
		expect(
			mapSkillHits(
				"技能",
				[{ name: "skill:api-test-workflow", source: "skill", displayName: "接口自动化测试" }],
				"接口",
			)[0],
		).toMatchObject({ title: "接口自动化测试", text: "@skill:api-test-workflow" });
	});
});
