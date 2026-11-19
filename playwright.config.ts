/**
 * AIBUS CRS — Playwright E2E Test Configuration (Phase 6)
 *
 * Browser binaries must be installed before tests run:
 *   npx playwright install chromium
 *
 * Usage:
 *   npx playwright test                    # run all tests (headless)
 *   npx playwright test --headed           # visible browser
 *   npx playwright test tests/e2e/auth.spec.ts   # single spec
 *
 * Required services (must be running):
 *   - Backend:  PORT=4000  (npm run dev -w backend)
 *   - Operator: PORT=5173  (npm run dev -w frontend)
 *   - Admin:    PORT=5174  (npm run dev -w admin)
 *
 * Tests use TEST-MODE credentials and never touch live financial data.
 * No real Razorpay calls are made — webhook responses are simulated via the
 * /api/v1/webhooks/razorpay endpoint using the RAZORPAY_WEBHOOK_SECRET.
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_OPERATOR = process.env.OPERATOR_URL ?? "http://127.0.0.1:5173";
const BASE_ADMIN = process.env.ADMIN_URL ?? "http://127.0.0.1:5174";
const BASE_API = process.env.API_URL ?? "http://127.0.0.1:4000";

export default defineConfig({
  testDir: "./tests/e2e",
  // Allow up to 60 s per test; E2E tests are IO-bound
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Sequential by default — avoids shared-state collisions between suites
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    // Use system-installed Chrome; no network download required
    channel: "chrome",
    // No persistent auth state — each spec logs in independently
    baseURL: BASE_OPERATOR,
    headless: true,
    viewport: { width: 1280, height: 800 },
    // Capture traces on first retry to aid debugging
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // All test interactions are local; no external network required
    extraHTTPHeaders: { "X-Aibus-Client": "operator" },
  },
  projects: [
    {
      name: "operator-chromium",
      use: { ...devices["Desktop Chrome"], baseURL: BASE_OPERATOR },
      testMatch: "tests/e2e/operator/**/*.spec.ts",
    },
    {
      name: "admin-chromium",
      use: { ...devices["Desktop Chrome"], baseURL: BASE_ADMIN, extraHTTPHeaders: { "X-Aibus-Client": "admin" } },
      testMatch: "tests/e2e/admin/**/*.spec.ts",
    },
    {
      name: "booking-chromium",
      use: { ...devices["Desktop Chrome"], baseURL: BASE_OPERATOR },
      testMatch: "tests/e2e/booking/**/*.spec.ts",
    },
    {
      name: "security-chromium",
      use: { ...devices["Desktop Chrome"], baseURL: BASE_OPERATOR },
      testMatch: "tests/e2e/security/**/*.spec.ts",
    },
  ],
  // Environment values available to all test files
  metadata: {
    BASE_OPERATOR,
    BASE_ADMIN,
    BASE_API,
  },
});
