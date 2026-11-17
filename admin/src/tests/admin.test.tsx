// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminApp } from "../app/App";
import { logout } from "../api/client";

const admin = {
  id: "admin-1",
  name: "Platform Admin",
  email: "admin@example.test",
  role: "super_admin",
  operatorId: null,
  permissions: ["platform:manage"],
};
const company = {
  _id: "operator-1",
  company: "Pune Travels",
  email: "office@example.test",
  phone: "9876543210",
  address: "Pune",
  status: "pending",
  createdAt: "2026-11-14T00:00:00Z",
  counts: { buses: 3, routes: 2, scheduledTrips: 4 },
};
const reply = (data: unknown, status = 200, meta?: unknown) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { data, meta }
        : { error: { code: "FAILED", message: "Could not load operators" } },
    ),
    { status, headers: { "content-type": "application/json" } },
  );
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: any, options?: RequestInit) => {
      const url = String(path);
      if (url.endsWith("/auth/refresh")) return reply(null, 401);
      if (url.endsWith("/auth/login"))
        return reply({ accessToken: "admin-token", user: admin });
      if (url.endsWith("/platform/overview"))
        return reply({
          operators: { pending: 1 },
          totalOperators: 1,
          buses: 3,
          routes: 2,
          scheduledTrips: 4,
        });
      if (url.endsWith("/operators/operator-1/status"))
        return reply({
          ...company,
          status: JSON.parse(options?.body as string).status,
        });
      if (url.endsWith("/operators/operator-1")) return reply(company);
      if (url.includes("/platform/operators?"))
        return reply([company], 200, {
          page: 1,
          limit: 10,
          total: 1,
          pages: 1,
        });
      return reply({});
    }),
  );
});
afterEach(async () => {
  await logout().catch(() => {});
  cleanup();
  vi.unstubAllGlobals();
});
async function signIn() {
  const user = userEvent.setup();
  render(<AdminApp />);
  await user.type(await screen.findByLabelText("Email"), admin.email);
  await user.type(screen.getByLabelText("Password"), "example-password-123");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: "Admin overview" });
  return user;
}
it("opens the separate admin app, reviews company details and confirms status changes", async () => {
  const user = await signIn();
  await user.click(screen.getByRole("button", { name: "Bus Operators" }));
  await user.click(await screen.findByRole("button", { name: "View details" }));
  const details = within(
    screen.getByRole("dialog", { name: "Operator details" }),
  );
  expect(await details.findByText("Pune Travels")).toBeTruthy();
  expect(details.getByText("9876543210")).toBeTruthy();
  expect(details.getByText("Scheduled trips")).toBeTruthy();
  await user.click(
    details.getByRole("button", { name: "Change operator status" }),
  );
  const confirmation = within(
    screen.getByRole("dialog", { name: "Change operator status" }),
  );
  expect(
    vi.mocked(fetch).mock.calls.some(([, o]) => o?.method === "PATCH"),
  ).toBe(false);
  await user.selectOptions(
    confirmation.getByLabelText("New status"),
    "approved",
  );
  await user.click(
    confirmation.getByRole("button", { name: "Confirm status change" }),
  );
  expect(await screen.findByText("Pune Travels is now approved.")).toBeTruthy();
  const saved = vi
    .mocked(fetch)
    .mock.calls.find(([, o]) => o?.method === "PATCH")!;
  expect(JSON.parse(saved[1]!.body as string)).toEqual({ status: "approved" });
  expect(new Headers(saved[1]?.headers).get("X-Aibus-Client")).toBe("admin");
});
it("shows an API failure and recovers through retry", async () => {
  const user = await signIn();
  const original = vi.mocked(fetch).getMockImplementation()!;
  let fail = true;
  vi.mocked(fetch).mockImplementation(async (...args) =>
    String(args[0]).includes("/platform/operators?") && fail
      ? reply(null, 500)
      : original(...args),
  );
  await user.click(screen.getByRole("button", { name: "Bus Operators" }));
  expect(await screen.findByText("Could not load operators")).toBeTruthy();
  expect(screen.queryByText("No matching operators")).toBeNull();
  fail = false;
  await user.click(screen.getByRole("button", { name: "Retry operators" }));
  expect(await screen.findByText("Pune Travels")).toBeTruthy();
});
it("sends search and status filters to the platform API", async () => {
  const user = await signIn();
  await user.click(screen.getByRole("button", { name: "Bus Operators" }));
  await user.type(screen.getByLabelText("Search operators"), "Pune");
  await user.selectOptions(
    screen.getByLabelText("Operator status filter"),
    "pending",
  );
  await waitFor(() =>
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([url]) =>
          String(url).includes("search=Pune&status=pending"),
        ),
    ).toBe(true),
  );
});
