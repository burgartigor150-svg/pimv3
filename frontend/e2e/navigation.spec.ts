import { test, expect } from "@playwright/test";
import { login } from "./helpers";

const NAV_ITEMS = [
  { label: "Дашборд", path: "/dashboard" },
  { label: "Товары", path: "/products" },
  { label: "Атрибуты", path: "/attributes" },
  { label: "Выгрузка", path: "/syndication" },
  { label: "Подключения", path: "/integrations" },
  { label: "Star Map", path: "/star-map" },
  { label: "Метрики", path: "/agent-dashboard" },
  { label: "Консоль", path: "/agent-console" },
  { label: "Ассистент", path: "/agent-assistant" },
  { label: "Self-Improve", path: "/self-improve" },
  { label: "Пользователи", path: "/users" },
  { label: "Настройки", path: "/settings" },
];

test.describe("Sidebar Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("all sidebar menu items are visible", async ({ page }) => {
    const sidebar = page.locator("aside").first();
    await expect(sidebar).toBeVisible({ timeout: 5000 });

    for (const item of NAV_ITEMS) {
      const link = sidebar.locator(`a[href="${item.path}"]`);
      await expect(link).toBeVisible({ timeout: 3000 });
    }
  });

  for (const item of NAV_ITEMS) {
    test(`navigates to ${item.label} (${item.path})`, async ({ page }) => {
      const sidebar = page.locator("aside").first();
      const link = sidebar.locator(`a[href="${item.path}"]`);
      await link.click();
      await page.waitForURL(`**${item.path}`, { timeout: 10000 });
      await expect(page).toHaveURL(new RegExp(item.path.replace("/", "\\/")));
      // Page should render content
      const main = page.locator("main");
      await expect(main).toBeVisible({ timeout: 5000 });
    });
  }

  test("sidebar group labels are visible", async ({ page }) => {
    const sidebar = page.locator("aside").first();
    // Groups: Каталог, Маркетплейсы, Агент, Система
    const groups = ["Каталог", "Маркетплейсы", "Агент", "Система"];
    for (const group of groups) {
      const groupLabel = sidebar.locator(`text=${group}`);
      // Group labels may be uppercase small text
      const count = await groupLabel.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });
});
