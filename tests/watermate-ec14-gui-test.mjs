/**
 * Manual EC14 probe for an already-launched, isolated WaterMate window.
 * It never opens a profile, reads authentication data, or submits work unless
 * the caller explicitly enables the submission scenario.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const option = (name) => {
	const index = args.indexOf(name);
	return index < 0 ? undefined : args[index + 1];
};
const scenario = option("--scenario") ?? "observe";
assert.ok(["observe", "input", "submit", "stop", "handoff"].includes(scenario), "Unknown WaterMate EC14 scenario");

const cdpUrl = option("--cdp-url") ?? process.env.WATERMATE_EC14_CDP_URL;
assert.ok(cdpUrl, "Provide --cdp-url for the isolated WaterMate CDP endpoint");
const endpoint = new URL(cdpUrl);
assert.equal(endpoint.protocol, "http:", "WaterMate CDP must use HTTP loopback");
assert.ok(["127.0.0.1", "localhost"].includes(endpoint.hostname), "WaterMate CDP must stay on loopback");
assert.ok(Number(endpoint.port) >= 8900, "WaterMate CDP port must be at least 8900");

const allowSubmit = process.env.WATERMATE_EC14_ALLOW_SUBMIT === "1";
const task = process.env.WATERMATE_EC14_TASK;
const expected = process.env.WATERMATE_EC14_EXPECTED;
if (["submit", "stop", "handoff"].includes(scenario)) {
	assert.equal(allowSubmit, true, "Submission requires WATERMATE_EC14_ALLOW_SUBMIT=1");
	assert.match(task ?? "", /^[\x20-\x7e\n]{1,512}$/, "Use a bounded plain-text EC14 task");
}
if (scenario === "submit") assert.match(expected ?? "", /^[\x20-\x7e]{1,128}$/, "Provide a bounded expected marker");

const browser = await chromium.connectOverCDP(endpoint.href);
try {
	const contexts = browser.contexts();
	assert.equal(contexts.length, 1, "Expected one isolated WaterMate browser context");
	const pages = contexts[0].pages();
	assert.equal(pages.length, 1, "Expected one isolated WaterMate window");
	const page = pages[0];
	const userAgent = await page.evaluate(() => navigator.userAgent);
	assert.match(userAgent, /WaterMate\/1\.0\.0/, "Expected the pinned WaterMate 1.0.0 client");

	const input = page.locator('textarea[placeholder="和 WaterMate 一起工作"]');
	const send = page.locator('button[aria-label="发送"]');
	await input.waitFor();
	await send.waitFor();
	const result = {
		status: "PASS",
		scenario,
		observedAt: new Date().toISOString(),
		target: "WaterMate/1.0.0",
		pageCount: pages.length,
		inputVisible: await input.isVisible(),
		sendDisabledBefore: await send.isDisabled(),
		submission: "none",
	};

	if (scenario === "input") {
		await input.pressSequentially("EC14_INPUT_PROBE");
		await send.waitFor({ state: "visible" });
		assert.equal(await send.isDisabled(), false, "Input must enable send without submitting work");
		await input.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
		await input.press("Backspace");
		await page.waitForFunction(() => document.querySelector('button[aria-label="发送"]')?.disabled === true);
		result.sendDisabledAfter = await send.isDisabled();
		result.submission = "not-requested";
	}

	if (["submit", "stop"].includes(scenario)) {
		await input.pressSequentially(task);
		assert.equal(await send.isDisabled(), false, "Task input must enable send before submission");
		await send.click();
		result.submission = "submitted";
	}

	if (scenario === "handoff") {
		await input.pressSequentially(task);
		assert.equal(await send.isDisabled(), false, "Task input must enable send before submission");
		await send.click();
		result.submission = "submitted";
		const stop = page.getByRole("button", { name: /^(停止|Stop)$/ });
		const running = await stop
			.waitFor({ timeout: 5000 })
			.then(() => true)
			.catch(() => false);
		if (!running) {
			result.status = "NO_RUNNING_CONTROL";
			result.manualHandoffObserved = false;
		} else {
			console.log(JSON.stringify({ ...result, status: "HANDOFF_READY" }));
			await stop.waitFor({ state: "hidden", timeout: 120000 });
			result.manualHandoffObserved = true;
		}
	}

	if (scenario === "submit") {
		await page.getByText(expected, { exact: true }).waitFor({ timeout: 30000 });
		result.expectedMarkerVisible = true;
	}

	if (scenario === "stop") {
		const stop = page.getByRole("button", { name: /^(停止|Stop)$/ });
		await stop.waitFor({ timeout: 5000 });
		await stop.click();
		await stop.waitFor({ state: "hidden", timeout: 30000 });
		result.stopRequested = true;
	}

	console.log(JSON.stringify(result));
} finally {
	await browser.close();
}
