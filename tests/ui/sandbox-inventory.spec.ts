import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`named sandbox grant, password recovery and layout at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: any[] = [];
    let assigned = false;
    const partner = {
      _id: "0123456789abcdef01234567",
      name: "Fixture Company",
      onboardingStatus: "Approved",
      revision: 0,
      scopes: ["inventory:read"],
      requestsPerMinute: 120,
    };
    await page.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      let data: any;
      if (path.endsWith("/auth/refresh"))
        data = {
          accessToken: "fixture-only-token",
          user: {
            id: "root",
            name: "Fixture Admin",
            email: "admin@fixture.test",
            role: "super_admin",
            operatorId: null,
            permissions: ["platform:partners:read", "platform:partners:write"],
          },
        };
      else if (path.endsWith("/inventory-options"))
        data =
          url.searchParams.get("kind") === "Operator"
            ? [{ id: "operator-a", label: "Isolated Test Fleet" }]
            : [
                {
                  id: "trip-a",
                  label: "Pune → Mumbai · 2030-01-01 · 08:00 pm IST",
                },
              ];
      else if (path.endsWith("/grants")) {
        const body = route.request().postDataJSON();
        writes.push(body);
        if (body.password !== "Reviewed-Fixture-Password!") {
          await route.fulfill({
            status: 403,
            json: {
              error: {
                code: "STEP_UP_REQUIRED",
                message: "Verify your current password",
              },
            },
          });
          return;
        }
        assigned = true;
        data = { id: "grant-a", active: true };
      } else if (path.endsWith("/" + partner._id))
        data = {
          partner,
          credentials: [],
          inventory: {
            grants: assigned
              ? [
                  {
                    id: "grant-a",
                    operatorId: "operator-a",
                    operator: "Isolated Test Fleet",
                    kind: "Trip",
                    targetId: "trip-a",
                    active: true,
                  },
                ]
              : [],
            trips: [],
          },
          usage: {},
          failures: [],
          bookings: [],
          support: [],
          audit: [],
        };
      else data = [partner];
      await route.fulfill({
        json: {
          data,
          meta: {
            page: 1,
            limit: 100,
            total: Array.isArray(data) ? data.length : 1,
            pages: 1,
          },
        },
      });
    });
    await page.goto("/");
    await page
      .getByRole("button", { name: "View details", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Manage inventory grant", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Manage sandbox inventory grant",
      exact: true,
    });
    await expect(
      page.getByLabel("Sandbox operator ID", { exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByLabel("Sandbox operator", { exact: true }).locator("option"),
    ).toHaveCount(2);
    await dialog
      .getByLabel("Sandbox operator", { exact: true })
      .selectOption({ label: "Isolated Test Fleet" });
    await expect(
      dialog.getByLabel("Sandbox resource", { exact: true }).locator("option"),
    ).toHaveCount(2);
    // Native controls keep their platform keyboard model and never require an ID.
    await dialog.getByLabel("Sandbox resource", { exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(
      dialog.getByLabel("Sandbox resource", { exact: true }),
    ).toHaveValue("trip-a");
    await dialog
      .getByLabel("Review reason", { exact: true })
      .fill("Reviewed test inventory for this company");
    await dialog
      .getByLabel("Current password", { exact: true })
      .fill("wrong-password");
    await page.keyboard.press("Escape");
    await expect(
      dialog.getByRole("heading", { name: "Discard unsaved admin changes?" }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(
      dialog.getByLabel("Sandbox resource", { exact: true }),
    ).toHaveValue("trip-a");
    await page.screenshot({
      path: `.cache/sandbox-inventory-${width}.png`,
      fullPage: true,
    });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await expect(
      dialog.getByRole("button", { name: "Review action", exact: true }),
    ).toBeInViewport();
    await dialog
      .getByRole("button", { name: "Review action", exact: true })
      .click();
    expect(writes).toHaveLength(0);
    await expect(
      dialog.getByRole("button", { name: "Grant sandbox access", exact: true }),
    ).toBeInViewport();
    await dialog
      .getByRole("button", { name: "Grant sandbox access", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Password verification failed",
    );
    await expect(
      dialog.getByLabel("Current password", { exact: true }),
    ).toHaveValue("");
    await dialog
      .getByLabel("Current password", { exact: true })
      .fill("Reviewed-Fixture-Password!");
    await dialog
      .getByRole("button", { name: "Review action", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Grant sandbox access", exact: true })
      .click();
    await expect(
      page.getByText("Sandbox inventory access updated.", { exact: true }),
    ).toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      operatorId: "operator-a",
      kind: "Trip",
      targetId: "trip-a",
      active: true,
      key: writes[0].key,
    });
  });
}
