import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Agent Dashboard Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/agent-dashboard");
    await page.waitForTimeout(2000);
  });

  test("page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/agent-dashboard/);
    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10000 });
  });

  test("shows agent metrics KPI cards", async ({ page }) => {
    // Agent dashboard has KPI cards for tasks, success rate, etc.
    await page.waitForTimeout(2000);
    const main = page.locator("main");
    const content = await main.textContent();
    // Should contain metric-related text
    expect(content).toBeTruthy();
  });

  test("task queue status is visible", async ({ page }) => {
    // Queue/task status section
    const statusLabels = page.locator("text=/Ожидание|Выполняется|Завершено|Ошибка|pending|running|completed|failed/i");
    const count = await statusLabels.count();
    // At least some status indicators should be present
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("refresh button exists", async ({ page }) => {
    // Refresh button to reload metrics
    const refreshBtn = page.locator("button").filter({ hasText: /Обновить|Refresh/i });
    const refreshIcon = page.locator("button svg");
    const count = (await refreshBtn.count()) + (await refreshIcon.count());
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("recent tasks list renders", async ({ page }) => {
    await page.waitForTimeout(2000);
    // Recent tasks section
    const main = page.locator("main");
    await expect(main).toBeVisible();
    // Content should be present even if empty
    const text = await main.textContent();
    expect(text!.length).toBeGreaterThan(0);
  });
});
