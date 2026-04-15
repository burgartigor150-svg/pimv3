import { Page } from "@playwright/test";

export async function login(page: Page) {
  await page.goto("/login");
  await page.waitForSelector("input", { timeout: 10000 });
  // Try to find email/username input
  const emailInput = page
    .locator('input[type="email"], input[name="email"], input[name="username"]')
    .first();
  if (await emailInput.count()) {
    await emailInput.fill("admin@admin.com");
  } else {
    // Fallback: first text input on the page
    await page.locator("input").first().fill("admin@admin.com");
  }
  await page.locator('input[type="password"]').fill("admin");
  await page
    .locator('button[type="submit"], button:has-text("Войти")')
    .first()
    .click();
  await page.waitForURL("**/dashboard", { timeout: 15000 });
}

export async function loginAndGo(page: Page, path: string) {
  await login(page);
  await page.goto(path, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
}
