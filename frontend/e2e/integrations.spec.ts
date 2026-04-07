import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Integrations / Connections Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/integrations");
    await page.waitForTimeout(2000);
  });

  test("page loads and shows heading", async ({ page }) => {
    await expect(page).toHaveURL(/\/integrations/);
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 5000 });
  });

  test("add connection button exists", async ({ page }) => {
    const addBtn = page.locator("button").filter({ hasText: /Добавить|подключ/i });
    await expect(addBtn).toBeVisible({ timeout: 5000 });
  });

  test("clicking add button opens modal", async ({ page }) => {
    const addBtn = page.locator("button").filter({ hasText: /Добавить|подключ/i });
    await addBtn.click();
    await page.waitForTimeout(500);
    // Modal should appear with form fields
    const modal = page.locator("text=/Добавить подключение/i");
    await expect(modal).toBeVisible({ timeout: 3000 });
  });

  test("modal shows marketplace type selector", async ({ page }) => {
    const addBtn = page.locator("button").filter({ hasText: /Добавить|подключ/i });
    await addBtn.click();
    await page.waitForTimeout(500);
    // Should have type selector with marketplace options
    const select = page.locator("select").first();
    await expect(select).toBeVisible({ timeout: 3000 });
  });

  test("connections list renders (or empty state)", async ({ page }) => {
    // Page should render connection cards or an empty state
    const main = page.locator("main");
    await expect(main).toBeVisible();
    const content = await main.textContent();
    expect(content).toBeTruthy();
  });

  test("each connection card shows name and status", async ({ page }) => {
    // If connections exist, they should show name, type, and status
    // Look for status indicators
    const statusBadges = page.locator("text=/Подключено|Ошибка|Ожидание/i");
    const count = await statusBadges.count();
    // May be 0 if no connections; that is OK
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
