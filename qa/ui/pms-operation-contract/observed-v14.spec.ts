import { test, expect } from '@playwright/test';
test('PMS recorded query reset', async ({ page }) => {
  // Draft only. Managed environment fixture and approved network assertions are still required.
  const query = process.env.UI_CONTRACT_QUERY;
  if (!query) throw new Error('Missing declared query fixture');
  const name = page.locator('main input[placeholder="请输入"]').first();
  await name.fill(query);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect(name).toHaveValue(query);
  await page.getByRole('button', { name: '重置', exact: true }).click();
  await expect(name).toHaveValue('');
});
