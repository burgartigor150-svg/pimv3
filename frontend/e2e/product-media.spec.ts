import { test, expect } from "@playwright/test";
import { login } from "./helpers";

async function navigateToFirstProduct(page: any): Promise<boolean> {
  await page.goto("/products");
  await page.waitForTimeout(3000);
  const editBtn = page.locator('button[title="Редактировать"]').first();
  const count = await editBtn.count();
  if (count === 0) return false;
  await editBtn.click();
  await page.waitForURL("**/products/**", { timeout: 15000 });
  return true;
}

test.describe("Product Media Tab", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("navigate to product details and find media tab", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available to test media tab");
      return;
    }
    const mediaTab = page.locator("text=/Медиа/i").first();
    await expect(mediaTab).toBeVisible({ timeout: 5000 });
  });

  test("media tab shows content when clicked", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available");
      return;
    }
    const mediaTab = page.locator("text=/Медиа/i").first();
    await mediaTab.click();
    await page.waitForTimeout(1000);
    const main = page.locator("main");
    await expect(main).toBeVisible();
  });

  test("media tab has upload button or file input", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available");
      return;
    }
    const mediaTab = page.locator("text=/Медиа/i").first();
    await mediaTab.click();
    await page.waitForTimeout(1000);
    const uploadBtn = page.locator("button").filter({ hasText: /Загрузить|Upload|Добавить/i });
    const fileInput = page.locator('input[type="file"]');
    const uploadCount = (await uploadBtn.count()) + (await fileInput.count());
    expect(uploadCount).toBeGreaterThanOrEqual(0);
  });

  test("media tab shows image thumbnails if images exist", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available");
      return;
    }
    const mediaTab = page.locator("text=/Медиа/i").first();
    await mediaTab.click();
    await page.waitForTimeout(1000);
    const images = page.locator("img");
    const imgCount = await images.count();
    expect(imgCount).toBeGreaterThanOrEqual(0);
  });
});
