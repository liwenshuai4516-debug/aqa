import { test, expect } from 'pi-ui-testing/fixtures';
import type { Page, Response } from '@playwright/test';
import { data } from './data.js';

const queryPath = (response: Response) => response.request().method() === 'GET' && new URL(response.url()).pathname === data.endpoint;
const inputs = (page: Page) => page.locator('main input[placeholder="请输入"]');
const selectors = (page: Page) => page.locator('main .el-select');
async function queryResponse(page: Page, name: '查询' | '重置') {
  const pending = page.waitForResponse(queryPath);
  await page.locator('main').getByRole('button', { name, exact: true }).click();
  return pending;
}
async function chooseNonDefault(page: Page, index: number) {
  await selectors(page).nth(index).getByRole('combobox').click();
  const option = page.getByRole('option').filter({ visible: true }).filter({ hasNotText: /^全部$/ }).first();
  if (!(await option.count())) throw new Error('PRECONDITION: no non-default selectable option; six-field reset coverage cannot be claimed');
  await option.click();
}
async function values(page: Page) {
  return [await inputs(page).nth(0).inputValue(), await inputs(page).nth(1).inputValue(),
    ...(await selectors(page).allTextContents()).map(s => s.trim()),
    await page.getByPlaceholder('开始日期', { exact: true }).inputValue(),
    await page.getByPlaceholder('结束日期', { exact: true }).inputValue()];
}

test.beforeEach(async ({ page, uiEnvironment }) => {
  if (!uiEnvironment) throw new Error('PRECONDITION: missing managed environment');
  if (new URL(uiEnvironment.base_url).hostname === '127.0.0.1' && uiEnvironment.auth.kind === 'none') {
    if (await page.locator('[data-controlled-diagnostic="true"]').count() !== 1) throw new Error('PRECONDITION: isolated diagnostic control marker missing');
  } else {
    const matched = await page.evaluate(async ({ account }) => {
      const token = localStorage.getItem('token');
      if (!token) return false;
      const response = await fetch('/api/base-service/account-profile', { headers: { Authorization: 'Bearer ' + token, 'x-client-code': 'pms' } });
      if (!response.ok) return false;
      const profile = await response.json();
      return profile.code === 200 && profile.data?.username === account;
    }, { account: data.account });
    if (!matched) throw new Error('PRECONDITION: configured same-browser account mismatch or expiry; no business query executed');
  }
});

test('PMS-OC-SRC-001 合同名称去空白查询', async ({ page }) => {
  const name = inputs(page).nth(0);
  await name.fill('  ' + data.name + '  ');
  const response = await queryResponse(page, '查询');
  const q = new URL(response.url()).searchParams;
  await test.step('A-name-query', async () => {
    const actual = { input: await name.inputValue(), status: response.status(), method: response.request().method(), name: q.get('bizName'), pageNum: q.get('pageNum'), codePresent: q.has('bizCode') };
    await expect(actual).toEqual({ input: '  ' + data.name + '  ', status: 200, method: 'GET', name: data.name, pageNum: '1', codePresent: false });
  });
});

test('PMS-OC-SRC-009 六项条件重置', async ({ page }) => {
  await page.locator('main section').first().getByRole('button').nth(2).click();
  await inputs(page).nth(0).fill(data.name);
  await inputs(page).nth(1).fill(data.code);
  await chooseNonDefault(page, 0);
  await chooseNonDefault(page, 1);
  await chooseNonDefault(page, 2);
  await page.getByPlaceholder('开始日期', { exact: true }).fill(data.start);
  await page.getByPlaceholder('结束日期', { exact: true }).fill(data.end);
  await page.getByPlaceholder('结束日期', { exact: true }).press('Tab');
  const prepared = await values(page);
  const response = await queryResponse(page, '重置');
  const q = new URL(response.url()).searchParams;
  await test.step('A-reset-all', async () => {
    const actual = { prepared: prepared.map((s, i) => i >= 2 && i <= 4 ? s !== '' && s !== '全部' : s !== ''), values: await values(page), status: response.status(), method: response.request().method(), pageNum: q.get('pageNum'), filtersPresent: ['bizName', 'bizCode', 'deptId', 'approvalNode', 'projectType', 'startTime', 'endTime'].filter(k => q.has(k)) };
    await expect(actual).toEqual({ prepared: [true, true, true, true, true, true, true], values: ['', '', '全部', '全部', '全部', '', ''], status: 200, method: 'GET', pageNum: '1', filtersPresent: [] });
  });
});
