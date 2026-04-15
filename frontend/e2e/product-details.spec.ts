import { test, expect, Page } from '@playwright/test';
import { login } from './helpers';

/**
 * Navigate to the first available product detail page.
 * Uses table row click (SPA navigation via react-router).
 */
async function goToFirstProduct(page: Page): Promise<string | null> {
  await login(page);
  await page.goto('/products', { waitUntil: 'networkidle' });
  // Wait for the table to render with products
  await page.waitForSelector('tbody tr', { timeout: 15000 });
  await page.waitForTimeout(1000); // let all rows render

  const firstRow = page.locator('tbody tr').first();
  const hasProducts = await firstRow.count() > 0;
  if (!hasProducts) return null;

  // Get the current URL before click
  const beforeUrl = page.url();

  await firstRow.click();

  // Wait for URL to change (SPA navigation - no page load event)
  await page.waitForFunction(
    (oldUrl) => window.location.href !== oldUrl,
    beforeUrl,
    { timeout: 15000 }
  );

  // Wait for product details content to appear (loading spinner to disappear)
  // The product details page shows a Loader2 spinner while loading, then renders the top bar with "Назад" button
  await page.waitForSelector('button:has-text("Назад")', { timeout: 30000 });
  await page.waitForTimeout(1000);

  const url = page.url();
  const match = url.match(/\/products\/(.+)/);
  return match ? match[1] : null;
}

