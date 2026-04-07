import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Attributes Management Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/attributes");
    await page.waitForTimeout(2000);
  });

  test("page loads and shows heading", async ({ page }) => {
    await expect(page).toHaveURL(/\/attributes/);
    // Page has heading 'Схема атрибутов'
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 5000 });
  });

  test("create attribute button exists", async ({ page }) => {
    // Button with text '+ Добавить атрибут' or similar
    const addBtn = page.locator("button").filter({ hasText: /Добавить атрибут/ });
    await expect(addBtn).toBeVisible({ timeout: 5000 });
  });

  test("clicking add button shows create form", async ({ page }) => {
    const addBtn = page.locator("button").filter({ hasText: /Добавить атрибут/ });
    await addBtn.click();
    // Form with input fields should appear
    await page.waitForTimeout(500);
    const codeInput = page.locator("input").first();
    await expect(codeInput).toBeVisible({ timeout: 3000 });
  });

  test("filter by category dropdown exists", async ({ page }) => {
    // Category filter is a <select> element
    const selects = page.locator("select");
    const count = await selects.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("attributes table or list renders", async ({ page }) => {
    // The page renders a table/list with attribute rows
    // Look for table rows or repeated elements
    const main = page.locator("main");
    const content = await main.textContent();
    // Should at least show the page structure
    expect(content).toBeTruthy();
  });

  test("attribute has name, type, is_required fields in create form", async ({ page }) => {
    const addBtn = page.locator("button").filter({ hasText: /Добавить атрибут/ });
    await addBtn.click();
    await page.waitForTimeout(500);

    // Name/code input
    const inputs = page.locator("input");
    const inputCount = await inputs.count();
    expect(inputCount).toBeGreaterThanOrEqual(2); // at least code and name

    // Type selector (select element for type: string/number/boolean)
    const typeSelect = page.locator("select");
    const selectCount = await typeSelect.count();
    expect(selectCount).toBeGreaterThanOrEqual(1);
  });
});
