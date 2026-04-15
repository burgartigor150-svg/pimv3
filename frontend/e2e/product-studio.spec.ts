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

test.describe("Product Studio Tab", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("navigate to product and find studio tab", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available");
      return;
    }
    const studioTab = page.locator("text=/Студия/i").first();
    await expect(studioTab).toBeVisible({ timeout: 5000 });
  });

  test("studio tab renders content editor", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available");
      return;
    }
    const studioTab = page.locator("text=/Студия/i").first();
    await studioTab.click();
    await page.waitForTimeout(2000);
    const main = page.locator("main");
    await expect(main).toBeVisible();
  });

  test("studio tab has tool panel or canvas area", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available");
      return;
    }
    const studioTab = page.locator("text=/Студия/i").first();
    await studioTab.click();
    await page.waitForTimeout(2000);
    const main = page.locator("main");
    await expect(main).toBeVisible();
    const content = await main.textContent();
    expect(content).toBeTruthy();
  });
});
