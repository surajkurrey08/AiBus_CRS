// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiPartners } from "../features/platform/ApiPartners";
import { api } from "../api/client";
vi.mock("../api/client", () => ({
  api: vi.fn(),
  downloadPlatformCsv: vi.fn(),
}));
const user = {
  id: "root",
  name: "Admin",
  email: "admin@test",
  role: "super_admin",
  operatorId: null,
  permissions: ["platform:partners:read", "platform:partners:write"],
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("?")
      ? {
          data: [
            {
              _id: "org",
              name: "Applied Company",
              onboardingStatus: "Submitted",
            },
          ],
          meta: { page: 1, limit: 25, total: 1, pages: 1 },
        }
      : {
          data: {
            partner: {
              name: "Applied Company",
              onboardingStatus: "Submitted",
              revision: 0,
              scopes: [],
              requestsPerMinute: 120,
            },
            credentials: [],
            inventory: {},
            usage: {},
            failures: [],
            bookings: [],
            support: [],
            audit: [],
          },
        },
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("reviews the selected application with explicit scopes, reason and current password", async () => {
  render(<ApiPartners user={user} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "View details" }),
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Review approval, scopes & limits",
    }),
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Application status"),
    "Approved",
  );
  await userEvent.click(screen.getByLabelText("inventory:read"));
  await userEvent.type(
    screen.getByLabelText("Review reason"),
    "Reviewed sandbox company approval",
  );
  await userEvent.type(
    screen.getByLabelText("Current password"),
    "Reviewed-test-password",
  );
  await userEvent.click(screen.getByRole("button", { name: "Review action" }));
  expect(
    vi
      .mocked(api)
      .mock.calls.some(
        ([p, o]) => p.endsWith("/review") && o?.method === "POST",
      ),
  ).toBe(false);
  await userEvent.click(
    screen.getByRole("button", { name: "Approve partner" }),
  );
  const call = vi
    .mocked(api)
    .mock.calls.find(([p, o]) => p.endsWith("/review") && o?.method === "POST");
  expect(call).toBeTruthy();
  expect(JSON.parse(call![1]!.body as string)).toMatchObject({
    status: "Approved",
    scopes: ["inventory:read"],
    version: 0,
  });
});
it("shows metadata without granting review controls to a read-only platform user", async () => {
  render(
    <ApiPartners user={{ ...user, permissions: ["platform:partners:read"] }} />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "View details" }),
  );
  expect(await screen.findByText("Application details")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Review approval, scopes & limits" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Manage inventory grant" }),
  ).toBeNull();
});
