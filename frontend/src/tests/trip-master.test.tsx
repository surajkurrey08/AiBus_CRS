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
import { TripMaster } from "../features/trip-master/TripMaster";
import {
  ScheduleServices,
  Availability,
} from "../features/trip-master/Workflows";
import { MasterForm } from "../features/trip-master/MasterForm";
vi.mock("../api/client", () => ({ api: vi.fn() }));
const ws = vi.hoisted(() => ({
  user: {
    permissions: [
      "read",
      "routes:write",
      "pricing:write",
      "fleet:write",
      "finance:read",
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
  vi.mocked(api).mockResolvedValue({
    data: [],
    meta: { page: 1, limit: 100, total: 0, pages: 1 },
  });
});
afterEach(cleanup);
it("opens Trip Master sections and provides actionable empty states", async () => {
  const onArea = vi.fn();
  render(
    <TripMaster
      onCounter={vi.fn()}
      onArea={onArea}
      routesContent={<p>Route configuration</p>}
      tripsContent={<p>Dated trip calendar</p>}
    />,
  );
  await screen.findByText("No services yet.");
  await userEvent.click(
    screen.getByRole("button", { name: "Cities & pickup / drop points" }),
  );
  expect(onArea).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("tab", { name: "Routes" }));
  expect(screen.getByText("Route configuration")).toBeTruthy();
  await userEvent.click(screen.getByRole("tab", { name: "Scheduled trips" }));
  expect(screen.getByText("Dated trip calendar")).toBeTruthy();
  await userEvent.click(
    screen.getByRole("tab", { name: "Multi-trip scheduling" }),
  );
  expect(screen.getByText("Create a service first.")).toBeTruthy();
});
it("requires explicit availability search and clears stale results when date changes", async () => {
  render(<Availability services={[]} onCounter={vi.fn()} />);
  expect(api).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Check availability" }),
  );
  expect(api).toHaveBeenCalledWith(
    expect.stringContaining("/availability?journeyDate="),
  );
  await screen.findByText("No records for this selection.");
  fireEvent.change(screen.getByLabelText("Journey date"), {
    target: { value: "2030-12-01" },
  });
  expect(
    screen.getByText("Choose a journey date, then check availability."),
  ).toBeTruthy();
});
it("invalidates the scheduling preview when dates change and does not create blocked batches", async () => {
  vi.mocked(api).mockResolvedValue({
    data: [
      {
        serviceName: "Daily",
        route: "Pune → Bhopal",
        registration: "MP01",
        journeyDate: "2030-12-01",
        state: "Bus conflict",
      },
    ],
  });
  render(
    <ScheduleServices
      services={[
        { _id: "s1", name: "Daily", departure: "21:30", status: "Active" },
      ]}
      refresh={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(
    screen.getByRole("button", { name: "Preview journeys" }),
  );
  const schedule = await screen.findByRole("button", {
    name: "Schedule previewed journeys",
  });
  expect((schedule as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("To date"), {
    target: { value: "2030-12-02" },
  });
  expect(screen.queryByText("Schedule previewed journeys")).toBeNull();
});
it("converts separate service fares to integer paise and sends selected operating days", async () => {
  const onSaved = vi.fn();
  render(
    <MasterForm
      resource="services"
      lookup={{
        routes: [{ _id: "r1", source: "Pune", destination: "Bhopal" }],
        buses: [{ _id: "b1", registration: "MP01", name: "Sleeper" }],
      }}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  );
  const form = within(screen.getByRole("dialog"));
  fireEvent.change(form.getByLabelText("Service name"), {
    target: { value: "Night sleeper" },
  });
  fireEvent.change(form.getByLabelText("Service code"), {
    target: { value: "PNQ-BPL" },
  });
  fireEvent.change(form.getByLabelText("Route"), { target: { value: "r1" } });
  fireEvent.change(form.getByLabelText("Default bus"), {
    target: { value: "b1" },
  });
  fireEvent.change(form.getByLabelText("Departure · IST"), {
    target: { value: "21:30" },
  });
  fireEvent.change(
    form.getByLabelText("Double-side fare per passenger · INR"),
    { target: { value: "2200" } },
  );
  fireEvent.change(
    form.getByLabelText("Single-side fare per passenger · INR"),
    { target: { value: "2500.50" } },
  );
  await userEvent.click(form.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const call = vi
    .mocked(api)
    .mock.calls.find(([p]) => p === "/operator/trip-master/services")!;
  expect(JSON.parse(String(call[1]!.body))).toMatchObject({
    doublePaise: 220000,
    singlePaise: 250050,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  });
});
