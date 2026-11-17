// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { TripControls } from "../features/trips/TripControls";
import { LayoutEditor } from "../features/fleet/SeatLayoutEditor";

vi.mock("../api/client", () => ({ api: vi.fn() }));
const ws = vi.hoisted(() => ({
  demo: false,
  revision: 0,
  user: { permissions: ["routes:write", "fleet:write", "pricing:write"] },
  raw: {
    trips: [],
    buses: [
      {
        _id: "bus-1",
        registration: "MP04YM7789",
        name: "Choudhary's Travels",
        type: "AC Seater",
        capacity: 2,
      },
    ],
    routes: [{ _id: "route-1", departure: "19:00" }],
  },
  records: { routes: [{ id: "route-1", route: "Pune → Bhopal" }] },
  refresh: vi.fn(async () => {}),
  notify: vi.fn(),
}));
vi.mock("../context/WorkspaceContext", () => ({ useWorkspace: () => ws }));
beforeEach(() => {
  vi.clearAllMocks();
  ws.raw.buses[0].capacity = 2;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

it("keeps pricing out of layout setup and preserves existing seat fares", async () => {
  vi.mocked(api).mockImplementation(async (_path, options) => ({
    data:
      options?.method === "PUT"
        ? {}
        : {
            seats: [
              { number: "L1", farePaise: 220000 },
              { number: "L2", farePaise: 250000 },
            ],
          },
  }));
  const user = userEvent.setup();
  render(<LayoutEditor busId="bus-1" />);
  await user.click(
    screen.getByRole("button", { name: "Configure seat layout" }),
  );
  expect(screen.queryByLabelText(/fare/i)).toBeNull();
  expect(
    screen.getByText(/Set double-side and single-side prices in the Fares tab/),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save layout" }));
  await waitFor(() =>
    expect(vi.mocked(api).mock.calls.some(([, o]) => o?.method === "PUT")).toBe(
      true,
    ),
  );
  const saved = vi.mocked(api).mock.calls.find(([, o]) => o?.method === "PUT")!;
  expect(
    JSON.parse(saved[1]!.body as string).seats.map(
      (seat: any) => seat.farePaise,
    ),
  ).toEqual([220000, 250000]);
});

afterEach(cleanup);

it("accepts separate double and single fares while scheduling and requires both prices", async () => {
  vi.mocked(api).mockResolvedValue({
    data: [],
    meta: { page: 1, limit: 6, total: 0, pages: 1 },
  });
  const user = userEvent.setup();
  render(<TripControls />);
  await user.click(screen.getByRole("button", { name: "Schedule a trip" }));
  const form = within(screen.getByRole("dialog", { name: "Schedule a trip" }));
  await user.selectOptions(form.getByLabelText("Bus"), "bus-1");
  await user.selectOptions(form.getByLabelText("Route"), "route-1");
  fireEvent.change(form.getByLabelText("Journey date"), {
    target: { value: "2026-11-16" },
  });
  await user.type(
    form.getByLabelText("Double-side fare (2) · INR per person"),
    "2200",
  );
  await user.click(form.getByRole("button", { name: "Schedule trip" }));
  expect((await form.findByRole("alert")).textContent).toContain("Enter both");
  expect(vi.mocked(api).mock.calls.some(([, o]) => o?.method === "POST")).toBe(
    false,
  );
  await user.type(
    form.getByLabelText("Single-side fare (1) · INR per person"),
    "2500.50",
  );
  await user.click(form.getByRole("button", { name: "Schedule trip" }));
  await waitFor(() => expect(ws.notify).toHaveBeenCalledWith("Trip scheduled"));
  const post = vi.mocked(api).mock.calls.find(([, o]) => o?.method === "POST")!;
  expect(JSON.parse(post[1]!.body as string)).toMatchObject({
    seatSideFares: { doublePaise: 220000, singlePaise: 250050 },
  });
});

it("saves a missing layout inside scheduling without submitting the trip or losing its draft", async () => {
  let layoutSaved = false;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/operator/trips" && options?.method === "POST") {
      if (!layoutSaved)
        throw Error("Configure the bus seat layout before creating a trip");
      return { data: {} };
    }
    if (path === "/operator/buses/bus-1/layout" && options?.method === "PUT") {
      layoutSaved = true;
      return { data: {} };
    }
    return { data: [], meta: { page: 1, limit: 6, total: 0, pages: 1 } };
  });
  const user = userEvent.setup();
  const tripPosts = () =>
    vi
      .mocked(api)
      .mock.calls.filter(
        ([path, options]) =>
          path === "/operator/trips" && options?.method === "POST",
      );
  render(<TripControls />);
  await user.click(screen.getByRole("button", { name: "Schedule a trip" }));
  const schedule = within(
    screen.getByRole("dialog", { name: "Schedule a trip" }),
  );
  await user.selectOptions(schedule.getByLabelText("Bus"), "bus-1");
  await user.selectOptions(schedule.getByLabelText("Route"), "route-1");
  fireEvent.change(schedule.getByLabelText("Journey date"), {
    target: { value: "2026-11-16" },
  });
  await user.click(schedule.getByRole("button", { name: "Schedule trip" }));
  expect((await schedule.findByRole("alert")).textContent).toContain(
    "Configure the bus seat layout",
  );
  await user.click(
    schedule.getByRole("button", { name: "Configure seat layout" }),
  );
  expect(tripPosts()).toHaveLength(1);
  const layout = within(
    screen.getByRole("dialog", { name: "Configure seat layout" }),
  );
  expect(
    (layout.getByLabelText("Layout type") as HTMLSelectElement).value,
  ).toBe("seater");
  expect((layout.getByLabelText("Decks") as HTMLSelectElement).value).toBe("1");
  await user.click(layout.getByRole("button", { name: "Save layout" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Configure seat layout" }),
    ).toBeNull(),
  );
  expect(tripPosts()).toHaveLength(1);
  expect(schedule.queryByRole("alert")).toBeNull();
  expect(
    (schedule.getByLabelText("Journey date") as HTMLInputElement).value,
  ).toBe("2026-11-16");
  expect(
    (schedule.getByLabelText("Departure · IST") as HTMLInputElement).value,
  ).toBe("19:00");
  await user.click(schedule.getByRole("button", { name: "Schedule trip" }));
  await waitFor(() => expect(ws.notify).toHaveBeenCalledWith("Trip scheduled"));
  expect(tripPosts()).toHaveLength(2);
  expect(JSON.parse(tripPosts()[1][1]!.body as string)).toMatchObject({
    busId: "bus-1",
    routeId: "route-1",
    journeyDate: "2026-11-16",
    departureAt: "2026-11-16T19:00:00+05:30",
  });
});
