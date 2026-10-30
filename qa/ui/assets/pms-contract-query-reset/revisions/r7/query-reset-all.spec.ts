import { test, expect } from "pi-ui-testing/fixtures";
import type { Locator, Page, Request, Response, TestInfo } from "@playwright/test";
import { data, frozenSource } from "./data-all.js";
import { freezeDepartmentFromPageResponse, assertUnsupportedWithinWindow } from "./r7-helpers.js";

// DESIGN ONLY: current component declarations checked against index-CIpFLfjX.js.
// Current department/shared/API source confirmation is recorded in the persistent provenance reference.
// Native approval, diagnosis, target freshness/identity checks and authorization remain separate gates.
const labels = ["合同名称", "合同编号", "归属部门", "流程节点", "项目类型", "合同签订日期"] as const;
const filterKeys = ["bizName", "bizCode", "departmentId", "contractStatus", "signedAtStart", "signedAtEnd"];
const panel = (page: Page) => page.locator("main section").first();
// .search-label itself contains text, so hasText + exact anchored regexp avoids a descendant-only getByText assumption.
function field(page: Page, label: (typeof labels)[number]): Locator {
	return panel(page)
		.locator(".search-item")
		.filter({
			has: page.locator(".search-label").filter({ hasText: new RegExp(`^${label}$`) }),
		});
}
const nameInput = (page: Page) => field(page, "合同名称").locator('input[placeholder="请输入"]');
const codeInput = (page: Page) => field(page, "合同编号").locator('input[placeholder="请输入"]');
const dateInput = (page: Page, edge: "开始日期" | "结束日期") =>
	field(page, "合同签订日期").locator(`input[placeholder="${edge}"]`);
const selectBox = (page: Page, label: "归属部门" | "流程节点" | "项目类型") =>
	field(page, label).locator('.el-select [role="combobox"]');
const pagination = (page: Page) => page.locator("main .el-pagination");
const activePage = (page: Page) => pagination(page).locator(".el-pager .number.is-active");
const table = (page: Page) => page.locator("main .contract-table");
const matchesQuery = (request: Request) =>
	request.method() === "GET" && new URL(request.url()).pathname === data.endpoint;

