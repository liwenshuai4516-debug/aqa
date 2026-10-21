// Observe the original File System Access picker without substituting its result.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const endpoint = process.argv[2];
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint));
const output = resolve(process.argv[3]);
assert(!existsSync(output), "Preserve evidence");
const expectedPath = process.argv[4];
const expected = Buffer.from("504b0506000000000000000000000000000000000000", "hex");
const result = {
	status: "FAIL",
	instrumentation:
		"Passive wrapper calls original picker with unchanged arguments and returns original handle; postflight reads handle only",
	checks: [],
};
let browser;
try {
	browser = await chromium.connectOverCDP(endpoint);
	const page = browser.contexts()[0].pages()[0];
	const pageProtocol = await page.context().newCDPSession(page);
	await pageProtocol.send("Page.setInterceptFileChooserDialog", { enabled: false });
	const browserProtocol = await browser.newBrowserCDPSession();
	await browserProtocol.send("Browser.setDownloadBehavior", { behavior: "default" });
	await page.reload();
	await page.locator(".file-item.file").first().waitFor();
	await page.evaluate(() => {
		const original = window.__originalNativeSavePicker ?? window.showSaveFilePicker;
		window.__originalNativeSavePicker = original;
		window.__nativeSaveTrace = { state: "not-called" };
		window.showSaveFilePicker = async function (...args) {
			window.__nativeSaveTrace = { state: "opened", suggestedName: args[0]?.suggestedName, openedAt: Date.now() };
			try {
				const handle = await Reflect.apply(original, this, args);
				window.__nativeSaveHandle = handle;
				window.__nativeSaveTrace = {
					...window.__nativeSaveTrace,
					state: "selected",
					name: handle.name,
					kind: handle.kind,
				};
				return handle;
			} catch (error) {
				window.__nativeSaveTrace = {
					...window.__nativeSaveTrace,
					state: "rejected",
					errorName: error.name,
					errorMessage: error.message,
					rejectedAt: Date.now(),
				};
				throw error;
			}
		};
	});
	const row = page
		.locator(".panel-right .file-item.file")
		.filter({ has: page.locator(".file-name-text", { hasText: "报告.zip" }) });
	await row.hover();
	await row.locator("button.file-attach.download").click();
	console.log("ORIGINAL_NATIVE_SAVE_OPENED");
	const deadline = Date.now() + 900000;
	while (Date.now() < deadline) {
		const trace = await page.evaluate(async () => {
			const state = { ...window.__nativeSaveTrace };
			if (window.__nativeSaveHandle) {
				const file = await window.__nativeSaveHandle.getFile();
				state.bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
			}
			return state;
		});
		result.trace = trace;
		if (trace.state === "rejected") throw new Error(`Original picker rejected: ${trace.errorName}`);
		if (trace.bytes && Buffer.from(trace.bytes).equals(expected)) {
			assert.equal(trace.suggestedName, "报告.zip");
			assert.equal(trace.name, "报告.zip");
			result.checks.push(
				"Original picker suggested and returned Chinese filename",
				"Original FileSystemFileHandle reads exact persisted ZIP bytes",
			);
			result.fileSha256 = createHash("sha256").update(expected).digest("hex");
			result.expectedPathExists = existsSync(expectedPath);
			if (result.expectedPathExists) {
				assert(readFileSync(expectedPath).equals(expected));
				result.checks.push("Host file at user-confirmed destination matches exact ZIP bytes");
			}
			result.status = "PASS";
			break;
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	assert.equal(result.status, "PASS", "Native save observation timed out");
} catch (error) {
	result.error = error.message;
	process.exitCode = 1;
} finally {
	await browser?.close().catch(() => {});
	writeFileSync(output, JSON.stringify(result, null, 2));
	console.log(JSON.stringify(result, null, 2));
}
