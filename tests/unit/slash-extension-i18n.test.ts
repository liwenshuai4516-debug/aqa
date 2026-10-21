import { describe, expect, it, vi } from "vitest";
import { SlashCommandsService } from "../../server/slash-commands.js";

async function extensionCatalog(commands: Record<string, unknown>[]) {
	const emit = vi.fn();
	const service = new SlashCommandsService({
		emit,
		getSession: () =>
			({
				extensionRunner: { getRegisteredCommands: () => commands },
			}) as any,
	} as any);
	await service.push();
	return emit.mock.calls[0][0].commands;
}

describe("extension command descriptions", () => {
	it("forwards Chinese and the original English for language switching", async () => {
		const commands = await extensionCatalog([
			{ invocationName: "goal", description: "Draft a goal", descriptionZh: "规划目标" },
		]);
		expect(commands.find((c: any) => c.name === "goal")).toEqual({
			name: "goal",
			description: "规划目标",
			descriptionEn: "Draft a goal",
			source: "extension",
		});
		expect(commands.find((c: any) => c.name === "new").source).toBe("builtin");
	});

	it("keeps the original description when translation is missing or empty", async () => {
		const commands = await extensionCatalog([
			{ invocationName: "legacy", description: "Original description" },
			{ invocationName: "empty", description: "Fallback", descriptionZh: "" },
		]);
		expect(commands.find((c: any) => c.name === "legacy").description).toBe("Original description");
		expect(commands.find((c: any) => c.name === "empty").description).toBe("Fallback");
	});

	it("preserves explicitly provided English metadata", async () => {
		const commands = await extensionCatalog([
			{ invocationName: "dual", description: "默认描述", descriptionEn: "English description" },
		]);
		expect(commands.find((c: any) => c.name === "dual")).toMatchObject({
			description: "默认描述",
			descriptionEn: "English description",
		});
	});

	it("keeps native command precedence and SDK invocation aliases", async () => {
		const commands = await extensionCatalog([
			{ invocationName: "new", description: "Collision", descriptionZh: "冲突" },
			{ invocationName: "new:2", description: "Alias", descriptionZh: "别名" },
		]);
		expect(commands.filter((c: any) => c.name === "new")).toHaveLength(1);
		expect(commands.find((c: any) => c.name === "new").source).toBe("builtin");
		expect(commands.find((c: any) => c.name === "new:2")).toMatchObject({
			description: "别名",
			descriptionEn: "Alias",
			source: "extension",
		});
	});
});
