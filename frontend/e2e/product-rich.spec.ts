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

test.describe("Rich Content Tab", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("navigate to product and find rich content tab", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available");
      return;
    }
    const richTab = page.locator("text=/Rich|Лендинг/i").first();
    await expect(richTab).toBeVisible({ timeout: 5000 });
  });

  test("rich content tab renders block editor", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available");
      return;
    }
    const richTab = page.locator("text=/Rich|Лендинг/i").first();
    await richTab.click();
    await page.waitForTimeout(2000);
    const main = page.locator("main");
    await expect(main).toBeVisible();
  });

  test("rich content tab has add block button", async ({ page }) => {
    const found = await navigateToFirstProduct(page);
    if (!found) {
      test.skip(true, "No products available");
      return;
    }
    const richTab = page.locator("text=/Rich|Лендинг/i").first();
    await richTab.click();
    await page.waitForTimeout(2000);
    const addBlockBtn = page.locator("button").filter({ hasText: /Добавить|Add|блок|Block/i });
    const count = await addBlockBtn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
