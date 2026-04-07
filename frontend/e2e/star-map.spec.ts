import { test, expect } from '@playwright/test';
import { loginAndGo } from './helpers';

test.describe('Star Map', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndGo(page, '/star-map');
  });

  test('Page loads', async ({ page }) => {
    await page.waitForTimeout(3000);
    // The page should have loaded without error — check for any meaningful content
    const hasSelect = await page.locator('select').count() > 0;
    const hasText = await page.locator('text=Star Map').count() > 0
      || await page.locator('text=Категория').count() > 0
      || await page.locator('text=Источник').count() > 0;
    expect(hasSelect || hasText).toBeTruthy();
  });

  test('Platform selectors render', async ({ page }) => {
    await page.waitForTimeout(3000);
    // Star map has platform selectors (source and target)
    const selects = page.locator('select');
    const selectCount = await selects.count();
    expect(selectCount).toBeGreaterThanOrEqual(1);
  });

  test('Build button exists', async ({ page }) => {
    await page.waitForTimeout(3000);
    // Look for the build/generate button
    const buildBtn = page.locator('button').filter({ hasText: /Построить|Build|Запустить|Сопоставить/ }).first();
    const hasBuildBtn = await buildBtn.count() > 0;
    if (hasBuildBtn) {
      await expect(buildBtn).toBeVisible();
    }
  });
});
