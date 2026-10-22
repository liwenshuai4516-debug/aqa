import { test, expect } from "./project.fixture.mjs";

test("isolated app starts empty and owns synthetic data", async ({ page, projectEnvironment }) => {
	expect(projectEnvironment.preflight.status).toBe("completed");
	await expect(page.locator(".msg-user")).toHaveCount(0);
	const prepared = await projectEnvironment.createOwnedData({ purpose: "fixture-smoke" });
	expect(prepared.business_key).toMatch(/^qa-/);
	await page.locator("textarea").first().fill("仅验证草稿，不发送模型请求");
	await expect(page.locator("textarea").first()).toHaveValue("仅验证草稿，不发送模型请求");
	const records = await projectEnvironment.cleanupData();
	expect(records.every((record) => record.cleanup_state === "cleaned")).toBe(true);
});
