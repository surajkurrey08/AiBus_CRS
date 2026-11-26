import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, client: "operator" | "admin" | "audit") {
  await page.goto(
    client === "operator" ? "http://127.0.0.1:15173" : "http://127.0.0.1:15174",
  );
  await page
    .getByLabel("Email", { exact: true })
    .fill(client + "@browser.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Browser-Fixture-Password-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
test("admin login, operational health and explicit finance denial", async ({
  page,
}) => {
  await login(page, "admin");
  await expect(
    page.getByRole("heading", { name: "Admin overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Finance", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Cars & Trips", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Operations health", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No durable worker heartbeat has been recorded.", {
      exact: false,
    }),
  ).toBeVisible();
});
test("least-privilege admin sees only assigned audit module", async ({
  page,
}) => {
  await login(page, "audit");
  await expect(
    page.getByRole("heading", {
      name: "Security and audit history",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cars & Trips", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Admin Users & Roles", exact: true }),
  ).toHaveCount(0);
});
test("operator login, fleet and master navigation use real isolated records", async ({
  page,
}) => {
  await login(page, "operator");
  await expect(
    page.getByText("Browser Operator", { exact: true }).first(),
  ).toBeVisible();
<<<<<<< Updated upstream
  const navigation = page.getByRole("navigation", { name: "Workspace navigation" });
  await navigation.getByRole("button", { name: "Vehicle Master", exact: true }).click();
=======
  await page.getByRole("button", {name:"Vehicle Master",exact:true}).click();
>>>>>>> Stashed changes
  await expect(page.getByText("MH12CR4321",{exact:true})).toBeVisible();
  await expect(page.getByText("Browser Car",{exact:false}).first()).toBeVisible();
  await page.getByRole("button",{name:"Route Master",exact:true}).click();
  await expect(page.getByRole("button",{name:"Create route",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Trip Master",exact:true}).click();
  await expect(page.getByRole("button",{name:/schedule.*trip|create.*trip/i}).first()).toBeVisible();

});
test("anonymous browser cannot access authenticated administration", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:15174");
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  const response = await page.request.get(
    "http://127.0.0.1:14100/api/v1/platform/operations/health",
  );
  expect(response.status()).toBe(401);
});
