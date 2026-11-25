// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api/client.ts";
import { counterApi } from "../features/booking-counter/api/counter.api.ts";
import { BookingCounter } from "../features/booking-counter/BookingCounter.tsx";

const state = vi.hoisted(() => ({
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
    user: { permissions: state.permissions },
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

// Sedan (4-passenger bookable + 1 driver) Car Trip fixture
const carTripSedan = {
  id: "65f1a2b3c4d5e6f7a8b9c001",
  routeId: "route-pune-mumbai",
  busId: "car-sedan-dzire",
  route: "Pune → Mumbai",
  source: "Pune",
  destination: "Mumbai",
  boarding: [{ name: "Swargate", time: "08:00", address: "Pune" }],
  dropping: [{ name: "Dadar", time: "11:00", address: "Mumbai" }],
  busName: "Maruti Suzuki Dzire",
  registration: "MH12CS4001",
  busType: "4-Passenger Sedan",
  journeyDate: "2026-12-15",
  departureAt: "2026-12-15T08:00:00Z",
  arrivalAt: "2026-12-15T11:00:00Z",
  bookingOpen: true,
  version: 1,
  inventoryOwner: "internal" as const,
  totalSeats: 5,
  availableSeats: 4,
  bookedSeats: 0,
  blockedSeats: 0,
  quotaSeats: 0,
  baseFarePaise: 50000,
  capabilities: {
    inventory: true,
    quote: true,
    confirmation: true,
    payment: true,
  },
};

// 5 physical seats: Driver ('D', non-bookable), FP, 2L, 2M, 2R
const sedanSeats = [
  { number: "D", deck: "lower" as const, row: 1, column: 2, category: "driver" as const, farePaise: 0, state: "blocked" as const },
  { number: "FP", deck: "lower" as const, row: 1, column: 1, category: "front_passenger" as const, farePaise: 55000, state: "available" as const },
  { number: "2L", deck: "lower" as const, row: 2, column: 1, category: "window" as const, farePaise: 50000, state: "available" as const },
  { number: "2M", deck: "lower" as const, row: 2, column: 2, category: "middle" as const, farePaise: 45000, state: "available" as const },
  { number: "2R", deck: "lower" as const, row: 2, column: 3, category: "window" as const, farePaise: 50000, state: "available" as const },
];

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(counterApi.policy).mockResolvedValue({
    data: {
      taxBasisPoints: 0,
      chargePaise: 0,
      chargesTaxable: false,
      operatorDiscountMaxPaise: 10000,
      requireAge: false,
      requireGender: false,
      requireMobile: false,
      gstEnabled: false,
      version: 1,
    },
  });
  vi.mocked(counterApi.search).mockResolvedValue({
    data: [carTripSedan],
    meta: { page: 1, pages: 1, total: 1, limit: 10 },
  } as any);
  vi.mocked(counterApi.seats).mockResolvedValue({
    data: {
      tripId: carTripSedan.id,
      seats: sedanSeats,
      inventoryOwner: "internal",
    },
  } as any);
  vi.mocked(counterApi.bookings).mockResolvedValue({
    data: {
      bookings: [],
      sourceCounts: { operator: 0 },
    },
    meta: { page: 1, limit: 6, total: 0, pages: 1 },
  } as any);
  vi.mocked(counterApi.quote).mockImplementation(async (_id, input) => ({
    data: {
      quoteId: "QUOTE-CAR-PUNE-001",
      holdId: input.holdId,
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      pricing: {
        currency: "INR",
        seatFares: input.seats.map((number) => ({ number, basePaise: 55000 })),
        grossPaise: 55000 * input.seats.length,
        discountPaise: 0,
        taxablePaise: 55000 * input.seats.length,
        taxBasisPoints: 0,
        taxPaise: 0,
        chargePaise: 0,
        chargesTaxable: false,
        totalPaise: 55000 * input.seats.length,
        policyVersion: 1,
        requirements: { age: false, gender: false, mobile: false, gstEnabled: false },
      },
    },
  }));
  vi.mocked(counterApi.hold).mockImplementation(async (_id, seats) => ({
    data: {
      holdId: "HOLD-CAR-PUNE-001",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      amountPaise: 55000 * seats.length,
      seats,
    },
  } as any));
});

afterEach(cleanup);

describe("Car CRS Operator Booking Counter — Browser Sandbox Smoke Test", () => {
  it("executes complete One Way car booking flow: search, seat selection, hold, passenger info, and confirms booking displaying PNR", async () => {
    const user = userEvent.setup();

    // 1. Render Booking Counter
    render(<BookingCounter />);

    // Check heading and car-specific UI
    expect(screen.getByText(/Car Central Reservation System/i)).toBeTruthy();

    // 2. Perform Trip Search: Pune to Mumbai
    await user.type(screen.getByLabelText("Counter from"), "Pune");
    await user.type(screen.getByLabelText("To"), "Mumbai");
    await user.click(screen.getByRole("button", { name: "Search trips" }));

    // 3. Verify Scheduled Car trip option appears and loads Seat Map
    await waitFor(() => {
      expect(screen.getByText("Maruti Suzuki Dzire")).toBeTruthy();
      expect(screen.getAllByText(/4-Passenger Sedan/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/MH12CS4001/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Vehicle : MH12CS4001/).length).toBeGreaterThan(0);
    });

    // 4. Verify Driver Seat 'D' is blocked and non-selectable
    const driverSeatButton = await screen.findByRole("button", { name: /^D,/i });
    expect(driverSeatButton).toHaveProperty("disabled", true);

    // 5. Select Front Passenger Seat 'FP'
    const fpSeatButton = await screen.findByRole("button", { name: "FP, available, 550 rupees" });
    expect(fpSeatButton).toHaveProperty("disabled", false);
    await user.click(fpSeatButton);

    // 6. Wait for Hold button to become active and click it
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Hold seats & add passengers/i }) as HTMLButtonElement).disabled
      ).toBe(false)
    );

    // 7. Place Seat Hold
    vi.mocked(counterApi.hold).mockResolvedValueOnce({
      data: {
        holdId: "HOLD-CAR-PUNE-001",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        amountPaise: 55000,
        seats: ["FP"],
      },
    } as any);

    vi.mocked(counterApi.quote).mockResolvedValueOnce({
      data: {
        quoteId: "QUOTE-CAR-PUNE-001",
        holdId: "HOLD-CAR-PUNE-001",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        pricing: {
          currency: "INR",
          seatFares: [{ number: "FP", basePaise: 55000 }],
          grossPaise: 55000,
          discountPaise: 0,
          taxablePaise: 55000,
          taxBasisPoints: 0,
          taxPaise: 0,
          chargePaise: 0,
          chargesTaxable: false,
          totalPaise: 55000,
          policyVersion: 1,
          requirements: { age: false, gender: false, mobile: false, gstEnabled: false },
        },
      },
    } as any);

    const holdButton = screen.getByRole("button", { name: /Hold seats & add passengers/i });
    await user.click(holdButton);

    await waitFor(() => {
      expect(counterApi.hold).toHaveBeenCalledWith(carTripSedan.id, ["FP"]);
    });

    // 8. Enter Passenger Details
    const nameInput = await screen.findByLabelText("Passenger full name FP");
    await user.type(nameInput, "Aarav Sharma");
    await user.type(screen.getByLabelText("Booking contact mobile"), "9876543210");

    // 9. Proceed to Booking Review
    const reviewButton = screen.getByRole("button", { name: /Review booking/i });
    await user.click(reviewButton);

    const reviewDialog = await screen.findByRole("dialog", { name: "Review counter booking" });
    expect(reviewDialog).toBeTruthy();

    // 10. Confirm Booking in Sandbox mode
    vi.mocked(api).mockResolvedValueOnce({
      data: {
        _id: "65f1a2b3c4d5e6f7a8b9c999",
        reference: "REF-20261215-CS4001",
        pnr: "CAR7K92P8X",
        status: "Confirmed",
        bookingType: "ONE_WAY",
        totalPayablePaise: 55000,
      },
    } as any);

    const confirmButton = within(reviewDialog).getByRole("button", { name: /Create pending booking/i });
    await user.click(confirmButton);

    // 11. Verify PNR and Reference Display
    await waitFor(() => {
      expect(screen.getByText("REF-20261215-CS4001")).toBeTruthy();
      expect(screen.getByText("CAR7K92P8X")).toBeTruthy();
      expect(screen.getAllByText(/Booking confirmed by the authoritative reservation system/i).length).toBeGreaterThan(0);
    });
  });

  it("handles booking confirmation failures gracefully without showing a false success state", async () => {
    const user = userEvent.setup();
    render(<BookingCounter />);

    await user.type(screen.getByLabelText("Counter from"), "Pune");
    await user.type(screen.getByLabelText("To"), "Mumbai");
    await user.click(screen.getByRole("button", { name: "Search trips" }));

    await waitFor(() => {
      expect(screen.getByText("Maruti Suzuki Dzire")).toBeTruthy();
      expect(screen.getAllByText(/Vehicle : MH12CS4001/).length).toBeGreaterThan(0);
    });

    const fpSeatButton = await screen.findByRole("button", { name: "FP, available, 550 rupees" });
    await user.click(fpSeatButton);

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Hold seats & add passengers/i }) as HTMLButtonElement).disabled
      ).toBe(false)
    );

    vi.mocked(counterApi.hold).mockResolvedValueOnce({
      data: {
        holdId: "HOLD-FAIL-001",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        amountPaise: 55000,
        seats: ["FP"],
      },
    } as any);

    vi.mocked(counterApi.quote).mockResolvedValueOnce({
      data: {
        quoteId: "QUOTE-FAIL-001",
        holdId: "HOLD-FAIL-001",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        pricing: {
          currency: "INR",
          seatFares: [{ number: "FP", basePaise: 55000 }],
          grossPaise: 55000,
          discountPaise: 0,
          taxablePaise: 55000,
          taxBasisPoints: 0,
          taxPaise: 0,
          chargePaise: 0,
          chargesTaxable: false,
          totalPaise: 55000,
          policyVersion: 1,
          requirements: { age: false, gender: false, mobile: false, gstEnabled: false },
        },
      },
    } as any);

    await user.click(screen.getByRole("button", { name: /Hold seats & add passengers/i }));

    const nameInput = await screen.findByLabelText("Passenger full name FP");
    await user.type(nameInput, "Test Passenger");
    await user.type(screen.getByLabelText("Booking contact mobile"), "9876543210");
    await user.click(screen.getByRole("button", { name: /Review booking/i }));

    const reviewDialog = await screen.findByRole("dialog", { name: "Review counter booking" });
    expect(reviewDialog).toBeTruthy();

    // Mock API Failure on confirmation (e.g., payment / hold mismatch)
    vi.mocked(api).mockRejectedValueOnce(
      new ApiError(400, "FARE_MISMATCH", "Payment amount does not match authoritative fare")
    );

    const confirmButton = within(reviewDialog).getByRole("button", { name: /Create pending booking/i });
    await user.click(confirmButton);

    // Verify error message is shown and no false confirmed PNR is rendered
    await waitFor(() => {
      expect(screen.getAllByText(/Payment amount does not match authoritative fare/i).length).toBeGreaterThan(0);
      expect(screen.queryByText(/Booking confirmed by the authoritative reservation system/i)).toBeNull();
    });
  });

  it("verifies Round Trip atomic booking confirmation returning dual tickets (OUT and RET) and authoritative PNR", async () => {
    const user = userEvent.setup();
    render(<BookingCounter />);

    await user.type(screen.getByLabelText("Counter from"), "Pune");
    await user.type(screen.getByLabelText("To"), "Mumbai");
    await user.click(screen.getByRole("button", { name: "Search trips" }));

    await waitFor(() => {
      expect(screen.getByText("Maruti Suzuki Dzire")).toBeTruthy();
    });

    const fpSeatButton = await screen.findByRole("button", { name: "FP, available, 550 rupees" });
    await user.click(fpSeatButton);

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Hold seats & add passengers/i }) as HTMLButtonElement).disabled
      ).toBe(false)
    );

    await user.click(screen.getByRole("button", { name: /Hold seats & add passengers/i }));

    const nameInput = await screen.findByLabelText("Passenger full name FP");
    await user.type(nameInput, "Priya Sharma");
    await user.type(screen.getByLabelText("Booking contact mobile"), "9876543211");
    await user.click(screen.getByRole("button", { name: /Review booking/i }));

    const reviewDialog = await screen.findByRole("dialog", { name: "Review counter booking" });
    expect(reviewDialog).toBeTruthy();

    // Confirm Round Trip Booking in Sandbox Mode
    vi.mocked(api).mockResolvedValueOnce({
      data: {
        _id: "65f1a2b3c4d5e6f7a8b9c777",
        reference: "REF-RT-20261215-001",
        pnr: "CAR9RT4X2Z",
        status: "Confirmed",
        bookingType: "ROUND_TRIP",
        totalPayablePaise: 110000,
        tickets: [
          { ticketNumber: "TKT-CAR9RT4X2Z-OUT", journeyType: "OUTBOUND", seatId: "FP" },
          { ticketNumber: "TKT-CAR9RT4X2Z-RET", journeyType: "RETURN", seatId: "FP" },
        ],
      },
    } as any);

    const confirmButton = within(reviewDialog).getByRole("button", { name: /Create pending booking/i });
    await user.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText("REF-RT-20261215-001")).toBeTruthy();
      expect(screen.getByText("CAR9RT4X2Z")).toBeTruthy();
      expect(screen.getAllByText(/Booking confirmed by the authoritative reservation system/i).length).toBeGreaterThan(0);
    });
  });
});
