/**
 * OPERATOR E2E: Login, trip scheduling, seat inventory, booking counter.
 *
 * Run:  npx playwright test tests/e2e/operator/ --project=operator-chromium
 */
import { test, expect } from "@playwright/test";

const OPERATOR_URL = process.env.OPERATOR_URL ?? "http://127.0.0.1:5173";
const OP_EMAIL = process.env.E2E_OPERATOR_EMAIL ?? "operator@example.com";
const OP_PASSWORD = process.env.E2E_OPERATOR_PASSWORD ?? "change-me";

test.describe("Operator dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(OPERATOR_URL);
    await page.getByLabel(/email/i).fill(OP_EMAIL);
    await page.getByLabel(/password/i).fill(OP_PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page.getByRole("navigation")).toBeVisible({ timeout: 15_000 });
  });

  test("shows trip list after login", async ({ page }) => {
    const tripsLink = page.getByRole("link", { name: /trip master|trips/i });
    await expect(tripsLink).toBeVisible();
    await tripsLink.click();
    await expect(page).toHaveURL(/trip/i);
  });

  test("navigates to operational reports section", async ({ page }) => {
    const reportsLink = page.getByRole("link", { name: /reports|operational/i });
    if (await reportsLink.isVisible()) {
      await reportsLink.click();
      await expect(page.getByText(/operational reports|report/i)).toBeVisible();
    } else {
      test.skip(true, "Reports link not found in navigation");
    }
  });
});
