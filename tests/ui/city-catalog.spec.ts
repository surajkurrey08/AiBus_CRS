import { test, expect } from "@playwright/test";
for (const width of [1440, 390])
  test(`catalog preview, reviewed import and layout at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let commits = 0;
    const batch = {
      id: "0123456789abcdef01234567",
      source: "fixture-cities.json",
      counts: { ready: 1, conflict: 1, invalid: 0, duplicate: 0, existing: 0 },
      total: 2,
      cursor: 0,
      inserted: 0,
      skipped: 0,
      status: "Preview",
      rows: [
        { row: 1, name: "Pune", state: "Maharashtra", status: "ready" },
        {
          row: 2,
          name: "Ambiguous locality",
          state: "Maharashtra",
          status: "conflict",
          reason: "Review this locality manually.",
        },
      ],
    };
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data: any;
      if (path === "/api/v1/auth/refresh")
        data = {
          accessToken: "fixture-only-token",
          user: {
            id: "root",
            name: "Fixture Admin",
            email: "admin@fixture.test",
            role: "super_admin",
            operatorId: null,
            permissions: ["platform:settings:read", "platform:settings:write"],
          },
        };
      else if (path.endsWith("/commit")) {
        const body = route.request().postDataJSON();
        expect(body.cursor).toBe(0);
        expect(body.reason).toBe("Import fixture cities");
        commits++;
        Object.assign(batch, {
          status: "Complete",
          cursor: 2,
          inserted: 1,
          skipped: 1,
        });
        data = batch;
      } else if (path.includes("/imports/")) data = batch;
      else
        data = commits
          ? [
              {
                cityId: "city_fixture_test_id_001",
                name: "Pune",
                state: "Maharashtra",
                key: "pune-maharashtra-india",
                status: "Active",
              },
            ]
          : [];
      await route.fulfill({
        json: {
          data,
          meta: {
            page: 1,
            limit: 25,
            total: Array.isArray(data) ? data.length : 1,
            pages: 1,
          },
        },
      });
    });
    await page.goto("/");
    await expect(
      page
        .getByRole("heading", { name: "Central City Master", exact: true })
        .first(),
    ).toBeVisible();
    await page
      .getByLabel("Import city JSON")
      .setInputFiles({
        name: "fixture-cities.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            success: true,
            data: [{ CityId: 1, City: "Pune", State: "Maharashtra" }],
          }),
        ),
      });
    await expect(
      page.getByText("Review this locality manually."),
    ).toBeVisible();
    expect(commits).toBe(0);
    await page.screenshot({
      path: `.cache/city-catalog-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Review and import valid cities" })
      .click();
    await page
      .getByLabel("Business reason", { exact: true })
      .fill("Import fixture cities");
    await page
      .getByLabel("Your current password", { exact: true })
      .fill("Fixture-Password-Not-Live!");
    await page
      .getByRole("button", { name: "Review action", exact: true })
      .click();
    expect(commits).toBe(0);
    await page
      .getByRole("button", { name: "Record reviewed change", exact: true })
      .click();
    await expect(
      page.getByText("Import complete: 1 cities added; 1 records skipped."),
    ).toBeVisible();
    expect(commits).toBe(1);
  });
