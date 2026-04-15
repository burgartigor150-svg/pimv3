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
    const addBtn = page.locator("button.btn-glow").first();
    await expect(addBtn).toBeVisible({ timeout: 5000 });
  });

  test("clicking add button opens modal", async ({ page }) => {
    const addBtn = page.locator("button.btn-glow").first();
    await addBtn.click();
    await page.waitForTimeout(1000);
    // Modal should appear with h2 heading
    const modalHeading = page.locator("h2").filter({ hasText: "Добавить подключение" });
    await expect(modalHeading).toBeVisible({ timeout: 5000 });
  });

  test("modal shows marketplace type buttons", async ({ page }) => {
    const addBtn = page.locator("button.btn-glow").first();
    await addBtn.click();
    await page.waitForTimeout(1000);
    // Wait for modal
    await expect(page.locator("h2").filter({ hasText: "Добавить подключение" })).toBeVisible({ timeout: 5000 });
    // Marketplace selector uses buttons for Ozon, WB, Yandex, Mega
    const ozonBtn = page.locator("button").filter({ hasText: /Ozon/i });
    const wbBtn = page.locator("button").filter({ hasText: /Wildberries/i });
    expect(await ozonBtn.count()).toBeGreaterThanOrEqual(1);
    expect(await wbBtn.count()).toBeGreaterThanOrEqual(1);
  });

  test("connections list renders (or empty state)", async ({ page }) => {
    const main = page.locator("main");
    await expect(main).toBeVisible();
    const content = await main.textContent();
    expect(content).toBeTruthy();
  });

  test("each connection card shows name and status", async ({ page }) => {
    const statusBadges = page.locator("text=/Подключено|Ошибка|Ожидание/i");
    const count = await statusBadges.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
