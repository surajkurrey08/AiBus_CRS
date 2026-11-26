import { test, expect } from "@playwright/test";

test("admin grants named sandbox inventory with reviewed password recovery", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:15174");
  await page.getByLabel("Email", { exact: true }).fill("admin@browser.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-Fixture-Password-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "API Partners", exact: true }).click();
  await page
    .getByRole("button", { name: "View details", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Manage inventory grant", exact: true })
    .click();
  await expect(
    page.getByLabel("Sandbox operator ID", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Sandbox operator").locator("option"),
  ).toHaveCount(2);
  await page
    .getByLabel("Sandbox operator", { exact: true })
    .selectOption({ label: "Isolated Browser Operator" });
  await expect(
    page.getByLabel("Sandbox resource").locator("option"),
  ).toHaveCount(2);
  await page
    .getByLabel("Sandbox resource", { exact: true })
    .selectOption({ index: 1 });
  await page
    .getByLabel("Review reason", { exact: true })
    .fill("Reviewed browser fixture trip access");
  await page
    .getByLabel("Current password", { exact: true })
    .fill("wrong-password");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Review action", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Grant sandbox access", exact: true }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "Grant sandbox access", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Password verification failed",
  );
  await expect(
    page.getByLabel("Current password", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("Current password", { exact: true })
    .fill("Browser-Fixture-Password-123!");
  await page
    .getByRole("button", { name: "Review action", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Grant sandbox access", exact: true })
    .click();
  await expect(
    page.getByText("Sandbox inventory access updated.", { exact: true }),
  ).toBeVisible();
});
