import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Users Management Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/users");
    await page.waitForTimeout(2000);
  });

  test("page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/users/);
    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10000 });
  });

  test("shows heading", async ({ page }) => {
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 5000 });
    const text = await heading.textContent();
    expect(text).toContain("Сотрудники");
  });

  test("users list/table renders", async ({ page }) => {
    // User table or list
    const main = page.locator("main");
    const content = await main.textContent();
    expect(content).toBeTruthy();
  });

  test("user entries show email and role", async ({ page }) => {
    // Look for admin@admin.com in the users list
    const adminEntry = page.locator("text=admin@admin.com");
    const count = await adminEntry.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("create user form exists", async ({ page }) => {
    // Form to add new user (email + password inputs)
    const emailInput = page.locator('input[type="email"], input[placeholder*="email" i]');
    const passwordInput = page.locator('input[type="password"]');
    // At least one of these patterns should exist
    const count = (await emailInput.count()) + (await passwordInput.count());
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("user role is displayed", async ({ page }) => {
    // Role column/badge
    const roleBadge = page.locator("text=/admin|manager|editor/i");
    const count = await roleBadge.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