async function blocked(info: TestInfo, check: string): Promise<never> {
	await info.attach("ui-preflight", {
		body: JSON.stringify({ status: "blocked", category: "precondition", check }),
		contentType: "application/json",
	});
	throw new Error(`PRECONDITION: ${check}`);
}
async function guard(info: TestInfo, check: string, action: () => Promise<boolean>): Promise<void> {
	try {
		if (await action()) return;
	} catch {
		/* record a sanitized precondition reason */
	}
	await blocked(info, check);
}
async function settle(page: Page): Promise<void> {
	// Complete the response before reading render state; bounded two-frame render barrier, no business data logging.
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
	);
}
async function selected(page: Page, label: "归属部门" | "流程节点" | "项目类型"): Promise<string> {
	const loc = field(page, label).locator(".el-select__selected-item:visible");
	return (await loc.allTextContents()).join("").trim();
}
async function uiValues(page: Page) {
	return {
		name: await nameInput(page).inputValue(),
		code: await codeInput(page).inputValue(),
		department: await selected(page, "归属部门"),
		node: await selected(page, "流程节点"),
		type: await selected(page, "项目类型"),
		start: await dateInput(page, "开始日期").inputValue(),
		end: await dateInput(page, "结束日期").inputValue(),
	};
}
function emptyUI() {
	return { name: "", code: "", department: "全部", node: "全部", type: "全部", start: "", end: "" };
}
function nonKeywordUI(values: ReturnType<typeof emptyUI>) {
	// Post-blur keyword DOM normalization is not defined by modelModifiers alone.
	// Assert only the independently declared select/date state here; keyword query values are checked on GET.
	const { department, node, type, start, end } = values;
	return { department, node, type, start, end };
}
async function openFilters(page: Page, info: TestInfo) {
	const date = dateInput(page, "开始日期");
	if (await date.isVisible()) return;
	await guard(info, "expand-structure-design-only", async () => (await panel(page).getByRole("button").count()) === 3);
	await panel(page).getByRole("button").nth(2).click();
	await guard(info, "expanded-filters-design-only", async () => {
		await date.waitFor({ state: "visible", timeout: 5000 });
		return await selectBox(page, "项目类型").isVisible();
	});
}
async function choose(page: Page, label: "归属部门" | "流程节点" | "项目类型", value: string, info: TestInfo) {
	const combo = selectBox(page, label);
	await guard(
		info,
		`combobox-${label}-design-only`,
		async () => (await combo.count()) === 1 && (await combo.isVisible()),
	);
	await combo.click();
	const option = page.getByRole("option", { name: value, exact: true }).filter({ visible: true });
	await guard(info, `configured-option-${label}`, async () => {
		await option.waitFor({ state: "visible", timeout: 5000 });
		return (await option.count()) === 1;
	});
	await option.click();
	// Do not verify the eventual tested state as a precondition: a value mutation must fail the aggregate expect.
}
async function chooseFirstDepartment(page: Page, info: TestInfo): Promise<void> {
	const combo = selectBox(page, "归属部门");
	await guard(
		info,
		"department-combobox-design-only",
		async () => (await combo.count()) === 1 && (await combo.isVisible()),
	);
	await combo.click();
	// Replaceable UI input only: no department ID mapping is inferred or asserted in 009.
	const option = page
		.getByRole("option")
		.filter({ visible: true })
		.filter({ hasNotText: /^\s*全部\s*$/ })
		.first();
	await guard(info, "visible-non-all-department-required", async () => {
		await option.waitFor({ state: "visible", timeout: 5000 });
		return (await option.innerText()).trim().length > 0;
	});
	await option.click();
}
async function dates(page: Page) {
	await dateInput(page, "开始日期").fill(data.start);
	await dateInput(page, "结束日期").fill(data.end);
	await dateInput(page, "结束日期").press("Tab");
	// Hide the date popover without clicking a business operation.
	await field(page, "合同签订日期").locator(".search-label").click();
}
async function query(page: Page, action: "查询" | "重置") {
	const requests: Request[] = [];
	const onRequest = (request: Request) => {
		if (matchesQuery(request)) requests.push(request);
	};
	page.on("request", onRequest);
	try {
		const pending = page.waitForResponse((response) => matchesQuery(response.request()));
		await panel(page).getByRole("button", { name: action, exact: true }).click();
		const response = await pending;
		await response.finished();
		await settle(page);
		return { response, requests };
	} finally {
		page.off("request", onRequest);
	}
}
function requestState(response: Response, count: number) {
	const url = new URL(response.url());
	return {
		method: response.request().method(),
		path: url.pathname,
		status: response.status(),
		params: [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)),
		queryCount: count,
	};
}
function expectedRequest(filters: Record<string, string> = {}) {
	// Expected values come from frozen declarations/data, never from the captured request/response.
	return {
		method: "GET",
		path: data.endpoint,
		status: 200,
		params: Object.entries({ pageNum: "1", pageSize: data.pageSize, ...filters }).sort(([a], [b]) =>
			a.localeCompare(b),
		),
		queryCount: 1,
	};
}

test.beforeEach(async ({ page, uiEnvironment }, info) => {
	// Original scope role is a declaration; do not invent business role names.
	await guard(
		info,
		"managed-context-and-scope-role",
		async () => !!uiEnvironment && uiEnvironment.isolation === "context" && uiEnvironment.role === data.role,
	);
	// frozenSource identifies design evidence only; recheck target deployment when registering environment.
	if (!frozenSource.component || !frozenSource.bundle) await blocked(info, "frozen-source-missing");
	const controlled =
		!!uiEnvironment &&
		["127.0.0.1", "localhost"].includes(new URL(uiEnvironment.base_url).hostname) &&
		uiEnvironment.auth.kind === "none";
	// Real PMS follows the recorded v14 seed protocol; only a boolean leaves this callback.
	// The local auth:none fixture also requires its explicit body marker and synthetic profile.
	const matched = await page.evaluate(
		async ({ account, endpoint, controlled }) => {
			try {
				const headers: Record<string, string> = { "x-parent-client-code": "pms", "x-client-code": "pms" };
				if (!controlled) {
					let token = localStorage.getItem("token");
					try {
						const parsed = JSON.parse(token || "null");
						if (typeof parsed === "string") token = parsed;
					} catch {}
					if (!token) return false;
					headers.token = token;
				} else if (document.querySelector('body[data-controlled-diagnostic="true"]') === null) return false;
				const response = await fetch(endpoint, { headers });
				if (!response.ok) return false;
				const profile = await response.json();
				return profile.code === 200 && profile.data?.username === account;
			} catch {
				return false;
			}
		},
		{ account: data.account, endpoint: data.profileEndpoint, controlled },
	);
	if (!matched) await blocked(info, "same-browser-account-mismatch-or-expired");
	await guard(info, "settled-initial-network", async () => {
		await page.waitForLoadState("networkidle", { timeout: 10000 });
		return true;
	});
	await guard(info, "six-label-structure-design-only", async () => {
		for (const label of labels) if ((await field(page, label).count()) !== 1) return false;
		return (
			(await nameInput(page).count()) === 1 &&
			(await codeInput(page).count()) === 1 &&
			(await table(page).count()) === 1 &&
			(await pagination(page).count()) === 1
		);
	});
	await openFilters(page, info);
	await guard(
		info,
		"rebuildable-default-ui-design-only",
		async () =>
			JSON.stringify(await uiValues(page)) === JSON.stringify(emptyUI()) &&
			(await activePage(page).innerText()).trim() === "1",
	);
	await info.attach("ui-preflight", {
		body: JSON.stringify({
			status: "completed",
			checks: ["same-browser-account-boolean", "scope-role", "independent-context", "default-ui"],
			readiness: "design-only",
		}),
		contentType: "application/json",
	});
});

