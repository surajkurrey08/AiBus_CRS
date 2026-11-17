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
  it("groups Bus, Area and Trip Master on the dedicated Master page", async () => {
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
      const masterToggle = screen.getByRole("button", { name: "Master" });
      expect(screen.queryByRole("dialog", { name: "Master" })).toBeNull();
      await user.click(masterToggle);
      expect(
        screen.getByRole("heading", { level: 1, name: "Master" }),
      ).toBeTruthy();
      expect(masterToggle.getAttribute("aria-current")).toBe("page");
      expect(screen.queryByRole("dialog", { name: "Master" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Bus Master" }));
      expect(
        screen.getByRole("heading", { level: 1, name: "Bus Master" }),
      ).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Vehicles" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Seat charts" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Crew" })).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: "Master" })).toBeNull();
      await user.click(masterToggle);
      await user.click(screen.getByRole("button", { name: "Area Master" }));
      expect(
        screen.getByRole("heading", { level: 1, name: "Area Master" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("tab", { name: "Pickup & drop points" }),
      ).toBeTruthy();
      await user.click(masterToggle);
      await user.click(screen.getByRole("button", { name: "Trip Master" }));
      expect(
        screen.getByRole("heading", { level: 1, name: "Trip Master" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("tab", { name: "Multi-trip scheduling" }),
      ).toBeTruthy();
      await user.click(screen.getByRole("tab", { name: "Routes" }));
      await user.click(screen.getByRole("button", { name: "Add route" }));
      const routeDialog = screen.getByRole("dialog", { name: "Add route" });
      expect(within(routeDialog).getByLabelText("From city")).toBeTruthy();
      await user.click(
        within(routeDialog).getByRole("button", { name: "Cancel" }),
      );
      expect(
        screen.getByRole("heading", { level: 1, name: "Trip Master" }),
      ).toBeTruthy();
      await user.click(screen.getByRole("tab", { name: "Scheduled trips" }));
      expect(
        screen.getByRole("button", { name: "Schedule a trip" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("heading", { level: 1, name: "Trip Master" }),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Trip Master" })).toBeNull();
      await user.click(masterToggle);
      expect(
        screen.getByRole("heading", { level: 1, name: "Master" }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Bus Master" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Area Master" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Trip Master" })).toBeTruthy();
      expect(screen.queryByRole("dialog", { name: "Master" })).toBeNull();
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
  it("opens all eleven screens and supports booking search and no-results recovery", async () => {
    const user = userEvent.setup();
    render(<App demo />);
    const labels = [
      "Seat inventory",
      "Bookings & tickets",
      "Passenger manifest",
      "Fare & pricing",
      "Cancellations & refunds",
      "Offers & promotions",
      "Reports & earnings",
      "Operator settings",
    ];
    for (const name of labels) {
      await user.click(screen.getByRole("button", { name }));
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(name);
      expect(document.querySelector(".app.workspace-crs")).toBeTruthy();
      expect(screen.getByRole("button", { name }).getAttribute("title")).toBe(
        name,
      );
    }
    await user.click(
      screen.getByRole("button", { name: "Bookings & tickets" }),
    );
    const search = screen.getByRole("textbox", { name: "Search bookings" });
    await user.type(search, "AIB683420");
    expect(screen.getByText("Aarav Sharma")).toBeTruthy();
    expect(screen.queryByText("Priya Patel")).toBeNull();
    await user.clear(search);
    await user.type(search, "no-such-passenger");
    expect(screen.getByText("No matching bookings")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Priya Patel")).toBeTruthy();
  });
  it("validates and creates a bus, then persists the new fleet record", async () => {
    const user = userEvent.setup();
    render(<App demo />);
    await user.click(screen.getByRole("button", { name: "Master" }));
    await user.click(screen.getByRole("button", { name: "Bus Master" }));
    await user.click(screen.getByRole("button", { name: "Add bus" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(
      screen.getByText(/Enter a vehicle registration number with/),
    ).toBeTruthy();
    const registration = within(dialog).getByLabelText(
      "Vehicle registration number",
    );
    await user.type(registration, "001");
    // Complete the remaining fields before checking invalid registration on save.
    const fields = {
      Name: "Aibus Test",

      Capacity: "36",
    };
    for (const [label, value] of Object.entries(fields))
      await user.type(
        within(dialog).getByLabelText(new RegExp(`^${label}`)),
        value,
      );
    await user.selectOptions(
      within(dialog).getByLabelText("Type"),
      "AC Sleeper",
    );
    await user.selectOptions(within(dialog).getByLabelText("Status"), "Active");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(
      screen.getByText(/Enter a vehicle registration number with/),
    ).toBeTruthy();
    expect(document.activeElement).toBe(registration);
    await user.clear(registration);
    await user.type(registration, "TS 09 ZZ 9999");
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    expect(screen.getByText("TS 09 ZZ 9999")).toBeTruthy();
    expect(localStorage.getItem("aibus-fleet")).toBeNull();
  });
  it("blocks and releases berths without enabling booked berths", async () => {
    const user = userEvent.setup();
    render(<App demo />);
    await user.click(screen.getByRole("button", { name: "Seat inventory" }));
    const booked = screen.getByRole("button", {
      name: "L2, booked, 1450 rupees",
    }) as HTMLButtonElement;
    expect(booked.disabled).toBe(true);
    await user.click(
      screen.getByRole("button", { name: "L1, available, 1450 rupees" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Block selected berths" }),
    );
    await user.click(
      screen.getByRole("button", { name: "L1, blocked, 1450 rupees" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Release blocked berths" }),
    );
    expect(
      screen.getByRole("button", { name: "L1, available, 1450 rupees" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Upper deck" }));
    expect(
      screen.getByRole("button", { name: "U1, available, 1350 rupees" }),
    ).toBeTruthy();
  });
  it("shows the booking ticket drawer and toggles passenger check-in", async () => {
    const user = userEvent.setup();
    render(<App demo />);
    await user.click(
      screen.getByRole("button", { name: "Bookings & tickets" }),
    );
    await user.click(
      screen.getAllByRole("button", { name: "View details" })[0],
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("PNR AIB683420")).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Print e-ticket" }),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", { name: "Close details" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Passenger manifest" }),
    );
    await user.click(
      screen.getAllByRole("button", { name: "Toggle check-in" })[0],
    );
    expect(screen.queryByText("Checked in")).toBeNull();
  });
});
