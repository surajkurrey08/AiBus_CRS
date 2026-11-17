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
import { BusMaster } from "../features/fleet/BusMaster";
vi.mock("../api/client", () => ({ api: vi.fn() }));
const ws = vi.hoisted(() => ({
  demo: false,
  revision: 0,
  user: { permissions: ["read", "fleet:write", "routes:write"] },
  raw: {
    buses: [
      {
        _id: "bus-1",
        registration: "MP04YM7789",
        name: "Aibus",
        capacity: 3,
        type: "AC Sleeper",
        status: "Active",
      },
    ],
  },
  refresh: vi.fn(async () => {}),
  notify: vi.fn(),
}));
vi.mock("../context/WorkspaceContext", () => ({ useWorkspace: () => ws }));
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/operator/buses/bus-1") return { data: ws.raw.buses[0] };
    if (path.startsWith("/operator/buses?"))
      return {
        data: ws.raw.buses,
        meta: { page: 1, limit: 100, total: 1, pages: 1 },
      };
    if (options?.method) return { data: { _id: "saved-1" } };
    return { data: [], meta: { page: 1, limit: 100, total: 0, pages: 1 } };
  });
});
afterEach(cleanup);
it("creates a reusable 2+1 chart from the Bus Master page with correct seat positions", async () => {
  const user = userEvent.setup();
  render(<BusMaster onAddBus={() => {}} />);
  await user.click(screen.getByRole("tab", { name: "Seat charts" }));
  const create = await screen.findByRole("button", {
    name: "Create seat charts",
  });
  await waitFor(() =>
    expect((create as HTMLButtonElement).disabled).toBe(false),
  );
  await user.click(create);
  const dialog = within(
    screen.getByRole("dialog", { name: "Create seat charts" }),
  );
  await user.type(dialog.getByLabelText("Chart name"), "Three seat sleeper");
  await user.clear(dialog.getByLabelText("Seat capacity"));
  await user.type(dialog.getByLabelText("Seat capacity"), "3");
  await user.selectOptions(dialog.getByLabelText("Decks"), "1");
  await user.click(dialog.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(ws.refresh).toHaveBeenCalled());
  const saved = vi
    .mocked(api)
    .mock.calls.find(
      ([path, options]) =>
        path === "/operator/bus-master/charts" && options?.method === "POST",
    )!;
  const payload = JSON.parse(saved[1]!.body as string);
  expect(payload.seats.map((seat: any) => seat.column)).toEqual([0, 1, 3]);
  expect(payload.seats.map((seat: any) => seat.farePaise)).toEqual([0, 0, 0]);
  expect(payload.name).toBe("Three seat sleeper");
});
it("links a bus to an owner and coach through its vehicle action", async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path.startsWith("/operator/bus-master/owners?"))
      return {
        data: [{ _id: "owner-1", name: "Fleet Owner", status: "Active" }],
      };
    if (path.startsWith("/operator/bus-master/coaches?"))
      return {
        data: [
          {
            _id: "coach-1",
            name: "Premium sleeper",
            type: "AC Sleeper",
            status: "Active",
          },
        ],
      };
    return original(path, options);
  });
  const user = userEvent.setup();
  render(<BusMaster onAddBus={() => {}} />);
  await user.click(
    await screen.findByRole("button", { name: /Configure bus/ }),
  );
  const dialog = within(
    screen.getByRole("dialog", { name: "Configure MP04YM7789" }),
  );
  expect(
    dialog.getByRole("button", { name: "Configure seat layout" }),
  ).toBeTruthy();
  await user.selectOptions(
    dialog.getByLabelText("Owner / proprietor"),
    "owner-1",
  );
  await user.selectOptions(dialog.getByLabelText("Coach type"), "coach-1");
  await user.click(
    dialog.getByRole("button", { name: "Save owner and coach" }),
  );
  expect(await dialog.findByText("Owner and coach saved.")).toBeTruthy();
  expect(api).toHaveBeenCalledWith(
    "/operator/bus-master/buses/bus-1/assignments",
    {
      method: "PATCH",
      body: JSON.stringify({ ownerId: "owner-1", coachTypeId: "coach-1" }),
    },
  );
});
