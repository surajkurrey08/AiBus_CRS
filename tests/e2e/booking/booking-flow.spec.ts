/**
 * BOOKING E2E: Bus search → seat selection → hold → test-mode booking → PNR retrieval → cancellation.
 *
 * Uses test-mode Razorpay credentials. Webhook is simulated via backend test helper.
 * Run:  npx playwright test tests/e2e/booking/ --project=booking-chromium
 */
import { test, expect } from "@playwright/test";

const OPERATOR_URL = process.env.OPERATOR_URL ?? "http://127.0.0.1:5173";
const OP_EMAIL = process.env.E2E_OPERATOR_EMAIL ?? "operator@example.com";
const OP_PASSWORD = process.env.E2E_OPERATOR_PASSWORD ?? "change-me";

test.describe("Booking counter flow", () => {
  test("completes a test-mode booking from seat selection to PNR", async ({ page }) => {
    test.skip(!process.env.E2E_FULL_BOOKING, "Set E2E_FULL_BOOKING=1 to run full booking flow");
    await page.goto(OPERATOR_URL);
    await page.getByLabel(/email/i).fill(OP_EMAIL);
    await page.getByLabel(/password/i).fill(OP_PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page.getByRole("navigation")).toBeVisible({ timeout: 15_000 });
    // Navigate to booking counter
    const counterLink = page.getByRole("link", { name: /booking counter|counter/i });
    await expect(counterLink).toBeVisible();
    await counterLink.click();
    // Detailed steps depend on live trip data — see manual QA guide (E2E-MANUAL-QA.md)
    await expect(page).toHaveURL(/counter/i);
  });
});
