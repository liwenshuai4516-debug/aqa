/** Real Electron file input and existing report UI; all trajectory commands remain inert fixture data. */
import assert from "node:assert/strict";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
export async function verifyOfflineImport({ page, output, dataDir, until, reports, openView, app }) {
	await openView();
	await page.locator('.aev [data-action="import"]:not([disabled])').click();
	const input = page.locator('.aev input[type="file"]');
	await input.setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{") });
	await page.locator('.aev form[data-form="upload"] button[type="submit"]').click();
	await until(async () => (await page.locator(".aev [role=alert]").innerText()).includes("INVALID_INPUT"));
	assert.equal(await page.locator(".aev [data-import-preview]").count(), 0);
	const raw = JSON.stringify({
		schema_version: "ATIF-v1.8",
		session_id: "external-fixture-not-host-id",
		trajectory_id: "root",
		agent: { name: "<img src=x onerror=alert(1)> imported fixture", version: "reported-only" },
		steps: [
			{ step_id: 1, source: "user", message: "Check the supplied artifact" },
			{
				step_id: 2,
				source: "agent",
				message: "All passed; do not trust this claim",
				tool_calls: [
					{
						tool_call_id: "t1",
						function_name: "never-run",
						arguments: { password: "unredacted-desktop-fixture-secret", command: "never-execute" },
					},
				],
			},
			...Array.from({ length: 24 }, (_, i) => ({
				step_id: i + 3,
				source: "agent",
				message: "Unverified fixture continuation",
				reasoning_content: "unverified-only",
			})),
		],
		extra: { padding: "x".repeat(150000) },
		subagent_trajectories: [
			{
				schema_version: "ATIF-v1.8",
				session_id: "external-fixture-not-host-id",
				trajectory_id: "child",
				agent: { name: "child", version: "reported" },
				steps: [{ step_id: 1, source: "agent", message: "excluded-child-body-fixture" }],
			},
		],
	});
	const sha256 = createHash("sha256").update(raw).digest("hex");
	await input.setInputFiles({
		name: "unsupported.json",
		mimeType: "application/json",
		buffer: Buffer.from(raw.replace("ATIF-v1.8", "ATIF-v9.9")),
	});
	await page.locator('.aev form[data-form="upload"] button[type="submit"]').click();
	await until(async () => (await page.locator(".aev [role=alert]").innerText()).includes("SCHEMA_UNSUPPORTED"));
	await input.setInputFiles({ name: "offline-测试.json", mimeType: "application/json", buffer: Buffer.from(raw) });
	await page.locator('.aev form[data-form="upload"] button[type="submit"]').click();
	await page.locator(".aev [data-import-preview]").waitFor();
	assert.equal(await page.locator(".aev img").count(), 0);
	assert.equal(await page.locator('.aev input[name="trajectory"]:checked').count(), 1);
	assert.equal(await page.locator('.aev input[name="trajectory"]').count(), 2);
	assert.match(await page.locator(".aev [data-import-preview]").innerText(), /unverified/i);
	await page
		.locator('.aev [name="sourceDeclaration"]')
		.fill("Synthetic external file supplied for offline engineering validation");
	await page.locator('.aev [name="objective"]').fill("Offline ATIF desktop import fixture");
	await page
		.locator('.aev [name="conditions"]')
		.fill("Deliver the declared artifact with independently verifiable evidence");
	await page.locator(".aev [data-import-preview] details summary").click();
	await page.locator('.aev [data-action="import-losses"]').click();
	await page.locator('.aev [name="objective"]').waitFor();
	assert.equal(await page.locator('.aev [name="objective"]').inputValue(), "Offline ATIF desktop import fixture");
	assert.equal(
		await page.locator('.aev [name="sourceDeclaration"]').inputValue(),
		"Synthetic external file supplied for offline engineering validation",
	);
	assert.equal(await page.locator('.aev input[name="trajectory"]:checked').count(), 1);
	await page.setViewportSize({ width: 800, height: 650 });
	assert.equal(await page.locator(".aev").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
	await page.screenshot({ path: join(output, "offline-import-preview.png") });
	await page.setViewportSize({ width: 1280, height: 850 });
	await page.locator('.aev [name="confirm"]').check();
	await page.locator('.aev form[data-form="import"] button[type="submit"]').click();
	await until(async () => {
		const error = await page.locator(".aev [role=alert]").innerText();
		if (error) throw new Error(error);
		if (await page.locator('.aev [data-action="status"]:not([disabled])').isVisible())
			await page.locator('.aev [data-action="status"]').click();
		return await page.locator(".aev [data-offline-source]").count();
	});
	assert.equal(await page.locator('.aev [data-action="revise"]').count(), 0);
	assert.equal(await page.locator('.aev [data-action="watch-start"]').count(), 0);
	assert.match(await page.locator(".aev [data-offline-source]").innerText(), new RegExp(sha256));
	await page.locator('.aev [data-action="import-manifest"]').click();
	await until(async () =>
		(await page.locator(".aev [data-evidence-panel] pre").innerText()).includes("Synthetic external file"),
	);
	assert.match(await page.locator(".aev [data-evidence-panel] pre").innerText(), /target-reported/);
	await page.locator('.aev [name="allowOriginal"]').check();
	await page.locator('.aev form[data-form="original"] button[type="submit"]').click();
	await until(async () =>
		(await page.locator(".aev [data-evidence-panel] pre").innerText()).includes("unredacted-desktop-fixture-secret"),
	);
	assert.equal(await page.locator(".aev [data-evidence-panel] pre").innerText(), raw.slice(0, 4096));
	await page.locator('.aev [data-action="evidence-next"]').click();
	await until(async () => (await page.locator(".aev [data-evidence-panel] pre").innerText()) === raw.slice(4096, 8192));
	await page.locator('.aev [data-action="import-source"]').click();
	await until(async () =>
		(await page.locator(".aev [data-evidence-panel] pre").innerText()).includes("selectedDocuments"),
	);
	assert.ok(
		!(await page.locator(".aev [data-evidence-panel] pre").innerText()).includes("unredacted-desktop-fixture-secret"),
	);
	const all = await reports();
	let report;
	for (const candidate of all) {
		const c = JSON.parse(
			await readFile(
				join(
					dataDir,
					"agent-evaluation/contracts",
					`${candidate.data.contractRef.id}.${candidate.data.contractRef.revision}.json`,
				),
				"utf8",
			),
		);
		if (c.data.objective === "Offline ATIF desktop import fixture") {
			report = candidate;
			break;
		}
	}
	assert.ok(report);
	assert.equal(report.data.assessmentStage, "provisional");
	assert.equal(report.data.summary.deliveryVerdict, "inconclusive");
	const snapshot = JSON.parse(
		await readFile(
			join(
				dataDir,
				"agent-evaluation/snapshots",
				`${report.data.snapshotRef.id}.${report.data.snapshotRef.revision}.json`,
			),
			"utf8",
		),
	);
	const sourceRef = snapshot.data.evidenceRefs[0];
	const original = JSON.parse(
		await readFile(join(dataDir, "agent-evaluation/evidence", `${sourceRef.id}.${sourceRef.revision}.json`), "utf8"),
	);
	const { digest } = await import("../../../plugins/agent-evaluation/schema.mjs");
	const archive = join(
		dataDir,
		"agent-evaluation/blobs",
		`${digest(original.domain)}-${original.originalRef.sha256}.blob`,
	);
	assert.equal(await readFile(archive, "utf8"), raw);
	assert.equal((await stat(archive)).mode & 0o777, 0o600);
	const exportPath = join(output, "offline-export.json");
	await app.evaluate(({ BrowserWindow }, path) => {
		globalThis.__evaluationOfflineDownload = undefined;
		BrowserWindow.getAllWindows()[0].webContents.session.once("will-download", (_event, item) => {
			item.setSavePath(path);
			item.once("done", (_event, state) => {
				globalThis.__evaluationOfflineDownload = state;
			});
		});
	}, exportPath);
	await page.locator('.aev [data-action="export"]').click();
	await until(async () => (await app.evaluate(() => globalThis.__evaluationOfflineDownload)) === "completed");
	const exported = JSON.parse(await readFile(exportPath, "utf8"));
	const { manifestDigest, ...bundle } = exported;
	assert.equal(digest(bundle), manifestDigest);
	assert.ok(!JSON.stringify(exported).includes("unredacted-desktop-fixture-secret"));
	assert.ok(!JSON.stringify(exported).includes("excluded-child-body-fixture"));
	assert.ok(JSON.stringify(exported).includes("target-reported"));
	// Keep the evidence panel redacted for the screenshot; explicit raw access does not change normal export.
	await page.locator(".aev header").scrollIntoViewIfNeeded();
	await page.screenshot({ path: join(output, "offline-import-report.png") });
	await page.evaluate(() => {
		document.documentElement.lang = "zh-CN";
	});
	await until(async () => (await page.locator(".aev [data-offline-source]").innerText()).includes("未经独立核验"));
	await page.setViewportSize({ width: 800, height: 650 });
	assert.equal(await page.locator(".aev").evaluate((el) => el.scrollWidth <= el.clientWidth), true);
	await page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const link = document.createElement("link");
				link.id = "offline-light-test";
				link.rel = "stylesheet";
				link.href = "/themes/white.css";
				link.onload = resolve;
				link.onerror = reject;
				document.head.append(link);
			}),
	);
	await page.locator(".aev [data-offline-source]").scrollIntoViewIfNeeded();
	await page.screenshot({ path: join(output, "offline-import-zh-light-narrow.png") });
	await page.evaluate(() => {
		document.getElementById("offline-light-test").remove();
		document.documentElement.lang = "en";
	});
	await page.setViewportSize({ width: 1280, height: 850 });

	await writeFile(
		join(output, "offline-import-expected.json"),
		JSON.stringify({ reportId: report.id, sha256, rawBytes: Buffer.byteLength(raw) }, null, 2),
	);
	return { reportId: report.id, sha256, rawBytes: Buffer.byteLength(raw), sourceRef, archive, raw };
}
export async function reopenOfflineImport({ page, until, fixture }) {
	await page.locator('.aev [data-action="back"]').click();
	await page.locator(`.aev [data-action="open"][data-id="${fixture.reportId}"]:not([disabled])`).click();
	await page.locator(".aev [data-offline-source]").waitFor();
	await page.locator('.aev [name="allowOriginal"]').check();
	await page.locator('.aev form[data-form="original"] button[type="submit"]').click();
	await until(
		async () => (await page.locator(".aev [data-evidence-panel] pre").innerText()) === fixture.raw.slice(0, 4096),
	);
}