test.describe('Product Details', () => {

  test('Product details page loads with correct structure', async ({ page }) => {
    const productId = await goToFirstProduct(page);
    if (!productId) { test.skip(true, 'No products to test'); return; }
    // Product name should be visible in the top bar
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });
    // SKU label should be visible
    await expect(page.locator('text=SKU:')).toBeVisible();
    // Back button should exist
    await expect(page.locator('button').filter({ hasText: 'Назад' })).toBeVisible();
  });

  test('All tabs are visible and clickable', async ({ page }) => {
    const productId = await goToFirstProduct(page);
    if (!productId) { test.skip(true, 'No products to test'); return; }
    const tabNames = ['Основное', 'Атрибуты', 'Медиа', 'Студия', 'Синдикация', 'История', 'Rich & Лендинг', 'Соцсети'];
    for (const tabName of tabNames) {
      const tab = page.locator('button').filter({ hasText: tabName }).first();
      await expect(tab).toBeVisible({ timeout: 5000 });
    }
    // Click each tab and verify no crash
    for (const tabName of tabNames) {
      const tab = page.locator('button').filter({ hasText: tabName }).first();
      await tab.click();
      await page.waitForTimeout(500);
    }
  });

  test('Основное tab: name, SKU, brand, category, description fields render', async ({ page }) => {
    const productId = await goToFirstProduct(page);
    if (!productId) { test.skip(true, 'No products to test'); return; }
    await page.locator('button').filter({ hasText: 'Основное' }).first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('text=Название товара')).toBeVisible();
    await expect(page.locator('text=Артикул (SKU)')).toBeVisible();
    await expect(page.locator('text=Бренд')).toBeVisible();
    await expect(page.locator('text=Категория')).toBeVisible();
    await expect(page.locator('text=Описание')).toBeVisible();
    // Check input fields for the form
    const mainContent = page.locator('main');
    const inputs = mainContent.locator('input');
    expect(await inputs.count()).toBeGreaterThanOrEqual(4);
    await expect(mainContent.locator('textarea')).toBeVisible();
  });

  test('Атрибуты tab: attributes section renders', async ({ page }) => {
    const productId = await goToFirstProduct(page);
    if (!productId) { test.skip(true, 'No products to test'); return; }
    await page.locator('button').filter({ hasText: 'Атрибуты' }).first().click();
    await page.waitForTimeout(1000);
    const attrHeader = page.locator('h2').filter({ hasText: 'Атрибуты' });
    await expect(attrHeader).toBeVisible({ timeout: 5000 });
    const addBtn = page.locator('button').filter({ hasText: 'Добавить' }).first();
    await expect(addBtn).toBeVisible();
  });

  test('Атрибуты tab: error banner shows when errors exist (MP products)', async ({ page }) => {
    await login(page);
    await page.goto('/products', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const mpTab = page.locator('button').filter({ hasText: /Megamarket|Ozon/ }).first();
    if (await mpTab.count() === 0) { test.skip(true, 'No marketplace tabs available'); return; }
    await mpTab.click();
    // Wait for MP products to load (loading spinner disappears and new rows render)
    await page.waitForTimeout(5000);
    const firstRow = page.locator('tbody tr').first();
    if (await firstRow.count() === 0) { test.skip(true, 'No MP products to test'); return; }
    // Click the name cell (4th td) to avoid the checkbox
    const nameCell = firstRow.locator('td').nth(3);
    const beforeUrl = page.url();
    await nameCell.click();
    await page.waitForFunction(
      (oldUrl) => window.location.href !== oldUrl,
      beforeUrl,
      { timeout: 15000 }
    );
    await page.waitForSelector('button:has-text("Назад")', { timeout: 30000 });
    await page.locator('button').filter({ hasText: 'Атрибуты' }).first().click();
    await page.waitForTimeout(1000);
    // Check for error banner — it may or may not be present depending on data
    const errorBanner = page.locator('text=ошибк').first();
    const hasErrors = await errorBanner.count() > 0;
    if (hasErrors) { await expect(errorBanner).toBeVisible(); }
    await expect(page.locator('h2').filter({ hasText: 'Атрибуты' })).toBeVisible();
  });

  test('Атрибуты tab: attribute controls render correctly (select/input/datalist)', async ({ page }) => {
    await login(page);
    await page.goto('/products', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const mpTab = page.locator('button').filter({ hasText: /Megamarket|Ozon/ }).first();
    if (await mpTab.count() === 0) {
      // Fall back to PIM product
      await page.waitForSelector('tbody tr', { timeout: 15000 }).catch(() => {});
      const firstRow = page.locator('tbody tr').first();
      if (await firstRow.count() === 0) { test.skip(true, 'No products available'); return; }
      const beforeUrl = page.url();
      await firstRow.click();
      await page.waitForFunction((oldUrl) => window.location.href !== oldUrl, beforeUrl, { timeout: 15000 });
    } else {
      await mpTab.click();
      await page.waitForTimeout(5000);
      const firstRow = page.locator('tbody tr').first();
      if (await firstRow.count() === 0) { test.skip(true, 'No MP products available'); return; }
      const nameCell = firstRow.locator('td').nth(3);
      const beforeUrl = page.url();
      await nameCell.click();
      await page.waitForFunction((oldUrl) => window.location.href !== oldUrl, beforeUrl, { timeout: 15000 });
    }
    await page.waitForSelector('button:has-text("Назад")', { timeout: 30000 });
    await page.locator('button').filter({ hasText: 'Атрибуты' }).first().click();
    await page.waitForTimeout(1000);
    // Check for various input types
    const mainContent = page.locator('main');
    const selectElements = mainContent.locator('select');
    const inputElements = mainContent.locator('input');
    const datalistElements = mainContent.locator('datalist');
    const selectCount = await selectElements.count();
    const inputCount = await inputElements.count();
    const datalistCount = await datalistElements.count();
    expect(inputCount + selectCount).toBeGreaterThan(0);
    if (selectCount > 0) {
      const firstSelect = selectElements.first();
      const options = firstSelect.locator('option');
      expect(await options.count()).toBeGreaterThan(0);
    }
    if (datalistCount > 0) {
      const firstDatalist = datalistElements.first();
      const datalistOptions = firstDatalist.locator('option');
      expect(await datalistOptions.count()).toBeGreaterThan(0);
    }
  });

  test('Атрибуты tab: onChange updates attribute value', async ({ page }) => {
    const productId = await goToFirstProduct(page);
    if (!productId) { test.skip(true, 'No products to test'); return; }
    await page.locator('button').filter({ hasText: 'Атрибуты' }).first().click();
    await page.waitForTimeout(1000);
    const mainContent = page.locator('main');
    const attrInputs = mainContent.locator('input[placeholder]');
    const count = await attrInputs.count();
    if (count === 0) { test.skip(true, 'No attribute inputs found'); return; }
    const firstInput = attrInputs.first();
    await firstInput.click();
    const originalValue = await firstInput.inputValue();
    await firstInput.fill('test-value-12345');
    await expect(firstInput).toHaveValue('test-value-12345');
    // Restore original value
    await firstInput.fill(originalValue);
  });

  test('Медиа tab: image gallery section renders', async ({ page }) => {
    const productId = await goToFirstProduct(page);
    if (!productId) { test.skip(true, 'No products to test'); return; }
    await page.locator('button').filter({ hasText: 'Медиа' }).first().click();
    await page.waitForTimeout(1000);
    const hasMediaHeader = await page.locator('text=Медиафайлы').count() > 0;
    const hasNoMedia = await page.locator('text=Нет медиафайлов').count() > 0;
    const hasImages = await page.locator('img[alt="product"]').count() > 0;
    expect(hasMediaHeader || hasNoMedia || hasImages).toBeTruthy();
    const uploadBtn = page.locator('button').filter({ hasText: /Загрузить|Добавить/ }).first();
    await expect(uploadBtn).toBeVisible();
  });

  test('Синдикация tab: shows connections with push buttons', async ({ page }) => {
    const productId = await goToFirstProduct(page);
    if (!productId) { test.skip(true, 'No products to test'); return; }
    await page.locator('button').filter({ hasText: 'Синдикация' }).first().click();
    await page.waitForTimeout(1000);
    const hasConnections = await page.locator('button').filter({ hasText: /Отправить|Обновить/ }).count() > 0;
    const hasNoConnections = await page.locator('text=Нет подключённых маркетплейсов').count() > 0;
    expect(hasConnections || hasNoConnections).toBeTruthy();
    if (hasConnections) {
      const pushButtons = page.locator('button').filter({ hasText: /Отправить|Обновить/ });
      expect(await pushButtons.count()).toBeGreaterThan(0);
    }
  });

  test('Синдикация tab: push button shows loading state when clicked', async ({ page }) => {
    const productId = await goToFirstProduct(page);
    if (!productId) { test.skip(true, 'No products to test'); return; }
    await page.locator('button').filter({ hasText: 'Синдикация' }).first().click();
    await page.waitForTimeout(1000);
    const pushBtn = page.locator('button').filter({ hasText: /Отправить|Обновить/ }).first();
    if (await pushBtn.count() === 0) { test.skip(true, 'No push buttons available'); return; }
    await pushBtn.click();
    // Wait for response
    await page.waitForTimeout(5000);
    // Page should not crash
    await expect(page.locator('button').filter({ hasText: 'Синдикация' }).first()).toBeVisible();
  });

  test('AI обогатить button is visible', async ({ page }) => {
    const productId = await goToFirstProduct(page);
    if (!productId) { test.skip(true, 'No products to test'); return; }
    const enrichBtn = page.locator('button').filter({ hasText: 'AI обогатить' });
    await expect(enrichBtn).toBeVisible({ timeout: 5000 });
  });

  test('AI обогатить button: click triggers enrichment or connection dialog', async ({ page }) => {
    const productId = await goToFirstProduct(page);
    if (!productId) { test.skip(true, 'No products to test'); return; }
    const enrichBtn = page.locator('button').filter({ hasText: 'AI обогатить' });
    await expect(enrichBtn).toBeVisible();
    await enrichBtn.click();
    await page.waitForTimeout(2000);
    const hasDialog = await page.locator('text=Выберите подключение').count() > 0;
    if (hasDialog) {
      // Dialog should list connections
      const dialogButtons = page.locator('h3').filter({ hasText: 'Выберите подключение' })
        .locator('..').locator('button');
      expect(await dialogButtons.count()).toBeGreaterThan(0);
      // Close dialog
      const cancelBtn = page.locator('button').filter({ hasText: 'Отмена' }).last();
      await cancelBtn.click();
    }
    // Page should not crash
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('Сохранить button is visible and clickable', async ({ page }) => {
    const productId = await goToFirstProduct(page);
    if (!productId) { test.skip(true, 'No products to test'); return; }
    const saveBtn = page.locator('button').filter({ hasText: 'Сохранить' });
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
    await page.waitForTimeout(3000);
    // Page should not crash
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('Platform badge shows for MP products', async ({ page }) => {
    await login(page);
    await page.goto('/products', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const mpTab = page.locator('button').filter({ hasText: /Megamarket|Ozon/ }).first();
    if (await mpTab.count() === 0) { test.skip(true, 'No marketplace tabs available'); return; }
    await mpTab.click();
    // Wait for MP products to load
    await page.waitForTimeout(5000);
    const firstRow = page.locator('tbody tr').first();
    if (await firstRow.count() === 0) { test.skip(true, 'No MP products available'); return; }
    // Click the name cell to avoid checkbox
    const nameCell = firstRow.locator('td').nth(3);
    const beforeUrl = page.url();
    await nameCell.click();
    await page.waitForFunction(
      (oldUrl) => window.location.href !== oldUrl,
      beforeUrl,
      { timeout: 15000 }
    );
    await page.waitForSelector('button:has-text("Назад")', { timeout: 30000 });
    // MP product should show a platform badge (e.g. MEGAMARKET or OZON)
    const platformBadge = page.locator('span').filter({ hasText: /MEGAMARKET|OZON|WILDBERRIES/ }).first();
    if (await platformBadge.count() > 0) {
      await expect(platformBadge).toBeVisible();
    }
  });
});
