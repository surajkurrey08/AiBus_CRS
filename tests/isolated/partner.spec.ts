import { test, expect, type Page } from "@playwright/test";
const password = "Browser-Fixture-Password-123!";
test("partner registration submits from its own origin with responsive grouped fields", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:15176");
  await page
    .getByRole("button", { name: "Register company", exact: true })
    .click();
  for (const [label, value] of [
    ["Company name", "Browser Application Company"],
    ["Contact person", "Application Owner"],
    ["Business email", "application@browser.test"],
    ["Contact number", "9000000000"],
    ["Business address", "Pune sandbox office"],
    ["Technical contact email", "tech@browser.test"],
    ["Intended API usage", "Bus booking sandbox integration"],
    ["Owner password (12+ characters)", password],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await expect(
    page.getByRole("group", { name: "Company details", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".cache/partner-registration-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".cache/partner-registration-mobile.png",
    fullPage: true,
  });
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/partner/applications") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save application", exact: true })
    .click();
  expect((await response).status()).toBe(201);
  await expect(page.getByRole("status")).toContainText("Application submitted");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
async function login(page: Page, email = "partner@browser.test") {
  await page.goto("http://127.0.0.1:15176");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Browser API Company", exact: true }),
  ).toBeVisible();
}
test("partner login, approved inventory, live playground and logout", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Inventory Access", exact: true })
    .click();
  await expect(
    page.getByText("Isolated Browser Operator", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "API Playground", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Run sandbox request", exact: true })
    .click();
  await expect(page.getByText(/HTTP 200/)).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Sandbox response" })
      .locator("pre.portal-json"),
  ).toContainText('"productionCredentials": false');
  await page.screenshot({
    path: ".cache/partner-playground-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
test("read-only partner cannot reach key issuance or playground", async ({
  page,
}) => {
  await login(page, "readonly@browser.test");
  await expect(
    page.getByRole("button", { name: "API Credentials", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "API Playground", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Integration Status", exact: true })
    .click();
  await expect(page.getByText("mfa Supported", { exact: false })).toBeVisible();
});
test("credential issuance requires reviewed password and clears the one-time secret", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "API Credentials", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate credential", exact: true })
    .click();
  await page
    .getByLabel("Credential label", { exact: true })
    .fill("Browser server key");
  await page.getByLabel("inventory:read", { exact: true }).check();
  await page
    .getByLabel("Expiration date", { exact: true })
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Browser reviewed sandbox integration");
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Review action", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record reviewed change", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Save your new sandbox secret" }),
  ).toBeVisible();
  await expect(page.getByLabel("New secret")).not.toContainText("ap_sandbox_");
  await page.getByRole("button", { name: "Show secret", exact: true }).click();
  await expect(page.getByLabel("New secret")).toContainText("ap_sandbox_cred_");
  await page
    .getByRole("button", { name: "I have saved it", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Save your new sandbox secret" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Browser server key", { exact: true }),
  ).toBeVisible();
});
test("admin reviews the existing partner organization workspace", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:15174");
  await page.getByLabel("Email", { exact: true }).fill("admin@browser.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "API Partners", exact: true }).click();
  await expect(
    page.getByText("Browser API Company", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View details", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", {
      name: "Review approval, scopes & limits",
      exact: true,
    }),
  ).toBeVisible();
});
test("partner portal remains usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.screenshot({
    path: ".cache/partner-overview-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("admin partner approval recovers from a wrong password and keeps its footer visible", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:15174");
  await page.getByLabel("Email", { exact: true }).fill("admin@browser.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "API Partners", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Browser Application Company" })
    .getByRole("button", { name: "View details" })
    .click();
  await page
    .getByRole("button", {
      name: "Review approval, scopes & limits",
      exact: true,
    })
    .click();
  const dialog = page.locator("dialog.review-dialog");
  await page
    .getByLabel("Application status", { exact: true })
    .selectOption("Approved");
  await page.getByLabel("inventory:read", { exact: true }).check();
  await page
    .getByLabel("Review reason", { exact: true })
    .fill("Reviewed sandbox business application");
  await page
    .getByLabel("Current password", { exact: true })
    .fill("incorrect-test-password");
  await page.setViewportSize({ width: 480, height: 760 });
  await expect(dialog).toBeVisible();
  const footer = await dialog.locator(".dialog-footer").boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(760);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: ".cache/admin-partner-review-mobile.png" });
  await page
    .getByRole("button", { name: "Review action", exact: true })
    .click();
  const failed = page.waitForResponse(
    (r) => r.url().endsWith("/review") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Approve partner", exact: true })
    .click();
  expect((await failed).status()).toBe(403);
  await expect(dialog.getByRole("alert")).toContainText("admin@browser.test");
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Review reason", { exact: true })).toHaveValue(
    "Reviewed sandbox business application",
  );
  await page.getByLabel("Current password", { exact: true }).fill(password);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("button", { name: "Review action", exact: true })
    .click();
  await page.screenshot({ path: ".cache/admin-partner-review-desktop.png" });
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/review") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Approve partner", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
});

// The API contract and credentials use disposable fixture data only.
test("developer reference exposes parameters and playground templates at desktop and mobile widths", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "API Documentation", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Authorized dated trip search/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Parameters & headers" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "journeyDate", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "JavaScript", exact: true }).click();
  await expect(
    page.locator("pre").filter({ hasText: "const response = await fetch" }),
  ).toContainText("journeyDate=");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download OpenAPI JSON" }).click();
  expect((await downloadEvent).suggestedFilename()).toBe(
    "aibus-public-api-v1-sandbox.json",
  );
  await page.screenshot({
    path: ".cache/partner-api-docs-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Find endpoint").fill("unknown-endpoint-name");
  await expect(page.getByText("No matching endpoints.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".cache/partner-api-docs-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "API Playground", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Authorized dated trip search/ })
    .click();
  await expect(page.getByLabel("Sandbox request JSON")).toContainText(
    "journeyDate",
  );
  await page
    .getByRole("button", {
      name: /Inspect supported and unavailable capabilities/,
    })
    .click();
  await page
    .getByRole("button", { name: "Run sandbox request", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Sandbox response" }),
  ).toContainText("HTTP 200");
  await page.screenshot({
    path: ".cache/partner-api-playground-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.screenshot({
    path: ".cache/partner-api-playground-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Inventory Access", exact: true })
    .click();
  await expect(
    page.getByText("Isolated Browser Operator", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Public trip ID" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".cache/partner-api-inventory-desktop.png",
    fullPage: true,
  });
  // Read authorized cities, then search the actual fixture date using the
  // same server-bound playground flow a partner uses. No booking is created.
  const inventoryResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/v1/partner/inventory") &&
      r.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const inventory = (await (await inventoryResponse).json()).data;
  await page
    .getByRole("button", { name: "API Playground", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Authorized source and destination cities/ })
    .click();
  const citiesResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/partner/playground") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Run sandbox request", exact: true })
    .click();
  const cities = (await (await citiesResponse).json()).data.response.data;
  await page
    .getByRole("button", { name: /Authorized dated trip search/ })
    .click();
  await page.getByLabel("Sandbox request JSON").fill(
    JSON.stringify({
      params: {},
      query: {
        from: cities.find((c: any) => c.name === "Pune").id,
        to: cities.find((c: any) => c.name === "Mumbai").id,
        journeyDate: inventory.trips[0].journeyDate,
      },
      body: {},
    }),
  );
  await page
    .getByRole("button", { name: "Run sandbox request", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Sandbox response" }),
  ).toContainText(inventory.trips[0].id);
  await page
    .getByRole("button", { name: "API Credentials", exact: true })
    .click();
  await expect(
    page.getByRole("columnheader", { name: "Status", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".cache/partner-api-credentials-desktop.png",
    fullPage: true,
  });
});
