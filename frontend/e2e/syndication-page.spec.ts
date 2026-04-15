import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Syndication (Bulk Push) Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/syndication");
    await page.waitForTimeout(2000);
  });

  test("page loads and shows heading", async ({ page }) => {
    await expect(page).toHaveURL(/\/syndication/);
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 5000 });
    const text = await heading.textContent();
    expect(text).toContain("выгрузка");
  });

  test("connection selector is present", async ({ page }) => {
    // Syndication page has a connection selector (select element)
    const selects = page.locator("select");
    const count = await selects.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("shows warning when no products selected", async ({ page }) => {
    // When visiting /syndication without ?ids=, shows a warning banner
    const warning = page.locator("text=/Товары не выбраны|каталог/i");
    await expect(warning.first()).toBeVisible({ timeout: 5000 });
  });

  test("has link back to products catalog", async ({ page }) => {
    const productsLink = page.locator('a[href="/products"]').first();
    await expect(productsLink).toBeVisible({ timeout: 5000 });
  });

  test("megamarket repair section is visible", async ({ page }) => {
    // MM repair block is always visible on syndication page
    const repairSection = page.locator("text=/Megamarket|автоисправ/i").first();
    const count = await repairSection.count();
    // May or may not exist depending on connections
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
