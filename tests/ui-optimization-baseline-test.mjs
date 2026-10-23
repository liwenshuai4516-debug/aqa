/** U00 target calibration only; not a model review, formal run or Electron acceptance. */
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import { CHROME_PATH } from "./lib/chrome.mjs";
import { setupUiFixture } from "./fixtures/data-space/ui-fixture.mjs";
import { optimizationScope } from "./fixtures/data-space/ui-optimization-page.mjs";
const normal = await setupUiFixture({ optimization: true });
const faulty = await setupUiFixture({ optimization: true, discardPersistence: true });
let browser;
const started = performance.now();
const assertions = [];
async function check(id, verify) {
	await verify();
	assertions.push(id);
}
try {
	assert.notEqual(new URL(normal.url).origin, new URL(faulty.url).origin);
	browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(normal.url);
	const ready = () =>
		page
			.getByRole("status")
			.filter({ hasText: /^Ready$/ })
			.waitFor();
	await ready();
	await check("paging:two-rows", async () => assert.equal(await page.getByRole("listitem").count(), 2));
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await ready();
	await check("paging:next", async () => assert.equal(await page.getByRole("listitem").innerText(), "Gamma"));
	await page.getByRole("button", { name: "Previous", exact: true }).click();
	await ready();
	await check("paging:previous", async () => assert.equal(await page.locator("#page").innerText(), "1"));
	await page.getByLabel("Query").fill("Gamma");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await ready();
	await check("search:filter", async () => assert.equal(await page.getByRole("listitem").innerText(), "Gamma"));
	await page.getByRole("button", { name: "Reset", exact: true }).click();
	await ready();
	await check("search:reset", async () =>
		assert.deepEqual(await page.getByRole("listitem").allTextContents(), ["Alpha", "Beta"]),
	);
	await check("permission:tester", async () =>
		assert.equal(await page.getByRole("button", { name: "Add", exact: true }).isVisible(), true),
	);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await check("edit:open", async () => assert.equal(await page.getByRole("dialog").isVisible(), true));
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await check("edit:cancel", async () => assert.equal(await page.getByRole("dialog").isVisible(), false));
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await page.getByLabel("Name", { exact: true }).fill("Owned-name");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await page.reload();
	await check("edit:persistence", async () =>
		assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("names")).includes("Owned-name"))),
	);
	await page.getByRole("tab", { name: "About", exact: true }).click();
	await check("details:tab", async () => assert.equal(await page.locator("#about-panel").isVisible(), true));
	await page.getByText("Details", { exact: true }).click();
	await check("details:expanded", async () =>
		assert.equal(await page.getByText("Fixture version u00-1", { exact: true }).isVisible(), true),
	);
	await page.getByRole("tab", { name: "List", exact: true }).click();
	await page.getByLabel("Query").fill("Missing");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await check("states:loading", async () => assert.equal(await page.getByRole("status").innerText(), "Loading"));
	await page
		.getByRole("status")
		.filter({ hasText: /^Empty$/ })
		.waitFor();
	await check("states:empty", async () => assert.equal(await page.getByRole("listitem").count(), 0));
	await page.getByRole("button", { name: "Simulate error", exact: true }).click();
	await page
		.getByRole("status")
		.filter({ hasText: /^Error loading names$/ })
		.waitFor();
	assertions.push("states:error");
	await page.goto(normal.url + "/?role=viewer");
	await check("permission:viewer", async () =>
		assert.equal(await page.getByRole("button", { name: "Add", exact: true }).count(), 0),
	);
	await page.goto(faulty.url);
	await page.getByRole("button", { name: "Add", exact: true }).click();
	await page.getByLabel("Name", { exact: true }).fill("Owned-name");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await page.reload();
	await check("fault:persistence-detected", async () =>
		assert.equal(await page.evaluate(() => localStorage.getItem("names")), null),
	);
	await context.close();
	console.log(
		JSON.stringify({
			kind: "fixture-calibration",
			scope: optimizationScope.version,
			assertions,
			passed: assertions.length,
			elapsedMs: performance.now() - started,
			browserLaunches: 1,
			modelCalls: 0,
			formalRunnerCalls: 0,
		}),
	);
} finally {
	await browser?.close();
	for (const fixture of [normal, faulty]) {
		await fixture.close();
		await rm(dirname(fixture.project), { recursive: true, force: true });
	}
}
