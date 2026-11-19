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
import { api } from "../api/client";
import { LiveStaff } from "../features/settings/StaffManagement";
import { AgentForm } from "../features/settings/components/AgentForm";
vi.mock("../api/client", () => ({ api: vi.fn() }));
const ws = vi.hoisted(() => ({
  demo: false,
  revision: 0,
  user: { permissions: ["agents:read", "agents:write", "staff:write"] },
  raw: { staff: [], buses: [] },
  refresh: vi.fn(async () => {}),
  notify: vi.fn(),
}));
vi.mock("../context/WorkspaceContext", () => ({ useWorkspace: () => ws }));
beforeEach(() => {
  vi.clearAllMocks();
  ws.revision = 0;
  ws.user.permissions = ["agents:read", "agents:write", "staff:write"];
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(api).mockResolvedValue({ data: { agents: [], totals: {} } });
});
afterEach(cleanup);
it("creates an agency with zero commission and selected booking privileges through the canonical API", async () => {
  const user = userEvent.setup();
  render(<LiveStaff />);
  await screen.findByText("No agencies yet");
  await user.click(screen.getByRole("button", { name: "Add agency" }));
  const dialog = within(screen.getByRole("dialog"));
  await user.type(dialog.getByLabelText("Agency name"), "Pune Travel Agency");
  await user.clear(dialog.getByLabelText("Commission percentage (%)"));
  await user.type(dialog.getByLabelText("Commission percentage (%)"), "0");
  await user.click(dialog.getByLabelText("Request cancellations"));
  await user.click(dialog.getByRole("button", { name: "Save agency" }));
  await waitFor(() => expect(ws.notify).toHaveBeenCalledWith("Agency saved"));
  const call = vi
    .mocked(api)
    .mock.calls.find(
      ([path, options]) =>
        path === "/operator/agents" && options?.method === "POST",
    )!;
  const payload = JSON.parse(String(call[1]!.body));
  expect(payload).toMatchObject({
    name: "Pune Travel Agency",
    commissionType: "Percent",
    commissionRate: 0,
    status: "Active",
  });
  expect(payload.permissions).not.toContain("cancel");
  expect(payload.permissions).toContain("book");
  expect(
    vi
      .mocked(api)
      .mock.calls.some(
        ([path, opts]) => path === "/operator/staff" && opts?.method === "POST",
      ),
  ).toBe(false);
});
it("validates commissions and keeps drafts after failure", async () => {
  const user = userEvent.setup(),
    save = vi.fn().mockRejectedValue(new Error("Agency could not be saved"));
  render(
    <AgentForm
      agency={{ name: "Original", commissionRate: 0 }}
      buses={[]}
      onClose={vi.fn()}
      onSave={save}
    />,
  );
  const rate = screen.getByLabelText("Commission percentage (%)");
  expect((rate as HTMLInputElement).value).toBe("0");
  await user.clear(rate);
  await user.type(rate, "101");
  await user.click(screen.getByRole("button", { name: "Save agency" }));
  expect(save).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(rate);
  await user.clear(rate);
  await user.type(rate, "5");
  await user.click(screen.getByRole("button", { name: "Save agency" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Agency could not be saved",
  );
  expect((screen.getByLabelText("Agency name") as HTMLInputElement).value).toBe(
    "Original",
  );
});
it("shows API failures with retry and never substitutes fabricated agent sales", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Agency reports unavailable"));
  const user = userEvent.setup();
  render(<LiveStaff />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Agency reports unavailable",
  );
  await user.click(screen.getByRole("button", { name: "Retry agencies" }));
  expect(await screen.findByText("No agencies yet")).toBeTruthy();
});
it("requests no private agent data for read-only staff", async () => {
  ws.user.permissions = ["read"];
  render(<LiveStaff />);
  expect(
    screen.getByText("You do not have permission to view agent management."),
  ).toBeTruthy();
  expect(api).not.toHaveBeenCalled();
});
it("preserves unsaved permission changes until discard is confirmed", async () => {
  const user = userEvent.setup(),
    close = vi.fn();
  render(
    <AgentForm
      agency={{ name: "Agency" }}
      buses={[]}
      onClose={close}
      onSave={vi.fn()}
    />,
  );
  await user.click(screen.getByLabelText("Request cancellations"));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(
    (screen.getByLabelText("Request cancellations") as HTMLInputElement)
      .checked,
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(close).toHaveBeenCalledOnce();
});
it("keeps an agency history request active during a workspace refresh", async () => {
  const agent = {
    id: "agency-1",
    name: "Pune Agency",
    active: true,
    commissionRate: 500,
  };
  let resolveHistory!: (value: any) => void;
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith("/bookings")
      ? await new Promise((resolve) => {
          resolveHistory = resolve;
        })
      : { data: { agents: [agent], totals: {} } },
  );
  const user = userEvent.setup(),
    view = render(<LiveStaff />);
  await user.click(
    await screen.findByRole("button", { name: "View bookings" }),
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Loading agency bookings",
  );
  ws.revision++;
  view.rerender(<LiveStaff />);
  resolveHistory({
    data: {
      agent: { ...agent, linkedUsers: [] },
      bookings: [
        {
          id: "booking-1",
          pnr: "AGENT-BOOK",
          passengerName: "Passenger",
          seats: ["L1"],
          totalPaise: 10000,
          status: "Confirmed",
          paymentStatus: "Paid",
        },
      ],
    },
  });
  expect((await screen.findAllByText("AGENT-BOOK")).length).toBeGreaterThan(0);
});
