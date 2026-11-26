// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { App } from "../app/App.tsx";
import { RecordForm } from "../components/index.ts";
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    value: function () {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    value: function () {
      this.removeAttribute("open");
    },
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
beforeEach(() => {
  localStorage.clear();
  // Demo booking fixtures belong to this journey date, independent of wall time.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T06:00:00+05:30"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("Operator workflows", () => {
  it("provides direct car-based navigation for Vehicle Master, Route Master, and Trip Master", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [],
              meta: { page: 1, limit: 100, total: 0, pages: 1 },
            }),
            { headers: { "content-type": "application/json" } },
          ),
      ),
    );
    try {
      const user = userEvent.setup();
      render(<App demo />);
      expect(screen.queryByRole("button", { name: "Bus & fleet" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Routes & trips" }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "Bus Master" })).toBeNull();

      // Directly accessible Vehicle Master in navigation
      const nav = screen.getByRole("navigation", { name: "Workspace navigation" });
      const carMasterBtn = within(nav).getByRole("button", { name: "Vehicle Master" });
      await user.click(carMasterBtn);
      expect(screen.getByText("Vehicle Fleet")).toBeTruthy();
      expect(carMasterBtn.getAttribute("aria-current")).toBe("page");

      // Directly accessible Trip Master in navigation
      const tripMasterBtn = within(nav).getByRole("button", { name: "Trip Master" });
      await user.click(tripMasterBtn);
      expect(screen.getByText("Car Trip Master")).toBeTruthy();
      expect(tripMasterBtn.getAttribute("aria-current")).toBe("page");

      // Directly accessible Seat Layout Designer
      const layoutBtn = within(nav).getByRole("button", { name: "Seat Layout Designer" });
      await user.click(layoutBtn);
      expect(screen.getAllByText(/Seat Layout Designer/i).length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("validates route duration and saves separate cities with overnight times", async () => {
    const user = userEvent.setup(),
      save = vi.fn();
    render(
      <RecordForm
        title="Add route"
        fields={[
          "source",
          "destination",
          "boarding",
          "dropping",
          "departure",
          "arrival",
          "durationMinutes",
          "status",
        ]}
        onSave={save}
        onClose={() => {}}
      />,
    );
    for (const [label, value] of Object.entries({
      "From city": "Pune",
      "To city": "Mumbai",
      "Boarding stops": "Nigdi, Wakad",
      "Dropping stops": "Vashi, Dadar",
      "Departure time · IST": "23:00",
      "Arrival time · IST": "03:00",
      "Journey duration · minutes": "0",
    })) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(save).not.toHaveBeenCalled();
    expect(
      screen.getByText("Enter whole minutes from 1 to 4320."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Journey duration · minutes"), {
      target: { value: "240" },
    });
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "Pune",
        destination: "Mumbai",
        route: "Pune → Mumbai",
        departure: "23:00",
        arrival: "03:00",
        durationMinutes: "240",
        status: "Active",
      }),
    );
  });
  it("opens all screens in the Car CRS navigation", async () => {
    const user = userEvent.setup();
    render(<App demo />);
    const labels = [
      "Vehicle Master",
      "Route Master",
      "Trip Master",
      "Seat Layout Designer",
      "Seat Availability",
      "Booking Counter",
      "Passenger Manifest",
      "Agents",
      "Finance",
      "Reports",
      "Settings",
    ];
    const nav = screen.getByRole("navigation", { name: "Workspace navigation" });
    for (const name of labels) {
      const btn = within(nav).getByRole("button", { name });
      await user.click(btn);
      expect(btn.getAttribute("aria-current")).toBe("page");
    }
  });
  it("validates and creates a car, then persists the new fleet record", async () => {
    const user = userEvent.setup();
    render(<App demo />);
    const nav = screen.getByRole("navigation", { name: "Workspace navigation" });
    await user.click(within(nav).getByRole("button", { name: "Vehicle Master" }));
    await user.click(screen.getByRole("button", { name: "Add Vehicle" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Add New Vehicle")).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", { name: "Save Car" }),
    );
    expect(
      screen.getByText(/Enter a valid Indian vehicle registration/),
    ).toBeTruthy();
    const registration = within(dialog).getByLabelText(
      "Vehicle Registration Number",
    );
    await user.type(registration, "TS-09-ZZ-9999");
    await user.type(within(dialog).getByLabelText("Car Make"), "Maruti Suzuki");
    await user.type(within(dialog).getByLabelText("Car Model"), "Dzire");
    await user.click(
      within(dialog).getByRole("button", { name: "Save Car" }),
    );
    expect(screen.getByText("TS-09-ZZ-9999")).toBeTruthy();
  });
  it("shows passenger manifest and toggles passenger check-in", async () => {
    const user = userEvent.setup();
    render(<App demo />);
    await user.click(
      screen.getByRole("button", { name: "Passenger Manifest" }),
    );
    await user.click(
      screen.getAllByRole("button", { name: "Toggle check-in" })[0],
    );
    expect(screen.queryByText("Checked in")).toBeNull();
  });
});
