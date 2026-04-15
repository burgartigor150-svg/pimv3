import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('Authentication', () => {

  test('Login page renders with email and password fields', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });

    // The heading "Войти в систему" should be visible
    await expect(page.locator('h2')).toContainText('Войти');

    // Email and password inputs exist
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // Submit button exists
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('Login with valid credentials redirects to dashboard', async ({ page }) => {
    await login(page);

    // Should be on dashboard (or at least not on /login)
    expect(page.url()).not.toContain('/login');
    // Sidebar nav should be present
    await expect(page.locator('nav')).toBeVisible();
  });

  test('Login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });

    await page.locator('input[type="email"]').fill('wrong@wrong.com');
    await page.locator('input[type="password"]').fill('wrongpassword');
    await page.locator('button[type="submit"]').click();

    // Error message should appear
    const errorDiv = page.locator('div').filter({ hasText: /Неверный|Ошибка/ }).first();
    await expect(errorDiv).toBeVisible({ timeout: 10000 });

    // Should still be on login page
    expect(page.url()).toContain('/login');
  });

  test('Logout redirects to login page', async ({ page }) => {
    await login(page);

    // The logout button has a LogOut icon — it is in the sidebar footer
    // Click the logout button (last button in aside)
    const logoutBtn = page.locator('aside button').last();
    await logoutBtn.click();

    // Should redirect to login
    await page.waitForURL('**/login', { timeout: 10000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('Protected pages redirect to login when not authenticated', async ({ page }) => {
    // Clear any existing auth state
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    });

    // Try accessing a protected page
    await page.goto('/products', { waitUntil: 'networkidle' });

    // Should be redirected to login
    await page.waitForURL('**/login', { timeout: 10000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});
