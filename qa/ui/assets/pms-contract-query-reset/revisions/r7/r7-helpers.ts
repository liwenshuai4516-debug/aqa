import { expect } from "pi-ui-testing/fixtures";
import { createHash } from "node:crypto";
import type { Locator, Page, Request, TestInfo } from "@playwright/test";
import { data } from "./data-all.js";

type Block = (info: TestInfo, check: string) => Promise<never>;
type Department = Readonly<{ label: string; id: string }>;
const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");

// Independent response oracle: never accepts the contract list request as input.
// Current department-n1.txt confirms data[]/children[] flattening and label/value/id separation.
// The main agent confirmed current Ne()/dn() object guards and string/number normalization unchanged.
function flattenDepartments(nodes: unknown): Department[] {
	if (!Array.isArray(nodes)) throw new Error("Department data must be an array");
	const result: Department[] = [];
	for (const node of nodes) {
		if (!node || typeof node !== "object" || Array.isArray(node)) continue;
		const item = node as Record<string, unknown>;
		if (item.id !== undefined && item.name) result.push(Object.freeze({ label: text(item.name), id: text(item.id) }));
		if (Array.isArray(item.children)) result.push(...flattenDepartments(item.children));
	}
	return result;
}

export async function freezeDepartmentFromPageResponse(page: Page, info: TestInfo, block: Block): Promise<Department> {
	// beforeEach may run after initial navigation, so explicitly capture the UI's own
	// fresh department-tree response across a reload. No direct authenticated fetch,
	// token access, request headers, request dumps or request-derived expectations.
	let raw: string;
	try {
		const [response] = await Promise.all([
			page.waitForResponse(
				(response) =>
					response.request().method() === "GET" &&
					new URL(response.url()).origin === new URL(page.url()).origin &&
					new URL(response.url()).pathname === data.departmentEndpoint,
				{ timeout: 10000 },
			),
			page.reload({ waitUntil: "domcontentloaded", timeout: 10000 }),
		]);
		if (response.status() !== 200 || (await response.finished()) !== null)
			return await block(info, "department-tree-response-not-200-or-incomplete");
		raw = await response.text();
	} catch {
		return await block(info, "independent-department-tree-response-required");
	}
	let departments: Department[];
	try {
		const payload: unknown = JSON.parse(raw);
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid tree envelope");
		departments = flattenDepartments((payload as Record<string, unknown>).data);
	} catch {
		return await block(info, "department-tree-shape-not-supported-by-frozen-source");
	}
	// Component lookup is find(value === label); duplicate labels are ambiguous.
	// Choose a non-empty ID whose label occurs exactly once in the full response.
	const choice = departments.find(
		(item) =>
			item.label.trim() !== "" &&
			item.label !== "全部" &&
			item.id.trim() !== "" &&
			departments.filter((other) => other.label === item.label).length === 1,
	);
	if (!choice) return await block(info, "independent-unambiguous-department-label-id-required");
	const frozen = Object.freeze({ ...choice });
	const controlled = (await page.locator('body[data-controlled-diagnostic="true"]').count()) === 1;
	await info.attach("department-oracle-before-query", {
		body: JSON.stringify({
			kind: controlled ? "controlled-synthetic-department-response" : "same-page-department-service-response",
			endpoint: data.departmentEndpoint,
			response_sha256: createHash("sha256").update(raw).digest("hex"),
			selected: frozen,
			frozen_before_contract_query: true,
			limits: "Current response snapshot only; controlled fixture is not real PMS department evidence.",
		}),
		contentType: "application/json",
	});
	await page.waitForLoadState("networkidle", { timeout: 10000 });
	return frozen;
}

type ListWatchResult = {
	listUnchanged: boolean;
	changesObserved: number;
	durationMs: number;
};
declare global {
	interface Window {
		__pmsR7ListWatch?: { finish: () => ListWatchResult; disconnect: () => void };
	}
}

