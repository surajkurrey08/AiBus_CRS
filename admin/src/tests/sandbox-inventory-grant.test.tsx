// @vitest-environment jsdom
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SandboxInventoryGrant } from "../features/platform/SandboxInventoryGrant";
import { api } from "../api/client";
vi.mock("../api/client", () => ({ api: vi.fn() }));
const saved = vi.fn(),
  closed = vi.fn();
const response = (data: any[], total = data.length) => ({
  data,
  meta: {
    page: 1,
    limit: 100,
    total,
    pages: Math.max(1, Math.ceil(total / 100)),
  },
});
const defaultRequest = async (path: string, options?: RequestInit) => {
  if (options?.method === "POST") return { data: { id: "grant" } };
  const query = new URL(path, "https://admin.test").searchParams;
  if (query.get("kind") === "Operator")
    return response([
      { id: "operator-a", label: "Sandbox Fleet A" },
      { id: "operator-b", label: "Sandbox Fleet B" },
    ]);
  return response([
    {
      id: "trip-" + query.get("operatorId"),
      label: "Pune → Mumbai · 2030-01-01 · 08:00 pm IST",
    },
  ]);
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(api).mockImplementation(defaultRequest);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const show = () =>
  render(
    <SandboxInventoryGrant
      partnerId="partner-record"
      partnerName="Reviewed Company"
      accountEmail="admin@test"
      onClose={closed}
      onSaved={saved}
    />,
  );
async function chooseTrip() {
  await screen.findByRole("option", { name: "Sandbox Fleet A" });
  await userEvent.selectOptions(
    screen.getByLabelText("Sandbox operator"),
    "operator-a",
  );
  await screen.findByRole("option", { name: /Pune → Mumbai/ });
  await userEvent.selectOptions(
    screen.getByLabelText("Sandbox resource"),
    "trip-operator-a",
  );
}
const writes = () =>
  vi.mocked(api).mock.calls.filter(([, options]) => options?.method === "POST");

it("selects named sandbox inventory and uses the existing password-reviewed grant flow", async () => {
  show();
  expect(screen.queryByLabelText("Sandbox operator ID")).toBeNull();
  await chooseTrip();
  await userEvent.type(
    screen.getByLabelText("Review reason"),
    "Allow reviewed company test bookings",
  );
  await userEvent.type(
    screen.getByLabelText("Current password"),
    "private-password",
  );
  await userEvent.click(screen.getByRole("button", { name: "Review action" }));
  expect(writes()).toHaveLength(0);
  expect(screen.getAllByText("Sandbox Fleet A").length).toBeGreaterThan(0);
  expect(
    (screen.getByLabelText("Current password") as HTMLInputElement).type,
  ).toBe("password");
  expect(screen.queryByText("private-password")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Grant sandbox access" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(writes()).toHaveLength(1);
  const [path, options] = writes()[0];
  expect(path).toBe("/platform/api-partners/partner-record/grants");
  const body = JSON.parse(options!.body as string);
  expect(body).toMatchObject({
    operatorId: "operator-a",
    kind: "Trip",
    targetId: "trip-operator-a",
    active: true,
    reason: "Allow reviewed company test bookings",
    password: "private-password",
  });
  expect(body.expiresAt).toMatch(/T18:29:59\.000Z$/);
  expect(body.operatorSearch).toBeUndefined();
  expect(body.resourceSearch).toBeUndefined();
  expect(closed).toHaveBeenCalledOnce();
});
it("clears dependent choices when the operator changes and discards stale resource responses", async () => {
  let resolveOld: (value: any) => void = () => {};
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path.includes("operatorId=operator-a"))
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    return defaultRequest(path, options);
  });
  show();
  await screen.findByRole("option", { name: "Sandbox Fleet A" });
  await userEvent.selectOptions(
    screen.getByLabelText("Sandbox operator"),
    "operator-a",
  );
  await waitFor(() =>
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) => path.includes("operatorId=operator-a")),
    ).toBe(true),
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Sandbox operator"),
    "operator-b",
  );
  await screen.findByRole("option", { name: /Pune → Mumbai/ });
  resolveOld(response([{ id: "stale-trip", label: "Stale trip" }]));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Sandbox resource") as HTMLSelectElement).value,
    ).toBe(""),
  );
  expect(screen.queryByRole("option", { name: "Stale trip" })).toBeNull();
  await userEvent.selectOptions(
    screen.getByLabelText("Sandbox resource"),
    "trip-operator-b",
  );
  expect(
    (screen.getByLabelText("Sandbox resource") as HTMLSelectElement).value,
  ).toBe("trip-operator-b");
});
it("shows loading and recoverable failures instead of requesting pasted IDs", async () => {
  vi.mocked(api).mockRejectedValue(new Error("Sandbox connection unavailable"));
  show();
  expect(screen.getByRole("status").textContent).toContain("Loading");
  expect(
    (screen.getByRole("button", { name: "Review action" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Sandbox connection unavailable",
  );
  vi.mocked(api).mockImplementation(defaultRequest);
  await userEvent.click(
    screen.getByRole("button", { name: "Retry inventory" }),
  );
  await screen.findByRole("option", { name: "Sandbox Fleet A" });
  expect(screen.queryByRole("alert")).toBeNull();
});
it("keeps the grant decision and retry key after rejected password verification", async () => {
  let first = true;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (options?.method === "POST" && first) {
      first = false;
      throw Object.assign(new Error("Verify password"), {
        code: "STEP_UP_REQUIRED",
      });
    }
    return defaultRequest(path, options);
  });
  show();
  await chooseTrip();
  await userEvent.type(
    screen.getByLabelText("Review reason"),
    "Reviewed inventory integration",
  );
  await userEvent.type(
    screen.getByLabelText("Current password"),
    "wrong-password",
  );
  await userEvent.click(screen.getByRole("button", { name: "Review action" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Grant sandbox access" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Password verification failed",
  );
  expect(
    (screen.getByLabelText("Current password") as HTMLInputElement).value,
  ).toBe("");
  expect(
    (screen.getByLabelText("Sandbox resource") as HTMLSelectElement).value,
  ).toBe("trip-operator-a");
  await userEvent.type(
    screen.getByLabelText("Current password"),
    "correct-password",
  );
  await userEvent.click(screen.getByRole("button", { name: "Review action" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Grant sandbox access" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(JSON.parse(writes()[0][1]!.body as string).key).toBe(
    JSON.parse(writes()[1][1]!.body as string).key,
  );
});
it("explains missing test inventory without inventing operator or trip choices", async () => {
  vi.mocked(api).mockResolvedValue(response([]));
  show();
  expect(
    await screen.findByText(/No approved sandbox operators are available/),
  ).toBeTruthy();
  expect(screen.queryByRole("option", { name: /Sandbox Fleet/ })).toBeNull();
  expect(writes()).toHaveLength(0);
});
it("can disable previously assigned inventory when it is no longer in eligible choices", async () => {
  vi.mocked(api).mockImplementation(async (path, options) =>
    options?.method === "POST" ? { data: { id: "old-grant" } } : response([]),
  );
  render(
    <SandboxInventoryGrant
      partnerId="partner-record"
      partnerName="Reviewed Company"
      accountEmail="admin@test"
      grants={[
        {
          operatorId: "old-operator",
          operator: "Previously assigned fleet",
          kind: "Trip",
          targetId: "old-trip",
        },
      ]}
      onClose={closed}
      onSaved={saved}
    />,
  );
  await screen.findByRole("option", { name: "Previously assigned fleet" });
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Sandbox operator") as HTMLSelectElement).disabled,
    ).toBe(false),
  );
  await userEvent.selectOptions(screen.getByLabelText("Access"), "false");
  await userEvent.selectOptions(
    screen.getByLabelText("Sandbox operator"),
    "old-operator",
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Sandbox resource"),
    "old-trip",
  );
  await userEvent.type(
    screen.getByLabelText("Review reason"),
    "Disable expired test inventory access",
  );
  await userEvent.type(
    screen.getByLabelText("Current password"),
    "private-password",
  );
  await userEvent.click(screen.getByRole("button", { name: "Review action" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Disable sandbox access" }),
  );
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(JSON.parse(writes()[0][1]!.body as string)).toMatchObject({
    operatorId: "old-operator",
    targetId: "old-trip",
    active: false,
  });
});
