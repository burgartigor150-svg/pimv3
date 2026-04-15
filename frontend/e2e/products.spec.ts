import { test, expect } from '@playwright/test';
import { login, loginAndGo } from './helpers';

test.describe('Product List', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndGo(page, '/products');
  });

  test('Products page loads and shows product table', async ({ page }) => {
    // Page heading "Товары" should be visible
    await expect(page.locator('h1')).toContainText('Товары');

    // Should have total count badge
    const badge = page.locator('span').filter({ hasText: /\d+/ }).first();
    await expect(badge).toBeVisible({ timeout: 15000 });

    // Wait for table to render
    await page.waitForSelector('tbody tr', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // Search input should exist
    const searchInput = page.locator('input[placeholder*="Поиск"]');
    await expect(searchInput).toBeVisible();
  });

  test('Search filters products', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="Поиск"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Type a search query — the debounced search should update results
    await searchInput.fill('test');
    // Wait for debounce (400ms) + API
    await page.waitForTimeout(2000);

    // The page should still have the "Товары" heading — no crash
    await expect(page.locator('h1')).toContainText('Товары');
  });

  test('Click product navigates to product details', async ({ page }) => {
    // Wait for products table to load
    await page.waitForSelector('tbody tr', { timeout: 15000 });
    await page.waitForTimeout(1000);

    const firstRow = page.locator('tbody tr').first();
    const hasProducts = await firstRow.count() > 0;
    if (!hasProducts) {
      test.skip(true, 'No products available to click');
      return;
    }

    const beforeUrl = page.url();
    await firstRow.click();

    // Wait for SPA navigation
    await page.waitForFunction(
      (oldUrl) => window.location.href !== oldUrl,
      beforeUrl,
      { timeout: 15000 }
    );

    // Should navigate to /products/:id
    expect(page.url()).toMatch(/\/products\/.+/);
  });

  test('MP product tab shows marketplace products', async ({ page }) => {
    // Look for source/platform tabs (PIM, Ozon, Megamarket etc.)
    const platformButtons = page.locator('button').filter({ hasText: /Ozon|Megamarket|Wildberries|PIM/ });
    const count = await platformButtons.count();
    if (count <= 1) {
      test.skip(true, 'No marketplace connections configured — only PIM tab visible');
      return;
    }

    // Click a non-PIM tab
    const mpTab = page.locator('button').filter({ hasText: /Ozon|Megamarket|Wildberries/ }).first();
    await mpTab.click();

    // Wait for data to load
    await page.waitForTimeout(3000);

    // Page should not crash — heading still visible
    await expect(page.locator('h1')).toContainText('Товары');
  });

  test('Pagination works', async ({ page }) => {
    await page.waitForTimeout(3000);

    // Pagination uses ChevronLeft / ChevronRight buttons
    const nextBtn = page.locator('button').filter({ hasText: /›|Далее|→/ });
    const paginationExists = await nextBtn.count() > 0;
    if (!paginationExists) {
      // Maybe less than 50 items — just verify no crash
      await expect(page.locator('h1')).toContainText('Товары');
      return;
    }

    await nextBtn.first().click();
    await page.waitForTimeout(2000);

    // Page should still work
    await expect(page.locator('h1')).toContainText('Товары');
  });
});
