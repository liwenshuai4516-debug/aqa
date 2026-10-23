// U05 source-only candidate. Expectations come from frozen u00-1 declarations.
// This file is statically checked; review and diagnostic admission are still required.
import { test, expect } from "playwright/test";

test.beforeEach(async ({ page }) => {
	await page.goto("/?role=tester");
	await expect(page.locator("#identity")).toHaveText("Role: tester");
	await expect(page.getByRole("status")).toHaveText("Ready");
});

test("C-search Query and reset", async ({ page }) => {
	await test.step("A-search-1 Query filters names", async () => {
		await page.getByLabel("Query", { exact: true }).fill("Gamma");
		await page.getByRole("button", { name: "Search", exact: true }).click();
		await expect(page.getByRole("listitem")).toHaveText(["Gamma"]);
	});
	await test.step("A-search-2 Reset restores first page", async () => {
		await page.getByRole("button", { name: "Reset", exact: true }).click();
		await expect(page.getByLabel("Query", { exact: true })).toHaveValue("");
		await expect(page.getByRole("listitem")).toHaveText(["Alpha", "Beta"]);
		await expect(page.locator("#page")).toHaveText("1");
	});
});

test("C-edit Cancel and persisted save", async ({ page }) => {
	const ownedName = "U05-owned-item";
	await test.step("A-edit-1 Dialog opens and cancels without writes", async () => {
		await page.getByRole("button", { name: "Add", exact: true }).click();
		await expect(page.getByRole("dialog")).toBeVisible();
		await page.getByLabel("Name", { exact: true }).fill(ownedName);
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(page.getByRole("dialog")).toBeHidden();
		await page.reload();
		await page.getByLabel("Query", { exact: true }).fill(ownedName);
		await page.getByRole("button", { name: "Search", exact: true }).click();
		await expect(page.getByRole("status")).toHaveText("Empty");
		await expect(page.getByRole("listitem")).toHaveCount(0);
	});
	await test.step("A-edit-2 Saved name survives reload once", async () => {
		await page.getByRole("button", { name: "Add", exact: true }).click();
		await page.getByLabel("Name", { exact: true }).fill(ownedName);
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await page.reload();
		await page.getByLabel("Query", { exact: true }).fill(ownedName);
		await page.getByRole("button", { name: "Search", exact: true }).click();
		await expect(page.getByRole("listitem")).toHaveText([ownedName]);
	});
});

test("C-details Tabs and disclosure", async ({ page }) => {
	await test.step("A-details-1 Tab selection changes panel", async () => {
		await page.getByRole("tab", { name: "About", exact: true }).click();
		await expect(page.getByRole("tab", { name: "About", exact: true })).toHaveAttribute("aria-selected", "true");
		await expect(page.getByRole("tab", { name: "List", exact: true })).toHaveAttribute("aria-selected", "false");
		await expect(page.locator("#about-panel")).toBeVisible();
		await expect(page.locator("#list-panel")).toBeHidden();
	});
	await test.step("A-details-2 Disclosure changes visibility", async () => {
		const version = page.getByText("Fixture version u00-1", { exact: true });
		await expect(version).toBeHidden();
		await page.getByText("Details", { exact: true }).click();
		await expect(version).toBeVisible();
		await page.getByText("Details", { exact: true }).click();
		await expect(version).toBeHidden();
	});
});

test("C-paging Filtered page boundaries", async ({ page }) => {
	// Add a nonmatching row so retained query is demonstrated by the actual result set.
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await page.getByLabel("Name", { exact: true }).fill("U05-owned-item");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await page.getByLabel("Query", { exact: true }).fill("a");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await test.step("A-paging-1 Two rows on the first page", async () => {
		await expect(page.getByRole("listitem")).toHaveText(["Alpha", "Beta"]);
		await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
		await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();
	});
	await test.step("A-paging-2 Next and previous retain query", async () => {
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await expect(page.getByRole("listitem")).toHaveText(["Gamma"]);
		await expect(page.getByLabel("Query", { exact: true })).toHaveValue("a");
		await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
		await page.getByRole("button", { name: "Previous", exact: true }).click();
		await expect(page.getByRole("listitem")).toHaveText(["Alpha", "Beta"]);
		await expect(page.getByLabel("Query", { exact: true })).toHaveValue("a");
		await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
	});
});

test("C-permission Separate viewer and tester contexts", async ({ page, browser }) => {
	await test.step("A-permission-1 Viewer cannot see Add", async () => {
		const viewer = await browser.newContext();
		try {
			const viewerPage = await viewer.newPage();
			await viewerPage.goto(new URL("/?role=viewer", page.url()).href);
			await expect(viewerPage.locator("#identity")).toHaveText("Role: viewer");
			await expect(viewerPage.getByRole("status")).toHaveText("Ready");
			await expect(viewerPage.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
			await expect(viewerPage.locator("#add")).toHaveCount(1);
			await expect(viewerPage.locator("#add")).toBeHidden();
		} finally {
			await viewer.close();
		}
	});
	await test.step("A-permission-2 Tester can see Add", async () => {
		await expect(page.locator("#identity")).toHaveText("Role: tester");
		await expect(page.getByRole("button", { name: "Add", exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
	});
});

test("C-states Loading empty and error", async ({ page }) => {
	await test.step("A-states-1 Loading precedes data", async () => {
		await page.addInitScript(() => {
			const observations: { status: string; rows: string[] }[] = [];
			(window as Window & { u05States?: typeof observations }).u05States = observations;
			new MutationObserver(() => {
				const status = document.querySelector('[role="status"]')?.textContent;
				if (status && status !== observations.at(-1)?.status)
					observations.push({
						status,
						rows: Array.from(document.querySelectorAll("li"), (row) => row.textContent || ""),
					});
			}).observe(document, { subtree: true, childList: true, characterData: true });
		});
		await page.reload();
		await expect(page.getByRole("status")).toHaveText("Ready");
		const observations = await page.evaluate(() => (window as Window & { u05States?: unknown }).u05States);
		await expect(observations).toEqual([
			{ status: "Loading", rows: [] },
			{ status: "Ready", rows: ["Alpha", "Beta"] },
		]);
	});
	await test.step("A-states-2 No matches shows empty", async () => {
		await page.getByLabel("Query", { exact: true }).fill("Missing");
		await page.getByRole("button", { name: "Search", exact: true }).click();
		await expect(page.getByRole("status")).toHaveText("Empty");
		await expect(page.getByRole("listitem")).toHaveCount(0);
	});
	await test.step("A-states-3 Failure shows error", async () => {
		await page.getByRole("button", { name: "Simulate error", exact: true }).click();
		await expect(page.getByRole("status")).toHaveText("Error loading names");
		await expect(page.getByRole("listitem")).toHaveCount(0);
	});
});
