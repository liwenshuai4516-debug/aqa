import { test, expect } from '@playwright/test';
test('PMS recorded query reset', async ({ page }) => {
  // Draft only. Managed environment fixture and approved network assertions are still required.
  const name = page.locator('main input[placeholder="请输入"]').first();
  await name.fill('AQA_OWNED_QUERY_ONLY');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(name).toHaveValue('AQA_OWNED_QUERY_ONLY');
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(name).toHaveValue('');
});