test("PMS-OC-SRC-001 合同名称去空白查询", async ({ page }) => {
	// Default first page only; transition from a non-first page back to 1 remains uncovered.
	await nameInput(page).fill(data.nameRaw);
	const result = await query(page, "查询");
	await test.step("PMS-OC-SRC-001-A1 合同名称trim参数与第一页", async () => {
		const actual = {
			request: requestState(result.response, result.requests.length),
			ui: nonKeywordUI(await uiValues(page)),
			page: (await activePage(page).innerText()).trim(),
		};
		await expect(actual).toEqual({
			request: expectedRequest({ bizName: data.nameRaw.trim() }),
			ui: nonKeywordUI(emptyUI()),
			page: "1",
		});
	});
});

test("PMS-OC-SRC-002 合同编号去空白查询", async ({ page }) => {
	await codeInput(page).fill(data.codeRaw);
	const result = await query(page, "查询");
	await test.step("PMS-OC-SRC-002-A1 合同编号trim参数与其他条件省略", async () => {
		await expect({
			request: requestState(result.response, result.requests.length),
			ui: nonKeywordUI(await uiValues(page)),
			page: (await activePage(page).innerText()).trim(),
		}).toEqual({
			request: expectedRequest({ bizCode: data.codeRaw.trim() }),
			ui: nonKeywordUI(emptyUI()),
			page: "1",
		});
	});
});

test("PMS-OC-SRC-003 名称编号双空白省略筛选", async ({ page }) => {
	await nameInput(page).fill(data.whitespaceRaw);
	await codeInput(page).fill(data.whitespaceRaw);
	const result = await query(page, "查询");
	await test.step("PMS-OC-SRC-003-A1 双空白不产生任何关键字参数", async () => {
		const params = new URL(result.response.url()).searchParams;
		await expect({
			request: requestState(result.response, result.requests.length),
			filtersPresent: filterKeys.filter((key) => params.has(key)),
			ui: nonKeywordUI(await uiValues(page)),
			page: (await activePage(page).innerText()).trim(),
		}).toEqual({ request: expectedRequest(), filtersPresent: [], ui: nonKeywordUI(emptyUI()), page: "1" });
	});
});

test("PMS-OC-SRC-004 归属部门独立响应映射departmentId", async ({ page }, info) => {
	// Capture/freeze BEFORE selection and contract query. No contract request is an oracle input.
	const department = await freezeDepartmentFromPageResponse(page, info, blocked);
	await openFilters(page, info);
	await guard(
		info,
		"department-reload-default-ui-required",
		async () =>
			JSON.stringify(await uiValues(page)) === JSON.stringify(emptyUI()) &&
			(await activePage(page).innerText()).trim() === "1",
	);
	await choose(page, "归属部门", department.label, info);
	const result = await query(page, "查询");
	await test.step("PMS-OC-SRC-004-A1 查询部门id等于查询前独立冻结映射", async () => {
		await expect({
			request: requestState(result.response, result.requests.length),
			ui: await uiValues(page),
			page: (await activePage(page).innerText()).trim(),
		}).toEqual({
			request: expectedRequest({ departmentId: department.id }),
			ui: { ...emptyUI(), department: department.label },
			page: "1",
		});
	});
});

