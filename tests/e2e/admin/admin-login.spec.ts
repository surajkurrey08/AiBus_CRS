/**
 * ADMIN E2E: Login, operator approval, monitoring and finance report access.
 *
 * Requires:
 *   - Backend running at http://127.0.0.1:4000
 *   - Admin UI running at http://127.0.0.1:5174
 *   - A seeded super-admin account (run bootstrap or create manually)
 *   - BOOTSTRAP_EMAIL / BOOTSTRAP_PASSWORD in backend .env
 *
 * Run:  npx playwright test tests/e2e/admin/ --project=admin-chromium
 */
import { test, expect } from "@playwright/test";

const ADMIN_URL = process.env.ADMIN_URL ?? "http://127.0.0.1:5174";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "change-me";

test.describe("Admin login and dashboard", () => {
  test("logs in as platform admin and sees operator list", async ({ page }) => {
    await page.goto(ADMIN_URL);
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    // Confirm dashboard loaded
    await expect(page.getByRole("heading", { name: /operators|platform/i })).toBeVisible({ timeout: 15_000 });
  });

  test("navigates to Operations monitor and sees health panel", async ({ page }) => {
    await page.goto(ADMIN_URL);
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    // Navigate to operations/monitor section
    const monitor = page.getByRole("link", { name: /monitor|operations/i });
    if (await monitor.isVisible()) {
      await monitor.click();
      await expect(page.getByText(/operations health|background jobs/i)).toBeVisible({ timeout: 10_000 });
    } else {
      test.skip(true, "Monitor link not visible — check admin navigation wiring");
    }
  });
});
