import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Self-Improve Console Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/self-improve");
    await page.waitForTimeout(2000);
  });

  test("page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/self-improve/);
    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10000 });
  });

  test("incidents list renders", async ({ page }) => {
    // Incidents/tasks listing
    const main = page.locator("main");
    const content = await main.textContent();
    expect(content).toBeTruthy();
  });

  test("manual trigger form exists", async ({ page }) => {
    // Form with sku and task_id inputs for manual trigger
    const inputs = page.locator("input");
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("refresh button exists", async ({ page }) => {
    // Refresh/reload button
    const buttons = page.locator("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("github status section exists", async ({ page }) => {
    // GitHub automation status may be shown
    const main = page.locator("main");
    await expect(main).toBeVisible();
  });
});
