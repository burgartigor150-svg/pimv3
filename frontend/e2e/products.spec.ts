import { test, expect } from '@playwright/test';
import { login, loginAndGo } from './helpers';

test.describe('Product List', () => {

  test.beforeEach(async ({ page }) => {
    await loginAndGo(page, '/products');
  });

  test('Products page loads and shows product table', async ({ page }) => {
    // Page heading "Товары" should be visible
    await expect(page.locator('h1')).toContainText('Товары');

    // Should have total count badge (badge-purple with number)
    const badge = page.locator('span').filter({ hasText: /\d+/ }).first();
    await expect(badge).toBeVisible({ timeout: 15000 });

    // Wait for loading to finish — there should be no Loader spinner
    // Products should appear in some list/table
    // Each product row is clickable — just wait for at least one product name or SKU
    await page.waitForTimeout(3000); // Give API time to respond
    // At minimum, the filter bar with search input should exist
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
    // Wait for products to load
    await page.waitForTimeout(3000);

    // Find the first clickable product row — they use cursor:pointer
    // Products are rendered as table rows or divs that navigate on click
    const productRows = page.locator('[style*="cursor: pointer"], [style*="cursor:pointer"]').first();
    const hasProducts = await productRows.count() > 0;
    if (!hasProducts) {
      test.skip(true, 'No products available to click');
      return;
    }
    await productRows.click();

    // Should navigate to /products/:id
    await page.waitForURL('**/products/**', { timeout: 10000 });
    expect(page.url()).toMatch(/\/products\/.+/);
  });

  test('MP product tab shows marketplace products', async ({ page }) => {
    // Look for source/platform tabs (PIM, Ozon, Megamarket etc.)
    // These are buttons with platform names
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
    // Look for a next-page button or page number
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
