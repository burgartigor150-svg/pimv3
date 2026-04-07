import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    await page.waitForTimeout(2000);
  });

  test("page loads and shows heading", async ({ page }) => {
    await expect(page).toHaveURL(/\/settings/);
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 5000 });
    const text = await heading.textContent();
    expect(text).toContain("Настройки");
  });

  test("AI provider selection is visible", async ({ page }) => {
    // Radio buttons for provider selection (Gemini, DeepSeek)
    const providerRadios = page.locator('input[type="radio"][name="provider"]');
    const count = await providerRadios.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("API key fields exist", async ({ page }) => {
    // Input fields for API keys (DeepSeek, Gemini)
    const inputs = page.locator('input[type="text"], input[type="password"]');
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("save button exists", async ({ page }) => {
    const saveBtn = page.locator("button").filter({ hasText: /Сохранить|Save/i });
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
  });

  test("provider cards are clickable", async ({ page }) => {
    // Click on Gemini provider card
    const geminiLabel = page.locator("label").filter({ hasText: /Gemini/ });
    const count = await geminiLabel.count();
    if (count > 0) {
      await geminiLabel.click();
      const radio = geminiLabel.locator('input[type="radio"]');
      await expect(radio).toBeChecked();
    }
  });

  test("security warning is displayed", async ({ page }) => {
    // Warning about not sharing API keys
    const warning = page.locator("text=/API-ключ|ключи|мессенджер/i");
    const count = await warning.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("link to integrations page exists", async ({ page }) => {
    const link = page.locator('a[href="/integrations"]');
    const count = await link.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
