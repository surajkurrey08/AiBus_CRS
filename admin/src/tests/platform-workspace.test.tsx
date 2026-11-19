// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformScreen } from "../features/operators/PlatformScreen";
import { PlatformTable } from "../components/platform/PlatformTable";
import { PlatformUsers } from "../features/platform/PlatformUsers";
import { PlatformOverview } from "../features/platform/PlatformOverview";
import { FinanceReviewForm } from "../features/finance/FinanceReviewForm";
import { api } from "../api/client";
vi.mock("../api/client", () => ({
  api: vi.fn(),
  downloadPlatformCsv: vi.fn(),
  logout: vi.fn(),
}));
const root = {
  id: "root",
  name: "Root Admin",
  email: "root@test",
  role: "super_admin",
  operatorId: null,
  permissions: ["platform:manage"],
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("recovers from rejected password verification without losing the reviewed draft or request identity", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(
      Object.assign(new Error("Verify password"), { code: "STEP_UP_REQUIRED" }),
    )
    .mockResolvedValueOnce(undefined);
  render(
    <FinanceReviewForm
      title="Review partner"
      intent="platform"
      description="Review sandbox access"
      accountEmail="admin@browser.test"
      fields={[
        { name: "reason", label: "Review reason" },
        { name: "password", label: "Current password", type: "password" },
      ]}
      onSave={save}
      onClose={vi.fn()}
    />,
  );
  await userEvent.type(
    screen.getByLabelText("Review reason"),
    "Reviewed business approval",
  );
  await userEvent.type(
    screen.getByLabelText("Current password"),
    "wrong-password",
  );
  await userEvent.click(screen.getByRole("button", { name: "Review action" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Record reviewed change" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "admin@browser.test",
  );
  const password = screen.getByLabelText(
    "Current password",
  ) as HTMLInputElement;
  expect(password.value).toBe("");
  expect(document.activeElement).toBe(password);
  expect(
    (screen.getByLabelText("Review reason") as HTMLTextAreaElement).value,
  ).toBe("Reviewed business approval");
  await userEvent.type(password, "correct-password");
  await userEvent.click(screen.getByRole("button", { name: "Review action" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Record reviewed change" }),
  );
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[0][1]).toBe(save.mock.calls[1][1]);
});
it("keeps a dirty review dialog open on Escape until discard is confirmed", async () => {
  const close = vi.fn();
  render(
    <FinanceReviewForm
      title="Review partner"
      description="Review access"
      fields={[{ name: "reason", label: "Reason" }]}
      onSave={vi.fn()}
      onClose={close}
    />,
  );
  await userEvent.type(
    screen.getByLabelText("Reason"),
    "Unsaved business decision",
  );
  const event = new Event("cancel", { bubbles: true, cancelable: true });
  fireEvent(screen.getByRole("dialog"), event);
  expect(event.defaultPrevented).toBe(true);
  expect(close).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect((screen.getByLabelText("Reason") as HTMLTextAreaElement).value).toBe(
    "Unsaved business decision",
  );
});
it("shows only authorized modules and makes no hidden overview or finance request", async () => {
  vi.mocked(api).mockResolvedValue({
    data: [],
    meta: { page: 1, limit: 25, total: 0, pages: 1 },
  });
  render(
    <PlatformScreen
      user={{ ...root, permissions: ["platform:bookings:read"] }}
    />,
  );
  expect(await screen.findByText("No matching central bookings")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Overview" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Finance" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Admin Users & Roles" }),
  ).toBeNull();
  expect(
    vi
      .mocked(api)
      .mock.calls.every(([path]) => path.startsWith("/platform/bookings?")),
  ).toBe(true);
});
it("ignores stale search results after clearing a reference query and returns focus to search", async () => {
  let stale!: (v: any) => void;
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("search=PNR-A")
      ? new Promise((resolve) => {
          stale = resolve;
        })
      : {
          data: [{ id: "current", reference: "Current reference" }],
          meta: { page: 1, limit: 25, total: 1, pages: 1 },
        },
  );
  render(
    <PlatformTable
      title="Bookings"
      path="/platform/bookings"
      columns={[["reference", "Reference"]]}
    />,
  );
  const input = screen.getByLabelText("Search bookings");
  await userEvent.type(input, "PNR-A");
  await waitFor(() => expect(stale).toBeTypeOf("function"));
  await userEvent.click(
    screen.getByRole("button", { name: "Clear bookings search" }),
  );
  expect(document.activeElement).toBe(input);
  stale({
    data: [{ id: "old", reference: "Stale private result" }],
    meta: { page: 1, limit: 25, total: 1, pages: 1 },
  });
  expect(await screen.findByText("Current reference")).toBeTruthy();
  expect(screen.queryByText("Stale private result")).toBeNull();
});
it("creates staff only after review, with explicit limited grants and masked passwords", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/platform/capabilities"
      ? {
          data: {
            roles: [
              {
                profile: "Platform Operations",
                permissions: [
                  "platform:overview:read",
                  "platform:operators:read",
                ],
                defaultPermissions: ["platform:overview:read"],
              },
            ],
          },
        }
      : { data: [], meta: { page: 1, limit: 25, total: 0, pages: 1 } },
  );
  render(<PlatformUsers user={root} />);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Create admin staff",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Create admin staff" }),
  );
  await userEvent.type(
    screen.getByLabelText("Staff name"),
    "Operations Reader",
  );
  await userEvent.type(screen.getByLabelText("Staff email"), "ops@aibus.test");
  await userEvent.type(
    screen.getByLabelText("Initial staff password (12+ characters)"),
    "Initial-safe-password!",
  );
  await userEvent.type(
    screen.getByLabelText("Business reason"),
    "Approved operations account",
  );
  await userEvent.type(
    screen.getByLabelText("Your current password"),
    "Current-admin-password!",
  );
  expect(screen.getByLabelText("Your current password")).toHaveProperty(
    "type",
    "password",
  );
  await userEvent.click(screen.getByRole("button", { name: "Review action" }));
  expect(
    vi.mocked(api).mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
  expect(screen.queryByText("Current-admin-password!")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Record reviewed change" }),
  );
  await waitFor(() =>
    expect(
      vi
        .mocked(api)
        .mock.calls.some(
          ([path, options]) =>
            path === "/platform/admin-users" && options?.method === "POST",
        ),
    ).toBe(true),
  );
  const call = vi
    .mocked(api)
    .mock.calls.find(
      ([path, options]) =>
        path === "/platform/admin-users" && options?.method === "POST",
    )!;
  expect(JSON.parse(call[1]!.body as string)).toMatchObject({
    profile: "Platform Operations",
    permissions: ["platform:overview:read"],
    financeRead: false,
    financeActions: [],
  });
});
it("owns email validation, focuses invalid fields and preserves a draft until discard is confirmed", async () => {
  const save = vi.fn(),
    close = vi.fn();
  render(
    <FinanceReviewForm
      intent="platform"
      title="Edit staff"
      description="Privileged review"
      fields={[{ name: "email", label: "Staff email", type: "email" }]}
      onSave={save}
      onClose={close}
    />,
  );
  const input = screen.getByLabelText("Staff email");
  await userEvent.type(input, "invalid-email");
  await userEvent.click(screen.getByRole("button", { name: "Review action" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Enter a valid email address.",
  );
  expect(document.activeElement).toBe(input);
  expect(save).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Discard unsaved admin changes?")).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(input).toHaveProperty("value", "invalid-email");
});
it("re-masks explicitly revealed secrets at the review step", async () => {
  render(
    <FinanceReviewForm
      intent="platform"
      title="Verify access"
      description="Reverify"
      fields={[
        { name: "password", label: "Your current password", type: "password" },
      ]}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const input = screen.getByLabelText("Your current password");
  await userEvent.type(input, "Private-password");
  await userEvent.click(
    screen.getByRole("button", { name: "Show your current password" }),
  );
  expect(input).toHaveProperty("type", "text");
  await userEvent.click(screen.getByRole("button", { name: "Review action" }));
  expect(input).toHaveProperty("type", "password");
  expect(screen.queryByText("Private-password")).toBeNull();
});
it("shows genuine gross value separately from zero authorized platform earnings and recovers an overview failure", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(Error("Overview unavailable"))
    .mockResolvedValue({
      data: {
        metrics: { grossBookingValuePaise: 145000, platformEarningsPaise: 0 },
        trends: [],
        routes: [],
        recent: [],
        alerts: [],
      },
    });
  render(<PlatformOverview />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Overview unavailable"),
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry overview" }));
  expect(await screen.findByText("₹1,450.00")).toBeTruthy();
  expect(screen.getByText("₹0.00")).toBeTruthy();
  expect(screen.getByText("Authorized platform earnings")).toBeTruthy();
});
