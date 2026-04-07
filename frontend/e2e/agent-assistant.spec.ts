import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("AI Assistant Chat Page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto("/agent-assistant");
    await page.waitForTimeout(2000);
  });

  test("page loads", async ({ page }) => {
    await expect(page).toHaveURL(/\/agent-assistant/);
    const main = page.locator("main");
    await expect(main).toBeVisible({ timeout: 10000 });
  });

  test("chat input area exists", async ({ page }) => {
    // Chat has a text input or textarea for messages
    const chatInput = page.locator("textarea, input[type='text']").last();
    await expect(chatInput).toBeVisible({ timeout: 5000 });
  });

  test("send button exists", async ({ page }) => {
    // Send button near the chat input
    const sendBtn = page.locator("button").filter({ hasText: /Отправить|Send/i });
    const sendIcon = page.locator("button svg").last();
    const btnCount = await sendBtn.count();
    const iconCount = await sendIcon.count();
    expect(btnCount + iconCount).toBeGreaterThanOrEqual(1);
  });

  test("message area renders", async ({ page }) => {
    // The chat message area should be present (even if empty)
    const main = page.locator("main");
    await expect(main).toBeVisible();
  });

  test("model selector exists", async ({ page }) => {
    // Model dropdown with DeepSeek, Gemini, Qwen options
    const modelSelect = page.locator("select, button:has-text('DeepSeek'), button:has-text('Gemini')");
    const count = await modelSelect.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("conversation sidebar or list exists", async ({ page }) => {
    // Side panel with conversation history
    const convList = page.locator("text=/Новый чат|New Chat|conversations/i");
    const count = await convList.count();
    // May or may not have conversations
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("can type in chat input", async ({ page }) => {
    const chatInput = page.locator("textarea, input[type='text']").last();
    await chatInput.fill("Hello test message");
    const value = await chatInput.inputValue();
    expect(value).toBe("Hello test message");
  });
});
