/** Optional actual Electron long-evidence/read-error matrix. Only its isolated fixture storage is touched. */
import assert from "node:assert/strict";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readPackIndex } from "../../../plugins/agent-evaluation/pack.mjs";
import { LIMITS } from "../../../plugins/agent-evaluation/schema.mjs";
export const longEvidenceText =
	'Offline source navigation fixture; no model was called. 长正文😀 <img src=x onerror="window.__aevEvidenceInjected=true"> ' +
	"Z".repeat(160000) +
	" 末尾凭据样本 Bearer synthetic-only-evidence-secret END-OF-LONG-FIXTURE";
const sha = (text) => createHash("sha256").update(text).digest("hex");
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
// Measure the actual UI action through its asynchronous reply/render and two animation frames.
// This includes transport and rendering; it is not the server-only EC00 latency metric.
export async function paintedAction(page, selector, readySelector) {
	return page.evaluate(
		async ({ selector, readySelector }) => {
			const root = document.querySelector(".aev"),
				button = root.querySelector(selector);
			if (!button || button.disabled) throw new Error(`Missing enabled matrix action: ${selector}`);
			const started = performance.now();
			await new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					observer.disconnect();
					reject(new Error(`Matrix render timed out: ${selector}`));
				}, 10000);
				const observer = new MutationObserver(() => {
					const ready = root.querySelector(readySelector);
					if (!ready || ready.disabled) return;
					observer.disconnect();
					clearTimeout(timer);
					requestAnimationFrame(() => requestAnimationFrame(resolve));
				});
				observer.observe(root, { childList: true, subtree: true });
				button.click();
			});
			return performance.now() - started;
		},
		{ selector, readySelector },
	);
}
export async function verifyEvidenceMatrix({ page, output, dataDir, repo, original, exported, names, until }) {
	const evidence = exported.records.find((r) => r.kind === "evidence" && r.data.sourceEventId === "a1");
	assert.ok(evidence?.data.content, "The seeded long assistant message must be in the real sealed export");
	const expected = evidence.data.content;
	assert.equal(
		JSON.parse(expected).message.content[0].text,
		longEvidenceText.replace(/Bearer .+ END-OF-LONG-FIXTURE$/, "Bearer [REDACTED] END-OF-LONG-FIXTURE"),
	);
	assert.ok(expected.length > 128 * 1024);
	assert.ok(!expected.includes("synthetic-only-evidence-secret"));
	const finding = original.data.findings.findIndex((f) => f.evidenceRefs.some((r) => r.id === evidence.id));
	assert.ok(finding >= 0 && finding < 10, "The selected finding must be on the first real report page");
	const position = original.data.findings[finding].evidenceRefs.findIndex((r) => r.id === evidence.id);
	const selector = `[data-action="evidence"][data-finding="${finding}"][data-evidence="${position}"]`;
	const stateBefore = Object.fromEntries(
		await Promise.all(
			["attempts", "snapshots", "evaluations", "reviews"].map(async (kind) => [kind, await names(kind)]),
		),
	);
	const reportPath = join(dataDir, "agent-evaluation/evaluations", `${original.id}.1.json`),
		reportBefore = await readFile(reportPath);
	const durations = { list: [], report: [], evidence: [] };
	for (let round = 0; round < 5; round++) {
		durations.list.push(
			await paintedAction(page, '[data-action="back"]', `[data-action="open"][data-id="${original.id}"]`),
		);
		durations.report.push(await paintedAction(page, `[data-action="open"][data-id="${original.id}"]`, selector));
		durations.evidence.push(await paintedAction(page, selector, '[data-action="evidence-next"]'));
		assert.equal(await page.locator(".aev [role=alert]").innerText(), "");
	}
	const pages = [];
	let combined = "";
	for (;;) {
		const text = await page.locator(".aev [data-evidence-panel] pre").textContent();
		assert.equal(text, expected.slice(combined.length, combined.length + 4096));
		assert.ok(text.length <= 4096);
		pages.push({ offset: combined.length, characters: text.length, sha256: sha(text) });
		combined += text;
		assert.equal(
			await page.locator(".aev [data-evidence-panel]").evaluate((el) => el === document.activeElement),
			true,
		);
		assert.equal(await page.locator(".aev [data-evidence-panel] img").count(), 0);
		if (!(await page.locator('.aev [data-action="evidence-next"]').count())) break;
		assert.ok(pages.length < 100, "Fixture paging must terminate within its declared size");
		await paintedAction(page, '[data-action="evidence-next"]', '[data-action="evidence-first"]');
	}
	assert.equal(combined, expected);
	assert.equal(await page.evaluate(() => window.__aevEvidenceInjected ?? false), false);
	await paintedAction(page, '[data-action="evidence-first"]', '[data-action="evidence-next"]');
	assert.equal(await page.locator(".aev [data-evidence-panel] pre").textContent(), expected.slice(0, 4096));
	await page.locator(".aev [data-evidence-panel]").scrollIntoViewIfNeeded();
	await page.setViewportSize({ width: 800, height: 650 });
	const layout = await page.locator(".aev").evaluate((root) => {
		const panel = root.querySelector("[data-evidence-panel]"),
			pre = panel.querySelector("pre");
		return {
			rootFits: root.scrollWidth <= root.clientWidth,
			panelFits: panel.scrollWidth <= panel.clientWidth,
			preFits: pre.scrollWidth <= pre.clientWidth,
			characters: pre.textContent.length,
		};
	});
	assert.equal(layout.rootFits, true);
	assert.equal(layout.panelFits, true);
	assert.equal(layout.preFits, true);
	await page.screenshot({ path: join(output, "long-evidence-narrow.png") });
	await page.setViewportSize({ width: 1280, height: 850 });
	// Temporarily withhold only this fixture's pack. A read must show the actual error,
	// retain the old sealed view, and recover from an explicit retry after restoration.
	const directory = join(dataDir, "agent-evaluation/evidence");
	const matches = [];
	for (const file of await readdir(directory)) {
		if (!file.endsWith(".pack")) continue;
		const bytes = await readFile(join(directory, file));
		const records = readPackIndex((offset, length) => bytes.subarray(offset, offset + length), bytes.length, LIMITS);
		if (
			records.some(
				([offset, length]) => JSON.parse(bytes.subarray(offset, offset + length).toString("utf8")).id === evidence.id,
			)
		)
			matches.push(file);
	}
	assert.equal(matches.length, 1);
	const file = join(directory, matches[0]),
		held = join(output, "withheld-evidence.pack"),
		bytes = await readFile(file);
	let errorText;
	await rename(file, held);
	try {
		await page.locator(`.aev ${selector}`).click();
		await until(async () => (await page.locator(".aev [role=alert]").innerText()).includes("ENOENT"));
		errorText = await page.locator(".aev [role=alert]").innerText();
		assert.ok((await page.locator(".aev article h3").count()) > 0);
		assert.equal(await page.locator(".aev [data-evidence-panel] pre").textContent(), expected.slice(0, 4096));
		assert.equal(await page.locator(`.aev ${selector}`).isEnabled(), true);
		await page.locator(".aev [role=alert]").scrollIntoViewIfNeeded();
		await page.screenshot({ path: join(output, "evidence-read-error.png") });
	} finally {
		await rename(held, file);
	}
	assert.deepEqual(await readFile(file), bytes);
	await paintedAction(page, selector, '[data-action="evidence-next"]');
	assert.equal(await page.locator(".aev [role=alert]").innerText(), "");
	assert.equal(await page.locator(".aev [data-evidence-panel] pre").textContent(), expected.slice(0, 4096));
	assert.deepEqual(await readFile(reportPath), reportBefore);
	for (const [kind, before] of Object.entries(stateBefore)) assert.deepEqual(await names(kind), before);
	const installed = [];
	for (const file of [
		"manifest.json",
		"index.mjs",
		"service.mjs",
		"store.mjs",
		"collect.mjs",
		"client/entry.mjs",
		"client/transport.mjs",
		"client/style.mjs",
	]) {
		const actual = await readFile(join(dataDir, "plugins/agent-evaluation", file)),
			source = await readFile(join(repo, "plugins/agent-evaluation", file));
		assert.deepEqual(actual, source);
		installed.push({ file, sha256: sha(actual) });
	}
	const result = {
		status: "PASS",
		scope:
			"actual macOS arm64 Electron, synthetic 160K assistant evidence; latency includes transport/render/two animation frames",
		expectedCharacters: expected.length,
		listRows: stateBefore.evaluations.length,
		reportFindings: original.data.findings.length,
		expectedSha256: sha(expected),
		pages,
		layout,
		durations,
		mediansMs: Object.fromEntries(Object.entries(durations).map(([key, values]) => [key, median(values)])),
		error: { code: "ENOENT", message: errorText, restoredBytesUnchanged: true, retrySucceeded: true },
		oldReportBytesUnchanged: true,
		readOnlyRecordCountsUnchanged: true,
		installed,
		actualModelCalls: 0,
		actualCliCalls: 0,
	};
	await writeFile(join(output, "evidence-matrix.json"), JSON.stringify(result, null, 2));
	return result;
}