export async function assertUnsupportedWithinWindow(
	page: Page,
	button: Locator,
	info: TestInfo,
	block: Block,
): Promise<void> {
	// beforeEach waits out initial network; establish a fresh quiet state after selection.
	await page.waitForLoadState("networkidle", { timeout: 10000 });
	const requests: Request[] = [];
	const onRequest = (request: Request) => {
		// Count all methods for this list endpoint, including wrong-method regressions.
		if (new URL(request.url()).pathname === data.endpoint) requests.push(request);
	};
	page.on("request", onRequest);
	try {
		const installed = await page.evaluate(() => {
			if (window.__pmsR7ListWatch) return false;
			const table = document.querySelector<HTMLElement>("main .contract-table");
			const pager = document.querySelector<HTMLElement>("main .el-pagination");
			const main = document.querySelector("main");
			if (!table || !pager || !main) return false;
			// A list must contain rows or an explicit Element Plus empty-state marker.
			if (!table.querySelector(".el-table__row, .el-table__empty-block")) return false;
			const baseline = JSON.stringify({ table: table.innerText, pager: pager.innerText });
			const started = performance.now();
			let changesObserved = 0;
			const sample = () => {
				const currentTable = document.querySelector<HTMLElement>("main .contract-table");
				const currentPager = document.querySelector<HTMLElement>("main .el-pagination");
				if (
					!currentTable ||
					!currentPager ||
					JSON.stringify({ table: currentTable.innerText, pager: currentPager.innerText }) !== baseline
				)
					changesObserved += 1;
			};
			// Observe the parent as well: replacing the entire table must not escape observation.
			const observer = new MutationObserver(sample);
			observer.observe(main, { subtree: true, childList: true, characterData: true, attributes: true });
			const interval = window.setInterval(sample, 50);
			const disconnect = () => {
				observer.disconnect();
				window.clearInterval(interval);
			};
			window.__pmsR7ListWatch = {
				disconnect,
				finish: () => {
					sample();
					disconnect();
					return { listUnchanged: changesObserved === 0, changesObserved, durationMs: performance.now() - started };
				},
			};
			return true;
		});
		if (!installed) return await block(info, "stable-contract-list-and-pager-observer-required");
		const message = page.locator(".el-message:visible .el-message__content");
		// Prevent accepting a stale toast from a previous operation.
		if (await message.count()) return await block(info, "fresh-unsupported-message-required");
		await button.click({ timeout: 5000 });
		await expect(message).toHaveCount(1);
		await expect(message).toHaveText(data.unsupportedMessage);
		// Deliberate negative observation: do not replace with an immediately passing expect.poll.
		// Requests are observed from before click until after this full 1500 ms window.
		await page.evaluate(
			(ms) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)),
			data.unsupportedWindowMs,
		);
		const observed = await page.evaluate(() => {
			if (!window.__pmsR7ListWatch) throw new Error("Missing list observer");
			return window.__pmsR7ListWatch.finish();
		});
		await info.attach("unsupported-window-observation", {
			body: JSON.stringify({
				...observed,
				queryCount: requests.length,
				minimumWindowAfterMessageMs: data.unsupportedWindowMs,
				limits:
					"Only the observed interval; no claim about later requests or list changes. MutationObserver plus 50ms samples; no raw rows/headers/tokens exported.",
			}),
			contentType: "application/json",
		});
		await expect({
			queryCount: requests.length,
			listUnchanged: observed.listUnchanged,
			changesObserved: observed.changesObserved,
		}).toEqual({ queryCount: 0, listUnchanged: true, changesObserved: 0 });
		await expect(observed.durationMs).toBeGreaterThanOrEqual(data.unsupportedWindowMs);
	} finally {
		page.off("request", onRequest);
		await page.evaluate(() => {
			window.__pmsR7ListWatch?.disconnect();
			delete window.__pmsR7ListWatch;
		});
	}
}
