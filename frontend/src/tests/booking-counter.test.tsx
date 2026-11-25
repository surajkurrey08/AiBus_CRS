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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { api, ApiError } from "../api/client.ts";
import { SeatMap } from "../components/seats/SeatMap.tsx";
import { counterApi } from "../features/booking-counter/api/counter.api.ts";
import { BookingCounter } from "../features/booking-counter/BookingCounter.tsx";
const state = vi.hoisted(() => ({
  held: false,
  permissions: [
    "read",
    "bookings:write",
    "inventory:write",
    "pricing:write",
    "routes:write",
    "manifest:read",
    "finance:read",
  ],
  refresh: vi.fn(async () => {}),
  notify: vi.fn(),
}));
vi.mock("../context/WorkspaceContext.tsx", () => ({
  useWorkspace: () => ({
    revision: 0,
    user: { role: "operator_admin", permissions: state.permissions },
    refresh: state.refresh,
    notify: state.notify,
  }),
}));
vi.mock("../features/booking-counter/api/counter.api.ts", () => ({
  counterApi: {
    search: vi.fn(),
    seats: vi.fn(),
    quote: vi.fn(),
    hold: vi.fn(),
    release: vi.fn(),
    bookings: vi.fn(),
    policy: vi.fn(),
  },
  ticketHtml: vi.fn(),
}));
vi.mock("../api/client.ts", () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
const trip = {
  id: "123456789012345678901234",
  routeId: "route-1",
  busId: "bus-1",
  route: "Hyderabad → Bangalore",
  source: "Hyderabad",
  destination: "Bangalore",
  boarding: [{ name: "Miyapur" }],
  dropping: [{ name: "Hebbal" }],
  busName: "Aibus Premium",
  registration: "TS09AA1000",
  busType: "AC Sleeper",
  journeyDate: "2030-11-13",
  departureAt: "2030-11-13T16:00:00Z",
  arrivalAt: "2030-11-14T01:00:00Z",
  bookingOpen: true,
  version: 0,
  inventoryOwner: "internal" as const,
  totalSeats: 4,
  availableSeats: 2,
  bookedSeats: 1,
  blockedSeats: 0,
  quotaSeats: 1,
  baseFarePaise: 145000,
  capabilities: {
    inventory: true,
    quote: true,
    confirmation: false,
    payment: false,
  },
};
const baseSeats = [
  {
    number: "L1",
    deck: "lower" as const,
    row: 0,
    column: 0,
    category: "sleeper" as const,
    farePaise: 145000,
    state: "available" as const,
  },
  {
    number: "L2",
    deck: "lower" as const,
    row: 0,
    column: 1,
    category: "sleeper" as const,
    farePaise: 145000,
    state: "booked" as const,
  },
  {
    number: "L3",
    deck: "lower" as const,
    row: 0,
    column: 3,
    category: "sleeper" as const,
    farePaise: 145000,
    state: "quota" as const,
    quotaLabel: "Crew",
  },
  {
    number: "U1",
    deck: "upper" as const,
    row: 0,
    column: 0,
    category: "sleeper" as const,
    farePaise: 135000,
    state: "available" as const,
  },
];
beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function () {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function () {
      this.removeAttribute("open");
    },
  });
});
beforeEach(() => {
  vi.clearAllMocks();
  state.held = false;
  state.permissions = [
    "read",
    "bookings:write",
    "inventory:write",
    "pricing:write",
    "routes:write",
    "manifest:read",
    "finance:read",
  ];
  vi.mocked(counterApi.search).mockResolvedValue({
    data: [trip],
    meta: { page: 1, limit: 10, total: 1, pages: 1 },
  });
  vi.mocked(counterApi.seats).mockImplementation(async () => ({
    data: {
      tripId: trip.id,
      inventoryOwner: "internal",
      seats: baseSeats.map((s) =>
        s.number === "L1" && state.held ? { ...s, state: "held" } : s,
      ),
    },
  }));
  vi.mocked(counterApi.policy).mockResolvedValue({
    data: {
      taxBasisPoints: 500,
      chargePaise: 10000,
      chargesTaxable: false,
      operatorDiscountMaxPaise: 10000,
      requireAge: false,
      requireGender: false,
      requireMobile: true,
      gstEnabled: false,
      version: 1,
    },
  });
  vi.mocked(counterApi.bookings).mockResolvedValue({
    data: {
      bookings: [],
      sourceCounts: { operator: 0, customer: 0, agent: 0, external: 0 },
    },
    meta: { page: 1, limit: 6, total: 0, pages: 1 },
  });
  vi.mocked(counterApi.quote).mockImplementation(async (_id, input) => ({
    data: {
      quoteId: "quote-1",
      holdId: input.holdId,
      expiresAt: new Date(Date.now() + 120000).toISOString(),
      pricing: {
        currency: "INR",
        seatFares: input.seats.map((number) => ({ number, basePaise: 145000 })),
        grossPaise: 145000,
        discountPaise: 0,
        taxablePaise: 145000,
        taxBasisPoints: 500,
        taxPaise: 7250,
        chargePaise: 10000,
        chargesTaxable: false,
        totalPaise: 162250,
        policyVersion: 1,
        requirements: {
          age: false,
          gender: false,
          mobile: true,
          gstEnabled: false,
        },
      },
    },
  }));
  vi.mocked(counterApi.hold).mockImplementation(async () => {
    state.held = true;
    return {
      data: {
        holdId: "hold-1",
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        amountPaise: 145000,
        seats: ["L1"],
      },
    };
  });
  vi.mocked(counterApi.release).mockImplementation(async () => {
    state.held = false;
    return { data: { released: true } };
  });
  vi.mocked(api).mockResolvedValue({
    data: {
      _id: "booking-1",
      reference: "AB-SERVER-1",
      status: "Pending payment",
    },
  });
});
afterEach(() => cleanup());
async function submitSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Counter from"), "Pune");
  await user.type(screen.getByLabelText("Counter to"), "Mumbai");
  await user.click(screen.getByRole("button", { name: "Search trips" }));
}
describe("Booking Counter", () => {
  it("disables booked and blocked seats for booking and keeps release management separate", async () => {
    const user = userEvent.setup();
    vi.mocked(counterApi.seats).mockResolvedValue({
      data: {
        tripId: trip.id,
        inventoryOwner: "internal",
        seats: baseSeats.map((s) =>
          s.number === "U1" ? { ...s, state: "blocked" } : s,
        ),
      },
    } as any);
    render(<BookingCounter />);
    await submitSearch(user);
    const blocked = await screen.findByRole("button", {
      name: "U1, blocked, 1350 rupees",
    });
    const booked = screen.getByRole("button", {
      name: "L2, booked, 1450 rupees",
    });
    expect((blocked as HTMLButtonElement).disabled).toBe(true);
    expect((booked as HTMLButtonElement).disabled).toBe(true);
    await user.click(blocked);
    expect(counterApi.hold).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Manage blocked / quota seats" }),
    );
    expect((blocked as HTMLButtonElement).disabled).toBe(false);
    await user.click(blocked);
    expect(
      (
        screen.getByRole("button", {
          name: "Hold seats & add passengers",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Unblock seats",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(counterApi.hold).not.toHaveBeenCalled();
  });
  it("requests no trips or inventory until a complete search is submitted", async () => {
    const user = userEvent.setup();
    render(<BookingCounter />);
    expect(counterApi.search).not.toHaveBeenCalled();
    expect(counterApi.seats).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "L1, available, 1450 rupees" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Search trips" }));
    expect(counterApi.search).not.toHaveBeenCalled();
    await submitSearch(user);
    await screen.findByRole("button", { name: "L1, available, 1450 rupees" });
    expect(counterApi.search).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Pune",
        to: "Mumbai",
        journeyDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        page: 1,
      }),
      expect.any(AbortSignal),
    );
    vi.mocked(counterApi.search).mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 10, total: 0, pages: 1 },
    });
    // Native date inputs are changed directly to model a different journey day.
    fireEvent.change(screen.getByLabelText("Counter journey date"), {
      target: { value: "2027-01-03" },
    });
    await user.click(screen.getByRole("button", { name: "Search trips" }));
    await screen.findByText(/No authorized trips for this search/);
    expect(
      screen.queryByRole("button", { name: "L1, available, 1450 rupees" }),
    ).toBeNull();
  });
  it("shows selected-seat base fare and an actionable error when final pricing is unavailable", async () => {
    const user = userEvent.setup();
    vi.mocked(counterApi.policy).mockResolvedValue({ data: null } as any);
    vi.mocked(counterApi.quote).mockRejectedValue(
      new ApiError(
        409,
        "PRICING_POLICY_REQUIRED",
        "Configure tax and charge rules before bookings can be priced",
      ),
    );
    render(<BookingCounter />);
    await submitSearch(user);
    await user.click(
      await screen.findByRole("button", { name: "L1, available, 1450 rupees" }),
    );
    await user.click(
      screen.getByRole("button", { name: "U1, available, 1350 rupees" }),
    );
    expect(screen.getByLabelText("Base fare").textContent).toBe("₹2,800");
    await screen.findByText(
      /Configure tax and charge rules before bookings can be priced/,
    );
    expect(screen.getByLabelText("Grand total").textContent).toBe("—");
    expect(
      screen.getByRole("button", { name: "Configure pricing" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Hold seats & add passengers",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(
      screen.getByRole("button", { name: "U1, available, 1350 rupees" }),
    );
    expect(screen.getByLabelText("Base fare").textContent).toBe("₹1,450");
  });
  it("swaps route fields and submits the swapped cities without inventing a fare", async () => {
    const user = userEvent.setup();
    render(<BookingCounter />);

    expect(screen.getByLabelText("Grand total").textContent).toBe("—");
    await user.type(screen.getByLabelText("Counter from"), "Pune");
    await user.type(screen.getByLabelText("Counter to"), "Ahmednagar");
    await user.click(
      screen.getByRole("button", { name: "Swap origin and destination" }),
    );
    expect(
      (screen.getByLabelText("Counter from") as HTMLInputElement).value,
    ).toBe("Ahmednagar");
    expect(
      (screen.getByLabelText("Counter to") as HTMLInputElement).value,
    ).toBe("Pune");
    await user.click(screen.getByRole("button", { name: "Search trips" }));
    await waitFor(() =>
      expect(counterApi.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: "Ahmednagar", to: "Pune", page: 1 }),
        expect.any(AbortSignal),
      ),
    );
  });
  it("shows both decks in the CRS chart without overlapping their coordinates", async () => {
    const user = userEvent.setup(),
      toggle = vi.fn();
    render(
      <SeatMap
        variant="counter-chart"
        seats={baseSeats}
        selected={[]}
        onToggle={toggle}
      />,
    );
    const lower = screen.getByRole("button", {
      name: "L1, available, 1450 rupees",
    });
    const upper = screen.getByRole("button", {
      name: "U1, available, 1350 rupees",
    });
    expect(lower.style.gridRow).toBe("2");
    expect(upper.style.gridRow).toBe("2");
    expect(upper.style.gridColumn).toBe("6");
    expect(screen.getByText("Lower deck · 3")).toBeTruthy();
    expect(screen.getByText("Upper deck · 1")).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    await user.click(upper);
    expect(toggle).toHaveBeenCalledWith("U1");
  });
  it("reuses real seat positions, distinguishes quotas and switches decks with keyboard support", async () => {
    const user = userEvent.setup(),
      toggle = vi.fn();
    render(<SeatMap seats={baseSeats} selected={[]} onToggle={toggle} />);
    const quota = screen.getByRole("button", {
      name: "L3, quota, 1450 rupees, quota Crew",
    });
    expect(quota.style.gridColumn).toBe("4");
    expect(
      (
        screen.getByRole("button", {
          name: "L2, booked, 1450 rupees",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(
      screen.getByRole("button", { name: "L1, available, 1450 rupees" }),
    );
    expect(toggle).toHaveBeenCalledWith("L1");
    const upper = screen.getByRole("tab", { name: /Upper deck/ });
    await user.click(upper);
    expect(
      screen.getByRole("button", { name: "U1, available, 1350 rupees" }),
    ).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(
      screen.getByRole("button", { name: "L1, available, 1450 rupees" }),
    ).toBeTruthy();
  });
  it("loads authorized trips and uses the server total while retaining selection after a hold", async () => {
    const user = userEvent.setup();
    render(<BookingCounter />);
    await submitSearch(user);
    await user.click(
      await screen.findByRole("button", { name: "L1, available, 1450 rupees" }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Hold seats & add passengers",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(screen.getByText("₹1,622.5")).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Hold seats & add passengers" }),
    );
    const name = await screen.findByLabelText("Passenger full name L1");
    expect(name).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByLabelText("Booking contact mobile"),
    );
    expect(screen.getByText(/Seats held for/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "L1, held by you, 1450 rupees" }),
    ).toBeTruthy();
    expect(counterApi.hold).toHaveBeenCalledWith(trip.id, ["L1"]);
    await waitFor(() =>
      expect(counterApi.quote).toHaveBeenCalledWith(
        trip.id,
        expect.objectContaining({ holdId: "hold-1", seats: ["L1"] }),
        expect.any(AbortSignal),
      ),
    );
    await user.type(
      screen.getByLabelText("Booking contact mobile"),
      "9876543210",
    );
    await user.type(name, "Actual Passenger");
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Review booking",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "Review booking" }));
    const dialog = screen.getByRole("dialog", {
      name: "Review counter booking",
    });
    await user.dblClick(
      within(dialog).getByRole("button", { name: "Create pending booking" }),
    );
    await screen.findByText("AB-SERVER-1");
    const mutation = vi
      .mocked(api)
      .mock.calls.filter(([path]) => path === "/operator/bookings");
    expect(mutation).toHaveLength(1);
    const body = JSON.parse(String(mutation[0][1]?.body));
    expect(body).toMatchObject({
      quoteId: "quote-1",
      tripId: trip.id,
      holdId: "hold-1",
      contact: { phone: "9876543210" },
    });
    expect(body).not.toHaveProperty("totalPaise");
    expect(body).not.toHaveProperty("source");
    expect(
      screen.queryByRole("button", { name: "Confirm booking" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Pay with Razorpay (test)" }),
    ).toBeNull();
    expect(screen.queryByText(/^PNR /)).toBeNull();
  });
  it("hides unauthorized inventory and pricing controls for read-only staff", async () => {
    const user = userEvent.setup();
    state.permissions = ["read"];
    render(<BookingCounter />);
    await submitSearch(user);
    await screen.findByRole("button", { name: "L1, available, 1450 rupees" });
    expect(screen.queryByRole("button", { name: "Block seats" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop booking" })).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Pricing rules",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "L1, available, 1450 rupees",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Hold seats & add passengers" }),
    ).toBeNull();
  });
  it("requires confirmation before stopping bookings and submits the current server version", async () => {
    const user = userEvent.setup();
    vi.mocked(api).mockImplementation(async () => {
      vi.mocked(counterApi.search).mockResolvedValue({
        data: [{ ...trip, bookingOpen: false, version: 1 }],
        meta: { page: 1, limit: 10, total: 1, pages: 1 },
      });
      return { data: { bookingOpen: false, version: 1 } };
    });
    render(<BookingCounter />);
    await submitSearch(user);
    await user.click(
      await screen.findByRole("button", { name: "Stop booking" }),
    );
    expect(api).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Stop new bookings?" });
    await user.click(
      within(dialog).getByRole("button", { name: "Stop booking" }),
    );
    await screen.findByRole("button", { name: "Resume booking" });
    expect(api).toHaveBeenCalledWith(
      `/operator/trips/${trip.id}/booking-status`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ open: false, expectedVersion: 0 }),
      }),
    );
  });
  it("recovers an uncertain create response with the identical payload and idempotency key", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith("/operator/trip-master/partners"))
        return { data: [] };
      if (path === "/operator/bookings" && attempts++ === 0)
        throw new ApiError(0, "NETWORK_ERROR", "Response unavailable");
      return {
        data: {
          _id: "recovered-1",
          reference: "AB-RECOVERED",
          status: "Pending payment",
        },
      };
    });
    render(<BookingCounter />);
    await submitSearch(user);
    await user.click(
      await screen.findByRole("button", { name: "L1, available, 1450 rupees" }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Hold seats & add passengers",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    await user.click(
      screen.getByRole("button", { name: "Hold seats & add passengers" }),
    );
    await user.type(
      await screen.findByLabelText("Passenger full name L1"),
      "Recovered Passenger",
    );
    await user.type(
      screen.getByLabelText("Booking contact mobile"),
      "9876543210",
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Review booking",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "Review booking" }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Review counter booking" }),
      ).getByRole("button", { name: "Create pending booking" }),
    );
    const recover = await screen.findByRole("button", {
      name: "Recover booking request",
    });
    expect(screen.queryByText("AB-RECOVERED")).toBeNull();
    await user.click(recover);
    await screen.findByText("AB-RECOVERED");
    const requests = vi
      .mocked(api)
      .mock.calls.filter(([path]) => path === "/operator/bookings");
    expect(requests).toHaveLength(2);
    expect(requests[1][1]?.body).toBe(requests[0][1]?.body);
    expect(requests[1][1]?.headers).toEqual(requests[0][1]?.headers);
  });
  it("shows a real search failure with retry and never substitutes fixture trips", async () => {
    vi.mocked(counterApi.search).mockRejectedValue(
      new Error("Operator API unavailable"),
    );
    const user = userEvent.setup();
    render(<BookingCounter />);
    await submitSearch(user);
    await screen.findByText("Operator API unavailable");
    expect(screen.queryByText("Aibus Premium")).toBeNull();
    vi.mocked(counterApi.search).mockResolvedValue({
      data: [trip],
      meta: { page: 1, limit: 10, total: 1, pages: 1 },
    });
    await user.click(screen.getByRole("button", { name: "Retry search" }));
    await screen.findByText("Aibus Premium");
  });
});