test("PMS-OC-SRC-005 签订日期两端点按YYYY-MM-DD传递", async ({ page }) => {
	await dates(page);
	const result = await query(page, "查询");
	await test.step("PMS-OC-SRC-005-A1 日期端点原值与无额外筛选GET", async () => {
		await expect({
			request: requestState(result.response, result.requests.length),
			ui: await uiValues(page),
			page: (await activePage(page).innerText()).trim(),
		}).toEqual({
			request: expectedRequest({ signedAtStart: data.start, signedAtEnd: data.end }),
			ui: { ...emptyUI(), start: data.start, end: data.end },
			page: "1",
		});
	});
});

test("PMS-OC-SRC-006 草稿节点传递DRAFT状态", async ({ page }, info) => {
	await choose(page, "流程节点", data.draftNode, info);
	const result = await query(page, "查询");
	await test.step("PMS-OC-SRC-006-A1 草稿节点精确映射DRAFT且其他筛选省略", async () => {
		await expect({
			request: requestState(result.response, result.requests.length),
			ui: await uiValues(page),
			page: (await activePage(page).innerText()).trim(),
		}).toEqual({
			request: expectedRequest({ contractStatus: "DRAFT" }),
			ui: { ...emptyUI(), node: data.draftNode },
			page: "1",
		});
	});
});

test("PMS-OC-SRC-007 具体节点不支持且窗口内无请求列表不变", async ({ page }, info) => {
	await choose(page, "流程节点", data.concreteNode, info);
	await test.step("PMS-OC-SRC-007-A1 精确提示且有界窗口内无列表请求与列表变化", async () => {
		await expect(await uiValues(page)).toEqual({ ...emptyUI(), node: data.concreteNode });
		await assertUnsupportedWithinWindow(
			page,
			panel(page).getByRole("button", { name: "查询", exact: true }),
			info,
			blocked,
		);
	});
});

test("PMS-OC-SRC-008 项目类型不支持且窗口内无请求列表不变", async ({ page }, info) => {
	await choose(page, "项目类型", data.projectType, info);
	await test.step("PMS-OC-SRC-008-A1 精确提示且有界窗口内无列表请求与列表变化", async () => {
		await expect(await uiValues(page)).toEqual({ ...emptyUI(), type: data.projectType });
		await assertUnsupportedWithinWindow(
			page,
			panel(page).getByRole("button", { name: "查询", exact: true }),
			info,
			blocked,
		);
	});
});

test("PMS-OC-SRC-009 六条件全部设值后重置", async ({ page }, info) => {
	// Default first page only; do not add a data-dependent pagination precondition.
	await nameInput(page).fill(data.nameRaw);
	await codeInput(page).fill(data.codeRaw);
	await chooseFirstDepartment(page, info);
	await choose(page, "流程节点", data.concreteNode, info);
	await choose(page, "项目类型", data.projectType, info);
	await dates(page);
	const preparedValues = await uiValues(page);
	const prepared = {
		name: preparedValues.name.trim(),
		code: preparedValues.code.trim(),
		departmentNonDefault: preparedValues.department !== "" && preparedValues.department !== "全部",
		node: preparedValues.node,
		type: preparedValues.type,
		start: preparedValues.start,
		end: preparedValues.end,
	};
	const preparedPage = (await activePage(page).innerText()).trim();
	const result = await query(page, "重置");
	await test.step("PMS-OC-SRC-009-A1 六条件准备、全清空与第一页无筛选GET", async () => {
		const params = new URL(result.response.url()).searchParams;
		const actual = {
			prepared,
			preparedPage,
			ui: await uiValues(page),
			page: (await activePage(page).innerText()).trim(),
			request: requestState(result.response, result.requests.length),
			filtersPresent: filterKeys.filter((key) => params.has(key)),
		};
		await expect(actual).toEqual({
			prepared: {
				name: data.nameRaw.trim(),
				code: data.codeRaw.trim(),
				departmentNonDefault: true,
				node: data.concreteNode,
				type: data.projectType,
				start: data.start,
				end: data.end,
			},
			preparedPage: "1",
			ui: emptyUI(),
			page: "1",
			request: expectedRequest(),
			filtersPresent: [],
		});
	});
});
