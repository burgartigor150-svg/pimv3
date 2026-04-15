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

test.describe("Social Content Tab", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("navigate to product and find social tab", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available");
      return;
    }
    const socialTab = page.locator("text=/Соцсети/i").first();
    await expect(socialTab).toBeVisible({ timeout: 5000 });
  });

  test("social tab renders editor", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available");
      return;
    }
    const socialTab = page.locator("text=/Соцсети/i").first();
    await socialTab.click();
    await page.waitForTimeout(2000);
    const main = page.locator("main");
    await expect(main).toBeVisible();
    const content = await main.textContent();
    expect(content).toBeTruthy();
  });
});
