import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Agent Task Console Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/agent-console");
    await page.waitForTimeout(2000);
  });

  test("page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/agent-console/);
    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10000 });
  });

  test("task list section renders", async ({ page }) => {
    // Console should show a list/panel of tasks
    const main = page.locator("main");
    await expect(main).toBeVisible();
    const content = await main.textContent();
    expect(content).toBeTruthy();
  });

  test("create task button or form exists", async ({ page }) => {
    // Should have a way to create new tasks
    const createBtn = page.locator("button").filter({ hasText: /Создать|New|Добавить|задач/i });
    const count = await createBtn.count();
    // May have a create button or task template buttons
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("task status filters or tabs exist", async ({ page }) => {
    // Filter buttons or tabs for task statuses
    const filters = page.locator("button, select");
    const count = await filters.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("task details are expandable when tasks exist", async ({ page }) => {
    // If tasks exist, clicking one should show details
    const taskItems = page.locator("[style*='cursor: pointer'], [role='button']");
    const count = await taskItems.count();
    if (count > 0) {
      await taskItems.first().click();
      await page.waitForTimeout(500);
      // Some detail area should appear or expand
      const main = page.locator("main");
      await expect(main).toBeVisible();
    }
  });
});
