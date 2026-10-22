import { test as base, expect } from "@playwright/test";
import { waitAttachSettled } from "../../tests/lib/attach-settle.mjs";
import { createProjectEnvironment } from "./project-environment.mjs";

export const test = base.extend({
	projectEnvironment: [
		async ({}, use) => {
			const fixture = await createProjectEnvironment();
			try {
				await use(fixture);
			} finally {
				await fixture.dispose();
			}
		},
		{ scope: "worker" },
	],
	page: async ({ page, projectEnvironment }, use) => {
		await page
			.context()
			.addCookies([
				{ name: "pi_web_token", value: encodeURIComponent(projectEnvironment.token), url: projectEnvironment.url },
			]);
		let ready = false,
			marker = false,
			snapshot;
		page.on("websocket", (socket) =>
			socket.on("framereceived", ({ payload }) => {
				const frame = JSON.parse(String(payload));
				if (frame.type === "ready") ready = true;
				if (frame.type === "scheduler_tasks") marker = true;
				if (frame.type === "snapshot") snapshot = frame.state;
			}),
		);
		await page.goto(projectEnvironment.url);
		expect(await waitAttachSettled({ sawReady: () => ready, sawMarker: () => marker })).toBe(true);
		expect(snapshot?.cwd).toBe(projectEnvironment.workDir);
		expect(snapshot?.messages).toEqual([]);
		// This fixture intentionally has no model key. Dismiss onboarding through
		// its real UI; do not configure a personal provider or send a prompt.
		await page.locator(".setup-modal .modal-close").click();
		await expect(page.locator(".app")).toBeVisible();
		await use(page);
	},
});
export { expect };
